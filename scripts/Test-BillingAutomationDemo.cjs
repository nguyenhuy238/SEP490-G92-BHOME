// Browser smoke against live local APIs. No route mocks; synthetic identities and fixtures only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { chromium } = require(
  require.resolve('playwright', {
    paths: [path.join(__dirname, '../.tools/contract-browser'), process.cwd()],
  }),
);
const output = path.join(__dirname, '../.tools/contract-demo');
const settings = JSON.parse(
  fs.readFileSync(path.join(output, 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'automation-fixture.json'), 'utf8'));
const api = process.env.BHOME_AUTOMATION_DEMO_API || 'http://localhost:5540',
  web = process.env.BHOME_AUTOMATION_DEMO_WEB || 'http://localhost:5517',
  mobile = process.env.BHOME_AUTOMATION_DEMO_MOBILE || 'http://localhost:5581';
async function main() {
  for (const url of [api, web, mobile]) assert.equal(new URL(url).hostname, 'localhost');
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  const login = async (name) => {
    const r = await fetch(api + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: name + '.contract.demo@example.invalid',
        password: settings.BHOME_DEV_TEST_PASSWORD,
      }),
    });
    assert.equal(r.status, 200);
    return (await r.json()).accessToken;
  };
  const read = async (token, route) => {
    const r = await fetch(api + route, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(r.status, 200, route);
    return r.json();
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true }),
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
  const errors = [];
  const pages = [];
  const track = (p) => {
    pages.push(p);
    p.setDefaultTimeout(45000);
    p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  try {
    const owner = track(await context.newPage());
    await owner.goto(web);
    await owner.locator('#login-identifier').fill('owner.contract.demo@example.invalid');
    await owner.locator('#login-password').fill(settings.BHOME_DEV_TEST_PASSWORD);
    await owner.locator('button[type=submit]').click();
    await owner.waitForURL('**/dashboard');
    await owner.goto(
      `${web}/billing-automation?locationId=${fixture.locationId}&period=${fixture.period.slice(0, 7)}`,
    );
    await owner.getByText('Kết quả & Ngoại lệ', { exact: true }).waitFor();
    await owner.getByText('Cần phân công Staff đang phụ trách cơ sở', { exact: true }).count();
    await owner
      .getByText('Hàng đợi bền vững (30 lượt gần nhất)', { exact: true })
      .scrollIntoViewIfNeeded();
    await owner
      .getByText(/billing-final · Completed/)
      .first()
      .waitFor();
    await owner.screenshot({
      path: path.join(output, 'automation-owner-worker.png'),
      fullPage: false,
    });
    await owner.getByText('Kết quả & Ngoại lệ', { exact: true }).scrollIntoViewIfNeeded();
    await owner.screenshot({
      path: path.join(output, 'automation-owner-exceptions.png'),
      fullPage: false,
    });
    await owner.getByRole('button', { name: 'Chạy ngay: Giao việc ghi số', exact: true }).click();
    await owner
      .getByText('Đã xử lý. Xem trạng thái và dữ liệu còn thiếu bên dưới.', { exact: true })
      .waitFor();
    await owner.goto(web + '/notifications');
    await owner.getByLabel('Nhóm thông báo').click();
    await owner.getByRole('option', { name: 'Thanh toán', exact: true }).click();
    const ownerToken = await login('owner');
    const list = await read(
      ownerToken,
      '/api/v1/notifications?category=Payment&page=1&pageSize=20',
    );
    const index = list.items.findIndex((n) => n.relatedObjectId === fixture.invoiceId);
    assert.ok(index >= 0);
    await owner.getByRole('button', { name: 'Mở hồ sơ liên quan', exact: true }).nth(index).click();
    await owner.waitForURL('**/invoices?invoiceId=' + fixture.invoiceId);
    await owner.getByText('AUTO101-SHARED', { exact: false }).first().waitFor();
    await owner.screenshot({
      path: path.join(output, 'automation-owner-invoice.png'),
      fullPage: false,
    });
    async function mobileLogin(name) {
      const p = track(await context.newPage());
      await p.setViewportSize({ width: 430, height: 932 });
      await p.goto(mobile, { timeout: 90000 });
      await p
        .getByLabel('Email đăng nhập', { exact: true })
        .fill(name + '.contract.demo@example.invalid');
      await p
        .getByLabel('Mật khẩu đăng nhập', { exact: true })
        .fill(settings.BHOME_DEV_TEST_PASSWORD);
      await p.getByText('Đăng nhập', { exact: true }).click();
      await p.waitForURL('**/workspace/**');
      return p;
    }
    for (const name of ['tenant1', 'tenant2', 'tenant3']) {
      const p = await mobileLogin(name),
        token = await login(name);
      await p.getByRole('button', { name: 'Thông báo', exact: true }).first().click();
      await p.getByText('Thông báo của tôi', { exact: true }).waitFor();
      await p.getByRole('button', { name: 'Nhóm thông báo', exact: true }).click();
      await p.getByRole('radio', { name: 'Hóa đơn', exact: true }).click();
      await p.getByRole('radio', { name: 'Hóa đơn', exact: true }).waitFor({ state: 'hidden' });
      const notices = await read(
        token,
        '/api/v1/notifications?category=Invoice&page=1&pageSize=20',
      );
      const i = notices.items.findIndex((n) => n.relatedObjectId === fixture.invoiceId);
      assert.ok(i >= 0);
      await p
        .getByRole('button', { name: 'Mở hồ sơ liên quan', exact: true })
        .nth(i)
        .scrollIntoViewIfNeeded();
      await p.screenshot({
        path: path.join(output, `automation-${name}-inbox.png`),
        fullPage: false,
      });
      await p.getByRole('button', { name: 'Mở hồ sơ liên quan', exact: true }).nth(i).click();
      await p.getByText('Chi tiết hóa đơn', { exact: true }).waitFor();
      await p
        .getByText('Phòng AUTO101-SHARED · Kỳ ' + fixture.period.slice(0, 7), { exact: true })
        .waitFor();
      await p.screenshot({
        path: path.join(output, `automation-${name}-invoice.png`),
        fullPage: false,
      });
      assert.equal(
        (await read(token, `/api/v1/invoices/${fixture.invoiceId}/payment`)).outstandingAmount,
        '0',
      );
    }
    const staff = await mobileLogin('staff'),
      staffToken = await login('staff');
    await staff.getByRole('button', { name: 'Thông báo', exact: true }).first().click();
    await staff.getByText('Thông báo của tôi', { exact: true }).waitFor();
    const notices = await read(staffToken, '/api/v1/notifications?page=1&pageSize=20');
    const tasks = await read(
      staffToken,
      `/api/v1/capture/meter-tasks?locationId=${fixture.locationId}`,
    );
    const task = tasks.find((t) => t.room === 'AUTO101-SHARED' && t.purpose === 1);
    assert.ok(task);
    const i = notices.items.findIndex((n) => n.relatedObjectId === task.id);
    assert.ok(i >= 0);
    await staff
      .getByRole('button', { name: 'Mở hồ sơ liên quan', exact: true })
      .nth(i)
      .scrollIntoViewIfNeeded();
    await staff.screenshot({
      path: path.join(output, 'automation-staff-inbox.png'),
      fullPage: false,
    });
    await staff.getByRole('button', { name: 'Mở hồ sơ liên quan', exact: true }).nth(i).click();
    await staff.getByText('Đã lưu chỉ số và ảnh minh chứng', { exact: true }).waitFor();
    await staff.screenshot({
      path: path.join(output, 'automation-staff-confirmed.png'),
      fullPage: false,
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'automation-ui-proof.json'),
      JSON.stringify(
        {
          businessDate: fixture.businessDate,
          ownerRunNow: true,
          ownerQueue: true,
          ownerNotificationDeepLink: true,
          tenantABCInboxAndInvoice: true,
          staffInboxConfirmedTask: true,
          browser: 'installed Chrome, Mobile web 430x932',
          nativeCamera: false,
          externalProvider: false,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS real browser smoke: Owner monitoring/run-now/invoice link; Tenant A/B/C inbox/invoice; Staff inbox/confirmed reading.',
    );
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      fs.writeFileSync(
        path.join(output, 'automation-debug-' + i + '.txt'),
        await pages[i]
          .locator('body')
          .innerText()
          .catch(() => ''),
      );
      await pages[i]
        .screenshot({ path: path.join(output, 'automation-debug-' + i + '.png'), fullPage: false })
        .catch(() => {});
    }
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
