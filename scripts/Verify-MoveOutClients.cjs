// Shipped Owner Web + Mobile transports, real Compact24/MinIO. Synthetic data only.
// The bank transfer/statement is a manual-reconciliation fixture, never an actual payout.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
module.exports = async function verify({
  actors,
  contractId,
  room,
  today,
  baseline,
  settings,
  page,
}) {
  const { owner, staff, otherStaff, tenant, otherTenant, coTenant1 } = actors;
  const route = `/api/v1/contracts/${contractId}`;
  async function clickPost(button, suffix) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(suffix) && r.request().method() === 'POST'),
      button.click(),
    ]);
    assert.equal(response.status(), 200, 'Owner action failed: ' + suffix);
    return response;
  }
  const post = (actor, url, body, key = randomUUID()) =>
    actor.api.request(url, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  const invoicePage = await tenant.invoices.list(1);
  const invoice = invoicePage.items.find((i) => i.roomId === room.id);
  assert.ok(invoice);
  const issued = await tenant.invoices.get(invoice.id);
  await assert.rejects(
    otherTenant.contracts.settlementSummary(contractId),
    (e) => e.status === 404,
  );
  await assert.rejects(staff.contracts.settlementSummary(contractId), (e) => e.status === 403);
  await tenant.contracts.mutate(
    contractId,
    'termination-requests',
    { proposedDate: today, reason: 'SYNTHETIC move-out request' },
    randomUUID(),
  );
  await page.goto(settings.origin + '/contracts');
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  await page.getByRole('button', { name: 'Duyệt yêu cầu trả phòng', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Duyệt yêu cầu trả phòng', exact: true });
  await approval.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await approval.waitFor({ state: 'hidden' });
  let move = await tenant.api.request(route + '/move-out');
  assert.equal(move.status, 'Approved');
  await owner.contracts.mutate(
    contractId,
    'move-out/schedule',
    {
      scheduledAt: new Date(Date.now() + 3000).toISOString(),
      staffUserId: settings.actors.staff.id,
      expectedVersion: move.version,
    },
    randomUUID(),
  );
  const photo = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 600, 160);
      ctx.fillStyle = 'black';
      ctx.fillText('SYNTHETIC FINAL READING 120 / ROOM CONDITION - NO IDENTITY DATA', 10, 70);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  const readings = [];
  for (const meter of baseline.meters) {
    const task = await post(owner, '/api/v1/capture/meter-tasks', {
      meterId: meter.id,
      purpose: 2,
      contractId,
      readingDate: today,
    });
    await assert.rejects(
      otherStaff.api.request(`/api/v1/capture/meter-tasks/${task.id}`),
      (e) => e.status === 404,
    );
    const evidence = await staff.api.request(`/api/v1/capture/meter-tasks/${task.id}/evidence`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: photo,
    });
    const input = { confirmedValue: '120', humanConfirmed: true, evidenceId: evidence.id };
    const reading = await post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, input);
    assert.equal(
      (await post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, input)).id,
      reading.id,
    );
    readings.push(reading.id);
  }
  await assert.rejects(
    otherStaff.contracts.inspectionPreparation(contractId),
    (e) => e.status === 404,
  );
  const preparation = await staff.contracts.inspectionPreparation(contractId);
  assert.equal(preparation.baseline.version, 2);
  assert.equal(preparation.finalReadings.length, 2);
  const proof = await staff.contracts.upload(contractId, photo, 'image/png');
  move = await tenant.api.request(route + '/move-out');
  await staff.contracts.mutate(
    contractId,
    'move-out/inspection',
    {
      electricityReadingId: readings[0],
      waterReadingId: readings[1],
      notes: 'SYNTHETIC inspection, no damage or additional consumption',
      roomCondition: preparation.baseline.snapshot.roomCondition,
      keysAndAccess: 'Synthetic keys returned',
      assets: preparation.baseline.snapshot.assets.map((a) => ({
        id: a.id,
        condition: a.observedCondition,
      })),
      evidenceIds: [proof.id],
      expectedVersion: move.version,
    },
    randomUUID(),
  );
  assert.equal((await tenant.contracts.inspections(contractId))[0].ownerDecision, null);
  await page.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
  await page.getByRole('button', { name: 'Tải lại dữ liệu quyết toán', exact: true }).waitFor();
  await page
    .getByLabel('Lý do / căn cứ của Owner', { exact: true })
    .fill('Đã đối chiếu kiểm kê tổng hợp, không hư hỏng hoặc phí bổ sung');
  await page
    .getByLabel('Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu', { exact: true })
    .check();
  const depositReady = page.waitForResponse(
    async (r) =>
      r.url().endsWith(route + '/deposit-refunds') &&
      r.request().method() === 'GET' &&
      r.status() === 200 &&
      (await r.json()).blockers.length === 0,
  );
  await clickPost(
    page.getByRole('button', { name: 'Xác nhận biên bản kiểm tra', exact: true }),
    '/move-out/inspection-review',
  );
  await depositReady;
  await page
    .getByText('Chờ Owner xác nhận biên bản kiểm tra.', { exact: true })
    .first()
    .waitFor({ state: 'hidden' });
  await page
    .getByText('Chờ xác minh phí cuối kỳ / thiệt hại và chính sách tính phí.', { exact: true })
    .first()
    .waitFor({ state: 'hidden' });
  await page.getByText('Còn có thể lập yêu cầu: 3.000.000 ₫', { exact: true }).waitFor();
  const before = await tenant.contracts.settlementSummary(contractId);
  assert.equal(before.resolved, false);
  assert.equal(before.calculation.roomOutstanding, '0');
  assert.equal(before.calculation.availableSecurityDeposit, '3000000');
  assert.ok(before.unresolvedItems.includes('deposit_deduction_refund_policy_required'));
  console.log(
    'PASS: Tenant requests move-out, Owner browser approves/reviews inspection, assigned Staff confirms matching Final readings and baseline assets through Mobile transport; out-of-Location Staff/cross-Tenant access is denied and the unpaid deposit return still blocks closure.',
  );

  const sourceRoute = route + '/deposit-refunds';
  const source = await owner.api.request(sourceRoute);
  assert.deepEqual(source.blockers, []);
  assert.equal(source.sourcePaymentId, null);
  assert.equal(source.sourceDepositContractId, contractId);
  const contract = await tenant.contracts.get(contractId);
  const depositor = source.beneficiaries.find((p) => p.id === contract.representativeResidentId);
  assert.ok(depositor); // Synthetic statement explicitly identifies this depositor; never infer in the product.
  await page.getByRole('combobox', { name: 'Người nhận hoàn đã xác minh', exact: true }).click();
  await page.getByRole('option', { name: depositor.label, exact: true }).click();
  await page.getByLabel('Số tiền yêu cầu hoàn (VND)', { exact: true }).fill('3000000');
  await page
    .getByLabel('Lý do yêu cầu hoàn', { exact: true })
    .fill('Xác minh người nộp cọc theo sao kê tổng hợp, hoàn đủ không khấu trừ');
  const create = page.getByRole('button', { name: 'Lập yêu cầu hoàn tiền', exact: true });
  assert.equal(await create.isEnabled(), false);
  for (const label of [
    'Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn',
    'Tôi đã đối chiếu bằng chứng nộp cọc và xác minh người nhận là người nộp',
    'Tôi xác nhận hoàn cọc không khấu trừ, không còn phí hoặc nghĩa vụ chờ xử lý',
  ])
    await page.getByLabel(label, { exact: true }).check();
  assert.equal(
    await create.isEnabled(),
    true,
    'Fresh deposit source requires all human attestations',
  );
  const created = await clickPost(create, sourceRoute);
  assert.equal(created.status(), 200);
  const refund = await created.json();
  assert.equal(refund.status, 'REQUESTED');
  assert.equal(refund.sourcePaymentId, null);
  await page.getByText('Chờ duyệt ·', { exact: false }).waitFor();
  await page
    .getByLabel('Lý do quyết định / xác minh hoàn', { exact: true })
    .fill('Đã xác minh sao kê nộp cọc tổng hợp và nghĩa vụ, không khấu trừ');
  await page
    .getByLabel('Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định', {
      exact: true,
    })
    .check();
  const decidedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/refund-requests/${refund.id}/decision`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Duyệt yêu cầu hoàn', exact: true }).click();
  const decision = await decidedResponse;
  assert.equal(decision.status(), 200);
  const approved = await decision.json();
  assert.equal(approved.status, 'APPROVED');
  await page.getByText('Đã duyệt, chờ ghi nhận hoàn', { exact: false }).waitFor();
  const pending = await tenant.contracts.settlementSummary(contractId);
  assert.equal(pending.calculation.depositReserved, '3000000');
  assert.equal(pending.resolved, false);
  await assert.rejects(
    owner.contracts.mutate(contractId, 'move-out/complete', { actualEndDate: today }, randomUUID()),
    (e) => e.status === 409,
  );
  const evidence = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 600, 160);
      ctx.fillStyle = 'black';
      ctx.fillText('SYNTHETIC DEPOSIT RETURN 3,000,000 VND - NO REAL BANK TRANSFER', 10, 70);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  await page
    .getByLabel('Lý do quyết định / xác minh hoàn', { exact: true })
    .fill('Đã đối chiếu sao kê hoàn cọc tổng hợp, đúng người nộp');
  await page
    .getByLabel('Tham chiếu giao dịch hoàn trên sao kê', { exact: true })
    .fill('SYN-DEPOSIT-' + refund.id);
  await page.getByLabel('Thời gian hoàn thực tế (giờ Việt Nam)', { exact: true }).fill(
    new Date(Date.now() + 7 * 3600000)
      .toISOString()
      .slice(0, 23)
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '')
      .replace(/:00$/, ''),
  );
  await page
    .getByLabel('Chứng từ giao dịch hoàn', { exact: true })
    .setInputFiles({ name: 'synthetic-deposit.png', mimeType: 'image/png', buffer: evidence });
  await page
    .getByLabel(
      'Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận',
      { exact: true },
    )
    .check();
  const executedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/refund-requests/${refund.id}/execution`) &&
      r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Ghi nhận giao dịch hoàn đã thực hiện', exact: true })
    .click();
  const executed = await executedResponse;
  assert.equal(executed.status(), 200);
  assert.equal((await executed.json()).status, 'COMPLETED');
  await page.getByText('Đã ghi nhận hoàn ·', { exact: false }).waitFor();
  await assert.rejects(tenant.api.request(sourceRoute), (e) => e.status === 403);
  await assert.rejects(
    tenant.api.request(`/api/v1/refund-requests/${refund.id}/evidence`),
    (e) => e.status === 403,
  );
  await assert.rejects(coTenant1.contracts.settlementSummary(contractId), (e) => e.status === 404);
  const returned = await tenant.contracts.settlementSummary(contractId);
  assert.equal(returned.resolved, true);
  assert.equal(returned.refundAmount, '3000000');
  assert.equal(returned.approvedDeductions, '0');
  assert.equal(returned.calculation.availableSecurityDeposit, '0');
  assert.equal(returned.transferVerificationStatus, 'VerifiedManual');
  assert.equal(returned.financialReference, before.financialReference);
  assert.notEqual(returned.reference, before.reference);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải chứng từ hoàn tiền', exact: true }).click();
  const file = await download;
  const target = path.join(settings.temporary, 'deposit-return-proof.png');
  await file.saveAs(target);
  assert.deepEqual(await readFile(target), evidence);
  console.log(
    'PASS: Owner browser separately reserves/approves the security-deposit return and records synthetic manual execution with private MinIO proof; Tenant sees verified returned funds only after Completed, and approved/pending return never authorizes early closure.',
  );

  await page
    .getByLabel('Lý do / căn cứ của Owner', { exact: true })
    .fill('Đã kiểm tra đầy đủ nghĩa vụ và giao dịch hoàn cọc tổng hợp');
  await page
    .getByLabel('Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý', { exact: true })
    .check();
  const settledResponse = page.waitForResponse(
    (r) => r.url().endsWith('/move-out/settlement') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Lưu xem xét quyết toán', exact: true }).click();
  assert.equal((await settledResponse).status(), 200);
  await page.getByRole('button', { name: 'Hoàn tất trả phòng', exact: true }).click();
  const completeDialog = page.getByRole('dialog', { name: 'Hoàn tất trả phòng', exact: true });
  await completeDialog.getByLabel('Ngày kết thúc thực tế', { exact: true }).fill(today);
  const completeResponse = page.waitForResponse(
    (r) => r.url().endsWith('/move-out/complete') && r.request().method() === 'POST',
  );
  await completeDialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  assert.equal((await completeResponse).status(), 200);
  await completeDialog.waitFor({ state: 'hidden' });
  assert.equal((await tenant.contracts.get(contractId)).status, 'Terminated');
  assert.equal((await owner.api.request('/api/v1/rooms/' + room.id)).status, 0);
  assert.deepEqual(await tenant.invoices.get(invoice.id), issued);
  assert.equal((await tenant.payments.payment(invoice.id)).history.length, 2);
  const history = await tenant.contracts.moveOutHistory(contractId);
  assert.equal(history.filter((h) => h.action === 'Completed').length, 1);
  assert.equal((await owner.api.request(sourceRoute)).requests.length, 1);
  assert.equal((await owner.api.request(sourceRoute)).availableAmount, '0');
  console.log(
    'PASS: Owner browser reviews the final source snapshot and closes the Contract; the Room is released once, the shared Final invoice/allocations remain immutable, and source-specific refund/history survives reload. Charged deductions, bank-provider and native-device acceptance remain unverified.',
  );
};
