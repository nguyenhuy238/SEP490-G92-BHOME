// Browser smoke against real local APIs. No route mocks, real users, bank/provider claims or native-camera claims.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { chromium } = require(
  require.resolve('playwright', {
    paths: [path.join(__dirname, '../.tools/contract-browser'), process.cwd()],
  }),
);
const output = path.join(__dirname, '../.tools/contract-demo'),
  settings = JSON.parse(
    fs.readFileSync(path.join(output, 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'lifecycle-fixture.json'), 'utf8'));
const api = process.env.BHOME_LIFECYCLE_DEMO_API || 'http://localhost:5540',
  web = process.env.BHOME_LIFECYCLE_DEMO_WEB || 'http://localhost:5517',
  mobile = process.env.BHOME_LIFECYCLE_DEMO_MOBILE || 'http://localhost:5581';
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
  const ownerToken = await login('owner'),
    staffToken = await login('staff');
  async function read(route, token = ownerToken) {
    const r = await fetch(api + route, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(r.status, 200, route);
    return r.json();
  }
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }),
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  const errors = [],
    pages = [];
  const track = (p) => {
    p.setDefaultTimeout(30000);
    p.on('pageerror', (e) => errors.push(e.message));
    pages.push(p);
    return p;
  };
  async function mobilePage(name, cid) {
    const p = track(await context.newPage());
    await p.setViewportSize({width:430,height:932});
    await p.goto(mobile);
    await p
      .getByLabel('Email đăng nhập', { exact: true })
      .fill(name + '.contract.demo@example.invalid');
    await p
      .getByLabel('Mật khẩu đăng nhập', { exact: true })
      .fill(settings.BHOME_DEV_TEST_PASSWORD);
    await p.getByText('Đăng nhập', { exact: true }).click();
    await p.waitForURL('**/workspace/**');
    let useListing = true;
    if (name === 'staff') {
      await p.getByText('Trả phòng & kiểm tra', { exact: true }).click();
      const c = await read('/api/v1/contracts/' + cid);
      if (c.status !== 'Terminated') {
        await p
          .getByRole('button', { name: 'Mở kiểm tra phòng ' + c.roomNumber, exact: true })
          .click();
        useListing = false;
      }
    } else {
      await p.getByText('Hợp đồng', { exact: true }).first().click();
    }
    if (useListing) {
      const token = await login(name);
      let page = 1,
        index = -1;
      do {
        const list = await read('/api/v1/contracts?page=' + page + '&pageSize=20', token);
        index = list.items.findIndex((c) => c.id === cid);
        if (index >= 0) break;
        assert.ok(page * 20 < list.totalCount, 'contract visible in Tenant listing');
        await p.getByRole('button', { name: 'Sau', exact: true }).click();
        page++;
      } while (page < 20);
      await p.getByRole('button', { name: 'Xem hợp đồng', exact: true }).nth(index).click();
    }
    await p.getByText('Đối chiếu trả phòng', { exact: true }).waitFor();
    return p;
  }
  try {
    const ui = fixture.scenarios[5],
      cid = ui.contracts[0],
      route = '/api/v1/contracts/' + cid;
    let inspections = await read(route + '/move-out/inspections');
    if (!inspections.length) {
      const photo = await fetch(api + route + '/move-out/evidence', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + staffToken, 'Content-Type': 'image/png' },
        body: fs.readFileSync(path.join(output, 'synthetic-evidence.png')),
      });
      assert.equal(photo.status, 200);
    }
    const staff = await mobilePage('staff', cid);
    const staffSummaryReads = [];
    staff.on('request', (r) => {
      if (r.url().includes('/settlement-summary')) staffSummaryReads.push(r.url());
    });
    if (!inspections.length) {
      await staff
        .getByLabel('Hiện trạng phòng khi trả', { exact: true })
        .fill('SYNTHETIC UI: phòng sạch sau kiểm tra');
      await staff
        .getByLabel('Chìa khóa / quyền truy cập khi trả', { exact: true })
        .fill('SYNTHETIC UI: trả đủ 2 chìa khóa');
      await staff
        .getByLabel('Ghi chú kiểm tra', { exact: true })
        .fill('SYNTHETIC UI: không phát sinh phí riêng');
      await staff
        .getByLabel(/^Quạt lifecycle tổng hợp · Khi nhận/)
        .fill('SYNTHETIC UI: hoạt động tốt');
      for (const [label, code] of [
        ['Chỉ số điện chốt đã xác nhận', 'SYN-LC-5-0'],
        ['Chỉ số nước chốt đã xác nhận', 'SYN-LC-5-1'],
      ]) {
        await staff.getByRole('button', { name: label, exact: true }).click();
        await staff.getByRole('radio', { name: new RegExp(code) }).click();
      }
      await staff.getByRole('checkbox', { name: 'Ảnh hiện trạng 1', exact: true }).click();
      await staff
        .getByRole('checkbox', {
          name: 'Tôi xác nhận hiện trạng và chỉ số đã đối chiếu thực tế',
          exact: true,
        })
        .click();
      const saved = staff.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === route + '/move-out/inspection' &&
          r.request().method() === 'POST',
      );
      await staff.getByRole('button', { name: 'Lưu biên bản đối chiếu', exact: true }).click();
      assert.equal((await saved).status(), 200);
      inspections = await read(route + '/move-out/inspections');
    }
    await staff.getByText('Biên bản phiên bản 1', { exact: true }).waitFor();
    await staff.getByText('Đối chiếu trả phòng',{exact:true}).scrollIntoViewIfNeeded();
    await staff.screenshot({
      path: path.join(output, 'lifecycle-staff-inspection.png'),
      fullPage: true,
    });
    assert.equal(staffSummaryReads.length, 0);
    assert.equal(await staff.getByText('Quyết toán từ máy chủ', { exact: true }).count(), 0);
    const owner = track(await context.newPage());
    await owner.goto(web);
    await owner.locator('#login-identifier').fill('owner.contract.demo@example.invalid');
    await owner.locator('#login-password').fill(settings.BHOME_DEV_TEST_PASSWORD);
    await owner.locator('button[type=submit]').click();
    await owner.waitForURL('**/dashboard');
    async function openOwner(id) {
      await owner.goto(web + '/contracts');
      await owner.getByLabel('Mở bằng UUID hợp đồng', { exact: true }).fill(id);
      await owner.getByRole('button', { name: 'Mở hợp đồng', exact: true }).last().click();
      await owner.getByText('Kiểm tra & quyết toán trả phòng', { exact: true }).waitFor();
    }
    await openOwner(cid);
    if (!inspections[0].ownerDecision) {
      await owner
        .getByLabel('Lý do / căn cứ của Owner', { exact: true })
        .fill('SYNTHETIC UI: đối chiếu bàn giao, không phát sinh phí riêng');
      await owner
        .getByRole('checkbox', {
          name: 'Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu',
          exact: true,
        })
        .check();
      const reviewed = owner.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === route + '/move-out/inspection-review' &&
          r.request().method() === 'POST',
      );
      await owner.getByRole('button', { name: 'Xác nhận biên bản kiểm tra', exact: true }).click();
      assert.equal((await reviewed).status(), 200);
    }
    let m = await read(route + '/move-out');
    if (!['Settled', 'Completed'].includes(m.status)) {
      await owner
        .getByText('Các nguồn hiện tại đủ điều kiện xem xét hoàn tất.', { exact: true })
        .waitFor();
      await owner
        .getByLabel('Lý do / căn cứ của Owner', { exact: true })
        .fill('SYNTHETIC UI: đã đối chiếu ledger, không cọc, các khoản đã thanh toán');
      await owner
        .getByRole('checkbox', {
          name: 'Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý',
          exact: true,
        })
        .check();
      const settled = owner.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === route + '/move-out/settlement' &&
          r.request().method() === 'POST',
      );
      await owner.getByRole('button', { name: 'Lưu xem xét quyết toán', exact: true }).click();
      assert.equal((await settled).status(), 200);
    }
    await owner.getByText('Kiểm tra & quyết toán trả phòng',{exact:true}).scrollIntoViewIfNeeded();
    await owner.screenshot({
      path: path.join(output, 'lifecycle-owner-reviewed.png'),
      fullPage: true,
    });
    m = await read(route + '/move-out');
    if (m.status !== 'Completed') {
      await owner.getByRole('button', { name: 'Hoàn tất trả phòng', exact: true }).click();
      const dialog = owner.getByRole('dialog');
      await dialog.getByLabel('Ngày kết thúc thực tế', { exact: true }).fill(fixture.businessDate);
      const completed = owner.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === route + '/move-out/complete' &&
          r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      assert.equal((await completed).status(), 200);
    }
    const tenant = await mobilePage('tenant1', cid);
    await tenant.getByText('Ngày kết thúc thực tế: '+fixture.businessDate.split('-').reverse().join('/'),{exact:true}).waitFor();
    await tenant.getByText('Quyết toán từ máy chủ', { exact: true }).waitFor();
    await tenant.getByText('Owner đã xác nhận', { exact: false }).first().waitFor();
    await tenant.getByText('Quyết toán từ máy chủ',{exact:true}).scrollIntoViewIfNeeded();
    await tenant.screenshot({
      path: path.join(output, 'lifecycle-tenant-history.png'),
      fullPage: true,
    });
    assert.equal((await read(route)).status, 'Terminated');
    assert.equal((await read(route)).actualEndDate,fixture.businessDate);
    await openOwner(fixture.scenarios[3].contracts[0]);
    await owner.getByText(/Hóa đơn chung còn nợ/).waitFor();
    await owner.getByText(/Chờ chính sách khấu trừ/).waitFor();
    assert.equal(
      await owner.getByRole('button', { name: 'Hoàn tất trả phòng', exact: true }).count(),
      0,
    );
    await owner.getByText(/Hóa đơn chung còn nợ/).scrollIntoViewIfNeeded();
    await owner.screenshot({
      path: path.join(output, 'lifecycle-owner-pending.png'),
      fullPage: true,
    });
    const shared = await read('/api/v1/contracts/' + fixture.scenarios[2].contracts[0]);
    assert.equal(shared.status, 'Terminated');
    for (const other of fixture.scenarios[2].contracts.slice(1))
      assert.equal((await read('/api/v1/contracts/' + other)).status, 'Active');
    assert.equal((await read('/api/v1/rooms/' + fixture.scenarios[2].roomId)).status, 2);
    assert.equal((await read('/api/v1/rooms/' + fixture.scenarios[4].roomId)).status, 0);
    assert.equal((await read('/api/v1/rooms/' + fixture.scenarios[3].roomId)).status, 2);
    const reminders = await read('/api/v1/contracts/expiry-reminders');
    assert.ok(reminders.some((n) => n.contractId === fixture.scenarios[0].contracts[0]));
    await owner.goto(web + '/contracts');
    await owner.getByText(/Phòng LC101-RENEW-PENDING.*Sắp hết hạn/).waitFor();
    await owner
      .getByLabel('Mở bằng UUID hợp đồng', { exact: true })
      .fill(fixture.scenarios[0].renewalId);
    await owner.getByRole('button', { name: 'Mở hợp đồng', exact: true }).last().click();
    await owner.getByText('Các phiên bản và điều khoản', { exact: true }).waitFor();
    await owner
      .getByText('SYNTHETIC RENEWAL; preserved historical terms; SIMULATED SIGNING', {
        exact: true,
      })
      .first()
      .waitFor();
    await owner.getByText('Các phiên bản và điều khoản',{exact:true}).scrollIntoViewIfNeeded();
    await owner.screenshot({
      path: path.join(output, 'lifecycle-owner-renewal.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'lifecycle-browser-results.json'),
      JSON.stringify(
        {
          passed: true,
          staffInspection: true,
          ownerReviewAndClosure: true,
          tenantHistoricalView: true,
          sharedContractsPreserved: true,
          pendingBlocked: true,
          renewalVersionsAndExpiryReminder: true,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS BH40 real browser: Staff inspection, Owner review/settlement/closure, Tenant historical comparison and pending shared obligations. Synthetic evidence and funds; no native camera/bank/MySign claim.',
    );
  } catch (e) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i]
        .screenshot({ path: path.join(output, `lifecycle-failure-${i}.png`), fullPage: true })
        .catch(() => {});
      fs.writeFileSync(
        path.join(output, `lifecycle-failure-${i}.txt`),
        await pages[i]
          .locator('body')
          .innerText()
          .catch(() => ''),
      );
    }
    throw e;
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(String(e.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
