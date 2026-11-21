// Real isolated API workflow; synthetic bank verification and SIMULATED signing only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  nodeCrypto = require('node:crypto');
const output = path.join(__dirname, '../.tools/contract-demo');
const settings = JSON.parse(
  fs.readFileSync(path.join(output, 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const base = process.env.BHOME_AUTOMATION_DEMO_API || 'http://localhost:5540';
const id = (n) => `fa090000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (name) => {
  const h = nodeCrypto
    .createHash('sha256')
    .update('bhome-automation/' + name)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
async function call(token, route, body, operation, method) {
  const response = await fetch(base + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(operation ? { 'Idempotency-Key': key(operation) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw Error(`Automation demo ${response.status} ${route} ${problem.code ?? ''}`);
  }
  return response.status === 204 ? null : response.json();
}
async function main() {
  assert.equal(new URL(base).hostname, 'localhost');
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  const login = async (name) =>
    (
      await call(null, '/api/v1/auth/login', {
        email: name + '.contract.demo@example.invalid',
        password: settings.BHOME_DEV_TEST_PASSWORD,
      })
    ).accessToken;
  const owner = await login('owner'),
    staff = await login('staff'),
    tenants = [await login('tenant1'), await login('tenant2'), await login('tenant3')];
  assert.equal((await call(owner, '/api/v1/contracts/configuration')).signingMode, 'Simulated');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
    period = today.slice(0, 7) + '-01';
  const file = path.join(output, 'automation-fixture.json');
  const saved = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { businessDate: today, period, locationId: id(10), contracts: [] };
  assert.equal(
    saved.businessDate,
    today,
    'Fixture belongs to another business date; no automatic reset.',
  );
  const persist = () => fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  persist();
  const run = (phase) =>
    call(owner, '/api/v1/billing-automation/run-now', {
      locationId: id(10),
      billingPeriod: period,
      phase,
    });
  const inbox = async (token, category = '') =>
    (
      await call(
        token,
        '/api/v1/notifications?pageSize=100' + (category ? '&category=' + category : ''),
      )
    ).items;
  async function pump() {
    for (let n = 0; n < 8; n++) await call(owner, '/api/v1/notifications/process-events', {});
  }
  if (process.argv.includes('--verify')) {
    await Promise.all([
      run('Meter'),
      run('Meter'),
      run('Draft'),
      run('Draft'),
      run('Final'),
      run('Final'),
    ]);
    await pump();
    const invoice = await call(owner, '/api/v1/invoices/' + saved.invoiceId);
    assert.equal(invoice.status, 'Final');
    assert.equal(invoice.total, saved.originalTotal);
    for (const tenant of tenants) {
      const state = await call(tenant, `/api/v1/invoices/${saved.invoiceId}/payment`);
      assert.equal(state.outstandingAmount, '0');
      const notices = await inbox(tenant);
      assert.equal(
        notices.filter((n) => n.category === 'Invoice' && n.relatedObjectId === saved.invoiceId)
          .length,
        1,
      );
      assert.equal(
        notices.filter((n) => n.category === 'Payment' && n.relatedObjectId === saved.invoiceId)
          .length,
        1,
      );
      assert.ok(!JSON.stringify(notices).includes('PRIVATE_SYNTHETIC'));
    }
    saved.verification =
      'PASS API replay, shared entitlement, immutable Final and notification privacy';
    persist();
    console.log(saved.verification);
    return;
  }
  let calendar = await call(owner, `/api/v1/billing-schedules/${id(10)}`);
  if (!calendar)
    calendar = await call(
      owner,
      '/api/v1/billing-schedules',
      {
        locationId: id(10),
        rateDate: 0,
        rentSource: 0,
        partialMonth: 0,
        rounding: 0,
        draftDay: Number(today.slice(-2)),
        draftMonthOffset: 0,
        finalDay: Number(today.slice(-2)),
        finalMonthOffset: 0,
        dueDay: 31,
        dueMonthOffset: 0,
        expectedVersion: 0,
      },
      null,
      'PUT',
    );
  let plan = await call(owner, `/api/v1/billing-automation/${id(10)}?period=${period}`);
  if (!plan)
    plan = await call(
      owner,
      '/api/v1/billing-automation',
      {
        locationId: id(10),
        effectiveFrom: period,
        enabled: true,
        authorizeAutomaticFinalization: true,
        meterDay: Number(today.slice(-2)),
        meterDueDay: 31,
        meterDueMonthOffset: 0,
        timeZone: 'Asia/Ho_Chi_Minh',
        expectedVersion: 0,
        expectedBillingScheduleVersion: calendar.version,
      },
      null,
      'PUT',
    );
  saved.planId = plan.id;
  persist();
  const end = new Date(today + 'T12:00:00Z');
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const future = end.toISOString().slice(0, 10);
  async function contract(room, person) {
    const listing = await call(owner, `/api/v1/contracts?locationId=${id(10)}&pageSize=100`);
    let c;
    for (const row of listing.items.filter((c) => c.roomId === id(20 + room))) {
      const candidate = await call(owner, '/api/v1/contracts/' + row.id);
      if (candidate.tenantUserId === user(3 + person)) c = candidate;
    }
    if (!c)
      c = await call(
        owner,
        '/api/v1/contracts',
        {
          roomId: id(20 + room),
          ownerSignerId: user(1),
          tenantUserId: user(3 + person),
          representativeResidentId: id(40 + room * 3 + person),
          residentIds: [id(40 + room * 3 + person)],
          startDate: period,
          endDate: future,
          monthlyRent: '3000000',
          requiredDeposit: '0',
          terms: 'SYNTHETIC AUTOMATION; SIMULATED SIGNING; NO LEGAL OR BANK EFFECT',
        },
        `contract/${period}/${room}/${person}`,
      );
    c = await call(owner, '/api/v1/contracts/' + c.id);
    if (c.status !== 'Active') {
      assert.ok(
        ['Draft', 'PendingSigning', 'PendingActivation'].includes(c.status),
        'No reset for changed fixture tenancy',
      );
      await call(owner, `/api/v1/contracts/${c.id}/previews`, {}, 'preview/' + c.id);
      for (const [token, actor] of [
        [owner, user(1)],
        [tenants[person], user(3 + person)],
      ]) {
        c = await call(owner, '/api/v1/contracts/' + c.id);
        if (!c.signatures.some((s) => s.signerUserId === actor && s.status !== 'Failed'))
          await call(
            token,
            `/api/v1/contracts/${c.id}/signing`,
            { certificateId: '00000000-0000-0000-0000-000000000000' },
            'sign/' + c.id + '/' + actor,
          );
        await call(
          token,
          `/api/v1/contracts/${c.id}/signing/sync`,
          {},
          'sync/' + c.id + '/' + actor,
        );
      }
      assert.equal(
        (await call(owner, `/api/v1/contracts/${c.id}/activation-readiness`)).ready,
        true,
      );
      await call(owner, `/api/v1/contracts/${c.id}/activate`, {}, 'activate/' + c.id);
    }
    return c.id;
  }
  for (let room = 0; room < 2; room++) {
    saved.contracts[room] ??= [];
    for (let person = 0; person < (room === 0 ? 3 : 1); person++) {
      saved.contracts[room][person] = await contract(room, person);
      persist();
    }
  }
  const selection = await call(
    owner,
    `/api/v1/billing-automation/representative?roomId=${id(20)}&period=${period}`,
  );
  if (!selection)
    await call(
      owner,
      '/api/v1/billing-automation/representative',
      {
        roomId: id(20),
        billingPeriod: period,
        contractId: saved.contracts[0][0],
        expectedVersion: 0,
      },
      null,
      'PUT',
    );
  await Promise.all([run('Meter'), run('Meter')]);
  await run('Draft');
  let invoices = (await call(owner, `/api/v1/invoices?locationId=${id(10)}&pageSize=100`)).items;
  const before = invoices.find((i) => i.roomId === id(20));
  assert.ok(before);
  if (before.status === 'Draft') {
    const detail = await call(owner, '/api/v1/invoices/' + before.id);
    assert.ok(detail.missingInputs.length > 0);
    saved.missingDraftObserved = true;
    persist();
  }
  const image = fs.readFileSync(path.join(output, 'synthetic-evidence.png'));
  async function confirm(task, value) {
    if (task.status === 2) return;
    const response = await fetch(base + `/api/v1/capture/meter-tasks/${task.id}/evidence`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + staff, 'Content-Type': 'image/png' },
      body: image,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    await call(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
      humanConfirmed: true,
      confirmedValue: value,
      evidenceId: (await response.json()).id,
    });
  }
  let tasks = await call(
    staff,
    `/api/v1/capture/meter-tasks?locationId=${id(10)}&roomId=${id(20)}`,
  );
  const previous = new Date(period + 'T12:00:00Z');
  previous.setUTCDate(previous.getUTCDate() - 1);
  const baseline = previous.toISOString().slice(0, 10);
  for (const task of tasks.filter((t) => t.purpose === 1 && t.billingPeriod === period)) {
    let initial = tasks.find((t) => t.meterId === task.meterId && t.purpose === 0);
    if (!initial) {
      const created = await call(owner, '/api/v1/capture/meter-tasks', {
        meterId: task.meterId,
        purpose: 0,
        readingDate: baseline,
        billingPeriod: null,
      });
      initial = await call(staff, '/api/v1/capture/meter-tasks/' + created.id);
    }
    await confirm(initial, '100');
    await confirm(task, task.utilityType === 0 ? '125' : '102');
  }
  await Promise.all([run('Final'), run('Final')]);
  invoices = (await call(owner, `/api/v1/invoices?locationId=${id(10)}&pageSize=100`)).items;
  const final = await call(owner, '/api/v1/invoices/' + before.id);
  assert.equal(final.status, 'Final');
  saved.invoiceId = final.id;
  saved.originalTotal = final.total;
  const missing = invoices.find((i) => i.roomId === id(21));
  assert.equal(missing.status, 'Draft');
  saved.missingInvoiceId = missing.id;
  persist();
  await pump();
  for (const tenant of tenants)
    assert.ok((await inbox(tenant, 'Invoice')).some((n) => n.relatedObjectId === final.id));
  const unmatched = await call(
    owner,
    '/api/v1/payment-transactions',
    {
      providerIdentity: 'SYNTHETIC-AUTOMATION',
      bankReference: 'SYN-AUTO-' + final.id,
      amount: final.total,
      currency: 'VND',
      occurredAt: today + 'T01:00:00Z',
      transferDescription: 'SYNTHETIC',
      statementReference: 'PRIVATE_SYNTHETIC_BANK',
      verificationReason: 'Development synthetic verification; no actual money transferred',
      proposedInvoiceId: final.id,
      humanVerified: true,
      isDevelopmentDemo: true,
    },
    'payment/' + final.id,
  );
  if (unmatched.status !== 'Allocated')
    await call(
      owner,
      '/api/v1/payment-transactions/' + unmatched.id + '/reject',
      { reason: 'Synthetic unmatched reference; preserve history without credit' },
      'reject-unmatched/' + final.id,
    );
  const payment = await call(owner, '/api/v1/invoices/' + final.id + '/payment');
  const transfer = await call(
    owner,
    '/api/v1/payment-transactions',
    {
      providerIdentity: 'SYNTHETIC-AUTOMATION',
      bankReference: 'SYN-AUTO-VERIFIED-' + final.id,
      amount: final.total,
      currency: 'VND',
      occurredAt: today + 'T01:00:00Z',
      transferDescription: payment.transferReference,
      statementReference: 'PRIVATE_SYNTHETIC_BANK_VERIFIED',
      verificationReason: 'Development synthetic verified statement; no actual money transferred',
      proposedInvoiceId: final.id,
      humanVerified: true,
      isDevelopmentDemo: true,
    },
    'payment-verified/' + final.id,
  );
  const allocation = { invoiceId: final.id, paidByUserId: user(3), humanVerified: true };
  await call(
    owner,
    `/api/v1/payment-transactions/${transfer.id}/allocate`,
    allocation,
    'allocate-verified/' + transfer.id,
  );
  await call(
    owner,
    `/api/v1/payment-transactions/${transfer.id}/allocate`,
    allocation,
    'allocate-verified/' + transfer.id,
  );
  await pump();
  for (const tenant of tenants) {
    const state = await call(tenant, `/api/v1/invoices/${final.id}/payment`);
    assert.equal(state.paymentStatus, 'Paid');
    assert.ok((await inbox(tenant, 'Payment')).some((n) => n.relatedObjectId === final.id));
  }
  for (const approve of [true, false]) {
    const request = await call(
      tenants[0],
      `/api/v1/invoices/${final.id}/adjustment-requests`,
      {
        invoiceLineId: null,
        proposedAmount: String(BigInt(final.total) - 1000n),
        reason: 'PRIVATE_SYNTHETIC_REASON',
        evidenceIds: [],
        expectedInvoiceVersion: final.version,
      },
      `adjust/${final.id}/${approve}`,
    );
    await pump();
    let detail = await call(owner, '/api/v1/invoice-adjustments/' + request.id);
    if (detail.status === 'Pending') {
      const input = {
        expectedVersion: detail.version,
        expectedInvoiceVersion: detail.currentInvoice.version,
        expectedFinancialVersion: detail.currentFinancialVersion,
        correctedAmount: approve ? String(BigInt(final.total) - 1000n) : null,
        chargeCode: null,
        reason: 'PRIVATE_SYNTHETIC_DECISION',
        humanConfirmed: true,
      };
      await call(
        owner,
        `/api/v1/invoice-adjustments/${request.id}/${approve ? 'approve' : 'reject'}`,
        input,
        'decision/' + request.id,
      );
      await call(
        owner,
        `/api/v1/invoice-adjustments/${request.id}/${approve ? 'approve' : 'reject'}`,
        input,
        'decision/' + request.id,
      );
    }
    saved[approve ? 'approvedRequestId' : 'rejectedRequestId'] = request.id;
    persist();
    await pump();
  }
  const notice = (await inbox(tenants[0], 'Invoice')).find((n) => n.relatedObjectId === final.id);
  await call(tenants[0], `/api/v1/notifications/${notice.id}/read`, {});
  assert.ok((await inbox(tenants[0], 'Invoice')).find((n) => n.id === notice.id).readAt);
  // Activate retry room after the initial Draft run, leaving a genuine new business effect for CLI fault injection.
  saved.contracts[2] = [await contract(2, 0)];
  persist();
  const next = new Date(period + 'T12:00:00Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  const nextPeriod = next.toISOString().slice(0, 10);
  if (
    !(await call(owner, `/api/v1/billing-automation/${id(10)}/history`)).some(
      (p) => p.effectiveFrom === nextPeriod,
    )
  )
    await call(
      owner,
      '/api/v1/billing-automation',
      {
        locationId: id(10),
        effectiveFrom: nextPeriod,
        enabled: true,
        authorizeAutomaticFinalization: true,
        meterDay: Number(today.slice(-2)),
        meterDueDay: 31,
        meterDueMonthOffset: 0,
        timeZone: 'Asia/Ho_Chi_Minh',
        expectedVersion: plan.version,
        expectedBillingScheduleVersion: calendar.version,
      },
      null,
      'PUT',
    );
  assert.equal(
    await call(owner, '/api/v1/billing-automation/run-now', {
      locationId: id(10),
      billingPeriod: nextPeriod,
      phase: 'Meter',
    }),
    null,
  );
  saved.futurePeriod = nextPeriod;
  persist();
  console.log(
    'PASS API scenarios A-E: shared tasks, missing Draft, scheduled Final, verified payment, approved/rejected adjustments and read persistence. Run demo-billing-retry, then --verify.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
