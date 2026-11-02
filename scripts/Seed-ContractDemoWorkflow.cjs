// Real API fixture bootstrap. No mock routes, bank provider or legal signatures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const settings = JSON.parse(
  fs
    .readFileSync(path.join(__dirname, '../.tools/contract-demo/runtime.json'), 'utf8')
    .replace(/^\uFEFF/, ''),
);
const base = 'http://localhost:5540',
  root = '/api/v1/contracts';
const id = (n) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function key(value) {
  const h = nodeCrypto
    .createHash('sha256')
    .update('bhome-contract-demo/' + value)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function call(token, route, body, operation) {
  const r = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(operation ? { 'Idempotency-Key': key(operation) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    let code = '';
    try {
      code = (await r.json()).code ?? '';
    } catch {
      // Non-JSON error responses still report the HTTP status and route below.
    }
    throw new Error(`Demo API ${r.status}: ${route} ${code}`);
  }
  return r.status === 204 ? null : r.json();
}
async function main() {
  assert.ok(settings.ConnectionStrings__Database.includes('Database=bhome_contract_demo;'));
  const login = async (name) =>
    (
      await call(null, '/api/v1/auth/login', {
        email: name + '.contract.demo@example.invalid',
        password: settings.BHOME_DEV_TEST_PASSWORD,
      })
    ).accessToken;
  const owner = await login('owner'),
    tenant = await login('tenant3'),
    staff = await login('staff');
  const config = await call(owner, root + '/configuration');
  assert.equal(config.signingMode, 'Simulated');
  assert.equal(config.template.developmentOnly, true);
  const prep = await call(owner, root + '/preparation?locationId=' + id(10));
  assert.equal(prep.locations.find((l) => l.id === id(10)).label, 'BHOME CONTRACT DEMO');
  const listing = await call(owner, root + '?locationId=' + id(10) + '&pageSize=100');
  let contract = listing.items.find((c) => c.roomId === id(21) && c.kind === 'Main');
  if (!contract) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const end = new Date(today + 'T12:00:00Z');
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    contract = await call(
      owner,
      root,
      {
        roomId: id(21),
        ownerSignerId: id(1),
        tenantUserId: id(5),
        representativeResidentId: id(52),
        residentIds: [id(52)],
        startDate: today,
        endDate: end.toISOString().slice(0, 10),
        monthlyRent: '3000000',
        requiredDeposit: '3000000',
        terms:
          'SYNTHETIC DEVELOPMENT CONTRACT. Chỉ dùng thử quy trình; không phải điều khoản hoặc chữ ký pháp lý.',
        holdingContractId: null,
      },
      'draft-p102',
    );
  }
  const route = root + '/' + contract.id;
  let current = await call(owner, route);
  assert.equal(current.isDevelopmentDemo, true);
  if (['Terminated', 'Cancelled', 'Superseded'].includes(current.status)) {
    console.log('P102 đã có lịch sử kết thúc; giữ nguyên, không reset hoặc tạo lại.');
    return;
  }
  await call(owner, route + '/previews', {}, 'preview-' + contract.id);
  for (const [token, actor] of [
    [owner, id(1)],
    [tenant, id(5)],
  ]) {
    current = await call(owner, route);
    const signature = current.signatures.find(
      (s) => s.signerUserId === actor && s.status !== 'Failed',
    );
    if (!signature)
      await call(
        token,
        route + '/signing',
        { certificateId: '00000000-0000-0000-0000-000000000000' },
        'sign-' + contract.id + '-' + actor,
      );
    await call(token, route + '/signing/sync', {}, 'sync-' + contract.id + '-' + actor);
  }
  const deposits = await call(owner, route + '/deposit-verifications');
  if (!deposits.length)
    await call(
      owner,
      route + '/deposit-verifications',
      {
        bankTransactionReference: 'SYNTHETIC-DEMO-P102-' + contract.id,
        amount: '3000000',
        verificationReason: 'SYNTHETIC bank statement fixture; không phải khoản chuyển tiền thật.',
      },
      'deposit-' + contract.id,
    );
  current = await call(owner, route);
  if (current.status !== 'Active') {
    const ready = await call(owner, route + '/activation-readiness');
    assert.equal(ready.ready, true);
    current = await call(owner, route + '/activate', {}, 'activate-' + contract.id);
  }
  assert.equal(current.status, 'Active');
  const history = await call(owner, root + '?locationId=' + id(10) + '&pageSize=100');
  if (!history.items.some((c) => c.roomId === id(21) && c.kind === 'Renewal')) {
    const nextEnd = new Date(current.endDate + 'T12:00:00Z');
    nextEnd.setUTCFullYear(nextEnd.getUTCFullYear() + 1);
    await call(
      owner,
      route + '/renewals',
      {
        endDate: nextEnd.toISOString().slice(0, 10),
        monthlyRent: '3000000',
        terms: 'SYNTHETIC DEVELOPMENT RENEWAL. Bản nháp thử nghiệm, chưa ký hoặc kích hoạt.',
      },
      'renewal-' + contract.id,
    );
  }
  assert.equal(current.signatures.filter((s) => s.status === 'Simulated').length, 2);
  const image = fs.readFileSync(
    path.join(__dirname, '../.tools/contract-demo/synthetic-evidence.png'),
  );
  for (const meterId of [40, 41, 42, 43, 46, 47].map(id)) {
    const tasks = await call(staff, '/api/v1/capture/meter-tasks');
    let task = tasks.find((t) => t.meterId === meterId && t.purpose === 0);
    if (!task) {
      const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
      const created = await call(owner, '/api/v1/capture/meter-tasks', {
        meterId,
        purpose: 0,
        readingDate: date,
        billingPeriod: null,
        contractId: null,
      });
      task = { id: created.id, status: 0 };
    }
    if (task.status === 2) continue;
    const upload = await fetch(base + `/api/v1/capture/meter-tasks/${task.id}/evidence`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + staff, 'Content-Type': 'image/png' },
      body: image,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(upload.status, 200, 'synthetic meter evidence upload');
    const evidence = await upload.json();
    await call(staff, `/api/v1/capture/meter-tasks/${task.id}/confirm`, {
      humanConfirmed: true,
      confirmedValue: '100',
      evidenceId: evidence.id,
    });
  }
  fs.writeFileSync(
    path.join(__dirname, '../.tools/contract-demo/fixture.json'),
    JSON.stringify(
      { contractId: contract.id, roomId: id(21), status: current.status, signing: 'Simulated' },
      null,
      2,
    ),
  );
  console.log(
    'Đã kiểm tra P102 Active qua API thật; 2 trạng thái Simulated, cọc tổng hợp và PDF riêng tư. P101 còn dành cho thao tác tạo mới.',
  );
}
main().catch((e) => {
  console.error(String(e.message).split(settings.BHOME_DEV_TEST_PASSWORD).join('[REDACTED]'));
  process.exitCode = 1;
});
