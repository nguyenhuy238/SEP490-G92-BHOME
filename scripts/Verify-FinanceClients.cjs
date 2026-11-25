// Only synthetic credentials from the disposable .NET harness, delivered through stdin.
const path = require('node:path');
const { readFileSync, mkdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { Agent } = require('node:https');
async function main(settings) {
  const root = path.resolve(__dirname, '..');
  assert.equal(new URL(settings.baseUrl).hostname, 'localhost');
  const { build, preview } = await import(
    pathToFileURL(require.resolve('vite', { paths: [path.join(root, 'src/owner-web')] })).href
  );
  const { chromium } = require(path.join(root, '.tools/contract-browser/node_modules/playwright'));
  process.env.VITE_API_MODE = 'api';
  // Keep deploy URL validation intact. This isolated browser run uses the same-origin
  // local transport, with a proxy that trusts only the harness certificate.
  process.env.VITE_API_BASE_URL = 'https://api.example.com';
  const apiProxy = {
    target: settings.baseUrl,
    changeOrigin: true,
    secure: true,
    agent: new Agent({ ca: readFileSync(path.join(settings.temporary, 'ca.pem')) }),
  };
  const config = {
    root: path.join(root, 'src/owner-web'),
    configFile: path.join(root, 'src/owner-web/vite.config.ts'),
    envDir: settings.temporary,
    logLevel: 'error',
    define: { 'import.meta.env.DEV': 'true' },
    build: { outDir: path.join(settings.temporary, 'owner-web'), emptyOutDir: false },
    preview: {
      host: 'localhost',
      port: settings.webPort,
      strictPort: true,
      https: { pfx: readFileSync(settings.pfxPath), passphrase: settings.pfxPassword },
      proxy: { '/api': apiProxy, '/open/sign-contract': apiProxy },
    },
  };
  await build(config);
  const web = await preview(config);
  let browser;
  let page;
  const errors = [];
  const screenshots = path.join(root, '.tools', 'finance-browser-acceptance');
  mkdirSync(screenshots, { recursive: true });
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    // This context trusts only synthetic localhost traffic for this test. No OS trust changes.
    // TLS certificate trust itself is not an acceptance claim of this browser test.
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1920, height: 1080 },
    });
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.name));
    page.on('response', (response) => {
      if (
        (response.url().startsWith(settings.baseUrl + '/') ||
          response.url().startsWith(settings.origin + '/api/')) &&
        response.status() >= 500
      )
        errors.push('HTTP ' + response.status() + ' ' + new URL(response.url()).pathname);
    });
    async function capture(name) {
      for (const [width, height] of [
        [1920, 1080],
        [1366, 768],
        [768, 1024],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate('document.fonts.ready');
        await page.screenshot({
          path: path.join(screenshots, name + '-' + width + '.png'),
          fullPage: true,
          animations: 'disabled',
        });
        const overflow = await page.evaluate(
          'document.documentElement.scrollWidth - document.documentElement.clientWidth',
        );
        assert.ok(overflow <= 1, name + ' horizontal overflow at ' + width + ': ' + overflow);
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
    await page.goto(settings.origin + '/expenses', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email hoặc số điện thoại', { exact: true }).fill(settings.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(settings.password);
    await page.getByRole('button', { name: 'Đăng nhập vào hệ thống', exact: true }).click();
    await page.getByRole('heading', { name: 'Đầu tư ban đầu & Chi phí', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ghi khoản chi', exact: true }).click();
    if (settings.mainDraft) {
      await page.getByRole('combobox', { name: 'Phòng ghi nhận', exact: true }).click();
      await page.getByRole('option', { name: 'FIN-01', exact: true }).click();
      await page.getByRole('combobox', { name: 'Tài sản liên quan', exact: true }).click();
      await page.getByRole('option', { name: 'SYNTHETIC EXPENSE ASSET', exact: true }).click();
    }
    await page.getByLabel('Danh mục khoản chi').fill('Vệ sinh tổng hợp');
    await page.getByLabel('Số tiền (VND)').fill('200000');
    await page.getByLabel('Ngày phát sinh').fill('2026-11-01');
    await page.getByLabel('Nội dung / tham chiếu chứng từ').fill('Chứng từ tổng hợp browser');
    await page.getByRole('button', { name: 'Lưu khoản chi', exact: true }).click();
    await page.getByText('Đã lưu khoản chi.', { exact: true }).waitFor();
    await page.reload();
    await page
      .getByText('Vệ sinh tổng hợp', { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    await page.getByRole('button', { name: 'Chi tiết / chỉnh sửa', exact: true }).click();
    if (settings.mainDraft) {
      assert.match(
        await page.getByRole('combobox', { name: 'Tài sản liên quan', exact: true }).innerText(),
        /SYNTHETIC EXPENSE ASSET/,
      );
      assert.equal(
        await page
          .getByRole('combobox', { name: 'Phòng ghi nhận', exact: true })
          .getAttribute('aria-disabled'),
        'true',
      );
    }
    await page.getByLabel('Số tiền (VND)').fill('250000');
    await page.getByLabel('Lý do chỉnh sửa').fill('Đối chiếu lại chứng từ tổng hợp');
    await page.getByRole('button', { name: 'Lưu khoản chi', exact: true }).click();
    await page.getByText('Đã lưu khoản chi.', { exact: true }).waitFor();
    console.log('PASS: browser creates, reloads and corrects an actual Compact24 expense.');
    if (settings.mainDraft) await require('./Verify-ExpenseEvidenceClients.cjs')(page);
    await page.getByRole('button', { name: 'Chi tiết / chỉnh sửa', exact: true }).click();
    await page.getByText(/Chưa rõ tình trạng.*Đã chi:/).waitFor();
    await capture('expense-detail');
    await page.getByRole('button', { name: 'Cập nhật hạn thanh toán', exact: true }).click();
    await page.getByLabel('Hạn thanh toán', { exact: true }).fill('2026-11-02');
    await page.getByLabel('Lý do cập nhật hạn').fill('Synthetic due date');
    await page.getByLabel(/Xác nhận thay đổi hạn thanh toán/).check();
    await page.getByRole('button', { name: 'Lưu hạn thanh toán' }).click();
    await page.getByText('Đã cập nhật thông tin tài chính.', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Chi tiết / chỉnh sửa', exact: true }).click();
    await page.getByRole('dialog', { name: 'Chi tiết khoản chi' }).waitFor();
    await page.getByText(/Hạn thanh toán: 2026-11-02/).waitFor();
    await page.getByLabel('Số tiền đã chuyển (đ)').fill('100000');
    await page.getByLabel('Ngày thực chi').fill('2026-11-02');
    await page.getByLabel('Ghi chú xác nhận / chứng từ').fill('Synthetic partial expense payment');
    await page.getByLabel('Tôi xác nhận thông tin thanh toán đúng thực tế.').check();
    await page.getByRole('button', { name: 'Ghi nhận thực chi' }).click();
    await page.getByText('Đã cập nhật thông tin tài chính.', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Chi tiết / chỉnh sửa', exact: true }).click();
    await page.getByText(/Thanh toán một phần.*150.000/).waitFor();
    await capture('expense-partial-payment');
    await page.getByRole('button', { name: 'Điền toàn bộ số còn phải trả' }).click();
    await page.getByLabel('Ngày thực chi').fill('2026-11-03');
    await page.getByLabel('Ghi chú xác nhận / chứng từ').fill('Synthetic final expense payment');
    await page.getByLabel('Tôi xác nhận thông tin thanh toán đúng thực tế.').check();
    await page.getByRole('button', { name: 'Ghi nhận thực chi' }).click();
    await page.getByText('Đã cập nhật thông tin tài chính.', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    console.log('PASS: browser records due date, partial payment and full payment.');
    await page.goto(settings.origin + '/locations/' + settings.locationId + '/investment');
    await page.getByRole('heading', { name: 'Đầu tư ban đầu & Chi phí', exact: true }).waitFor();
    await page
      .getByText('Vệ sinh tổng hợp', { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    assert.equal(
      await page
        .getByRole('combobox', { name: 'Cơ sở', exact: true })
        .getAttribute('aria-disabled'),
      'true',
    );
    console.log('PASS: Location investment child route uses real scoped expenses in API mode.');
    await page.goto(settings.origin + '/reports');
    await page.getByRole('button', { name: 'Bộ lọc chi tiết', exact: true }).click();
    await page.getByLabel('Từ ngày').fill('2026-11-01');
    await page.getByLabel('Đến ngày').fill('2026-11-30');
    await page.getByRole('button', { name: 'Xem báo cáo', exact: true }).click();
    await page.getByText('Kỳ báo cáo đã tải: 01/11/2026 – 30/11/2026', { exact: true }).waitFor();
    await page.getByText('250.000 ₫', { exact: true }).first().waitFor();
    const tabs = page.getByRole('tablist', { name: 'Chọn mục trong chi phí & báo cáo' });
    assert.equal(await tabs.getByRole('tab').count(), 3);
    assert.deepEqual(await tabs.getByRole('tab').allTextContents(), [
      'Báo cáo',
      'Chi phí & đầu tư',
      'Kịch bản',
    ]);
    await capture('reports');
    await page.getByRole('button', { name: 'Biểu đồ các khoản thu chi', exact: true }).click();
    await page.getByRole('table', { name: 'Số liệu xu hướng kinh doanh chính xác' }).waitFor();
    await capture('report-trend');
    await page.getByRole('tab', { name: 'Thu chi thực tế', exact: true }).click();
    await page.getByRole('table', { name: 'Số liệu xu hướng thu chi chính xác' }).waitFor();
    await capture('report-cash-trend');
    await page.getByRole('button', { name: /Đối chiếu chi tiết số liệu/ }).click();
    await page.getByRole('button', { name: 'Xem nguồn giao dịch ngân hàng' }).click();
    await page.getByText('Không có giao dịch ngân hàng đã xác minh trong kỳ.').waitFor();
    await capture('report-bank-sources');
    console.log('PASS: browser report uses persisted expenses and preserves unavailable payback.');
    await page.goto(settings.origin + '/what-if');
    await page.getByLabel('Tên kịch bản').fill('Browser tổng hợp');
    await page.getByRole('button', { name: /Kỳ dữ liệu nền:/ }).click();
    await page.getByLabel('Dữ liệu nền từ ngày').fill('2026-11-01');
    await page.getByLabel('Dữ liệu nền đến ngày').fill('2026-11-30');
    for (const [label, value] of [
      ['Giá thuê giả định / phòng / tháng (VND)', '3000000'],
      ['Tỷ lệ lấp đầy (%)', '80'],
      ['Tỷ lệ thu tiền dự kiến (%)', '90'],
      ['Điện nước / dịch vụ mỗi tháng (VND)', '100000'],
      ['Chi phí Staff mỗi tháng (VND)', '200000'],
      ['Bảo trì mỗi tháng (VND)', '50000'],
      ['Chi phí khác mỗi tháng (VND)', '50000'],
      ['Doanh thu dịch vụ mỗi tháng (VND)', '0'],
      ['Đầu tư bổ sung một lần (VND)', '0'],
      ['Tỷ lệ thực chi dự kiến (%)', '100'],
      ['Tỷ lệ tăng chi phí (%)', '0'],
    ])
      await page.getByLabel(label).fill(value);
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await page.getByText('Dòng tiền / tháng: 1.760.000 ₫', { exact: true }).waitFor();
    await capture('what-if');
    await page.getByRole('button', { name: 'Lưu kịch bản', exact: true }).click();
    await page.getByText('Đã lưu kịch bản và ảnh chụp dữ liệu nền.', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: /Kịch bản đã lưu/ }).click();
    await page.getByRole('button', { name: 'Xem Browser tổng hợp', exact: true }).click();
    await page.getByText('Dòng tiền / tháng: 1.760.000 ₫', { exact: true }).waitFor();
    console.log('PASS: browser analyzes, saves and reloads the immutable scenario snapshot.');
    await page.goto(settings.origin + '/contracts');
    await page
      .getByRole('button', { name: 'Cấu hình bên cho thuê & tiền cọc', exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Cơ sở', exact: true }).click();
    await page.getByRole('option', { name: 'Cơ sở kiểm thử tài chính', exact: true }).click();
    for (const [label, value] of [
      ['Họ tên Owner', 'OWNER TỔNG HỢP'],
      ['Ngày sinh Owner', '1980-01-01'],
      ['CCCD Owner', '000000000001'],
      ['Ngày cấp CCCD Owner', '2020-01-01'],
      ['Nơi cấp', 'Cơ quan tổng hợp'],
      ['Địa chỉ thường trú', 'Địa chỉ tổng hợp'],
      ['Điện thoại', '0000000000'],
      [
        'Hiệu lực từ',
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
          Date.now() - 86400000,
        ),
      ],
      ['Tiền cọc đảm bảo (VND)', '3000000'],
      ['Hình thức / chính sách thanh toán', 'Chuyển khoản theo thỏa thuận tổng hợp'],
    ])
      await dialog.getByLabel(label === 'CCCD Owner' ? /^CCCD Owner/ : label).fill(value);
    await dialog.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
    await dialog.getByText('Đã lưu cấu hình.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Cấu hình bên cho thuê & tiền cọc', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Cơ sở', exact: true }).click();
    await page.getByRole('option', { name: 'Cơ sở kiểm thử tài chính', exact: true }).click();
    await dialog.getByLabel('Tiền cọc đảm bảo (VND)').waitFor();
    assert.equal(await dialog.getByLabel('Tiền cọc đảm bảo (VND)').inputValue(), '3000000');
    assert.equal(await dialog.getByLabel('Họ tên Owner').inputValue(), 'OWNER TỔNG HỢP');
    console.log(
      'PASS: browser saves and reloads encrypted Owner contract settings from Compact24.',
    );
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    if (settings.mainDraft) await require('./Verify-MainDraftClients.cjs')(settings, page);
    assert.deepEqual(errors, []);
    await context.close();
  } catch (error) {
    if (page && !page.isClosed()) {
      await page
        .screenshot({
          path: path.join(screenshots, 'failure.png'),
          fullPage: true,
          mask: [page.locator('input[type="password"]')],
        })
        .catch(() => {});
      console.error('Browser failure path:', new URL(page.url()).pathname);
    }
    console.error('Browser error names:', errors.join(', ') || 'none');
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) =>
      web.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (part) => (input += part));
process.stdin.on('end', () =>
  main(JSON.parse(input)).catch((e) => {
    // Safe failure metadata only: never dump a response, request body, auth headers or accounts.
    console.error(
      'Finance browser verification failed:',
      e.message,
      e.status ?? '',
      e.code ?? e.problem?.code ?? '',
      e.requestPath ?? '',
    );
    process.exitCode = 1;
  }),
);
