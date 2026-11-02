// Synthetic isolated BH40 scenarios. Real local API + PostgreSQL/MinIO; simulated signing/manual funds.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const output = path.join(__dirname, '../.tools/contract-demo');
const settings = JSON.parse(
  fs.readFileSync(path.join(output, 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const base = process.env.BHOME_LIFECYCLE_DEMO_API || 'http://localhost:5540',
  root = '/api/v1/contracts';
const id = (n) => `fa400000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  user = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function key(value) {
  const h = crypto
    .createHash('sha256')
    .update('bhome-lifecycle/' + value)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function call(token, route, body, operation, method) {
  const r = await fetch(base + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(operation ? { 'Idempotency-Key': key(operation) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw Error(`BH40 ${r.status} ${route} ${p.code ?? ''}`);
  }
  return r.status === 204 ? null : r.json();
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
  assert.equal((await call(owner, root + '/configuration')).signingMode, 'Simulated');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
    period = today.slice(0, 7) + '-01';
  const manifest = path.join(output, 'lifecycle-fixture.json'),
    previous = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : null;
  if (previous)
    assert.equal(
      previous.businessDate,
      today,
      'Fixture belongs to another business date; no automatic reset.',
    );
  const end = new Date(today + 'T12:00:00Z');
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const future = end.toISOString().slice(0, 10);
  const image = fs.readFileSync(path.join(output, 'synthetic-evidence.png'));
  async function upload(route, method = 'POST') {
    const r = await fetch(base + route, {
      method,
      headers: { Authorization: 'Bearer ' + staff, 'Content-Type': 'image/png' },
      body: image,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(r.status, 200, route);
    return r.json();
  }
  async function sign(contractId, person = 0, activate = true) {
    const route = root + '/' + contractId;
    for (const [token, actor] of [
      [owner, user(1)],
      [tenants[person], user(3 + person)],
    ]) {
      const c = await call(owner, route);
      if (!c.signatures.some((s) => s.signerUserId === actor && s.status !== 'Failed'))
        await call(
          token,
          route + '/signing',
          { certificateId: '00000000-0000-0000-0000-000000000000' },
          'sign-' + contractId + '-' + actor,
        );
      if (['Draft', 'PendingSigning'].includes(c.status))
        await call(token, route + '/signing/sync', {}, 'sync-' + contractId + '-' + actor);
    }
    const c = await call(owner, route);
    if (activate && c.status !== 'Active') {
      const ready = await call(owner, route + '/activation-readiness');
      assert.equal(ready.ready, true, JSON.stringify(ready.blockers));
      await call(owner, route + '/activate', {}, 'activate-' + contractId);
    }
  }
  const listing = await call(owner, root + '?locationId=' + id(10) + '&pageSize=100'),
    scenarios = [];
  for (let room = 0; room < 6; room++) {
    const contracts = [];
    for (let person = 0; person < ([2, 3].includes(room) ? 3 : 1); person++) {
      let c;
      for (const row of listing.items.filter(
        (c) => c.roomId === id(20 + room) && c.kind === 'Main',
      )) {
        const d = await call(owner, root + '/' + row.id);
        if (d.tenantUserId === user(3 + person)) c = d;
      }
      if (!c)
        c = await call(
          owner,
          root,
          {
            roomId: id(20 + room),
            ownerSignerId: user(1),
            tenantUserId: user(3 + person),
            representativeResidentId: id(40 + room * 3 + person),
            residentIds: [id(40 + room * 3 + person)],
            startDate: period,
            endDate: room === 0 ? today : future,
            monthlyRent: '3000000',
            requiredDeposit: room === 3 && person === 0 ? '3000000' : '0',
            terms: 'SYNTHETIC BH40; SIMULATED SIGNING; NOT A LEGAL CONTRACT',
          },
          'draft-' + room + '-' + person,
        );
      c = await call(owner, root + '/' + c.id);
      if (!['Active', 'Terminated', 'Superseded'].includes(c.status)) {
        if (c.requiredDeposit !== '0')
          await call(
            owner,
            root + '/' + c.id + '/deposit-verifications',
            {
              bankTransactionReference: 'SYN-BH40-DEPOSIT-' + c.id,
              amount: '3000000',
              verificationReason: 'SYNTHETIC DEVELOPMENT ONLY; no real bank transfer',
            },
            'deposit-' + c.id,
          );
        await sign(c.id, person);
      }
      contracts.push(c.id);
    }
    scenarios.push({
      ...previous?.scenarios?.find((s) => s.roomId === id(20 + room)),
      roomId: id(20 + room),
      contracts,
    });
  }
  for (const room of [0, 1]) {
    const parent = scenarios[room].contracts[0];
    let renewal;
    for (const row of (
      await call(owner, root + '?locationId=' + id(10) + '&pageSize=100')
    ).items.filter((c) => c.roomId === id(20 + room) && c.kind === 'Renewal')) {
      const c = await call(owner, root + '/' + row.id);
      if (c.previousContractId === parent) renewal = c;
    }
    if (!renewal)
      renewal = await call(
        owner,
        root + '/' + parent + '/renewals',
        {
          endDate: future,
          monthlyRent: '3100000',
          terms: 'SYNTHETIC RENEWAL; preserved historical terms; SIMULATED SIGNING',
        },
        'renew-' + parent,
      );
    if (renewal.status !== 'Active') await sign(renewal.id, 0, room === 1);
    const ready = await call(owner, root + '/' + renewal.id + '/activation-readiness');
    if (room === 0) {
      assert.equal((await call(owner, root + '/' + renewal.id)).status, 'PendingActivation');
      assert.ok(ready.blockers.includes('contract_not_in_effective_period'));
    } else {
      assert.equal((await call(owner, root + '/' + parent)).status, 'Superseded');
      assert.equal((await call(owner, root + '/' + renewal.id)).status, 'Active');
    }
    scenarios[room].renewalId = renewal.id;
  }
  if (!(await call(owner, '/api/v1/billing-schedules/' + id(10))))
    await call(
      owner,
      '/api/v1/billing-schedules',
      {
        locationId: id(10),
        rateDate: 0,
        rentSource: 0,
        partialMonth: 0,
        rounding: 0,
        draftDay: 1,
        draftMonthOffset: 0,
        finalDay: 1,
        finalMonthOffset: 0,
        dueDay: 31,
        dueMonthOffset: 0,
        expectedVersion: 0,
      },
      undefined,
      'PUT',
    );
  for (const room of [2, 3, 4, 5]) {
    const scenario = scenarios[room],
      cid = scenario.contracts[0],
      route = root + '/' + cid;
    let state = await call(owner, route);
    if (state.status === 'Terminated') {
      scenario.completed = true;
      continue;
    }
    const readings = {};
    async function reading(utility, purpose) {
      let task = (await call(staff, '/api/v1/capture/meter-tasks')).find(
        (t) =>
          t.meterId === id(60 + room * 2 + utility) &&
          t.purpose === purpose &&
          (purpose !== 2 || t.contractId === cid),
      );
      if (!task) {
        const result = await call(owner, '/api/v1/capture/meter-tasks', {
          meterId: id(60 + room * 2 + utility),
          purpose,
          readingDate: purpose === 0 ? period : today,
          billingPeriod: purpose === 1 ? period : null,
          contractId: purpose === 2 ? cid : null,
        });
        task = await call(staff, '/api/v1/capture/meter-tasks/' + result.id);
      }
      if (task.status !== 2) {
        const evidence = await upload(
          '/api/v1/capture/meter-tasks/' + task.id + '/evidence',
          'PUT',
        );
        await call(staff, '/api/v1/capture/meter-tasks/' + task.id + '/confirm', {
          humanConfirmed: true,
          confirmedValue: purpose === 0 ? '100' : utility === 0 ? '125.5' : '102',
          evidenceId: evidence.id,
        });
      }
      task = await call(staff, '/api/v1/capture/meter-tasks/' + task.id);
      return task.confirmedReadingId;
    }
    for (const utility of [0, 1]) readings[utility] = await reading(utility, 0);
    let h;
    try {
      h = await call(owner, route + '/handover');
    } catch (e) {
      if (!e.message.startsWith('BH40 404')) throw e;
    }
    if (!h) {
      const choices = await call(staff, route + '/handover/choices'),
        evidence = await upload(route + '/handover/evidence');
      h = await call(
        staff,
        route + '/handover',
        {
          version: 0,
          date: period,
          roomCondition: 'SYNTHETIC: sạch, hoạt động tốt',
          keysAndAccess: 'SYNTHETIC: 2 chìa khóa',
          notes: 'Fixture bàn giao tổng hợp BH40',
          assets: choices.assets.map((a) => ({ id: a.id, condition: 'Tốt - tổng hợp' })),
          electricityReadingId: readings[0],
          waterReadingId: readings[1],
          evidenceIds: [evidence.id],
        },
        'handover-' + cid,
      );
    }
    if (h.status !== 'Confirmed') {
      if (!h.tenantConfirmedAt)
        await call(
          tenants[0],
          route + '/handover/tenant-confirmation',
          { version: h.version, note: 'Synthetic Tenant confirmation' },
          'handover-tenant-' + cid,
        );
      await call(
        staff,
        route + '/handover/staff-confirmation',
        { version: h.version, note: 'Synthetic Staff confirmation' },
        'handover-staff-' + cid,
      );
    }
    for (const utility of [0, 1]) await reading(utility, 1);
    let invoice = await call(owner, '/api/v1/invoices/drafts', {
      roomId: scenario.roomId,
      billingPeriod: period,
      representativeContractId: cid,
    });
    if (invoice.status === 'Draft') {
      invoice = await call(owner, '/api/v1/invoices/' + invoice.id + '/refresh', {
        expectedVersion: invoice.version,
      });
      assert.equal(invoice.missingInputs.length, 0);
      invoice = await call(owner, '/api/v1/invoices/' + invoice.id + '/finalize', {
        expectedVersion: invoice.version,
      });
    }
    scenario.invoiceId = invoice.id;
    if (room !== 3) {
      const p = await call(owner, '/api/v1/invoices/' + invoice.id + '/payment');
      if (p.outstandingAmount !== '0') {
        const transfer = await call(
          owner,
          '/api/v1/payment-transactions',
          {
            providerIdentity: 'SYNTHETIC-BANK',
            bankReference: 'SYN-BH40-' + invoice.id,
            amount: invoice.total,
            currency: 'VND',
            occurredAt: invoice.finalizedAt,
            transferDescription: p.transferReference,
            statementReference: 'BH40-SYNTHETIC-STATEMENT',
            verificationReason: 'SYNTHETIC DEVELOPMENT ONLY; no real bank settlement',
            proposedInvoiceId: invoice.id,
            humanVerified: true,
            isDevelopmentDemo: true,
          },
          'payment-' + invoice.id,
        );
        await call(
          owner,
          '/api/v1/payment-transactions/' + transfer.id + '/allocate',
          { invoiceId: invoice.id, paidByUserId: user(3), humanVerified: true },
          'allocate-' + invoice.id,
        );
      }
    }
    let m;
    try {
      m = await call(owner, route + '/move-out');
    } catch (e) {
      if (!e.message.startsWith('BH40 404')) throw e;
    }
    if (!m)
      m = await call(
        tenants[0],
        route + '/termination-requests',
        { proposedDate: today, reason: 'SYNTHETIC BH40 demo move-out' },
        'request-' + cid,
      );
    if (m.status === 'Requested')
      m = await call(owner, route + '/move-out/approve', {}, 'approve-' + cid);
    if (m.status === 'Approved' && !m.inspectionScheduledAt)
      m = await call(
        owner,
        route + '/move-out/schedule',
        {
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
          staffUserId: user(2),
          expectedVersion: m.version,
        },
        'schedule-' + cid,
      );
    if (m.status === 'Approved') {
      for (const utility of [0, 1]) readings[utility] = await reading(utility, 2);
      if (room !== 5) {
        const prep = await call(staff, route + '/move-out/inspection-preparation'),
          evidence = await upload(route + '/move-out/evidence');
        m = await call(
          staff,
          route + '/move-out/inspection',
          {
            electricityReadingId: readings[0],
            waterReadingId: readings[1],
            notes: 'SYNTHETIC final inspection; no damage charges',
            evidenceIds: [evidence.id],
            assets: prep.baseline.snapshot.assets.map((a) => ({
              id: a.id,
              condition: 'Tốt - tổng hợp',
            })),
            roomCondition: 'SYNTHETIC: sạch, hoạt động tốt',
            keysAndAccess: 'SYNTHETIC: trả 2 chìa khóa',
            expectedVersion: m.version,
          },
          'inspect-' + cid,
        );
      }
    }
    if (room === 5) {
      scenario.uiReady = true;
      continue;
    }
    const inspections = await call(owner, route + '/move-out/inspections');
    if (!inspections[0].ownerDecision)
      await call(
        owner,
        route + '/move-out/inspection-review',
        {
          version: inspections[0].version,
          confirmed: true,
          reason: 'SYNTHETIC: đã đối chiếu không phát sinh phí riêng',
          noAdditionalCharges: true,
        },
        'inspection-review-' + cid,
      );
    let summary = await call(owner, route + '/move-out/settlement-summary');
    if (room === 3) {
      assert.equal(summary.resolved, false);
      assert.ok(summary.unresolvedItems.includes('deposit_deduction_refund_policy_required'));
      assert.ok(summary.unresolvedItems.includes('shared_liability_allocation_pending'));
    } else assert.equal(summary.resolved, true, JSON.stringify(summary.unresolvedItems));
    m = await call(owner, route + '/move-out');
    if (m.status !== 'Settled' && m.status !== 'PendingSettlement')
      m = await call(
        owner,
        route + '/move-out/settlement',
        {
          decision: 'SYNTHETIC: review actual persisted obligations',
          expectedReference: summary.reference,
        },
        'settlement-' + cid,
      );
    if (room === 3) {
      assert.equal(m.status, 'PendingSettlement');
      scenario.blockers = summary.unresolvedItems;
    } else {
      await call(owner, route + '/move-out/complete', { actualEndDate: today }, 'complete-' + cid);
      scenario.completed = true;
      assert.equal((await call(owner, route)).status, 'Terminated');
      for (const other of scenario.contracts.slice(1))
        assert.equal((await call(owner, root + '/' + other)).status, 'Active');
      assert.ok(await call(tenants[0], '/api/v1/invoices/' + invoice.id + '/payment'));
    }
  }
  fs.writeFileSync(
    path.join(output, 'lifecycle-fixture.json'),
    JSON.stringify({ locationId: id(10), businessDate: today, scenarios }, null, 2),
  );
  console.log(
    'PASS BH40: pending and effective signed renewals; shared-room A closure with B/C active; unresolved shared debt/deposit; last-tenant closure; UI scenario retained. Synthetic manual funds and simulated signing only.',
  );
}
main().catch((e) => {
  console.error(String(e.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
