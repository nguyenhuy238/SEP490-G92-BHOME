// Browser checks against real Owner Web / Expo Web / API / isolated PostgreSQL + MinIO.
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
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'invoice-fixture.json'), 'utf8'));
const api = process.env.BHOME_INVOICE_DEMO_API || 'http://localhost:5540';
const web = process.env.BHOME_INVOICE_DEMO_WEB || 'http://localhost:5517';
const mobile = process.env.BHOME_INVOICE_DEMO_MOBILE || 'http://localhost:5581';
const id = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function main() {
  for (const url of [api, web, mobile]) assert.equal(new URL(url).hostname, 'localhost');
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  const login = await fetch(api + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'owner.contract.demo@example.invalid',
      password: settings.BHOME_DEV_TEST_PASSWORD,
    }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).accessToken;
  const read = async (route) => {
    const response = await fetch(api + route, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const errors = [];
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1050 },
  });
  try {
    const owner = await context.newPage();
    owner.setDefaultTimeout(25000);
    owner.on('pageerror', (error) => errors.push(error.message));
    await owner.goto(web);
    await owner.locator('#login-identifier').fill('owner.contract.demo@example.invalid');
    await owner.locator('#login-password').fill(settings.BHOME_DEV_TEST_PASSWORD);
    await owner.locator('button[type=submit]').click();
    await owner.waitForURL('**/dashboard');
    await owner.goto(web + '/pricing');
    await owner.getByRole('heading', { name: 'Giá thuê & Chính sách phí', exact: true }).waitFor();
    await owner.getByLabel('Cơ sở cấu hình').click();
    await owner.getByRole('option', { name: 'BHOME CONTRACT DEMO', exact: true }).click();
    await owner.getByText('Quy tắc và lịch hóa đơn', { exact: true }).waitFor();
    await owner.getByText('Giá ELECTRICITY tổng hợp demo', { exact: false }).waitFor();
    const saved = owner.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/billing-schedules' &&
        response.request().method() === 'PUT',
    );
    await owner.getByRole('button', { name: 'Lưu quy tắc hóa đơn', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await owner.screenshot({
      path: path.join(output, 'invoice-owner-configuration.png'),
      fullPage: true,
    });
    await owner.goto(web + '/invoices');
    await owner.getByRole('heading', { name: 'Hóa đơn phòng', exact: true }).waitFor();
    const ready = fixture.find((f) => f.roomId === id(26));
    assert.ok(ready, 'prepare P107-REVIEW first');
    const listing = await read('/api/v1/invoices?pageSize=20');
    const index = listing.items.findIndex((i) => i.id === ready.invoiceId);
    assert.ok(index >= 0);
    await owner.getByRole('button', { name: 'Xem chi tiết', exact: true }).nth(index).click();
    await owner.getByRole('heading', { name: /Chi tiết hóa đơn · Phòng P107-REVIEW/ }).waitFor();
    const current = await read('/api/v1/invoices/' + ready.invoiceId);
    if (current.status === 'Draft') {
      await owner.getByRole('button', { name: 'Phát hành hóa đơn', exact: true }).click();
      const final = owner.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/v1/invoices/${ready.invoiceId}/finalize`,
      );
      await owner
        .getByRole('dialog')
        .getByRole('button', { name: 'Xác nhận phát hành', exact: true })
        .click();
      assert.equal((await final).status(), 200);
    }
    await owner.getByText('Đã phát hành — chi phí được giữ nguyên', { exact: true }).waitFor();
    assert.equal((await read('/api/v1/invoices/' + ready.invoiceId)).total, '3119250');
    await owner.screenshot({ path: path.join(output, 'invoice-owner-final.png'), fullPage: true });
    const tenant = await context.newPage();
    await tenant.setViewportSize({ width: 430, height: 932 });
    tenant.setDefaultTimeout(30000);
    tenant.on('pageerror', (error) => errors.push(error.message));
    await tenant.goto(mobile, { timeout: 60000 });
    await tenant
      .getByLabel('Email đăng nhập', { exact: true })
      .fill('tenant2.contract.demo@example.invalid');
    await tenant
      .getByLabel('Mật khẩu đăng nhập', { exact: true })
      .fill(settings.BHOME_DEV_TEST_PASSWORD);
    await tenant.getByText('Đăng nhập', { exact: true }).click();
    await tenant.waitForURL('**/workspace/**');
    await tenant.getByText('Hóa đơn & Thanh toán', { exact: true }).first().click();
    await tenant.getByText('Hóa đơn của tôi', { exact: true }).waitFor();
    await tenant.getByText('Xem hóa đơn', { exact: true }).nth(index).click();
    await tenant.getByText('Tiêu thụ: 25,5 kWh', { exact: true }).waitFor();
    assert.equal(await tenant.getByText(/Đã thanh toán|Paid|Thanh toán thành công/).count(), 0);
    await tenant.screenshot({
      path: path.join(output, 'invoice-tenant-detail.png'),
      fullPage: true,
    });
    const staff = await context.newPage();
    await staff.setViewportSize({ width: 430, height: 932 });
    staff.setDefaultTimeout(25000);
    staff.on('pageerror', (error) => errors.push(error.message));
    await staff.goto(mobile, { timeout: 60000 });
    await staff
      .getByLabel('Email đăng nhập', { exact: true })
      .fill('staff.contract.demo@example.invalid');
    await staff
      .getByLabel('Mật khẩu đăng nhập', { exact: true })
      .fill(settings.BHOME_DEV_TEST_PASSWORD);
    await staff.getByText('Đăng nhập', { exact: true }).click();
    await staff.waitForURL('**/workspace/**');
    await staff.getByText('Điện nước', { exact: true }).first().click();
    await staff.getByRole('button', { name: 'Trạng thái tác vụ', exact: true }).click();
    await staff.getByRole('radio', { name: 'Tất cả', exact: true }).click();
    await staff.getByText('Xem kết quả đã xác nhận', { exact: true }).first().click();
    await staff.getByText('Đã lưu chỉ số và ảnh minh chứng', { exact: true }).waitFor();
    await staff.getByText(/Mã chỉ số đã xác nhận:/).waitFor();
    await staff.screenshot({
      path: path.join(output, 'invoice-staff-confirmed.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, [], 'client runtime errors');
    fs.writeFileSync(
      path.join(output, 'invoice-browser-results.json'),
      JSON.stringify(
        {
          ownerConfiguration: 'PASS',
          ownerFinalization: 'PASS',
          tenantPersistedInvoice: 'PASS',
          staffPersistedReading: 'PASS',
          runtimeErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: real Owner configuration/finalization and Tenant invoice detail. No browser API mocks.',
    );
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch((error) => {
  console.error(String(error.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
