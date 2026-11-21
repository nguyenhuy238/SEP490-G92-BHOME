const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
module.exports = async function handoverSmoke({
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
}) {
  const route = '/api/v1/contracts/' + contractId,
    staffToken = await loginToken('staff');
  const existing = await fetch(api + route + '/handover', {
    headers: { Authorization: 'Bearer ' + token },
  });
  let handover = existing.status === 404 ? null : await existing.json(),
    staff;
  try {
    {
      if (!handover) {
        const photo = await fetch(api + route + '/handover/evidence', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + staffToken, 'Content-Type': 'image/png' },
          body: fs.readFileSync(path.join(output, 'synthetic-evidence.png')),
        });
        assert.equal(photo.status, 200);
      }
      staff = await browser.newPage({ viewport: { width: 430, height: 932 } });
      staff.setDefaultTimeout(25000);
      staff.on('pageerror', (e) => errors.push(e.message));
      staff.on('console', (m) => {
        if (
          m.type() === 'error' &&
          /Unexpected text node|Text strings must be rendered/.test(m.text())
        )
          errors.push(m.text());
      });
      await staff.goto(mobile, { waitUntil: 'domcontentloaded' });
      await staff
        .getByLabel('Email đăng nhập', { exact: true })
        .fill('staff.contract.demo@example.invalid');
      await staff
        .getByLabel('Mật khẩu đăng nhập', { exact: true })
        .fill(settings.BHOME_DEV_TEST_PASSWORD);
      await staff.getByText('Đăng nhập', { exact: true }).click();
      await staff.waitForURL('**/workspace/**', { waitUntil: 'domcontentloaded' });
      await staff.getByText('Bàn giao nhận phòng', { exact: true }).click();
      const card = staff
        .getByText('Phòng P104-UI', { exact: true })
        .locator('..')
        .locator('..')
        .locator('..');
      await card.getByRole('button', { name: 'Xem hợp đồng', exact: true }).click();
      await staff.getByText(contractId, { exact: true }).waitFor();
      if (!handover) {
        await staff.getByRole('button', { name: 'Lập biên bản bàn giao', exact: true }).click();
        await staff
          .getByLabel('Hiện trạng phòng', { exact: true })
          .fill('SYNTHETIC UI: phòng sạch, kiểm tra cùng Tenant.');
        await staff
          .getByLabel('Chìa khóa / quyền truy cập đã bàn giao', { exact: true })
          .fill('SYNTHETIC UI: đã kiểm tra chìa khóa và thiết bị.');
        await staff.getByLabel(/^Quạt UI tổng hợp/).fill('SYNTHETIC UI: hoạt động sau kiểm tra.');
        for (const [label, meter] of [
          ['Chỉ số điện', 'DEMO-P104-E'],
          ['Chỉ số nước', 'DEMO-P104-W'],
        ]) {
          await staff.getByRole('button', { name: label, exact: true }).click();
          await staff.getByRole('radio', { name: new RegExp(meter) }).click();
        }
        await staff.getByRole('checkbox', { name: /^Ảnh 1/ }).click();
        const saved = staff.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === route + '/handover' && r.request().method() === 'POST',
        );
        await staff.getByRole('button', { name: 'Lưu biên bản nhận phòng', exact: true }).click();
        assert.equal((await saved).status(), 200);
        handover = await apiRead(route + '/handover', token);
      }
      if (handover.status !== 'Confirmed') {
        await tenant.getByRole('button', { name: 'Tải lại bàn giao', exact: true }).click();
        await tenant
          .getByRole('checkbox', {
            name: `Tôi đã kiểm tra nội dung phiên bản ${handover.version}`,
            exact: true,
          })
          .click();
        const tenantConfirmed = tenant.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === route + '/handover/tenant-confirmation' &&
            r.request().method() === 'POST',
        );
        await tenant.getByRole('button', { name: 'Xác nhận nhận phòng', exact: true }).click();
        assert.equal((await tenantConfirmed).status(), 200);
        await staff.getByRole('button', { name: 'Tải lại bàn giao', exact: true }).click();
        await staff
          .getByRole('checkbox', {
            name: `Tôi đã kiểm tra nội dung phiên bản ${handover.version}`,
            exact: true,
          })
          .click();
        const completed = staff.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === route + '/handover/staff-confirmation' &&
            r.request().method() === 'POST',
        );
        await staff
          .getByRole('button', { name: 'Staff xác nhận hoàn tất bàn giao', exact: true })
          .click();
        assert.equal((await completed).status(), 200);
      }
      await staff.screenshot({ path: path.join(output, 'staff-handover.png'), fullPage: true });
    }
    handover = await apiRead(route + '/handover', token);
    assert.equal(handover.status, 'Confirmed');
    assert.equal(handover.tenantConfirmedVersion, handover.version);
    assert.ok(handover.staffConfirmedAt);
    await owner.getByRole('button', { name: 'Tải lại bàn giao', exact: true }).click();
    await owner.getByText(/Đã xác nhận bàn giao/).waitFor();
    console.log(
      'PASS UC-17: Staff Mobile lưu hiện trạng/tài sản/chìa khóa/chỉ số/ảnh → Tenant xác nhận cùng phiên bản → Staff hoàn tất → Owner Web đọc lịch sử.',
    );
  } catch (e) {
    if (staff) {
      console.log('Staff state:', (await staff.locator('body').innerText()).slice(-3500));
      await staff.screenshot({
        path: path.join(output, 'staff-handover-failure.png'),
        fullPage: true,
      });
    }
    throw e;
  }
};
