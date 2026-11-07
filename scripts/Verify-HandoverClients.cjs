/* global document */
// Continuation of the real disposable Main Draft client scenario. No synthetic readings are
// written directly to DB: evidence upload and human confirmation pass through shipped APIs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async function verify({ actors, contractId, room, today, page }) {
  const { owner, staff, tenant, otherTenant } = actors;
  const post = (actor, url, body) =>
    actor.api.request(url, { method: 'POST', body: JSON.stringify(body) });
  const photo = Buffer.from(
    await page.evaluate(() => {
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 40;
      const context = canvas.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, 100, 40);
      context.fillStyle = 'black';
      context.fillText('SYNTHETIC 100', 2, 20);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  await post(owner, '/api/v1/assets', {
    locationId: room.locationId,
    roomId: room.id,
    code: 'SYNTHETIC-HANDOVER',
    name: 'Bàn kiểm thử',
    category: 'Furniture',
    condition: 'Tốt',
  });
  const readings = [];
  const meters = [];
  for (const utilityType of [0, 1]) {
    const meter = await post(owner, '/api/v1/capture/meters', {
      roomId: room.id,
      code: 'SYNTHETIC-BASELINE-' + utilityType,
      utilityType,
      display: 0,
      decimalPlaces: 0,
      installedOn: today,
    });
    const task = await post(owner, '/api/v1/capture/meter-tasks', {
      meterId: meter.id,
      purpose: 0,
      readingDate: today,
    });
    meters.push(meter);
    const evidence = await staff.api.request(`/api/v1/capture/meter-tasks/${task.id}/evidence`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: photo,
    });
    const input = { humanConfirmed: true, confirmedValue: '100', evidenceId: evidence.id };
    await assert.rejects(
      post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
        ...input,
        humanConfirmed: false,
      }),
      (e) => e.status === 400,
    );
    const reading = await post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, input);
    const repeated = await post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, input);
    assert.equal(repeated.id, reading.id);
    readings.push(reading.id);
  }
  const evidence = await staff.contracts.uploadHandover(contractId, photo, 'image/png');
  const inventory = await staff.contracts.handoverChoices(contractId);
  const input = {
    version: 0,
    date: today,
    roomCondition: 'Phòng tổng hợp sạch, cần xác nhận',
    keysAndAccess: 'Hai chìa khóa tổng hợp',
    notes: 'Biên bản kiểm thử',
    assets: inventory.assets.map((a) => ({ id: a.id, condition: 'Tốt, đủ kiểm kê' })),
    electricityReadingId: readings[0],
    waterReadingId: readings[1],
    evidenceIds: [evidence.id],
  };
  const save = (body, key = randomUUID()) =>
    staff.contracts.mutate(contractId, 'handover', body, key);
  const decide = (actor, operation, version) =>
    actor.contracts.mutate(
      contractId,
      'handover/' + operation,
      { version, note: 'Đã xem xét dữ liệu tổng hợp' },
      randomUUID(),
    );
  await assert.rejects(
    save({ ...input, electricityReadingId: readings[1] }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    tenant.contracts.mutate(contractId, 'handover', input, randomUUID()),
    (e) => e.status === 403,
  );
  const key = randomUUID();
  await save(input, key);
  await save(input, key);
  await assert.rejects(decide(staff, 'staff-confirmation', 1), (e) => e.status === 409);
  await assert.rejects(decide(otherTenant, 'tenant-confirmation', 1), (e) => e.status === 404);
  await decide(tenant, 'disputes', 1);
  await assert.rejects(decide(tenant, 'tenant-confirmation', 1), (e) => e.status === 409);
  await save({ ...input, version: 1, roomCondition: 'Phòng tổng hợp đã đối chiếu lại' });
  await assert.rejects(decide(tenant, 'tenant-confirmation', 1), (e) => e.status === 409);
  await decide(tenant, 'tenant-confirmation', 2);
  await decide(staff, 'staff-confirmation', 2);
  const handover = await tenant.contracts.handover(contractId);
  assert.equal(handover.version, 2);
  assert.equal(handover.status, 'Confirmed');
  assert.equal(handover.tenantConfirmedVersion, 2);
  assert.ok(handover.staffConfirmedAt && handover.tenantConfirmedAt);
  assert.equal(handover.snapshot.assets[0].observedCondition, 'Tốt, đủ kiểm kê');
  assert.deepEqual(
    Buffer.from(await tenant.contracts.handoverEvidenceBytes(contractId, evidence.id)),
    photo,
  );
  assert.deepEqual(
    Buffer.from(await tenant.contracts.handoverMeterEvidenceBytes(contractId, readings[0])),
    photo,
  );
  await assert.rejects(
    otherTenant.contracts.handoverEvidenceBytes(contractId, evidence.id),
    (e) => e.status === 404,
  );
  await assert.rejects(save({ ...input, version: 2 }), (e) => e.status === 409);
  assert.equal((await tenant.contracts.handoverHistory(contractId)).length, 5);
  await page.getByRole('button', { name: 'Tải lại bàn giao', exact: true }).click();
  await page.getByText(/Phiên bản 2 · Đã xác nhận bàn giao/).waitFor();
  await page.getByText('Bàn kiểm thử: Tốt, đủ kiểm kê (kiểm kê: Tốt)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tải ảnh chỉ số điện', exact: true }).waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải ảnh bàn giao 1', exact: true }).click();
  await download;
  console.log(
    'PASS: Staff/Tenant Mobile transports record evidence, meter baselines and same-version handover confirmations; disputes/stale/cross-Tenant cases are rejected; Owner browser sees the confirmed inventory and private evidence.',
  );
  return { meters, photo };
};
