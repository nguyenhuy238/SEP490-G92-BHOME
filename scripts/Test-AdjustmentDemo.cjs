// Isolated synthetic UI smoke. Real API/DB/storage, synthetic image upload, no route interception.
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
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'adjustment-fixture.json'), 'utf8'));
const api = process.env.BHOME_ADJUSTMENT_DEMO_API || 'http://localhost:5540',
  web = process.env.BHOME_ADJUSTMENT_DEMO_WEB || 'http://localhost:5517',
  mobile = process.env.BHOME_ADJUSTMENT_DEMO_MOBILE || 'http://localhost:5581';
async function main() {
  for (const url of [api, web, mobile]) assert.equal(new URL(url).hostname, 'localhost');
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  async function login(name) {
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
  }
  const ownerToken = await login('owner'),
    aToken = await login('tenant1'),
    bToken = await login('tenant2'),
    cToken = await login('tenant3');
  async function read(route, token = ownerToken) {
    const r = await fetch(api + route, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(r.status, 200, route);
    return r.json();
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  const ui = fixture.invoices[4];
  try {
    async function tenantPage(name) {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: 430, height: 932 });
      await page.goto(mobile, { timeout: 60000 });
      await page
        .getByLabel('Email đăng nhập', { exact: true })
        .fill(name + '.contract.demo@example.invalid');
      await page
        .getByLabel('Mật khẩu đăng nhập', { exact: true })
        .fill(settings.BHOME_DEV_TEST_PASSWORD);
      await page.getByText('Đăng nhập', { exact: true }).click();
      await page.waitForURL('**/workspace/**');
      await page.getByText('Hóa đơn & Thanh toán', { exact: true }).first().click();
      await page.getByText('Hóa đơn của tôi', { exact: true }).waitFor();
      return page;
    }
    async function openInvoice(page, invoiceId, token) {
      const list = await read('/api/v1/invoices?page=1&pageSize=20', token);
      const index = list.items.findIndex((x) => x.id === invoiceId);
      assert.ok(index >= 0, 'invoice must be in current demo page');
      await page.getByText('Xem hóa đơn', { exact: true }).nth(index).click();
      await page.getByText('Chi tiết hóa đơn', { exact: true }).waitFor();
    }
    const tenant = await tenantPage('tenant1');
    await openInvoice(tenant, ui.invoiceId, aToken);
    async function submit(reason, amount, photo, invoiceId = ui.invoiceId) {
      const listing = await read(
        `/api/v1/invoice-adjustments?invoiceId=${invoiceId}&pageSize=100`,
        aToken,
      );
      const existing = listing.items.find((x) => x.reason === reason);
      if (existing) {
        const index = listing.items.findIndex((x) => x.id === existing.id);
        assert.ok(index < 20);
        await tenant.getByText('Xem yêu cầu của tôi', { exact: true }).nth(index).click();
        await tenant.getByText('Kết quả yêu cầu', { exact: true }).waitFor();
        return existing;
      }
      await tenant.getByText('Yêu cầu điều chỉnh', { exact: true }).click();
      if (photo) {
        await tenant.getByRole('button', { name: 'Khoản phí cần xem xét', exact: true }).click();
        await tenant.getByRole('radio', { name: /Giá tổng hợp adjustment RENT ·/ }).click();
      }
      await tenant.getByLabel('Giá trị đề xuất (VND, tùy chọn)', { exact: true }).fill(amount);
      await tenant.getByLabel('Lý do yêu cầu điều chỉnh', { exact: true }).fill(reason);
      if (photo) {
        await tenant
          .getByRole('checkbox', { name: 'Tôi đã kiểm tra ảnh bằng chứng', exact: true })
          .click();
        await tenant
          .getByLabel('Chọn ảnh bằng chứng điều chỉnh', { exact: true })
          .setInputFiles(path.join(output, 'synthetic-evidence.png'));
        await tenant.getByText('Tải bằng chứng điều chỉnh', { exact: true }).click();
        await tenant.getByText('Đã tải 1/5 ảnh.', { exact: true }).waitFor();
      }
      const pending = tenant.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/v1/invoices/${invoiceId}/adjustment-requests` &&
          r.request().method() === 'POST',
      );
      await tenant.getByText('Gửi yêu cầu cho Owner', { exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200);
      const request = await response.json();
      assert.equal(request.status, 'Pending');
      if (photo) assert.equal(request.evidence.length, 1);
      await tenant.getByText('Kết quả yêu cầu', { exact: true }).waitFor();
      return request;
    }
    const request = await submit('BH41 UI synthetic draft correction', '2995000', true);
    await tenant.getByText('Lịch sử yêu cầu của bạn', { exact: true }).scrollIntoViewIfNeeded();
    await tenant.screenshot({
      path: path.join(output, 'adjustment-tenant-request.png'),
      fullPage: true,
    });
    const owner = await context.newPage();
    owner.setDefaultTimeout(30000);
    owner.on('pageerror', (e) => errors.push(e.message));
    await owner.goto(web);
    await owner.locator('#login-identifier').fill('owner.contract.demo@example.invalid');
    await owner.locator('#login-password').fill(settings.BHOME_DEV_TEST_PASSWORD);
    await owner.locator('button[type=submit]').click();
    await owner.waitForURL('**/dashboard');
    async function decide(request, approve) {
      const latest = await read('/api/v1/invoice-adjustments/' + request.id);
      await owner.goto(web + '/invoice-adjustments?invoiceId=' + request.invoiceId);
      await owner.getByLabel('Trạng thái yêu cầu').waitFor();
      const invoiceFilter = owner.getByLabel('Lọc theo mã hóa đơn');
      if (await invoiceFilter.count()) await invoiceFilter.fill(request.invoiceId);
      await owner.getByLabel('Trạng thái yêu cầu').click();
      await owner
        .getByRole('option', {
          name:
            latest.status === 'Pending'
              ? 'Chờ Owner xem xét'
              : latest.status === 'Approved'
                ? 'Đã phê duyệt'
                : 'Đã từ chối',
          exact: true,
        })
        .click();
      const rows = await read(
        `/api/v1/invoice-adjustments?invoiceId=${request.invoiceId}&status=${latest.status}&pageSize=20`,
      );
      const row = rows.items.findIndex((x) => x.id === request.id);
      assert.ok(row >= 0);
      await owner
        .getByRole('button', { name: 'Xem yêu cầu điều chỉnh', exact: true })
        .nth(row)
        .click();
      await owner.getByText('Lý do yêu cầu: ' + request.reason, { exact: true }).waitFor();
      if (latest.status !== 'Pending') {
        assert.equal(latest.status, approve ? 'Approved' : 'Rejected');
        return;
      }
      if (approve) {
        if (request.evidence.length) {
          await owner.getByRole('button', { name: 'Xem bằng chứng 1', exact: true }).click();
          await owner.getByAltText('Bằng chứng điều chỉnh 1', { exact: true }).waitFor();
        }
        await owner
          .getByLabel('Giá trị sau điều chỉnh (VND)', { exact: true })
          .fill(request.proposedAmount);
      }
      await owner
        .getByLabel('Lý do quyết định', { exact: true })
        .fill(approve ? 'BH41 UI Owner verified synthetic charge' : 'BH41 UI no error found');
      await owner
        .getByLabel('Tôi đã kiểm tra hóa đơn, số dư và bằng chứng', { exact: true })
        .check();
      await owner
        .getByRole('button', {
          name: approve ? 'Phê duyệt điều chỉnh' : 'Từ chối yêu cầu',
          exact: true,
        })
        .click();
      const response = owner.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
          `/api/v1/invoice-adjustments/${request.id}/${approve ? 'approve' : 'reject'}`,
      );
      await owner
        .getByRole('dialog')
        .getByRole('button', { name: 'Xác nhận quyết định', exact: true })
        .click();
      const result = await response;
      assert.equal(result.status(), 200);
      assert.equal((await result.json()).status, approve ? 'Approved' : 'Rejected');
      await owner
        .getByText(approve ? /Đã phê duyệt · BH41 UI Owner/ : /Đã từ chối · BH41 UI no error found/)
        .waitFor();
    }
    await decide(request, true);
    assert.equal((await read('/api/v1/invoices/' + ui.invoiceId)).total, '3114250');
    await owner.screenshot({
      path: path.join(output, 'adjustment-owner-approved.png'),
      fullPage: true,
    });
    await tenant.getByText('Tải lại hóa đơn', { exact: true }).click();
    await tenant.getByText('3.114.250 ₫', { exact: true }).first().waitFor();
    const rejected = await submit('BH41 UI synthetic rejected request', '1', false);
    await decide(rejected, false);
    assert.equal((await read('/api/v1/invoices/' + ui.invoiceId)).total, '3114250');
    await tenant.getByText('Tải lại kết quả điều chỉnh', { exact: true }).click();
    await tenant.getByText('Quyết định Owner: BH41 UI no error found', { exact: true }).waitFor();
    await tenant
      .getByText('Quyết định Owner: BH41 UI no error found', { exact: true })
      .scrollIntoViewIfNeeded();
    await tenant.screenshot({
      path: path.join(output, 'adjustment-tenant-decision.png'),
      fullPage: true,
    });
    await tenant.getByText('Về danh sách hóa đơn', { exact: true }).click();
    const finalInvoice = fixture.invoices[2];
    await openInvoice(tenant, finalInvoice.invoiceId, aToken);
    const finalRequest = await submit(
      'BH41 UI synthetic final correction',
      '3089250',
      false,
      finalInvoice.invoiceId,
    );
    await decide(finalRequest, true);
    const finalBalance = await read(`/api/v1/invoices/${finalInvoice.invoiceId}/payment`);
    assert.equal(finalBalance.originalIssuedAmount, '3119250');
    assert.equal(finalBalance.payableAmount, '3089250');
    assert.equal((await read('/api/v1/invoices/' + finalInvoice.invoiceId)).total, '3119250');
    await owner.screenshot({
      path: path.join(output, 'adjustment-owner-final-approved.png'),
      fullPage: true,
    });
    const excess = fixture.invoices[3];
    await owner.goto(web + '/invoice-adjustments?invoiceId=' + excess.invoiceId);
    await owner.getByLabel('Trạng thái yêu cầu').waitFor();
    const excessFilter = owner.getByLabel('Lọc theo mã hóa đơn');
    if (await excessFilter.count()) await excessFilter.fill(excess.invoiceId);
    await owner
      .getByText(/BHOME ADJUSTMENT DEMO · Phòng ADJ104-EXCESS ·/)
      .locator('..')
      .getByRole('button', { name: 'Xem yêu cầu điều chỉnh', exact: true })
      .click();
    await owner.getByText(/Tiền thừa chờ xem xét: 10.000/).waitFor();
    await owner.screenshot({
      path: path.join(output, 'adjustment-owner-excess.png'),
      fullPage: true,
    });
    const tenantB = await tenantPage('tenant2');
    await openInvoice(tenantB, excess.invoiceId, bToken);
    await tenantB.getByText(/Tiền thừa chờ xem xét: 10.000/).waitFor();
    await tenantB.getByText(/Tiền thừa chờ xem xét: 10.000/).scrollIntoViewIfNeeded();
    assert.equal(
      await tenantB.getByText('Lý do: BH41 SYNTHETIC PAID-DOWNWARD', { exact: true }).count(),
      0,
    );
    await tenantB.screenshot({
      path: path.join(output, 'adjustment-tenant-shared-balance.png'),
      fullPage: true,
    });
    for (const access of [aToken, bToken, cToken]) {
      const state = await read(`/api/v1/invoices/${excess.invoiceId}/payment`, access);
      assert.equal(state.payableAmount, '3109250');
      assert.equal(state.paidAmount, '3119250');
      assert.equal(state.potentialExcessAmount, '10000');
    }
    const privateRead = await fetch(api + '/api/v1/invoice-adjustments/' + fixture.excessId, {
      headers: { Authorization: 'Bearer ' + bToken },
    });
    assert.equal(privateRead.status, 404);
    assert.equal((await read('/api/v1/invoices/' + excess.invoiceId)).total, '3119250');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'adjustment-browser-results.json'),
      JSON.stringify(
        {
          tenantRequestWithPrivateEvidence: 'PASS',
          ownerApproveDraft: 'PASS',
          ownerApproveFinal: 'PASS',
          ownerReject: 'PASS',
          finalOriginalImmutable: 'PASS',
          paidDownwardExcessPendingReview: 'PASS',
          threeTenantSharedBalanceAndRequestPrivacy: 'PASS',
          runtimeErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: real Owner/Tenant UI request/evidence/approve/reject, shared balances and pending excess; original Final and payments preserved. Synthetic image; no real refund or mocked API success.',
    );
  } catch (error) {
    const pages = context.pages();
    for (let n = 0; n < pages.length; n++) {
      await pages[n]
        .screenshot({ path: path.join(output, `adjustment-debug-${n}.png`), fullPage: true })
        .catch(() => {});
      fs.writeFileSync(
        path.join(output, `adjustment-debug-${n}.txt`),
        await pages[n]
          .locator('body')
          .innerText()
          .catch(() => ''),
      );
    }
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch((error) => {
  console.error(String(error.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
