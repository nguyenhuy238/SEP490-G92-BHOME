// Explicit synthetic demonstration, scoped to the newly seeded CT204 room only.
// Calls the existing Staff evidence/confirmation/handover APIs; never signs or verifies funds.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const base = new URL(
  process.env.BHOME_MOBILE_TEST_API ||
    fs.readFileSync(path.join(root, '.tools/cloudflare/api-url.txt'), 'utf8').trim(),
);
if (
  base.protocol !== 'https:' ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash ||
  !(base.hostname.endsWith('.trycloudflare.com') || base.hostname === 'localhost')
)
  throw new Error('Use the known local Development HTTPS API.');
const accounts = JSON.parse(
  fs
    .readFileSync(path.join(root, '.tools/mobile-test/accounts.json'), 'utf8')
    .replace(/^\uFEFF/, ''),
);
const contractId = 'bc050000-0000-4000-8000-000000004003';
let token;
async function call(route, method = 'GET', body, operation) {
  const bytes = body instanceof Uint8Array;
  const hash = operation
    ? createHash('sha256')
        .update('mobile-overview/' + operation)
        .digest('hex')
    : '';
  const response = await fetch(new URL(route, base), {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': bytes ? 'image/png' : 'application/json' } : {}),
      ...(operation
        ? {
            'Idempotency-Key': `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
          }
        : {}),
    },
    ...(body !== undefined ? { body: bytes ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json().catch(() => null);
  return { status: response.status, value };
}
async function required(route, method, body, operation) {
  const response = await call(route, method, body, operation);
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `${method || 'GET'} ${route}: HTTP ${response.status}; ${response.value?.code || ''}`,
    );
  return response.value;
}
(async () => {
  const session = await required('/api/v1/auth/login', 'POST', {
    email: accounts.staffEmail,
    password: accounts.password,
    device: 'synthetic-CT204-handover-example',
  });
  token = session.accessToken;
  if (!token || !session.roles?.includes('Staff')) throw new Error('Expected Staff test session.');
  try {
    const contract = await required('/api/v1/contracts/' + contractId);
    if (
      !contract.isDevelopmentDemo ||
      contract.roomNumber !== 'CT204' ||
      contract.status !== 'Active' ||
      contract.locationName !== 'BHOME MOBILE TEST'
    )
      throw new Error('Fixture identity mismatch. No writes allowed.');
    const route = '/api/v1/contracts/' + contractId + '/handover';
    const existing = await call(route);
    if (existing.status === 200) {
      console.log('CT204_HANDOVER_ALREADY_PRESENT: preserved existing handover and readings.');
      return;
    }
    if (existing.status !== 404) throw new Error('Cannot inspect existing handover.');
    const query = new URLSearchParams({ roomId: contract.roomId, locationId: contract.locationId });
    const tasks = await required('/api/v1/capture/meter-tasks?' + query);
    const initial = tasks.filter(
      (t) =>
        t.id.startsWith('bc050000-') &&
        t.purpose === 0 &&
        t.roomId === contract.roomId &&
        t.meterCode.startsWith('OVERVIEW-CT204-'),
    );
    if (initial.length !== 2 || new Set(initial.map((t) => t.utilityType)).size !== 2)
      throw new Error('Expected exactly two CT204 fixture meter tasks.');
    for (const task of initial) {
      if (task.confirmedReadingId) continue;
      if (task.status >= 2) throw new Error('Fixture task was closed by a tester; preserved.');
      const name = task.utilityType === 0 ? 'electricity' : 'water';
      const bytes = fs.readFileSync(
        path.join(root, '.tools/mobile-contract-overview/synthetic-' + name + '.png'),
      );
      const evidence = await required(
        '/api/v1/capture/meter-tasks/' + task.id + '/evidence',
        'PUT',
        bytes,
      );
      await required('/api/v1/capture/meter-tasks/' + task.id + '/confirm', 'POST', {
        humanConfirmed: true,
        confirmedValue: task.utilityType === 0 ? '100' : '10',
        evidenceId: evidence.id,
      });
    }
    const choices = await required(route + '/choices');
    const evidencePath = path.join(
      root,
      '.tools/mobile-contract-overview/handover-evidence-id.txt',
    );
    let roomEvidence = fs.existsSync(evidencePath)
      ? fs.readFileSync(evidencePath, 'utf8').trim()
      : '';
    if (!roomEvidence || !choices.evidence.some((item) => item.id === roomEvidence)) {
      const roomImage = fs.readFileSync(
        path.join(root, '.tools/mobile-contract-overview/synthetic-room.png'),
      );
      const uploaded = await required(route + '/evidence', 'POST', roomImage);
      roomEvidence = uploaded.id;
      fs.writeFileSync(evidencePath, roomEvidence + '\n');
    }
    const electricity = choices.readings.find((r) => r.meterCode === 'OVERVIEW-CT204-E');
    const water = choices.readings.find((r) => r.meterCode === 'OVERVIEW-CT204-W');
    if (!electricity || !water)
      throw new Error('Confirmed CT204 readings not available to handover.');
    const handover = await required(
      route,
      'POST',
      {
        version: 0,
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
        roomCondition:
          'MINH HỌA TEST: phòng sạch, tường và cửa nguyên vẹn; không phải kiểm tra thực tế.',
        keysAndAccess: 'MINH HỌA TEST: 2 chìa khóa phòng, 1 thẻ cổng.',
        notes:
          'Ảnh và chỉ số điện/nước là dữ liệu tổng hợp có nhãn SYNTHETIC TEST ONLY. Chưa có xác nhận Tenant/Staff hoàn tất.',
        assets: choices.assets.map((a) => ({ id: a.id, condition: a.inventoryCondition })),
        electricityReadingId: electricity.id,
        waterReadingId: water.id,
        evidenceIds: [roomEvidence],
      },
      'CT204-handover-v1',
    );
    console.log(
      'CT204_HANDOVER_CREATED: ' +
        handover.status +
        ' version ' +
        handover.version +
        '; synthetic meter images, awaiting Tenant confirmation.',
    );
  } finally {
    if (token) await call('/api/v1/auth/logout', 'POST', {});
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
