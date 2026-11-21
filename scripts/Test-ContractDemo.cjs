// Browser smoke against running applications and the isolated demo database. No API mocks.
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
const fixtureId = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const api = 'http://localhost:5540',
  web = 'http://localhost:5517',
  mobile = 'http://localhost:5581';
async function apiRead(route, token) {
  const r = await fetch(api + route, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(r.status, 200, route);
  return r.json();
}
async function loginToken(name) {
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
async function main() {
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  const token = await loginToken('owner'),
    configuration = await apiRead('/api/v1/contracts/configuration', token);
  assert.equal(configuration.signingMode, 'Simulated');
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  let owner, tenant;
  const errors = [];
  let contractId;
  try {
    owner = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    owner.setDefaultTimeout(20000);
    owner.on('pageerror', (e) => errors.push(e.message));
    await owner.goto(web, { waitUntil: 'domcontentloaded' });
    await owner.locator('#login-identifier').fill('owner.contract.demo@example.invalid');
    await owner.locator('#login-password').fill(settings.BHOME_DEV_TEST_PASSWORD);
    await owner.locator('button[type=submit]').click();
    await owner.waitForURL('**/dashboard', { waitUntil: 'domcontentloaded' });
    await owner.goto(web + '/contracts', { waitUntil: 'domcontentloaded' });
    await owner.getByRole('heading', { name: 'Hợp đồng thuê & Vòng đời' }).waitFor();
    let contract = (
      await apiRead('/api/v1/contracts?locationId=' + fixtureId(10) + '&pageSize=100', token)
    ).items.find((c) => c.roomId === fixtureId(23) && c.kind === 'Main');
    if (!contract) {
      await owner.getByRole('button', { name: 'Tạo hợp đồng thuê', exact: true }).click();
      const dialog = owner.getByRole('dialog');
      await dialog.getByText(/CHỈ DÙNG CHO PHÁT TRIỂN/).waitFor();
      await dialog.getByRole('button', { name: 'Tiếp theo', exact: true }).click();
      async function choose(label, option) {
        await dialog.getByRole('combobox', { name: label, exact: true }).click();
        await owner.getByRole('option', { name: option, exact: true }).click();
      }
      await choose('Cơ sở', 'BHOME CONTRACT DEMO');
      await choose('Phòng sẵn sàng', 'P104-UI');
      await dialog.getByLabel('Người ở UI tổng hợp', { exact: true }).check();
      await choose('Người đại diện', 'Người ở UI tổng hợp');
      await dialog.getByRole('button', { name: 'Tiếp theo', exact: true }).click();
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
        end = new Date(today + 'T12:00:00Z');
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      await dialog.getByLabel('Ngày bắt đầu', { exact: true }).fill(today);
      await dialog.getByLabel('Ngày hết hạn', { exact: true }).fill(end.toISOString().slice(0, 10));
      await dialog.getByLabel('Tiền thuê tháng (VND)', { exact: true }).fill('3000000');
      await dialog.getByLabel('Cọc yêu cầu (VND)', { exact: true }).fill('3000000');
      await dialog
        .getByLabel('Điều khoản đã thống nhất', { exact: true })
        .fill(
          'SYNTHETIC UI SMOKE — thử quy trình, không phải hợp đồng hoặc khoản thanh toán thật.',
        );
      await owner.screenshot({ path: path.join(output, 'owner-wizard.png') });
      const response = owner.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/v1/contracts' && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
      const created = await response;
      assert.equal(created.status(), 201);
      contract = await created.json();
    } else {
      console.log(
        'Reuse P104-UI đã lưu; chỉ thực hiện các bước chưa hoàn tất, không reset dữ liệu.',
      );
      await owner.getByLabel('Mở bằng UUID hợp đồng', { exact: true }).fill(contract.id);
      await owner.getByRole('button', { name: 'Mở hợp đồng', exact: true }).click();
    }
    contractId = contract.id;
    const route = '/api/v1/contracts/' + contractId;
    console.log('Draft persisted; loading preview.');
    await owner.getByRole('button', { name: 'Tạo / lấy bản PDF xem trước', exact: true }).click();
    await owner.getByRole('button', { name: 'Xem PDF', exact: true }).first().click();
    await owner.locator('iframe[title="Bản PDF hợp đồng từ máy chủ"]').waitFor();
    let current = await apiRead(route, token);
    async function ownerAction(label) {
      await owner.getByRole('button', { name: label, exact: true }).click();
      const actionDialog = owner.getByRole('dialog', { name: label, exact: true });
      await actionDialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await actionDialog.waitFor({ state: 'hidden' });
    }
    if (
      !current.signatures.some((s) => s.signerUserId === fixtureId(1) && s.status === 'Simulated')
    ) {
      if (!current.signatures.some((s) => s.signerUserId === fixtureId(1)))
        await ownerAction('Mô phỏng ký (Development)');
      await ownerAction('Kiểm tra kết quả ký');
    }
    console.log('PASS Owner Web: cấu hình → wizard lưu nháp → PDF từ API → mô phỏng ký.');
    tenant = await browser.newPage({ viewport: { width: 430, height: 932 } });
    tenant.setDefaultTimeout(25000);
    tenant.on('pageerror', (e) => errors.push(e.message));
    tenant.on('console', (m) => {
      if (
        m.type() === 'error' &&
        /Unexpected text node|Text strings must be rendered/.test(m.text())
      )
        errors.push(m.text());
    });
    await tenant.goto(mobile, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await tenant
      .getByLabel('Email đăng nhập', { exact: true })
      .fill('tenant2.contract.demo@example.invalid');
    await tenant
      .getByLabel('Mật khẩu đăng nhập', { exact: true })
      .fill(settings.BHOME_DEV_TEST_PASSWORD);
    await tenant.getByText('Đăng nhập', { exact: true }).click();
    await tenant.waitForURL('**/workspace/**', { waitUntil: 'domcontentloaded' });
    // Use application navigation: the web mobile session intentionally does not survive a full reload.
    await tenant.getByText('Xem hợp đồng & trạng thái ký', { exact: true }).first().click();
    await tenant.getByText('Điều khoản đưa đi ký', { exact: true }).waitFor();
    current = await apiRead(route, token);
    async function tenantAction(label) {
      await tenant.getByRole('button', { name: label, exact: true }).click();
      await tenant
        .getByRole('checkbox', {
          name: 'Tôi đã kiểm tra nội dung và xác nhận thao tác',
          exact: true,
        })
        .click();
      const committed = tenant.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
            route + (label === 'Kiểm tra kết quả ký' ? '/signing/sync' : '/signing') &&
          r.request().method() === 'POST',
      );
      await tenant.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      assert.equal((await committed).status(), 200);
      await tenant
        .getByRole('button', { name: 'Xác nhận', exact: true })
        .waitFor({ state: 'hidden' });
    }
    const pendingTenant = current.signatures.find((s) => s.signerUserId === fixtureId(4));
    if (pendingTenant?.status !== 'Simulated') {
      if (!pendingTenant) await tenantAction('Mô phỏng ký (Development)');
      await tenantAction('Kiểm tra kết quả ký');
    }
    current = await apiRead(route, token);
    console.log(
      'Persisted signing states:',
      current.signatures.map((s) => s.status),
    );
    assert.equal(current.signatures.filter((s) => s.status === 'Simulated').length, 2);
    console.log(
      'PASS Tenant Mobile: đăng nhập → hợp đồng của mình → xác nhận mô phỏng ký → trạng thái lưu thật.',
    );
    await owner.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
    if (current.status !== 'Active') {
      await owner.getByText('Tiền cọc đã xác minh chưa đủ.', { exact: true }).waitFor();
      assert.equal(
        await owner.getByRole('button', { name: 'Kích hoạt hợp đồng', exact: true }).isDisabled(),
        true,
      );
      await owner.getByRole('button', { name: 'Xác minh cọc ngân hàng', exact: true }).click();
      const deposit = owner.getByRole('dialog', { name: 'Xác minh cọc ngân hàng', exact: true });
      await deposit
        .getByLabel('Mã giao dịch trên sao kê', { exact: true })
        .fill('SYNTHETIC-UI-' + contractId);
      await deposit.getByLabel('Số tiền cọc đã nhận (VND)', { exact: true }).fill('3000000');
      await deposit
        .getByLabel('Căn cứ đối chiếu sao kê', { exact: true })
        .fill('SYNTHETIC UI smoke statement. Không phải giao dịch thật.');
      await deposit.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await deposit.waitFor({ state: 'hidden' });
      await owner.getByText('Đủ điều kiện để Owner xác nhận kích hoạt.', { exact: true }).waitFor();
      await ownerAction('Kích hoạt hợp đồng');
    }
    current = await apiRead(route, token);
    assert.equal(current.status, 'Active');
    assert.equal((await apiRead('/api/v1/rooms/' + fixtureId(23), token)).status, 2);
    const eligible = await apiRead(
      '/api/v1/contracts/preparation?locationId=' + fixtureId(10),
      token,
    );
    assert.ok(!eligible.rooms.some((r) => r.id === fixtureId(23)));
    await tenant.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
    await tenant.getByText('Đang hiệu lực', { exact: true }).filter({ visible: true }).waitFor();
    await owner.screenshot({ path: path.join(output, 'owner-active.png') });
    await tenant.screenshot({ path: path.join(output, 'tenant-active.png'), fullPage: true });
    console.log(
      'PASS Owner Web: cọc thiếu chặn kích hoạt → xác minh sao kê tổng hợp → Active; Tenant Mobile tải lại thấy Active.',
    );
    await require('./ContractDemoHandoverSmoke.cjs')({
      browser,
      owner,
      tenant,
      token,
      contractId,
      loginToken,
      apiRead,
      output,
      mobile,
      api,
      settings,
      errors,
    });
    fs.writeFileSync(
      path.join(output, 'ui-fixture.json'),
      JSON.stringify({ contractId, roomId: fixtureId(23) }, null, 2),
    );
    await tenant.screenshot({ path: path.join(output, 'tenant-home.png') });
    assert.deepEqual(errors, []);
  } catch (e) {
    if (owner)
      await owner
        .screenshot({ path: path.join(output, 'owner-smoke-failure.png') })
        .catch(() => {});
    if (tenant)
      console.log('Tenant state:', (await tenant.locator('body').innerText()).slice(-2200));
    throw e;
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(String(e.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
