// Synthetic billing bootstrap through real APIs; target is the isolated contract demo only.
const fs = require('node:fs'),
  path = require('node:path'),
  nodeCrypto = require('node:crypto'),
  assert = require('node:assert/strict');
const output = path.join(__dirname, '../.tools/contract-demo');
const settings = JSON.parse(
  fs.readFileSync(path.join(output, 'runtime.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const base = process.env.BHOME_INVOICE_DEMO_API || 'http://localhost:5540';
const id = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const operationKey = (input) => {
  const h = nodeCrypto
    .createHash('sha256')
    .update('invoice-demo/' + input)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
async function call(token, route, body, method, operation) {
  const response = await fetch(base + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(operation ? { 'Idempotency-Key': operationKey(operation) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(`Invoice demo ${response.status}: ${route} ${problem.code ?? ''}`);
  }
  return response.status === 204 ? null : response.json();
}
async function main() {
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  assert.equal(new URL(base).hostname, 'localhost');
  const login = async (name) =>
    (
      await call(null, '/api/v1/auth/login', {
        email: name + '.contract.demo@example.invalid',
        password: settings.BHOME_DEV_TEST_PASSWORD,
      })
    ).accessToken;
  const owner = await login('owner'),
    staff = await login('staff'),
    tenants = [await login('tenant1'), await login('tenant2')];
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
        dueDay: 10,
        dueMonthOffset: 1,
        expectedVersion: 0,
      },
      'PUT',
    );
  const image = fs.readFileSync(path.join(output, 'synthetic-evidence.png'));
  const result = [];
  for (let room = 0; room < 3; room++) {
    const roomId = id(24 + room);
    let listing = await call(owner, '/api/v1/contracts?locationId=' + id(10) + '&pageSize=100');
    const contracts = [];
    for (let person = 0; person < 2; person++) {
      // Identify each separate tenancy by the linked Tenant, never list order.
      let contract = null;
      for (const item of listing.items.filter((c) => c.roomId === roomId && c.kind === 'Main')) {
        const detail = await call(owner, '/api/v1/contracts/' + item.id);
        if (detail.tenantUserId === id(3 + person)) contract = detail;
      }
      if (!contract)
        contract = await call(
          owner,
          '/api/v1/contracts',
          {
            roomId,
            ownerSignerId: id(1),
            tenantUserId: id(3 + person),
            representativeResidentId: id(80 + room * 2 + person),
            residentIds: [id(80 + room * 2 + person)],
            startDate: date(-2),
            endDate: date(12),
            monthlyRent: '3000000',
            requiredDeposit: '0',
            terms: 'SYNTHETIC BILLING DEMO. SIMULATED SIGNING. Không phải hợp đồng pháp lý.',
          },
          undefined,
          `draft-${room}-${person}`,
        );
      const route = '/api/v1/contracts/' + contract.id;
      contract = await call(owner, route);
      if (contract.status !== 'Active') {
        assert.ok(
          ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status),
          'fixture tenancy was changed; no reset',
        );
        await call(owner, route + '/previews', {}, undefined, 'preview-' + contract.id);
        for (const [token, actor] of [
          [owner, id(1)],
          [tenants[person], id(3 + person)],
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
    const period = room === 1 ? date(0) : date(-1);
    const baseline = room === 1 ? date(0, 0) : date(-1, 0);
    const current = room === 1 ? today : date(0, 0);
    for (let utility = 0; utility < 2; utility++) {
      const meterId = id(70 + room * 2 + utility);
      for (const purpose of [0, 1]) {
        let tasks = await call(staff, '/api/v1/capture/meter-tasks');
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
            readingDate: purpose === 0 ? baseline : current,
            billingPeriod: purpose === 1 ? period : null,
            contractId: null,
          });
          task = await call(staff, '/api/v1/capture/meter-tasks/' + created.id);
        }
        if (task.status === 2 || (room === 1 && purpose === 1)) continue;
        assert.ok(task.status === 0 || task.status === 1, 'fixture task was changed; no reset');
        const upload = await fetch(base + `/api/v1/capture/meter-tasks/${task.id}/evidence`, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + staff, 'Content-Type': 'image/png' },
          body: image,
          signal: AbortSignal.timeout(30000),
        });
        assert.equal(upload.status, 200, 'private synthetic evidence upload');
        await call(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
          humanConfirmed: true,
          confirmedValue: purpose === 0 ? '100' : utility === 0 ? '125.5' : '102',
          evidenceId: (await upload.json()).id,
        });
      }
    }
    let invoice = await call(owner, '/api/v1/invoices/drafts', {
      roomId,
      billingPeriod: period,
      representativeContractId: contracts[0],
    });
    if (room === 0 && invoice.status === 'Draft') {
      invoice = await call(owner, `/api/v1/invoices/${invoice.id}/refresh`, {
        expectedVersion: invoice.version,
      });
      assert.equal(invoice.missingInputs.length, 0);
      invoice = await call(owner, `/api/v1/invoices/${invoice.id}/finalize`, {
        expectedVersion: invoice.version,
      });
    }
    result.push({ roomId, invoiceId: invoice.id, period, status: invoice.status, contracts });
    for (const token of tenants)
      assert.equal((await call(token, '/api/v1/invoices/' + invoice.id)).id, invoice.id);
  }
  fs.writeFileSync(path.join(output, 'invoice-fixture.json'), JSON.stringify(result, null, 2));
  console.log(
    'Invoice demo: shared tenancies, confirmed evidence/consumption, Draft and Final persisted via real APIs. No reset, bank payment or legal signature.',
  );
}
main().catch((error) => {
  console.error(String(error.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
