// Actual Owner Web + Mobile transport/shared clients against disposable Compact24/MinIO.
// All identity, bank account and bank statements are synthetic and explicitly labeled.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
// Accept PostgreSQL decimal scale only when all fractional digits are zero.
// Preserve exact integer digits and reject fractions without rounding through Number.
const integer = (value) => {
  assert.match(String(value), /^-?\d+(?:\.0+)?$/);
  return String(value).replace(/\.0+$/, '');
};
module.exports = async function verify({
  actors,
  contractId,
  room,
  today,
  page,
  settings,
  baseline,
}) {
  const { owner, staff, tenant, coTenant1, coTenant2, otherTenant } = actors;
  const tenants = [tenant, coTenant1, coTenant2];
  const post = (actor, route, body) =>
    actor.api.request(route, { method: 'POST', body: JSON.stringify(body) });
  const period = today.slice(0, 7) + '-01';
  // Explicit test calendar and bank account; these are not project-wide default policies.
  await owner.invoices.saveSchedule({
    locationId: room.locationId,
    rateDate: 1,
    rentSource: 1,
    partialMonth: 0,
    rounding: 0,
    draftDay: 1,
    draftMonthOffset: 0,
    finalDay: 1,
    finalMonthOffset: 0,
    dueDay: 28,
    dueMonthOffset: 0,
    version: 0,
  });
  await owner.payments.saveAccount({
    locationId: room.locationId,
    bankIdentifier: '970436',
    accountNumber: '0000000000',
    accountHolder: 'SYNTHETIC TEST ACCOUNT',
    enabled: true,
    isDevelopmentDemo: true,
    version: 0,
  });
  await page.goto(settings.origin + '/invoices');
  await page.getByRole('combobox', { name: 'Cơ sở', exact: true }).click();
  await page.getByRole('option', { name: 'Cơ sở kiểm thử tài chính', exact: true }).click();
  await page.getByRole('combobox', { name: 'Phòng', exact: true }).click();
  await page.getByRole('option', { name: 'FIN-01', exact: true }).click();
  await page.getByLabel('Kỳ hóa đơn', { exact: true }).fill(today.slice(0, 7));
  await page.getByLabel('Hoặc nhập mã hợp đồng đại diện', { exact: true }).fill(contractId);
  const generated = page.waitForResponse(
    (r) => r.url().endsWith('/invoices/drafts') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Tạo / mở bản nháp', exact: true }).click();
  const draftResponse = await generated;
  assert.equal(draftResponse.status(), 200);
  const draft = await draftResponse.json();
  assert.equal(draft.status, 'Draft');
  assert.ok(draft.missingInputs.includes('confirmed_reading_Electricity'));
  assert.ok(draft.missingInputs.includes('confirmed_reading_Water'));
  const issue = page.getByRole('button', { name: 'Phát hành hóa đơn', exact: true });
  await issue.waitFor();
  assert.equal(await issue.isEnabled(), false);
  for (const actor of tenants) {
    assert.equal((await actor.invoices.get(draft.id)).status, 'Draft');
    assert.equal((await actor.payments.instructions(draft.id)).availability, 'NotIssued');
  }
  await assert.rejects(otherTenant.invoices.get(draft.id), (e) => e.status === 404);
  await assert.rejects(staff.invoices.get(draft.id), (e) => e.status === 403);
  await assert.rejects(tenant.invoices.finalize(draft.id, draft.version), (e) => e.status === 403);
  const photo = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 150;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 150, 50);
      ctx.fillStyle = 'black';
      ctx.fillText('SYNTHETIC 120', 5, 25);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  for (const meter of baseline.meters) {
    const task = await post(owner, '/api/v1/capture/meter-tasks', {
      meterId: meter.id,
      purpose: 1,
      readingDate: today,
      billingPeriod: period,
    });
    const file = await staff.api.request(`/api/v1/capture/meter-tasks/${task.id}/evidence`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: photo,
    });
    const input = { humanConfirmed: true, confirmedValue: '120', evidenceId: file.id };
    await assert.rejects(
      post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
        ...input,
        humanConfirmed: false,
      }),
      (e) => e.status === 400,
    );
    const reading = await post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, input);
    assert.equal(integer(reading.previousValue), '100');
    assert.equal(integer(reading.consumption), '20');
    assert.equal(
      (await post(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, input)).id,
      reading.id,
    );
  }
  await page.getByRole('button', { name: 'Cập nhật đầu vào bản nháp', exact: true }).click();
  await page.getByText('Tổng: 3.430.000 ₫', { exact: true }).waitFor();
  const refreshed = await tenant.invoices.get(draft.id);
  assert.deepEqual(refreshed.missingInputs, []);
  assert.equal(integer(refreshed.lines.find((l) => l.chargeCode === 'RENT').amount), '3000000');
  for (const actor of tenants) {
    const shown = await actor.invoices.get(draft.id);
    assert.equal(integer(shown.total), '3430000');
    assert.ok(
      shown.lines
        .filter((l) => ['ELECTRICITY', 'WATER'].includes(l.chargeCode))
        .every(
          (l) =>
            integer(l.previousReading) === '100' &&
            integer(l.confirmedReading) === '120' &&
            integer(l.quantity) === '20',
        ),
    );
  }
  await issue.click();
  const finalize = page.getByRole('dialog', { name: 'Phát hành hóa đơn?', exact: true });
  await finalize.getByRole('button', { name: 'Xác nhận phát hành', exact: true }).click();
  await finalize.waitFor({ state: 'hidden' });
  await page.getByText('Đã phát hành — chi phí được giữ nguyên', { exact: true }).waitFor();
  const originalInvoice = await tenant.invoices.get(draft.id);
  assert.equal(originalInvoice.status, 'Final');
  const payerIds = (await owner.payments.payers(draft.id)).map((p) => p.userId).sort();
  assert.deepEqual(
    payerIds,
    ['tenant', 'coTenant1', 'coTenant2'].map((n) => settings.actors[n].id).sort(),
  );
  for (const actor of tenants) {
    const instructions = await actor.payments.instructions(draft.id);
    assert.equal(instructions.isDevelopmentDemo, true);
    assert.ok(instructions.qrPayload);
    assert.equal(integer(instructions.outstandingAmount), '3430000');
  }
  assert.equal((await owner.invoices.draft(room.id, period, contractId)).id, draft.id);
  assert.equal(
    (await owner.invoices.list()).items.filter(
      (i) => i.roomId === room.id && i.billingPeriod === period,
    ).length,
    1,
  );
  await assert.rejects(otherTenant.payments.payment(draft.id), (e) => e.status === 404);
  console.log(
    'PASS: three individually linked Tenants share one actual Draft/Final invoice from human-confirmed readings; Owner browser cannot finalize missing data; rent is charged once and demo QR comes from the backend.',
  );

  async function recordAndAllocate(amount, payerLabel, expectedReason) {
    await page.goto(settings.origin + '/invoices?invoiceId=' + draft.id);
    await page.getByRole('button', { name: 'Ghi nhận giao dịch từ sao kê', exact: true }).click();
    const reference = 'SYNTHETIC-BILLING-' + randomUUID();
    // Required MUI labels include an accessible asterisk; preserve that validation marker.
    await page.getByLabel(/^Ngân hàng \/ nguồn sao kê/).fill('SYNTHETIC-TEST');
    await page.getByLabel(/^Mã giao dịch ngân hàng/).fill(reference);
    await page.getByLabel(/^Số tiền thực nhận VND/).fill(amount);
    const localTime = new Date(Date.now() - 120000 + 7 * 3600000).toISOString().slice(0, 16);
    await page.getByLabel(/^Thời gian giao dịch \(giờ Việt Nam\)/).fill(localTime);
    await page.getByLabel(/^Tham chiếu bằng chứng sao kê/).fill('SYNTHETIC STATEMENT ONLY');
    await page.getByLabel(/^Căn cứ xác minh/).fill('Đối chiếu dữ liệu kiểm thử tổng hợp');
    await page.getByLabel('Dữ liệu tổng hợp Development/Testing', { exact: true }).check();
    await page
      .getByLabel('Tôi đã đối chiếu sao kê và xác minh tiền thực nhận', { exact: true })
      .check();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/payment-transactions') && r.request().method() === 'POST',
    );
    const before = await tenant.payments.payment(draft.id);
    await page.getByRole('button', { name: 'Lưu giao dịch đã đối chiếu', exact: true }).click();
    const savedResponse = await saved;
    assert.equal(savedResponse.status(), 200);
    const transfer = await savedResponse.json();
    assert.equal(transfer.isDevelopmentDemo, true);
    assert.equal((await tenant.payments.payment(draft.id)).paidAmount, before.paidAmount);
    await page.getByRole('combobox', { name: 'Người thực trả đã xác minh', exact: true }).click();
    await page.getByRole('option', { name: payerLabel, exact: true }).click();
    await page
      .getByLabel('Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Xác nhận phân bổ tiền', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Xác nhận đối soát giao dịch?', exact: true });
    const allocated = page.waitForResponse((r) =>
      r.url().endsWith(`/payment-transactions/${transfer.id}/allocate`),
    );
    await dialog.getByRole('button', { name: 'Xác nhận đối soát', exact: true }).click();
    const allocatedResponse = await allocated;
    assert.equal(allocatedResponse.status(), 200);
    assert.equal((await allocatedResponse.json()).reason, expectedReason);
    await dialog.waitFor({ state: 'hidden' });
    return transfer;
  }
  const partial = await recordAndAllocate(
    '1000000',
    'SYNTHETIC DRAFT REPRESENTATIVE',
    'verified_partial_payment',
  );
  for (const actor of tenants) {
    const state = await actor.payments.payment(draft.id);
    assert.equal(state.paymentStatus, 'Unpaid');
    assert.equal(integer(state.outstandingAmount), '2430000');
    assert.equal(integer(state.paidAmount), '1000000');
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0].paidByUserId, null);
    assert.equal(
      state.history[0].paidBy,
      actor === tenant ? 'Bạn' : 'Khách thuê khác trong hóa đơn',
    );
  }
  const electric = originalInvoice.lines.find((l) => l.chargeCode === 'ELECTRICITY');
  const evidence = await coTenant2.adjustments.upload(draft.id, photo, 'image/png');
  const request = {
    invoiceLineId: electric.id,
    proposedAmount: '50000',
    reason: 'Đối chiếu khoản điện tổng hợp',
    evidenceIds: [evidence.id],
    expectedInvoiceVersion: originalInvoice.version,
  };
  const requestKey = randomUUID();
  const adjustment = await coTenant2.adjustments.submit(draft.id, request, requestKey);
  assert.equal(
    (await coTenant2.adjustments.submit(draft.id, request, requestKey)).id,
    adjustment.id,
  );
  await assert.rejects(
    otherTenant.adjustments.submit(draft.id, request, randomUUID()),
    (e) => e.status === 404,
  );
  await assert.rejects(coTenant1.adjustments.get(adjustment.id), (e) => e.status === 404);
  await assert.rejects(staff.adjustments.get(adjustment.id), (e) => e.status === 403);
  assert.deepEqual(
    Buffer.from(await coTenant2.adjustments.evidenceBytes(adjustment.id, evidence.id)),
    photo,
  );
  await page.goto(
    settings.origin + `/invoice-adjustments?invoiceId=${draft.id}&requestId=${adjustment.id}`,
  );
  await page.getByLabel('Giá trị sau điều chỉnh (VND)', { exact: true }).fill('50000');
  await page
    .getByLabel('Lý do quyết định', { exact: true })
    .fill('Đối chiếu khoản điện trên chứng từ tổng hợp');
  const approve = page.getByRole('button', { name: 'Phê duyệt điều chỉnh', exact: true });
  assert.equal(await approve.isEnabled(), false);
  await page.getByLabel('Tôi đã kiểm tra hóa đơn, số dư và bằng chứng', { exact: true }).check();
  await approve.click();
  const decision = page.getByRole('dialog', {
    name: 'Xác nhận phê duyệt điều chỉnh?',
    exact: true,
  });
  await decision.getByRole('button', { name: 'Xác nhận quyết định', exact: true }).click();
  await decision.waitFor({ state: 'hidden' });
  await page.getByText(/Đã phê duyệt · Đối chiếu khoản điện trên chứng từ tổng hợp/).waitFor();
  const approved = await coTenant2.adjustments.get(adjustment.id);
  assert.equal(approved.status, 'Approved');
  assert.equal(integer(approved.decision.delta), '-20000');
  assert.deepEqual(await tenant.invoices.get(draft.id), originalInvoice);
  for (const actor of tenants) {
    assert.equal(integer((await actor.adjustments.effects(draft.id)).items[0].delta), '-20000');
    const state = await actor.payments.payment(draft.id);
    assert.equal(integer(state.payableAmount), '3410000');
    assert.equal(integer(state.outstandingAmount), '2410000');
  }
  console.log(
    'PASS: partial payment preserves shared debt and payer privacy; a co-occupant submits private evidence, Owner browser approves a separate adjustment, all three balances update and the complete Final Invoice DTO stays unchanged.',
  );
  const excess = await recordAndAllocate(
    '2420000',
    'SYNTHETIC CO-OCCUPANT 1',
    'verified_excess_payment_pending_review',
  );
  const retries = await Promise.all(
    Array.from({ length: 3 }, () =>
      owner.payments.allocate(excess.id, draft.id, settings.actors.coTenant1.id, randomUUID()),
    ),
  );
  assert.ok(retries.every((r) => r.status === 'Allocated'));
  const receipt = await owner.payments.transfer(excess.id);
  assert.equal(integer(receipt.allocatedAmount), '2410000');
  assert.equal(integer(receipt.unallocatedAmount), '10000');
  for (const actor of tenants) {
    const state = await actor.payments.payment(draft.id);
    assert.equal(state.paymentStatus, 'Paid');
    assert.equal(integer(state.paidAmount), '3410000');
    assert.equal(integer(state.outstandingAmount), '0');
    assert.equal(state.history.length, 2);
    assert.equal(state.pendingReview, true);
    assert.ok(state.history.every((h) => h.paidByUserId === null));
    assert.equal((await actor.payments.instructions(draft.id)).availability, 'Settled');
  }
  assert.equal((await owner.payments.reviews(excess.id)).items.length, 2);
  assert.deepEqual(await tenant.invoices.get(draft.id), originalInvoice);
  const originals = await owner.payments.transfer(partial.id);
  assert.equal(integer(originals.allocatedAmount), '1000000');
  console.log(
    'PASS: Owner browser allocates only the remaining balance, retains 10,000 VND unallocated excess for review, records the co-occupant payer, suppresses paid-invoice QR and parallel retries do not double-credit any of the three Tenants. No real bank transfer or automatic refund is claimed.',
  );
};
