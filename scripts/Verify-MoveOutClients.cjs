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
  const charged = settings.damageSettlement === true;
  const deductionAmount = charged ? '100000' : '0';
  const returnAmount = charged ? '2900000' : '3000000';
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
  const reportRoute = `/api/v1/financial-reports?from=${today}&to=${today}&locationId=${room.locationId}`;
  const reportBefore = await owner.api.request(reportRoute);
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
      notes: charged
        ? 'SYNTHETIC room damage, no additional consumption; compare image and baseline'
        : 'SYNTHETIC inspection, no damage or additional consumption',
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
    .fill(
      charged
        ? 'Đã đối chiếu thiệt hại tổng hợp với ảnh, chưa tính trên hóa đơn'
        : 'Đã đối chiếu kiểm kê tổng hợp, không hư hỏng hoặc phí bổ sung',
    );
  if (!charged)
    await page
      .getByLabel('Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu', {
        exact: true,
      })
      .check();
  const waitForReadyDeposit = () =>
    page.waitForResponse(
      async (r) =>
        r.url().endsWith(route + '/deposit-refunds') &&
        r.request().method() === 'GET' &&
        r.status() === 200 &&
        (await r.json()).blockers.length === 0,
    );
  const noChargeReady = charged ? null : waitForReadyDeposit();
  await clickPost(
    page.getByRole('button', { name: 'Xác nhận biên bản kiểm tra', exact: true }),
    '/move-out/inspection-review',
  );
  if (noChargeReady) await noChargeReady;
  await page
    .getByText('Chờ Owner xác nhận biên bản kiểm tra.', { exact: true })
    .first()
    .waitFor({ state: 'hidden' });
  if (charged) {
    await page.getByRole('button', { name: 'Thêm khoản thiệt hại', exact: true }).click();
    await page.getByLabel('Số tiền khấu trừ 1 (VND)', { exact: true }).fill(deductionAmount);
    await page
      .getByLabel('Mô tả thiệt hại 1', { exact: true })
      .fill('Thiệt hại phòng tổng hợp theo ảnh inspection; chưa tính invoice');
    await page.getByLabel('Khoản 1: dùng ảnh biên bản 1', { exact: true }).check();
    await page
      .getByLabel('Căn cứ quyết định khấu trừ', { exact: true })
      .fill('Owner đối chiếu baseline, biên bản, ảnh và hóa đơn tổng hợp');
    const approveDamage = page.getByRole('button', {
      name: 'Duyệt quyết định khấu trừ',
      exact: true,
    });
    assert.equal(await approveDamage.isEnabled(), false);
    await page
      .getByLabel(
        'Tôi đã đối chiếu thiệt hại, chứng từ và xác nhận khoản này chưa tính trên hóa đơn trước khi duyệt khấu trừ',
        { exact: true },
      )
      .check();
    const depositReady = waitForReadyDeposit();
    const decision = await (await clickPost(approveDamage, '/deposit-deductions')).json();
    assert.equal(decision.total, deductionAmount);
    assert.deepEqual(decision.items[0].evidenceIds, [proof.id]);
    assert.equal(decision.inspectionVersion, 1);
    assert.equal(decision.evidence[0].sha256.length, 64);
    await depositReady;
    console.log(
      'PASS: Owner browser records an evidenced, explicitly reviewed TenantDamage plan; server binds its inspection version and private proof hash, and subtracts it exactly once without editing the Final invoice.',
    );
  }
  await page
    .getByText('Chờ xác minh phí cuối kỳ / thiệt hại và chính sách tính phí.', { exact: true })
    .first()
    .waitFor({ state: 'hidden' });
  await page
    .getByText(`Còn có thể lập yêu cầu: ${charged ? '2.900.000' : '3.000.000'} ₫`, { exact: true })
    .waitFor();
  const before = await tenant.contracts.settlementSummary(contractId);
  assert.equal(before.resolved, false);
  assert.equal(before.calculation.roomOutstanding, '0');
  assert.equal(before.calculation.availableSecurityDeposit, returnAmount);
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
  await page.getByLabel('Số tiền yêu cầu hoàn (VND)', { exact: true }).fill(returnAmount);
  await page
    .getByLabel('Lý do yêu cầu hoàn', { exact: true })
    .fill(
      charged
        ? 'Đối chiếu người nộp theo sao kê tổng hợp, hoàn phần còn lại sau quyết định thiệt hại'
        : 'Xác minh người nộp cọc theo sao kê tổng hợp, hoàn đủ không khấu trừ',
    );
  const create = page.getByRole('button', { name: 'Lập yêu cầu hoàn tiền', exact: true });
  assert.equal(await create.isEnabled(), false);
  for (const label of [
    'Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn',
    'Tôi đã đối chiếu bằng chứng nộp cọc và xác minh người nhận là người nộp',
    charged
      ? 'Tôi đã đọc quyết định khấu trừ đã duyệt và xác nhận chỉ hoàn phần còn lại'
      : 'Tôi xác nhận hoàn cọc không khấu trừ, không còn phí hoặc nghĩa vụ chờ xử lý',
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
    .fill('Đã xác minh sao kê nộp cọc tổng hợp và quyết định nghĩa vụ hiện tại');
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
  assert.equal(pending.calculation.depositReserved, returnAmount);
  assert.equal(pending.resolved, false);
  await assert.rejects(
    owner.contracts.mutate(contractId, 'move-out/complete', { actualEndDate: today }, randomUUID()),
    (e) => e.status === 409,
  );
  const evidence = Buffer.from(
    await page.evaluate((amount) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 600, 160);
      ctx.fillStyle = 'black';
      ctx.fillText(`SYNTHETIC DEPOSIT RETURN ${amount} VND - NO REAL BANK TRANSFER`, 10, 70);
      return canvas.toDataURL('image/png').split(',')[1];
    }, returnAmount),
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
  assert.equal(returned.refundAmount, returnAmount);
  assert.equal(returned.approvedDeductions, deductionAmount);
  assert.equal(returned.calculation.availableSecurityDeposit, '0');
  assert.equal(returned.transferVerificationStatus, 'VerifiedManual');
  const reportReturned = await owner.api.request(reportRoute);
  assert.equal(reportReturned.hasUnclassifiedRefunds, false);
  assert.equal(
    reportReturned.verifiedDepositReturns,
    '0',
    'Explicitly simulated Contract returns are excluded from actual finance totals',
  );
  assert.deepEqual(reportReturned.total, reportBefore.total);
  assert.deepEqual(reportReturned.capital, reportBefore.capital);
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
    'PASS: Owner browser reviews the final source snapshot and closes the Contract; the Room is released once, the shared Final invoice/allocations remain immutable, and source-specific refund/history survives reload. Bank-provider and native-device acceptance remain unverified.',
  );

  // Worker remains disabled: explicitly run the existing Testing-only publisher endpoint.
  for (let i = 0; i < 5; i++) await post(owner, '/api/v1/notifications/process-events', {});
  const inboxRoute = '/api/v1/notifications?category=Contract&pageSize=100';
  const tenantNotices = (await tenant.api.request(inboxRoute)).items;
  const completedNotice = tenantNotices.filter(
    (n) => n.relatedObjectId === contractId && n.title === 'Hợp đồng đã hoàn tất trả phòng',
  );
  assert.equal(completedNotice.length, 1);
  assert.equal(completedNotice[0].deliveryState, 'Unconfigured');
  assert.equal(
    tenantNotices.filter(
      (n) =>
        n.relatedObjectId === contractId &&
        n.title === 'Giao dịch hoàn cọc đã được xác minh thủ công',
    ).length,
    1,
  );
  assert.equal(
    tenantNotices.filter(
      (n) =>
        n.relatedObjectId === contractId && n.title === 'Owner đã ghi nhận quyết định khấu trừ cọc',
    ).length,
    charged ? 1 : 0,
  );
  const noticeTarget = await tenant.api.request(
    `/api/v1/notifications/${completedNotice[0].id}/target`,
  );
  assert.equal(noticeTarget.objectId, contractId);
  await assert.rejects(
    otherTenant.api.request(`/api/v1/notifications/${completedNotice[0].id}/target`),
    (e) => e.status === 404,
  );
  for (const actor of [staff, otherStaff, coTenant1, otherTenant])
    assert.equal(
      (await actor.api.request(inboxRoute)).items.filter((n) => n.relatedObjectId === contractId)
        .length,
      0,
    );
  const count = tenantNotices.length;
  await post(owner, '/api/v1/notifications/process-events', {});
  assert.equal((await tenant.api.request(inboxRoute)).items.length, count);
  await page.goto(settings.origin + '/notifications');
  await page.getByRole('combobox', { name: 'Nhóm thông báo', exact: true }).click();
  await page.getByRole('option', { name: 'Hợp đồng', exact: true }).click();
  const closedTitle = page.getByRole('heading', {
    name: 'Hợp đồng đã hoàn tất trả phòng',
    exact: true,
  });
  await closedTitle.waitFor();
  const card = closedTitle.locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');
  await card.getByRole('button', { name: 'Mở hồ sơ liên quan', exact: true }).click();
  await page.waitForURL(`**/contracts?contractId=${contractId}`);
  console.log(
    'PASS: explicitly pumped committed move-out/deposit events reach the real Owner inbox and entitled Tenant transport once; browser deep-link reauthorizes the Contract, other Tenants/Staff receive no finance notice, and external delivery remains Unconfigured.',
  );

  await page.goto(settings.origin + '/reports');
  await page.getByLabel('Từ ngày').fill(today);
  await page.getByLabel('Đến ngày').fill(today);
  await page.getByRole('button', { name: 'Xem báo cáo', exact: true }).click();
  await page.getByText('Hoàn gốc cọc đã xác minh trong kỳ: 0 ₫', { exact: true }).waitFor();
  await page.getByText(/khoản giữ cọc bồi thường thiệt hại chưa được cộng/).waitFor();
  console.log(
    'PASS: real Finance API and Owner report classify the completed deposit principal separately, exclude explicit demo returns, keep invoice/OPEX/capital totals unchanged and explain excluded retained damage.',
  );
};
