// Run after Start-AssetHandoverDemo.ps1. Only its isolated synthetic scenario is accepted.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium, request } = require('playwright-core');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const out = path.resolve('.tmp/handover-demo');
let browser, http;
(async () => {
  const access = read(path.join(out, 'access.json'));
  const session = read(access.sessionFile);
  const scenario = read(path.join(out, 'scenario.json'));
  assert.ok(Number.isInteger(session.apiPort) && session.apiPort > 1023 && session.apiPort < 65536);
  assert.match(
    session.environment.ConnectionStrings__Database ?? '',
    /bhome_compact24_[a-f0-9]{32}/,
  );
  const base = `https://localhost:${session.apiPort}`;
  http = await request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const health = await http.get('/health/ready', { timeout: 2000 }).catch(() => null);
    if (health?.status() === 200) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'The isolated demo API is not ready; inspect its session logs.');
  const tokens = {};
  for (const [i, role] of ['owner', 'staff', 'tenant'].entries()) {
    const response = await http.post('/api/v1/auth/login', {
      data: { email: access.accounts[i], password: access.password, device: 'Synthetic E2E' },
    });
    assert.equal(response.status(), 200, `${role} API login`);
    tokens[role] = (await response.json()).accessToken;
  }
  const api = async (
    role,
    route,
    data,
    method = data === undefined ? 'GET' : 'POST',
    contentType,
  ) => {
    const response = await http.fetch(route, {
      method,
      data,
      headers: {
        Authorization: `Bearer ${tokens[role]}`,
        'Idempotency-Key': randomUUID(),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
    });
    if (method === 'GET' && route.endsWith('/handover') && [204, 404].includes(response.status()))
      return null;
    assert.equal(response.status(), 200, `${method} ${route}: ${await response.text()}`);
    return response.json();
  };
  const route = `/api/v1/contracts/${scenario.contractId}`;
  const profile = await api('tenant', '/api/v1/account/profile');
  assert.ok(
    profile.phone && profile.fullName.trim(),
    'Seed must prepare the synthetic Tenant profile.',
  );
  const photo = fs.readFileSync(scenario.evidenceFile);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.BHOME_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const pages = {};
  for (const [i, role] of ['owner', 'staff', 'tenant'].entries()) {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: role === 'owner' ? 1440 : 430, height: 950 },
    });
    page.setDefaultTimeout(45000);
    pages[role] = page;
    await page.goto(role === 'owner' ? access.ownerUrl : access.mobileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    if (role === 'owner') {
      await page.locator('#login-identifier').fill(access.accounts[i]);
      await page.locator('#login-password').fill(access.password);
      await page.getByRole('button', { name: 'Đăng nhập vào hệ thống', exact: true }).click();
      await page.getByText('Tổng quan', { exact: true }).first().waitFor();
      await page.goto(`${access.ownerUrl}/handovers?contractId=${scenario.contractId}`);
    } else {
      await page
        .getByLabel('Email hoặc số điện thoại đăng nhập', { exact: true })
        .fill(access.accounts[i]);
      await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(access.password);
      await page.getByText('Đăng nhập', { exact: true }).click();
      await page
        .getByText(role === 'staff' ? 'BHOME Nhân viên' : 'Phòng của tôi', { exact: true })
        .waitFor();
      if (role === 'staff') {
        await page.getByText('Bàn giao / Trả phòng', { exact: true }).click();
        await page.getByText('Bàn giao nhận phòng', { exact: true }).click();
        await page.getByText('Phòng BG-101', { exact: true }).click();
      } else {
        // The Tenant's own Contract is reachable through the normal bottom navigation.
        await page.getByText('Phòng của tôi', { exact: true }).click();
        await page.getByText('Xem chi tiết hợp đồng', { exact: true }).click();
      }
      await page.getByText('Bàn giao', { exact: true }).click();
    }
  }
  const { owner, staff, tenant } = pages;
  const click = (page, name) => page.getByText(name, { exact: true }).click();
  const fill = (page, label, value) => page.getByLabel(label, { exact: true }).fill(String(value));
  const check = (page, name) => page.getByRole('checkbox', { name, exact: true }).click();
  const choice = async (page, name, label) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page
      .getByRole('radio', { name: label, exact: typeof label === 'string' })
      .first()
      .click();
  };
  const mutation = async (page, operation, button) => {
    const received = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `${route}/${operation}` && r.request().method() === 'POST',
    );
    await click(page, button);
    const response = await received;
    assert.equal(response.status(), 200, `${operation}: ${await response.text()}`);
    return response.json();
  };
  let record = await api('staff', `${route}/handover`);
  if (!record) {
    // Camera input is replaced with synthetic PNG bytes; all inspection decisions use shipped UI.
    await api('staff', `${route}/handover/evidence`, photo, 'POST', 'image/png');
    await api('staff', `${route}/handover/evidence`, photo, 'POST', 'image/png');
    await click(staff, 'Tải lại bàn giao');
    await click(staff, 'Lập biên bản bàn giao');
    const choices = await api('staff', `${route}/handover/choices`);
    assert.equal(choices.assets.length, 9);
    assert.equal(choices.assets.filter((a) => a.ownerChecked).length, 7);
    await fill(staff, 'Hiện trạng phòng', 'SYNTHETIC: kiểm tra tường, sàn, cửa cùng Tenant');
    await fill(staff, 'Chìa khóa / quyền truy cập đã bàn giao', 'Hai chìa khóa');
    for (const a of choices.assets) {
      await click(staff, `Kiểm tra ${a.name}`);
      const quantity = a.physicalAssets.reduce((n, p) => n + p.quantity, 0);
      await fill(staff, `${a.name} · Tình trạng thực tế`, quantity ? 'Tốt' : 'Chưa được bổ sung');
      for (const [key, label] of [
        ['observedQuantity', 'Số lượng thực tế'],
        ['handedOverQuantity', 'Số lượng bàn giao'],
        ['goodQuantity', 'Tình trạng tốt'],
        ['wornQuantity', 'Hao mòn'],
        ['damagedQuantity', 'Hư hỏng'],
      ])
        await fill(
          staff,
          `${a.name} · ${label}`,
          ['wornQuantity', 'damagedQuantity'].includes(key) ? 0 : quantity,
        );
      if (!quantity) {
        await fill(
          staff,
          `${a.name} · Ghi chú / lý do không bàn giao`,
          'Owner sẽ quyết định bổ sung sau',
        );
        await check(staff, `${a.name} · Ảnh 2`);
      }
      await check(staff, `Đã kiểm tra ${a.name}`);
      await click(staff, `Thu gọn ${a.name}`);
    }
    await choice(staff, 'Chỉ số điện', /BG-101-Electricity/);
    await choice(staff, 'Chỉ số nước', /BG-101-Water/);
    await staff.getByRole('checkbox', { name: /^Ảnh 1 ·/ }).click();
    record = await mutation(staff, 'handover', 'Lưu biên bản nhận phòng');
  }
  if (record.status !== 'Confirmed') {
    await click(owner, 'Tải lại bàn giao');
    await fill(
      owner,
      'Lý do quyết định ngoại lệ bàn giao',
      'Chấp nhận hiện trạng hai nhóm chưa bổ sung',
    );
    await fill(
      owner,
      'Phương án bổ sung / sửa chữa / kiểm tra lại',
      'Theo dõi bằng bàn giao bổ sung; không tự quy trách nhiệm',
    );
    record = await mutation(owner, 'handover/owner-review', 'Chấp nhận bàn giao theo thực tế');
    await click(tenant, 'Tải lại bàn giao');
    await check(tenant, `Tôi đã kiểm tra nội dung phiên bản ${record.version}`);
    await mutation(tenant, 'handover/tenant-confirmation', 'Xác nhận nhận phòng');
    await click(staff, 'Tải lại bàn giao');
    await check(staff, `Tôi đã kiểm tra nội dung phiên bản ${record.version}`);
    await mutation(staff, 'handover/staff-confirmation', 'Staff xác nhận hoàn tất bàn giao');
  }
  const confirmed = await api('tenant', `${route}/handover`);
  assert.equal(confirmed.status, 'Confirmed');
  const documents = await api('tenant', `${route}/handover/documents`);
  const document = documents.find((d) => d.kind === 'MoveInReport');
  assert.ok(document);
  const pdf = await http.get(`${route}/handover/documents/${document.id}`, {
    headers: { Authorization: `Bearer ${tokens.tenant}` },
  });
  assert.equal(pdf.status(), 200);
  fs.writeFileSync(path.join(out, 'move-in.pdf'), await pdf.body());
  console.log('PASS: Move-in through three client interfaces and persisted PDF.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let changes = await api('staff', `${route}/asset-changes`);
  if (!changes.length) {
    const initial = await api('staff', `${route}/asset-changes/preparation`);
    const group = initial.baseline.assets.find((a) => a.name === 'Ghế');
    const asset = group.physicalAssets[0];
    const metadata = await api('owner', `/api/v1/assets/${asset.id}/metadata`);
    // Existing Owner inventory operation supplies the source; Staff only records physical receipt.
    await api(
      'owner',
      `/api/v1/assets/${asset.id}/metadata`,
      {
        metadata: { ...metadata.data, quantity: 5 },
        expectedVersion: metadata.version,
        reason: 'SYNTHETIC: Owner bổ sung một ghế, chờ bàn giao Tenant',
      },
      'PUT',
    );
    await click(staff, 'Tải lại thay đổi tài sản');
    await click(staff, 'Lập bàn giao thay đổi tài sản');
    await choice(
      staff,
      'Nguồn thay đổi từ quản lý tài sản / Work Order đã xác minh',
      /SYNTHETIC: Owner bổ sung/,
    );
    await choice(staff, 'Nhóm tài sản bàn giao', 'Ghế');
    await choice(staff, 'Tài sản được thêm / thay mới', /^Ghế · 5/);
    await fill(staff, 'Số lượng thêm', '1');
    await fill(staff, 'Tình trạng tài sản thay đổi', 'Tốt');
    await fill(staff, 'Lý do bổ sung / thay thế / thu hồi', 'SYNTHETIC: giao thêm một ghế thực tế');
    await check(staff, 'Ảnh thay đổi tài sản 1');
    await mutation(staff, 'asset-changes', 'Gửi Tenant xác nhận thay đổi tài sản');
    changes = await api('staff', `${route}/asset-changes`);
  }
  const change = changes[0];
  if (
    !change.data.acknowledgements.some((a) => a.contractId === scenario.contractId && a.accepted)
  ) {
    await click(tenant, 'Tải lại bàn giao');
    await check(tenant, 'Tôi đã kiểm tra thay đổi tài sản thực tế');
    await mutation(tenant, `asset-changes/${change.id}/confirmation`, 'Xác nhận thay đổi tài sản');
  }
  assert.equal(
    (await api('staff', `${route}/move-out/inspection-preparation`)).baseline.snapshot.assets.find(
      (a) => a.name === 'Ghế',
    ).handedOverQuantity,
    5,
  );
  assert.equal(
    (await api('tenant', `${route}/handover`)).snapshot.assets.find((a) => a.name === 'Ghế')
      .handedOverQuantity,
    4,
  );
  console.log(
    'PASS: Supplement UI acknowledgement updates comparison baseline without rewriting move-in.',
  );
  await click(tenant, 'Gia hạn & trả phòng');
  let move;
  try {
    move = await api('tenant', `${route}/move-out`);
  } catch (e) {
    if (!e.message.includes('404')) throw e;
  }
  if (!move) {
    await click(tenant, 'Yêu cầu chấm dứt trước hạn');
    await fill(tenant, 'Ngày dự kiến trả phòng (dd/MM/yyyy)', today);
    await fill(tenant, 'Lý do', 'SYNTHETIC: chuyển nơi ở');
    await check(tenant, 'Tôi đã kiểm tra nội dung và xác nhận thao tác');
    move = await mutation(tenant, 'termination-requests', 'Xác nhận');
  }
  await owner.goto(
    `${access.ownerUrl}/contracts?contractId=${scenario.contractId}&section=lifecycle`,
  );
  if (move.status === 'Requested') {
    await click(owner, 'Duyệt yêu cầu trả phòng');
    await mutation(owner, 'move-out/approve', 'Xác nhận');
  }
  move = await api('owner', `${route}/move-out`);
  if (!move.inspectionScheduledAt) {
    const future = new Date(Date.now() + 5 * 60000);
    const localSchedule = new Date(future.getTime() + 7 * 3600000).toISOString().slice(0, 16);
    await fill(owner, 'Lịch kiểm tra (giờ Việt Nam)', localSchedule);
    await owner.getByRole('combobox', { name: 'Staff kiểm tra', exact: true }).click();
    await owner
      .getByRole('option')
      .filter({ hasText: /demo bàn giao 2|staff.sample/ })
      .first()
      .click();
    await mutation(owner, 'move-out/schedule', 'Lưu lịch & phân công');
  }
  move = await api('staff', `${route}/move-out`);
  if (move.status === 'Approved') {
    const meters = await api('owner', `/api/v1/capture/locations/${scenario.locationId}/meters`);
    const roomMeters = meters.filter((m) => m.parentId === scenario.roomId);
    assert.equal(roomMeters.length, 2);
    for (const meter of roomMeters) {
      const task = await api('owner', '/api/v1/capture/meter-tasks', {
        meterId: meter.id,
        purpose: 2,
        readingDate: today,
        contractId: scenario.contractId,
      });
      const evidence = await api(
        'staff',
        `/api/v1/capture/meter-tasks/${task.id}/evidence`,
        photo,
        'PUT',
        'image/png',
      );
      await api('staff', `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
        humanConfirmed: true,
        confirmedValue: '101',
        evidenceId: evidence.id,
      });
    }
    await api('staff', `${route}/move-out/evidence`, photo, 'POST', 'image/png');
    await api('staff', `${route}/move-out/evidence`, photo, 'POST', 'image/png');
    await click(staff, 'Gia hạn & trả phòng');
    await click(staff, 'Tải lại trạng thái');
    await fill(staff, 'Hiện trạng phòng khi trả', 'SYNTHETIC: đã kiểm tra tường, sàn, cửa');
    await fill(staff, 'Chìa khóa / quyền truy cập khi trả', 'Thu hai chìa khóa riêng');
    await fill(staff, 'Ghi chú kiểm tra', 'SYNTHETIC: thiếu một ghế, chưa xác định trách nhiệm');
    const preparation = await api('staff', `${route}/move-out/inspection-preparation`);
    for (const a of preparation.inspectionGroups) {
      const quantity = a.name === 'Ghế' ? 4 : (a.handedOverQuantity ?? 0);
      await click(staff, `Kiểm tra ${a.name}`);
      await fill(staff, `${a.name} · Tình trạng thực tế`, 'Đã kiểm tra thực tế');
      for (const [key, label] of [
        ['observedQuantity', 'Số lượng thực tế'],
        ['handedOverQuantity', 'Số lượng bàn giao'],
        ['goodQuantity', 'Tình trạng tốt'],
        ['wornQuantity', 'Hao mòn'],
        ['damagedQuantity', 'Hư hỏng'],
      ])
        await fill(
          staff,
          `${a.name} · ${label}`,
          ['wornQuantity', 'damagedQuantity'].includes(key) ? 0 : quantity,
        );
      await fill(staff, `${a.name} · Ghi chú / lý do không bàn giao`, 'Chỉ ghi nhận hiện trạng');
      await check(staff, `${a.name} · Ảnh 2`);
      await check(staff, `Đã kiểm tra ${a.name}`);
      await click(staff, `Thu gọn ${a.name}`);
    }
    await choice(staff, 'Chỉ số điện chốt đã xác nhận', /BG-101-Electricity/);
    await choice(staff, 'Chỉ số nước chốt đã xác nhận', /BG-101-Water/);
    await check(staff, 'Ảnh hiện trạng 1');
    await check(staff, 'Tôi xác nhận hiện trạng và chỉ số đã đối chiếu thực tế');
    await mutation(staff, 'move-out/inspection', 'Lưu biên bản đối chiếu');
  }
  await click(tenant, 'Tải lại trạng thái');
  await click(tenant, 'Tải lại biên bản & quyết toán');
  const inspection = (await api('owner', `${route}/move-out/inspections`))[0];
  if (!inspection.observed.tenantFeedback) {
    await fill(
      tenant,
      'Nội dung phản hồi biên bản trả phòng',
      'Không đồng ý nguyên nhân thiếu ghế; yêu cầu Owner ghi nhận',
    );
    await check(tenant, `Tôi đã xem biên bản trả phòng phiên bản ${inspection.version}`);
    await mutation(tenant, 'move-out/tenant-feedback', 'Không đồng ý biên bản trả phòng');
  }
  await click(owner, 'Tải lại dữ liệu quyết toán');
  if (!inspection.ownerDecision) {
    await fill(owner, 'Lý do / căn cứ của Owner', 'Xác nhận hiện trạng; chưa kết luận bồi thường');
    await check(owner, 'Owner xử lý ngoại lệ Tenant chưa phản hồi hoặc không đồng ý');
    await fill(
      owner,
      'Căn cứ xử lý ngoại lệ phản hồi Tenant',
      'Ghi nhận tranh chấp của Tenant, xử lý tài chính riêng',
    );
    await mutation(owner, 'move-out/inspection-review', 'Xác nhận biên bản kiểm tra');
  }
  await owner
    .getByRole('combobox', { name: 'Trạng thái phòng nếu không còn Tenant', exact: true })
    .click();
  await owner.getByRole('option', { name: /Chưa cho thuê/ }).click();
  await mutation(owner, 'move-out/complete', 'Hoàn tất bàn giao trả phòng và lưu PDF');
  assert.equal((await api('owner', route)).status, 'Terminated');
  const finalDocuments = await api('tenant', `${route}/handover/documents`);
  assert.ok(finalDocuments.some((d) => d.kind === 'MoveOutReport'));
  for (const document of finalDocuments.filter((d) => d.kind !== 'MoveInReport')) {
    const response = await http.get(`${route}/handover/documents/${document.id}`, {
      headers: { Authorization: `Bearer ${tokens.tenant}` },
    });
    assert.equal(response.status(), 200);
    fs.writeFileSync(path.join(out, `${document.kind}.pdf`), await response.body());
  }
  await click(owner, 'Tải lại dữ liệu quyết toán');
  for (const [role, page] of Object.entries(pages))
    await page.screenshot({ path: path.join(out, `${role}-handover.png`), fullPage: true });
  console.log(
    'PASS: Move-out UI, Tenant dispute, Owner exception, physical completion and stored reports. Financial settlement remains separate.',
  );
  await browser.close();
  browser = null;
  await http.dispose();
  http = null;
})().catch(async (error) => {
  console.error(error.message);
  if (browser) {
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        console.error('Screen:', page.url(), (await page.locator('body').innerText()).slice(-6500));
      }
    await browser.close();
  }
  if (http) await http.dispose();
  process.exitCode = 1;
});
