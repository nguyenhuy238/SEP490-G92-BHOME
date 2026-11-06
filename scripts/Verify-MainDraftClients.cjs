// Called by the disposable Compact24/MinIO browser harness. Only synthetic accounts/data.
// Owner uses the shipped Web UI; Staff/Tenant use the shipped Mobile transport/shared clients.
const path = require('node:path');
const Module = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
function sourceModule(relative) {
  const file = path.resolve(__dirname, '..', relative);
  const code = require('esbuild').buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  loaded._compile(code, file);
  return loaded.exports;
}
module.exports = async function verify(settings, page) {
  const { SessionClient } = sourceModule('packages/client-core/src/sessionClient.ts');
  const { MobileApi } = sourceModule('src/mobile/src/lib/api.ts');
  const { contractClient, businessToday } = sourceModule('packages/client-core/src/contracts.ts');
  const { mainDraftClient } = sourceModule('packages/client-core/src/mainDrafts.ts');
  const { invoiceClient } = sourceModule('packages/client-core/src/invoices.ts');
  const { paymentClient } = sourceModule('packages/client-core/src/payments.ts');
  const { adjustmentClient } = sourceModule('packages/client-core/src/adjustments.ts');
  const actors = {};
  for (const [name, credentials] of Object.entries(settings.actors)) {
    const auth = new SessionClient(settings.baseUrl, 'mobile');
    await auth.login(credentials.email, credentials.password);
    const transport = new MobileApi(
      settings.baseUrl,
      () => auth.session?.accessToken,
      auth.refresh,
      auth.clear,
    );
    actors[name] = {
      api: transport,
      contracts: contractClient((...args) => transport.request(...args)),
      drafts: mainDraftClient((...args) => transport.request(...args)),
      invoices: invoiceClient((...args) => transport.request(...args)),
      payments: paymentClient((...args) => transport.request(...args)),
      adjustments: adjustmentClient((...args) => transport.request(...args)),
    };
  }
  const { owner, staff, tenant, otherTenant } = actors;
  const post = (actor, route, body) =>
    actor.api.request(route, { method: 'POST', body: JSON.stringify(body) });
  const today = businessToday();
  const start = new Date(today + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 1);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = new Date(today + 'T00:00:00Z');
  endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
  const rooms = await owner.api.request('/api/v1/rooms?locationId=' + settings.locationId);
  const room = rooms.items.find((r) => r.roomNumber === 'FIN-01');
  assert.ok(room);
  await post(owner, '/api/v1/staff-location-assignments', {
    locationId: settings.locationId,
    staffUserId: settings.actors.staff.id,
    startDate,
    endDate: endDate.toISOString().slice(0, 10),
  });
  const policies = await owner.invoices.policies(settings.locationId, 1);
  for (const [code, rate] of [
    ['RENT', '3000000'],
    ['ELECTRICITY', '3500'],
    ['WATER', '18000'],
  ]) {
    const policy = policies.items.find((p) => p.chargeCode === code);
    assert.match(String(policy.rate), new RegExp('^' + rate + '(?:\\.0+)?$'));
    assert.equal(policy.effectiveFrom, startDate);
  }
  // Historical configuration comes from the clearly labeled disposable fixture.
  // Keep the real API's no-backdating guard intact rather than changing it for this test.
  await assert.rejects(
    post(owner, '/api/v1/billing-policies', {
      locationId: settings.locationId,
      category: 0,
      chargeCode: 'RENT',
      name: 'RENT',
      method: 0,
      rate: '3000000',
      effectiveFrom: startDate,
    }),
    (e) => e.status === 400 && e.code === 'invalid_policy',
  );
  const resident = await post(staff, '/api/v1/capture/residents', {
    roomId: room.id,
    displayLabel: 'SYNTHETIC DRAFT REPRESENTATIVE',
    residentType: 0,
  });
  await post(staff, `/api/v1/capture/residents/${resident.id}/confirm`, {
    humanConfirmed: true,
    citizenIdentityNumber: '000000000123',
    fullName: 'NGƯỜI KIỂM THỬ',
    dateOfBirth: '2000-01-01',
    residentialAddress: 'Địa chỉ tổng hợp',
    dateOfIssue: '2021-01-01',
  });
  const residentIds = [resident.id];
  for (const [index, name] of ['coTenant1', 'coTenant2'].entries()) {
    const person = await post(staff, '/api/v1/capture/residents', {
      roomId: room.id,
      displayLabel: 'SYNTHETIC CO-OCCUPANT ' + (index + 1),
      residentType: 1,
    });
    await post(staff, `/api/v1/capture/residents/${person.id}/confirm`, {
      humanConfirmed: true,
      citizenIdentityNumber: '00000000012' + (index + 4),
      fullName: 'NGƯỜI Ở CÙNG TỔNG HỢP ' + (index + 1),
      dateOfBirth: '2000-01-01',
      residentialAddress: 'Địa chỉ tổng hợp',
      dateOfIssue: '2021-01-01',
    });
    await assert.rejects(
      staff.contracts.linkTenant(person.id, settings.actors[name].id),
      (e) => e.status === 403,
    );
    await owner.contracts.linkTenant(person.id, settings.actors[name].id);
    residentIds.push(person.id);
  }
  const draft = await staff.drafts.save(
    null,
    {
      roomId: room.id,
      representativeResidentId: resident.id,
      residentIds,
      startDate,
      endDate: endDate.toISOString().slice(0, 10),
      notes: 'Điều khoản browser tổng hợp',
      tenantPhone: '0000000000',
      tenantPlaceOfIssue: 'Nơi cấp tổng hợp',
      expectedVersion: 0,
    },
    randomUUID(),
  );
  assert.deepEqual(draft.preparation.blockers, []);
  assert.equal(draft.preparation.securityDeposit, '3000000');
  assert.equal((await staff.drafts.get(draft.id)).id, draft.id);
  console.log(
    'PASS: real Mobile transport confirms synthetic onboarding and saves/reloads a Main Draft using Owner settings.',
  );

  // Open through the real list action, exercising the page-level onboardingDraft branch.
  await page.reload();
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tài khoản Tenant đại diện', exact: true }).click();
  await page.getByRole('option', { name: settings.actors.tenant.email, exact: true }).click();
  const pdfResponse = page.waitForResponse(
    (r) =>
      r.url().includes(`/main-drafts/${draft.id}/documents/`) && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Tạo và xem PDF đưa đi ký', exact: true }).click();
  const reviewed = await pdfResponse;
  assert.equal(reviewed.status(), 200);
  const bytes = await reviewed.body();
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  await page.getByTitle('PDF được chọn để đưa đi ký', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Xác nhận chuyển sang ký', exact: true }).isEnabled(),
    false,
  );
  await page
    .getByLabel('Tôi đã xem đúng PDF trên và xác nhận tài khoản Tenant đại diện', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Xác nhận chuyển sang ký', exact: true }).click();
  await page
    .getByText('HỢP ĐỒNG DEMO · SIMULATED SIGNING · Không có giá trị pháp lý.', { exact: true })
    .waitFor();
  const contract = await tenant.contracts.get(draft.id);
  assert.equal(contract.status, 'PendingSigning');
  assert.equal(contract.onboardingDraft, false);
  const previews = await tenant.contracts.previews(draft.id);
  assert.equal(previews.length, 1);
  const canonical = await tenant.contracts.previewBytes(draft.id, previews[0].id);
  assert.equal(
    createHash('sha256').update(canonical).digest('hex'),
    createHash('sha256').update(bytes).digest('hex'),
  );
  await assert.rejects(
    otherTenant.contracts.previewBytes(draft.id, previews[0].id),
    (e) => e.status === 404,
  );
  await assert.rejects(
    staff.contracts.previewBytes(draft.id, previews[0].id),
    (e) => e.status === 403,
  );
  console.log(
    'PASS: Owner browser reviews and releases the exact private MinIO PDF; Tenant Mobile receives the same bytes; cross-Tenant and Staff downloads are denied.',
  );
  async function action(name) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await assert.rejects(
    owner.contracts.mutate(draft.id, 'activate', {}, randomUUID()),
    (e) => e.status === 409,
  );
  await action('Mô phỏng ký (Development)');
  await action('Kiểm tra kết quả ký');
  await tenant.contracts.mutate(
    draft.id,
    'signing',
    { certificateId: '00000000-0000-0000-0000-000000000000' },
    randomUUID(),
  );
  await tenant.contracts.mutate(draft.id, 'signing/sync', {}, randomUUID());
  await page.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  await page.getByRole('button', { name: 'Xác minh cọc ngân hàng', exact: true }).click();
  const deposit = page.getByRole('dialog', { name: 'Xác minh cọc ngân hàng', exact: true });
  await deposit
    .getByLabel('Mã giao dịch trên sao kê', { exact: true })
    .fill('SYNTHETIC-BROWSER-' + randomUUID());
  await deposit.getByLabel('Số tiền cọc đã nhận (VND)', { exact: true }).fill('3000000');
  await deposit
    .getByLabel('Căn cứ đối chiếu sao kê', { exact: true })
    .fill('Xác nhận sao kê tổng hợp trong kiểm thử');
  await deposit.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await deposit.waitFor({ state: 'hidden' });
  await page.getByText('Đủ điều kiện để Owner xác nhận kích hoạt.', { exact: true }).waitFor();
  await action('Kích hoạt hợp đồng');
  await page.getByText('Đã kích hoạt:', { exact: false }).waitFor();
  const active = await tenant.contracts.get(draft.id);
  assert.equal(active.status, 'Active');
  assert.equal(active.signatures.length, 2);
  assert.ok(active.signatures.every((s) => s.status === 'Simulated'));
  assert.equal((await tenant.contracts.deposits(draft.id)).length, 1);
  assert.equal((await owner.api.request('/api/v1/rooms/' + room.id)).status, 2);
  assert.ok((await tenant.contracts.documentBytes(draft.id)).length > 1000);
  console.log(
    'PASS: browser and Mobile complete explicitly simulated signatures, verified synthetic deposit and Owner activation; persisted Tenant state and Room occupancy agree. Actual MySign acceptance is BLOCKED.',
  );
  const baseline = await require('./Verify-HandoverClients.cjs')({
    actors,
    contractId: draft.id,
    room,
    today: startDate,
    page,
  });
  await require('./Verify-SharedBillingClients.cjs')({
    actors,
    contractId: draft.id,
    room,
    today,
    page,
    settings,
    baseline,
  });
  await require('./Verify-HistoricalOccupancyClients.cjs')({ owner, room, today, page, settings });
  await require('./Verify-MoveOutClients.cjs')({
    actors,
    contractId: draft.id,
    room,
    today,
    baseline,
    settings,
    page,
  });
};
