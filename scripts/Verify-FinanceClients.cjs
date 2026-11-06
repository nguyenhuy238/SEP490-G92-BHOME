// Only synthetic credentials from the disposable .NET harness, delivered through stdin.
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
async function main(settings) {
  const root = path.resolve(__dirname, '..');
  assert.equal(new URL(settings.baseUrl).hostname, 'localhost');
  const { build, preview } = await import(
    pathToFileURL(require.resolve('vite', { paths: [path.join(root, 'src/owner-web')] })).href
  );
  const { chromium } = require(path.join(root, '.tools/contract-browser/node_modules/playwright'));
  process.env.VITE_API_MODE = 'api';
  process.env.VITE_API_BASE_URL = settings.baseUrl;
  const config = {
    root: path.join(root, 'src/owner-web'),
    configFile: path.join(root, 'src/owner-web/vite.config.ts'),
    envDir: settings.temporary,
    logLevel: 'error',
    build: { outDir: path.join(settings.temporary, 'owner-web'), emptyOutDir: false },
    preview: {
      host: 'localhost',
      port: settings.webPort,
      strictPort: true,
      https: { pfx: readFileSync(settings.pfxPath), passphrase: settings.pfxPassword },
    },
  };
  await build(config);
  const web = await preview(config);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    // This context trusts only synthetic localhost traffic for this test. No OS trust changes.
    // TLS certificate trust itself is not an acceptance claim of this browser test.
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.name));
    await page.goto(settings.origin + '/expenses', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email hoặc Số điện thoại', { exact: true }).fill(settings.email);
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
    await page.getByText('Vệ sinh tổng hợp — 200.000 ₫', { exact: true }).waitFor();
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
    await page.goto(settings.origin + '/locations/' + settings.locationId + '/investment');
    await page.getByRole('heading', { name: 'Đầu tư ban đầu & Chi phí', exact: true }).waitFor();
    await page.getByText('Vệ sinh tổng hợp — 250.000 ₫', { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('combobox', { name: 'Cơ sở', exact: true })
        .getAttribute('aria-disabled'),
      'true',
    );
    console.log('PASS: Location investment child route uses real scoped expenses in API mode.');
    await page.goto(settings.origin + '/reports');
    await page.getByLabel('Từ ngày').fill('2026-11-01');
    await page.getByLabel('Đến ngày').fill('2026-11-30');
    await page.getByRole('button', { name: 'Xem báo cáo', exact: true }).click();
    await page.getByText('Chi phí vận hành: 250.000 ₫', { exact: true }).first().waitFor();
    await page.getByText('Ước tính số tháng còn lại: Chưa xác định', { exact: true }).waitFor();
    console.log('PASS: browser report uses persisted expenses and preserves unavailable payback.');
    await page.goto(settings.origin + '/what-if');
    await page.getByLabel('Tên kịch bản').fill('Browser tổng hợp');
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
    ])
      await page.getByLabel(label).fill(value);
    await page.getByRole('button', { name: 'Phân tích', exact: true }).click();
    await page.getByText('Dòng tiền / tháng: 1.760.000 ₫', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Lưu kịch bản', exact: true }).click();
    await page.getByText('Đã lưu kịch bản và ảnh chụp dữ liệu nền.', { exact: true }).waitFor();
    await page.reload();
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
      ['Hiệu lực từ', '2026-11-01'],
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
    console.error('Finance browser verification failed:', e.message);
    process.exitCode = 1;
  }),
);
