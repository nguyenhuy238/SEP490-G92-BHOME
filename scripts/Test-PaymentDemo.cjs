// Real browser/API smoke on isolated synthetic records. No route interception or fake bank success.
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
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'payment-fixture.json'), 'utf8'));
const api = process.env.BHOME_PAYMENT_DEMO_API || 'http://localhost:5540',
  web = process.env.BHOME_PAYMENT_DEMO_WEB || 'http://localhost:5517',
  mobile = process.env.BHOME_PAYMENT_DEMO_MOBILE || 'http://localhost:5581';
async function main() {
  for (const url of [api, web, mobile]) assert.equal(new URL(url).hostname, 'localhost');
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  async function token(name) {
    const response = await fetch(api + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: name + '.contract.demo@example.invalid',
        password: settings.BHOME_DEV_TEST_PASSWORD,
      }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).accessToken;
  }
  const ownerToken = await token('owner'),
    tenantTokens = [await token('tenant1'), await token('tenant2'), await token('tenant3')];
  async function read(route, access = ownerToken) {
    const response = await fetch(api + route, {
      headers: { Authorization: 'Bearer ' + access },
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 200, route);
    return response.json();
  }
  const ui = fixture.invoices[3],
    unpaid = fixture.invoices[1];
  assert.ok(ui, 'seed PAY104-UI first');
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  try {
    const owner = await context.newPage();
    owner.setDefaultTimeout(30000);
    owner.on('pageerror', (e) => errors.push(e.message));
    await owner.goto(web);
    await owner.locator('#login-identifier').fill('owner.contract.demo@example.invalid');
    await owner.locator('#login-password').fill(settings.BHOME_DEV_TEST_PASSWORD);
    await owner.locator('button[type=submit]').click();
    await owner.waitForURL('**/dashboard');
    await owner.goto(web + '/payments');
    await owner
      .getByRole('heading', { name: 'Thanh toán & Đối soát', exact: true })
      .first()
      .waitFor();
    await owner.getByLabel('Cơ sở thanh toán').click();
    await owner.getByRole('option', { name: 'BHOME PAYMENT DEMO', exact: true }).click();
    await owner
      .getByText(/BHOME PAYMENT DEMO · Phòng PAY104-UI ·/)
      .locator('..')
      .getByRole('button', { name: 'Mở thanh toán hóa đơn', exact: true })
      .click();
    const before = await read(`/api/v1/invoices/${ui.invoiceId}/payment`);
    await owner
      .getByText('Nội dung chuyển khoản: ' + before.transferReference, { exact: true })
      .waitFor();
    const panel = owner
      .getByText('Nội dung chuyển khoản: ' + before.transferReference, { exact: true })
      .locator('..');
    if (before.paymentStatus !== 'Paid') {
      await panel
        .getByRole('button', { name: 'Ghi nhận giao dịch từ sao kê', exact: true })
        .click();
      await panel.getByLabel('Ngân hàng / nguồn sao kê', { exact: false }).fill('SYNTHETIC-BANK');
      await panel
        .getByLabel('Mã giao dịch ngân hàng', { exact: false })
        .fill('SYN-UI-' + ui.invoiceId);
      const now = new Date();
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12))
        .toISOString()
        .slice(0, 10);
      await panel
        .getByLabel('Thời gian giao dịch (giờ Việt Nam)', { exact: false })
        .fill(day + 'T10:00');
      await panel
        .getByLabel('Tham chiếu bằng chứng sao kê', { exact: false })
        .fill('SYNTHETIC-UI-STATEMENT');
      await panel
        .getByLabel('Căn cứ xác minh', { exact: false })
        .fill('SYNTHETIC manual review for browser smoke; no real bank funds');
      await panel.getByLabel('Dữ liệu tổng hợp Development/Testing', { exact: true }).check();
      await panel
        .getByLabel('Tôi đã đối chiếu sao kê và xác minh tiền thực nhận', { exact: true })
        .check();
      const registered = owner.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/v1/payment-transactions' &&
          r.request().method() === 'POST',
      );
      await panel.getByRole('button', { name: 'Lưu giao dịch đã đối chiếu', exact: true }).click();
      assert.equal((await registered).status(), 200);
      await panel.getByText('Đã lưu giao dịch đã đối chiếu sao kê.', { exact: true }).waitFor();
      await panel.getByLabel('Người thực trả đã xác minh').click();
      await owner.getByRole('option', { name: /Người trả tổng hợp A \(PAY104-UI\)/ }).click();
      await panel
        .getByLabel('Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng', { exact: true })
        .check();
      await panel.getByRole('button', { name: 'Xác nhận phân bổ tiền', exact: true }).click();
      const allocated = owner.waitForResponse((r) =>
        /\/api\/v1\/payment-transactions\/[^/]+\/allocate$/.test(new URL(r.url()).pathname),
      );
      await owner
        .getByRole('dialog')
        .getByRole('button', { name: 'Xác nhận đối soát', exact: true })
        .click();
      const response = await allocated;
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).status, 'Allocated');
    }
    const paid = await read(`/api/v1/invoices/${ui.invoiceId}/payment`);
    assert.equal(paid.paymentStatus, 'Paid');
    assert.equal(paid.outstandingAmount, '0');
    assert.equal(paid.history.length, 1);
    for (const access of tenantTokens)
      assert.equal(
        (await read(`/api/v1/invoices/${ui.invoiceId}/payment`, access)).paymentStatus,
        'Paid',
      );
    await owner
      .getByText(/BHOME PAYMENT DEMO · Phòng PAY104-UI ·/)
      .locator('..')
      .getByText(/Đã thanh toán · Còn phải trả 0/)
      .waitFor();
    await owner
      .getByText(/BHOME PAYMENT DEMO · Phòng PAY102-UNPAID ·/)
      .locator('..')
      .getByText(/Còn phải trả 3.119.250/)
      .waitFor();
    await owner.screenshot({
      path: path.join(output, 'payment-owner-reconciled.png'),
      fullPage: true,
    });
    await owner.goto(web + '/debts');
    await owner.getByLabel('Cơ sở thanh toán').click();
    await owner.getByRole('option', { name: 'BHOME PAYMENT DEMO', exact: true }).click();
    await owner.getByLabel('Chỉ hóa đơn quá hạn', { exact: true }).check();
    await owner.getByText(/BHOME PAYMENT DEMO · Phòng PAY103-OVERDUE ·/).waitFor();
    assert.equal(await owner.getByText(/BHOME PAYMENT DEMO · Phòng PAY104-UI ·/).count(), 0);
    await owner.screenshot({ path: path.join(output, 'payment-owner-debt.png'), fullPage: true });
    const tenant = await context.newPage();
    tenant.setDefaultTimeout(30000);
    await tenant.setViewportSize({ width: 430, height: 932 });
    tenant.on('pageerror', (e) => errors.push(e.message));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: mobile });
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
    let list = await read('/api/v1/invoices?page=1&pageSize=20', tenantTokens[1]);
    let index = list.items.findIndex((i) => i.id === unpaid.invoiceId);
    assert.ok(index >= 0);
    await tenant.getByText('Xem hóa đơn', { exact: true }).nth(index).click();
    await tenant.getByText('Sao chép số tiền', { exact: true }).waitFor();
    await tenant.getByText('Sao chép số tiền', { exact: true }).click();
    await tenant.getByText('Đã sao chép.', { exact: true }).waitFor();
    assert.equal(await tenant.evaluate(() => navigator.clipboard.readText()), '3119250');
    await tenant.getByLabel('QR chuyển khoản hóa đơn', { exact: true }).scrollIntoViewIfNeeded();
    await tenant.screenshot({ path: path.join(output, 'payment-tenant-qr.png'), fullPage: true });
    await tenant.getByText('Về danh sách hóa đơn', { exact: true }).click();
    await tenant.getByText('Hóa đơn của tôi', { exact: true }).waitFor();
    list = await read('/api/v1/invoices?page=1&pageSize=20', tenantTokens[1]);
    index = list.items.findIndex((i) => i.id === ui.invoiceId);
    await tenant.getByText('Xem hóa đơn', { exact: true }).nth(index).click();
    await tenant.getByText('Đã thanh toán', { exact: true }).waitFor();
    await tenant.getByText('Người trả: Khách thuê khác trong hóa đơn', { exact: true }).waitFor();
    assert.equal(await tenant.getByText('Sao chép số tiền', { exact: true }).count(), 0);
    await tenant.screenshot({
      path: path.join(output, 'payment-tenant-shared-paid.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'payment-browser-results.json'),
      JSON.stringify(
        {
          ownerManualReconciliation: 'PASS',
          ownerDebt: 'PASS',
          tenantQRAndCopy: 'PASS',
          sharedPaidStatusForThreeTenants: 'PASS',
          runtimeErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: Owner manual reconciliation/debt and Tenant QR/copy/shared Paid status via real UI/API. No real bank or mocked success.',
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
