// Isolated synthetic data only. Uses real signing/capture/billing/manual-payment APIs; no bank callback mock.
const fs = require('node:fs'),
  path = require('node:path'),
  nodeCrypto = require('node:crypto'),
  assert = require('node:assert/strict');
const output = path.join(__dirname, '../.tools/contract-demo');
const settings = JSON.parse(
  fs.readFileSync(path.join(output, 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const base = process.env.BHOME_PAYMENT_DEMO_API || 'http://localhost:5540';
const id = (n) => `fa250000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function key(text) {
  const h = nodeCrypto
    .createHash('sha256')
    .update('bhome-payment-demo/' + text)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function call(token, route, body, method, operation) {
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
    const problem = await r.json().catch(() => ({}));
    throw new Error(`Payment demo ${r.status} ${route} ${problem.code ?? ''}`);
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
  assert.equal((await call(owner, '/api/v1/contracts/configuration')).signingMode, 'Simulated');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const first = new Date(today.slice(0, 7) + '-01T12:00:00Z');
  const date = (month, day = 1) =>
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + month, day, 12))
      .toISOString()
      .slice(0, 10);
  const schedule = await call(owner, '/api/v1/billing-schedules/' + id(10));
  if (!schedule)
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
        finalMonthOffset: 1,
        dueDay: 31,
        dueMonthOffset: 1,
        expectedVersion: 0,
      },
      'PUT',
    );
  const account = await call(owner, '/api/v1/receiving-bank-accounts/' + id(10));
  if (!account)
    await call(
      owner,
      '/api/v1/receiving-bank-accounts',
      {
        locationId: id(10),
        bankIdentifier: '970415',
        accountNumber: '000000000000',
        accountHolder: 'BHOME SYNTHETIC DEMO',
        enabled: true,
        isDevelopmentDemo: true,
        humanVerified: true,
        expectedVersion: 0,
      },
      'PUT',
    );
  const image = fs.readFileSync(path.join(output, 'synthetic-evidence.png'));
  const invoices = [];
  for (let room = 0; room < 4; room++) {
    const roomId = id(20 + room),
      contracts = [];
    const listing = await call(owner, '/api/v1/contracts?locationId=' + id(10) + '&pageSize=100');
    for (let person = 0; person < 3; person++) {
      let contract;
      for (const item of listing.items.filter((c) => c.roomId === roomId && c.kind === 'Main')) {
        const c = await call(owner, '/api/v1/contracts/' + item.id);
        if (c.tenantUserId === user(3 + person)) contract = c;
      }
      if (!contract)
        contract = await call(
          owner,
          '/api/v1/contracts',
          {
            roomId,
            ownerSignerId: user(1),
            tenantUserId: user(3 + person),
            representativeResidentId: id(40 + room * 3 + person),
            residentIds: [id(40 + room * 3 + person)],
            startDate: date(-3),
            endDate: date(12),
            monthlyRent: '3000000',
            requiredDeposit: '0',
            terms: 'SYNTHETIC PAYMENT DEMO. SIMULATED SIGNING ONLY.',
          },
          undefined,
          `draft-${room}-${person}`,
        );
      const route = '/api/v1/contracts/' + contract.id;
      contract = await call(owner, route);
      if (contract.status !== 'Active') {
        assert.ok(
          ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status),
          'fixture tenancy changed; not resetting',
        );
        await call(owner, route + '/previews', {}, undefined, 'preview-' + contract.id);
        for (const [token, actor] of [
          [owner, user(1)],
          [tenants[person], user(3 + person)],
        ]) {
          contract = await call(owner, route);
          if (!contract.signatures.some((s) => s.signerUserId === actor && s.status !== 'Failed'))
            await call(
              token,
              route + '/signing',
              { certificateId: '00000000-0000-0000-0000-000000000000' },
              undefined,
              `sign-${contract.id}-${actor}`,
            );
          await call(token, route + '/signing/sync', {}, undefined, `sync-${contract.id}-${actor}`);
        }
        assert.equal((await call(owner, route + '/activation-readiness')).ready, true);
        await call(owner, route + '/activate', {}, undefined, 'active-' + contract.id);
      }
      contracts.push(contract.id);
    }
    const period = room === 2 ? date(-2) : date(-1);
    const previous = room === 2 ? date(-2, 0) : date(-1, 0);
    const current = room === 2 ? date(-1, 0) : date(0, 0);
    for (let utility = 0; utility < 2; utility++)
      for (const purpose of [0, 1]) {
        const meterId = id(60 + room * 2 + utility);
        const tasks = await call(staff, '/api/v1/capture/meter-tasks');
        let task = tasks.find(
          (t) =>
            t.meterId === meterId &&
            t.purpose === purpose &&
            (purpose === 0 || t.billingPeriod === period),
        );
        if (!task) {
          const created = await call(owner, '/api/v1/capture/meter-tasks', {
            meterId,
            purpose,
            readingDate: purpose === 0 ? previous : current,
            billingPeriod: purpose === 1 ? period : null,
            contractId: null,
          });
          task = await call(staff, '/api/v1/capture/meter-tasks/' + created.id);
        }
        if (task.status === 2) continue;
        assert.ok(task.status === 0 || task.status === 1, 'fixture task changed; no reset');
        const upload = await fetch(base + `/api/v1/capture/meter-tasks/${task.id}/evidence`, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + staff, 'Content-Type': 'image/png' },
          body: image,
          signal: AbortSignal.timeout(30000),
        });
        assert.equal(upload.status, 200);
        await call(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
          humanConfirmed: true,
          confirmedValue: purpose === 0 ? '100' : utility === 0 ? '125.5' : '102',
          evidenceId: (await upload.json()).id,
        });
      }
    let invoice = await call(owner, '/api/v1/invoices/drafts', {
      roomId,
      billingPeriod: period,
      representativeContractId: contracts[0],
    });
    if (invoice.status === 'Draft') {
      invoice = await call(owner, `/api/v1/invoices/${invoice.id}/refresh`, {
        expectedVersion: invoice.version,
      });
      assert.equal(invoice.missingInputs.length, 0);
      invoice = await call(owner, `/api/v1/invoices/${invoice.id}/finalize`, {
        expectedVersion: invoice.version,
      });
    }
    assert.equal(invoice.total, '3119250');
    invoices.push({ roomId, invoiceId: invoice.id, period, contracts });
  }
  const paid = invoices[0],
    unpaid = invoices[1];
  async function register(invoice, reference, amount, description) {
    return call(
      owner,
      '/api/v1/payment-transactions',
      {
        providerIdentity: 'SYNTHETIC-BANK',
        bankReference: reference,
        amount,
        currency: 'VND',
        occurredAt: date(0, 0) + 'T10:00:00Z',
        transferDescription: description,
        statementReference: 'SYNTHETIC-STATEMENT-' + invoice.invoiceId,
        verificationReason: 'SYNTHETIC DEVELOPMENT BANK STATEMENT; no real bank settlement',
        proposedInvoiceId: invoice.invoiceId,
        humanVerified: true,
        isDevelopmentDemo: true,
      },
      undefined,
      'register-' + reference,
    );
  }
  const paidState = await call(owner, `/api/v1/invoices/${paid.invoiceId}/payment`);
  const transfer = await register(
    paid,
    'SYN-PAID-' + paid.invoiceId,
    '3119250',
    paidState.transferReference,
  );
  await call(
    owner,
    `/api/v1/payment-transactions/${transfer.id}/allocate`,
    { invoiceId: paid.invoiceId, paidByUserId: user(3), humanVerified: true },
    undefined,
    'allocate-' + transfer.id,
  );
  const unpaidState = await call(owner, `/api/v1/invoices/${unpaid.invoiceId}/payment`);
  const review = await register(
    unpaid,
    'SYN-REVIEW-' + unpaid.invoiceId,
    '100',
    unpaidState.transferReference,
  );
  const reviewed = await call(
    owner,
    `/api/v1/payment-transactions/${review.id}/allocate`,
    { invoiceId: unpaid.invoiceId, paidByUserId: user(4), humanVerified: true },
    undefined,
    'review-' + review.id,
  );
  assert.ok(['PendingReview', 'Allocated', 'Rejected'].includes(reviewed.status));
  const duplicate = await register(
    paid,
    'SYN-PAID-' + paid.invoiceId,
    '3119250',
    paidState.transferReference,
  );
  assert.equal(duplicate.id, transfer.id);
  for (const token of tenants)
    assert.equal(
      (await call(token, `/api/v1/invoices/${paid.invoiceId}/payment`)).paymentStatus,
      'Paid',
    );
  const overdue = await call(owner, '/api/v1/debts?locationId=' + id(10) + '&overdueOnly=true');
  assert.ok(overdue.items.some((i) => i.invoiceId === invoices[2].invoiceId));
  fs.writeFileSync(
    path.join(output, 'payment-fixture.json'),
    JSON.stringify(
      { locationId: id(10), invoices, paidTransferId: transfer.id, reviewTransferId: review.id },
      null,
      2,
    ),
  );
  console.log(
    'Payment demo: three individual tenancies per room; shared Paid/Unpaid/Overdue invoices; synthetic receiving account/QR; verified sample allocation, pending review and duplicate replay persisted. No real money or bank callback.',
  );
}
main().catch((error) => {
  console.error(String(error.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
