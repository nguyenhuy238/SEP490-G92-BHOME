// Repository-derived Postman v2.1 artifacts. No network, credentials or database mutation here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/testing/postman');
const stem = 'BHome.NguyenQuocHuy.Implemented';
const vars = new Map();
function variable(key, value = '', secret = false) {
  if (!vars.has(key))
    vars.set(key, {
      key,
      value: String(value),
      type: secret ? 'secret' : 'default',
      enabled: true,
    });
}
const v = (key) => {
  variable(key);
  return `{{${key}}}`;
};
const n = (key) => {
  variable(key);
  return { $number: key };
};
const b = (key) => {
  variable(key);
  return { $boolean: key };
};
const j = (key) => {
  variable(key);
  return { $json: key };
};
const folders = [];
let folder;
function group(name, description, source) {
  folder = { name, description: description + '\n\nNguồn: ' + source, item: [] };
  folders.push(folder);
}
function event(listen, code) {
  return { listen, script: { type: 'text/javascript', exec: code.split('\n') } };
}
function bodyTemplate(body) {
  return JSON.stringify(
    body,
    (_key, value) =>
      value &&
      typeof value === 'object' &&
      ('$number' in value || '$boolean' in value || '$json' in value)
        ? '__postmanRaw:' + (value.$number || value.$boolean || value.$json) + '__'
        : value,
    2,
  ).replace(/"__postmanRaw:(\w+)__"/g, '{{$1}}');
}
function prepareRequest() {
  const spec = JSON.parse(pm.variables.get('__requestSpec'));
  const rawBody = pm.request.body?.mode === 'raw' ? pm.request.body.raw : undefined;
  const required = new Set([
    ...spec.requires,
    ...[...(rawBody || '').matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]),
  ]);
  function skip(reason) {
    console.info('SKIP ' + pm.info.requestName + ': ' + reason);
    pm.execution.skipRequest();
  }
  for (const gate of spec.gates)
    if (String(pm.variables.get(gate)) !== 'true') {
      skip('bật ' + gate + '=true nếu muốn chạy nhánh này');
      return;
    }
  for (const key of required) {
    const value = pm.variables.get(key);
    if (
      value === undefined ||
      value === null ||
      String(value).trim() === '' ||
      String(value).includes('{{')
    ) {
      skip('thiếu biến ' + key);
      return;
    }
  }
  if (spec.freshKey) pm.variables.set('commandKey', pm.variables.replaceIn('{{$guid}}'));
  if (spec.stableKey && !pm.variables.get(spec.stableKey))
    pm.environment.set(spec.stableKey, pm.variables.replaceIn('{{$guid}}'));
  if (rawBody !== undefined) {
    // Resolve the visible Body, including manual edits. Quoted values are JSON-escaped;
    // unquoted variables must contain a JSON number, boolean, null, array or object.
    const resolved = rawBody.replace(/"(?:\\.|[^"\\])*"|\{\{([^}]+)\}\}/g, (token, rawKey) => {
      if (!rawKey) return JSON.stringify(pm.variables.replaceIn(JSON.parse(token)));
      try {
        return JSON.stringify(JSON.parse(String(pm.variables.get(rawKey))));
      } catch {
        throw new Error('Biến JSON/số/boolean không hợp lệ: ' + rawKey);
      }
    });
    pm.request.body.update(JSON.stringify(JSON.parse(resolved), null, 2));
  }
  if (spec.clearLogin)
    for (const suffix of ['AccessToken', 'RefreshToken', 'UserId'])
      pm.environment.set(spec.clearLogin + suffix, '');
}
function verifyResponse() {
  const spec = JSON.parse(pm.variables.get('__requestSpec'));
  const ok = spec.expected.includes(pm.response.code);
  pm.test('HTTP đúng hợp đồng: ' + spec.expected.join('/'), () =>
    pm.expect(pm.response.code).to.be.oneOf(spec.expected),
  );
  if (!ok) return;
  if (spec.expected.every((code) => code >= 400)) {
    pm.test('Lỗi không trả token hoặc stack trace', () => {
      const text = pm.response.text();
      pm.expect(text).not.to.match(/"(?:accessToken|refreshToken)"\s*:/i);
      pm.expect(text).not.to.match(/Npgsql\.|at BHome\.|System\.InvalidOperationException/);
    });
    if (spec.problemCode)
      pm.test('Mã lỗi nghiệp vụ', () =>
        pm.expect(pm.response.json().code).to.eql(spec.problemCode),
      );
    return;
  }
  if (spec.emptyDefaults && pm.response.code === 204)
    for (const [key, value] of Object.entries(spec.emptyDefaults))
      pm.environment.set(key, String(value));
  if (pm.response.code === 204 || spec.format === 'text') return;
  if (spec.format === 'binary') {
    pm.test('File có nội dung và không bị public-cache', () => {
      pm.expect(pm.response.size().body).to.be.above(0);
      pm.expect(pm.response.headers.get('Cache-Control') || '').not.to.include('public');
    });
    if (spec.contentType)
      pm.test('Đúng MIME', () =>
        pm.expect(pm.response.headers.get('Content-Type')).to.include(spec.contentType),
      );
    return;
  }
  const data = pm.response.json();
  if (spec.emptyDefaults && (data === null || (Array.isArray(data) && data.length === 0)))
    for (const [key, value] of Object.entries(spec.emptyDefaults))
      pm.environment.set(key, String(value));
  if (spec.shape === 'array') pm.test('Response là array', () => pm.expect(data).to.be.an('array'));
  if (spec.shape === 'page')
    pm.test('Page contract và giới hạn server', () => {
      pm.expect(data.items).to.be.an('array');
      pm.expect(data.totalCount).to.be.a('number');
      pm.expect(data.page).to.be.above(0);
      pm.expect(data.items.length).to.be.at.most(data.pageSize);
    });
  for (const field of spec.fields || [])
    pm.test('Có trường ' + field, () => pm.expect(data).to.have.property(field));
  if (spec.login) {
    const valid =
      Array.isArray(data.roles) &&
      data.roles.includes(spec.login.role) &&
      typeof data.accessToken === 'string' &&
      data.accessToken.length > 20 &&
      typeof data.refreshToken === 'string';
    pm.test('Session đúng role và có token', () => pm.expect(valid).to.eql(true));
    pm.test('Auth no-store', () =>
      pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'),
    );
    if (valid)
      for (const [suffix, field] of [
        ['AccessToken', 'accessToken'],
        ['RefreshToken', 'refreshToken'],
        ['UserId', 'userId'],
      ])
        pm.environment.set(spec.login.prefix + suffix, data[field]);
  }
  if (spec.equals)
    for (const [field, value] of Object.entries(spec.equals))
      pm.test(field + ' đúng kết quả nghiệp vụ', () => pm.expect(data[field]).to.eql(value));
  if (spec.saves)
    for (const [key, pointer] of Object.entries(spec.saves)) {
      const value = pointer
        .split('.')
        .reduce((item, part) => (item == null ? undefined : item[part]), data);
      if (value !== undefined && value !== null)
        pm.environment.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  if (spec.invoiceSnapshot && data.status === 'Final')
    pm.environment.set(
      'originalFinalSnapshot',
      JSON.stringify({ id: data.id, total: data.total, version: data.version, lines: data.lines }),
    );
  if (spec.compareFinal) {
    const original = pm.variables.get('originalFinalSnapshot');
    pm.test('Final giữ nguyên tổng/version/lines sau payment/adjustment', () => {
      pm.expect(original).to.be.a('string').and.not.empty;
      pm.expect({
        id: data.id,
        total: data.total,
        version: data.version,
        lines: data.lines,
      }).to.deep.eql(JSON.parse(original));
    });
  }
  if (spec.noPrivate)
    pm.test('Không lộ private reason/bank marker/object key', () =>
      pm
        .expect(pm.response.text())
        .not.to.match(
          /POSTMAN_PRIVATE_|"(?:identityData|identityHmac|evidenceObjectKey|objectKey)"\s*:/,
        ),
    );
  if (spec.listSnapshot)
    pm.environment.set(
      spec.listSnapshot,
      JSON.stringify((data.items || data).map((item) => item.id).sort()),
    );
  if (spec.compareList)
    pm.test('Replay giữ nguyên IDs trong trang đang kiểm tra', () =>
      pm
        .expect(JSON.stringify((data.items || data).map((item) => item.id).sort()))
        .to.eql(pm.variables.get(spec.compareList)),
    );
}
function request(name, method, route, o = {}) {
  const role = o.role === undefined ? 'owner' : o.role;
  const token = role ? role + 'AccessToken' : null;
  const requires = [
    ...new Set([
      ...(token ? [token] : []),
      ...(o.requires || []),
      ...[...route.matchAll(/\{\{([^}]+)\}\}/g)].map((x) => x[1]),
    ]),
  ];
  requires.forEach((x) => variable(x, '', x.endsWith('Token')));
  function bodyKeys(value) {
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value))
        if (['$number', '$boolean', '$json'].includes(key)) requires.push(item);
        else bodyKeys(item);
    } else if (typeof value === 'string')
      for (const m of value.matchAll(/\{\{([^}]+)\}\}/g)) requires.push(m[1]);
  }
  // Body variables are checked from the editable raw template at send time.
  // Register them here so every reusable field is included in the Environment.
  const bodyRequires = [];
  const requiredBeforeBody = requires.length;
  bodyKeys(o.body);
  bodyRequires.push(...requires.splice(requiredBeforeBody));
  const gates = [...(o.write ? ['enableWrites'] : []), ...(o.gates || [])];
  gates.forEach((gate) => variable(gate, 'false'));
  const spec = {
    requires: [...new Set(requires)],
    gates,
    expected: o.expected || [200],
    freshKey: !!o.key && !o.stableKey,
    ...Object.fromEntries(
      Object.entries(o).filter(
        ([key]) =>
          ![
            'role',
            'requires',
            'write',
            'gates',
            'key',
            'binary',
            'description',
            'source',
            'stableKey',
          ].includes(key),
      ),
    ),
    ...(o.stableKey ? { stableKey: o.stableKey } : {}),
  };
  const headers = [];
  if (o.body !== undefined) headers.push({ key: 'Content-Type', value: 'application/json' });
  if (o.binary) headers.push({ key: 'Content-Type', value: 'image/png' });
  if (o.key)
    headers.push({ key: 'Idempotency-Key', value: '{{' + (o.stableKey || 'commandKey') + '}}' });
  if (o.stableKey) variable(o.stableKey);
  const prefix = o.write ? '[GHI] ' : '';
  const payloadPreview =
    o.body === undefined
      ? ''
      : '\n\nPayload template (xem và sửa trực tiếp trong tab Body):\n```json\n' +
        bodyTemplate(o.body) +
        '\n```';
  const description =
    (o.description || '') +
    '\n\nNguồn: ' +
    (o.source || folder.description.split('Nguồn: ')[1]) +
    '\n' +
    (gates.length ? 'Bật các biến: ' + gates.join(', ') + '. ' : '') +
    'Biến bắt buộc: ' +
    [...new Set([...spec.requires, ...bodyRequires])].join(', ') +
    '.\n' +
    (o.body !== undefined
      ? 'Body có JSON đầy đủ và tham chiếu Environment. Có thể sửa Body trực tiếp; script giữ đúng kiểu JSON và escape dấu nháy/backslash trong chuỗi. '
      : '') +
    (o.binary
      ? 'Body binary dùng fixtures/synthetic-meter.png; đặt Postman working directory là docs/testing/postman. Chỉ dữ liệu tổng hợp.'
      : '') +
    payloadPreview;
  const item = {
    name: prefix + name,
    request: {
      method,
      header: headers,
      auth: token
        ? { type: 'bearer', bearer: [{ key: 'token', value: '{{' + token + '}}', type: 'string' }] }
        : { type: 'noauth' },
      url: '{{baseUrl}}' + route.replace(/^\//, ''),
      description,
      ...(o.body !== undefined
        ? {
            body: {
              mode: 'raw',
              raw: bodyTemplate(o.body),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
      ...(o.binary
        ? { body: { mode: 'file', file: { src: 'fixtures/synthetic-meter.png' } } }
        : {}),
    },
    protocolProfileBehavior: { disableCookies: true },
    event: [
      event(
        'prerequest',
        'pm.variables.set("__requestSpec", ' +
          JSON.stringify(JSON.stringify(spec)) +
          ');\n(' +
          prepareRequest.toString() +
          ')();',
      ),
      event('test', '(' + verifyResponse.toString() + ')();'),
    ],
  };
  folder.item.push(item);
  return item;
}
const page = { shape: 'page' },
  array = { shape: 'array' };
const contractSave = { contractId: 'id', contractStatus: 'status' };
const invoiceSave = {
  invoiceId: 'id',
  invoiceVersion: 'version',
  invoiceStatus: 'status',
  invoiceTotal: 'total',
};
const taskSave = { operationalTaskId: 'id', operationalTaskVersion: 'version' };
const c = '/api/v1/contracts/{{contractId}}';
const life = '/api/v1/contracts/{{lifecycleContractId}}';
const inv = '/api/v1/invoices/{{invoiceId}}';

variable('baseUrl', 'https://localhost:7240/');
for (const flag of [
  'enableWrites',
  'enableLifecycleActions',
  'enableDevActions',
  'enableExternalSigning',
  'enableAuthCleanup',
  'enableIdentityConfirmation',
  'enableFinancialWrites',
  'enableOptionalBranches',
  'allowRemoteRequests',
])
  variable(flag, 'false');
for (const [key, value] of Object.entries({
  missingId: '00000000-0000-4000-8000-000000000099',
  timeZone: 'Asia/Ho_Chi_Minh',
  locationName: 'BHOME POSTMAN SYNTHETIC',
  locationAddress: 'ĐỊA CHỈ TỔNG HỢP POSTMAN',
  deviceName: 'Postman synthetic verification',
  roomTypeName: 'Loại phòng tổng hợp Postman',
  roomCapacity: '3',
  roomAreaM2: '25',
  roomFloor: '1',
  roomNumber: 'PM101',
  residentDisplayLabel: 'Người ở tổng hợp Postman',
  contractTerms: 'SYNTHETIC POSTMAN CONTRACT - NOT A LEGAL SIGNING RESULT',
  monthlyRent: '3000000',
  requiredDeposit: '0',
  meterConfirmedValue: '125',
  chargeRate: '3500',
  chargeCategory: '1',
  chargeCode: 'ELECTRICITY',
  chargeMethod: '1',
  chargeName: 'Điện tổng hợp Postman',
  automationEnabled: 'false',
  authorizeAutomaticFinalization: 'false',
  expectedHandoverVersion: '0',
  representativeVersion: '0',
  identityFullName: 'NGUOI THUE TONG HOP POSTMAN',
  identityDateOfBirth: '2000-01-01',
  evidenceIdsJson: '[]',
  handoverAssetsJson: '[]',
  correctedAmount: '2999000',
  proposedAmount: '2999000',
  confirmedInspectionNoCharges: 'false',
  syntheticBankIdentifier: '970415',
  syntheticAccountNumber: '000000000000',
  taskTitle: 'Kiểm tra tổng hợp Postman',
  taskNote: 'DỮ LIỆU TỔNG HỢP - KHÔNG PHẢI NGHIỆP VỤ THẬT',
}))
  variable(key, value);
for (const prefix of ['owner', 'staff', 'tenant', 'coTenant', 'outsider'])
  for (const suffix of ['Email', 'Password', 'AccessToken', 'RefreshToken', 'UserId'])
    variable(prefix + suffix, '', /Password|Token/.test(suffix));

group(
  '00 - Smoke không cần tài khoản',
  'Chạy được ngay. Không tạo dữ liệu nghiệp vụ; readiness 200 chỉ khi DB đã migrate.',
  'Program.cs; AuthController; API_CONVENTIONS.md; UC-01 / GBR-01',
);
request('00.01 Live', 'GET', '/health/live', { role: null, format: 'text' });
request('00.02 Ready - database và migrations', 'GET', '/health/ready', {
  role: null,
  format: 'text',
});
for (const [name, route] of [
  ['session', '/api/v1/session'],
  ['contracts', '/api/v1/contracts'],
  ['invoices', '/api/v1/invoices'],
  ['payments', '/api/v1/payment-transactions'],
  ['notifications', '/api/v1/notifications'],
])
  request('00 - Anonymous ' + name + ' -> 401', 'GET', route, { role: null, expected: [401] });
request('00.08 Login thiếu password -> 400', 'POST', '/api/v1/auth/login', {
  role: null,
  body: { email: 'synthetic@example.invalid' },
  expected: [400],
});
request('00.09 Refresh thiếu credential -> 401', 'POST', '/api/v1/auth/refresh', {
  role: null,
  body: {},
  expected: [401],
});

group(
  '01 - Đăng nhập và session theo role',
  'Điền email/password local cho mỗi role. CoTenant cùng invoice; outsider là Tenant khác không có entitlement. Không dùng chung hai tài khoản cho ca privacy.',
  'AuthController; FoundationController; UC-01/02 / GBR-01/02',
);
for (const [prefix, role] of [
  ['owner', 'Owner'],
  ['staff', 'Staff'],
  ['tenant', 'Tenant'],
  ['coTenant', 'Tenant'],
  ['outsider', 'Tenant'],
]) {
  request('Đăng nhập ' + prefix, 'POST', '/api/v1/auth/login', {
    role: null,
    requires: [prefix + 'Email', prefix + 'Password'],
    body: {
      email: v(prefix + 'Email'),
      password: v(prefix + 'Password'),
      device: v('deviceName'),
    },
    clearLogin: prefix,
    login: { prefix, role },
  });
  request('Me ' + prefix, 'GET', '/api/v1/auth/me', {
    role: prefix,
    fields: ['userId', 'sessionId', 'roles'],
  });
}
request('Owner session probe', 'GET', '/api/v1/session', { fields: ['userId'] });

group(
  '02 - Dữ liệu nền và chọn scope',
  'GET không tự chọn record đầu tiên. Điền locationId/roomId đúng môi trường; hoặc bật enableWrites để tạo scope tổng hợp mới. Không reset/xóa dữ liệu cũ.',
  'PropertyControllers.cs; LocationsController; ChainController; BF-01 / UC-04..07 / GBR-08',
);
request('Owner xem Chain duy nhất', 'GET', '/api/v1/chain', { fields: ['id', 'name', 'version'] });
request('Owner danh sách Location', 'GET', '/api/v1/locations?page=1&pageSize=20', page);
request('Staff Location hiện được giao', 'GET', '/api/v1/locations/assigned-to-me', {
  role: 'staff',
  ...array,
});
request('Tạo Location test', 'POST', '/api/v1/locations', {
  write: true,
  body: {
    name: v('locationName'),
    address: v('locationAddress'),
    isActive: true,
    version: 0,
    reason: 'Synthetic test workspace',
  },
  expected: [201],
  saves: { locationId: 'id', locationVersion: 'version' },
});
request('Xem Location test', 'GET', '/api/v1/locations/{{locationId}}', {
  fields: ['id', 'version'],
  saves: { locationVersion: 'version' },
});
request('Owner Staff choices', 'GET', '/api/v1/capture/staff', array);
request(
  'Assignment hiện có',
  'GET',
  '/api/v1/staff-location-assignments?locationId={{locationId}}',
  array,
);
request('Giao Staff trong khoảng test', 'POST', '/api/v1/staff-location-assignments', {
  write: true,
  body: {
    locationId: v('locationId'),
    staffUserId: v('staffUserId'),
    startDate: v('assignmentStart'),
    endDate: v('assignmentEnd'),
  },
  expected: [201],
});
request('Tạo RoomType test', 'POST', '/api/v1/room-types', {
  write: true,
  body: {
    locationId: v('locationId'),
    name: v('roomTypeName'),
    description: 'Synthetic only',
    defaultCapacity: n('roomCapacity'),
    areaM2: n('roomAreaM2'),
    amenities: [],
    isActive: true,
    version: 0,
  },
  expected: [201],
  saves: { roomTypeId: 'id' },
});
request('Tạo Room test', 'POST', '/api/v1/rooms', {
  write: true,
  body: {
    locationId: v('locationId'),
    roomTypeId: v('roomTypeId'),
    roomNumber: v('roomNumber'),
    floor: v('roomFloor'),
    capacity: n('roomCapacity'),
    status: 0,
    version: 0,
  },
  expected: [201],
  saves: { roomId: 'id', roomVersion: 'version' },
});
request(
  'Danh sách phòng theo scope',
  'GET',
  '/api/v1/rooms?locationId={{locationId}}&page=1&pageSize=20',
  page,
);
request('Xem Room và trạng thái từ backend', 'GET', '/api/v1/rooms/{{roomId}}', {
  fields: ['id', 'status', 'version'],
  saves: { roomVersion: 'version' },
});
request(
  'Asset của phòng',
  'GET',
  '/api/v1/assets?locationId={{locationId}}&roomId={{roomId}}&page=1&pageSize=20',
  page,
);
request('Tạo Asset test cho handover', 'POST', '/api/v1/assets', {
  write: true,
  body: {
    locationId: v('locationId'),
    roomId: v('roomId'),
    commonArea: null,
    code: null,
    name: 'Quạt tổng hợp Postman',
    category: 'Thiết bị',
    condition: 'Tốt - synthetic',
    status: 0,
    version: 0,
  },
  expected: [201],
  saves: { assetId: 'id' },
});
request(
  'Giá áp dụng đúng ngày',
  'GET',
  '/api/v1/rooms/{{roomId}}/prices?effectiveOn={{rateEffectiveOn}}',
  { fields: ['charges', 'missingRequiredCharges'] },
);
request(
  'Biểu phí theo cơ sở',
  'GET',
  '/api/v1/billing-policies?locationId={{locationId}}&page=1&pageSize=20',
  page,
);
request('Tạo một khoản giá Owner chọn', 'POST', '/api/v1/billing-policies', {
  write: true,
  body: {
    locationId: v('locationId'),
    roomTypeId: null,
    roomId: null,
    category: n('chargeCategory'),
    chargeCode: v('chargeCode'),
    name: v('chargeName'),
    method: n('chargeMethod'),
    rate: n('chargeRate'),
    effectiveFrom: v('rateEffectiveOn'),
    effectiveTo: null,
    reason: 'Synthetic policy configured by test Owner',
  },
  expected: [201],
  saves: { policyId: 'id', policyVersion: 'version' },
  description:
    'Chạy riêng ba lần với RENT/0/0, ELECTRICITY/1/1, WATER/2/1 và giá được chọn. Không tự tạo chính sách production.',
});

group(
  '03 - Capture và OCR - xác nhận con người',
  'Staff phải được giao Location hiện tại. Ảnh binary tổng hợp kèm theo; không gửi CCCD thật. Confirm identity là tùy chọn riêng vì lưu trường định danh.',
  'CaptureController; OcrController; CaptureContracts.cs; BF-03 / UC-13; BF-05 / UC-20 / GBR-07',
);
request('Staff capture locations', 'GET', '/api/v1/capture/locations', { role: 'staff', ...array });
request('Staff phòng theo Location', 'GET', '/api/v1/capture/locations/{{locationId}}/rooms', {
  role: 'staff',
  ...array,
});
request('Staff xem Residents', 'GET', '/api/v1/capture/locations/{{locationId}}/residents', {
  role: 'staff',
  ...array,
});
request('Tạo Resident test', 'POST', '/api/v1/capture/residents', {
  role: 'staff',
  write: true,
  body: { roomId: v('roomId'), displayLabel: v('residentDisplayLabel'), residentType: 0 },
  saves: { residentId: 'id' },
});
request(
  'OCR identity front - proposal transient',
  'POST',
  '/api/v1/ocr/identity/{{residentId}}/front',
  {
    role: 'staff',
    binary: true,
    fields: ['proposedFields', 'isFallback', 'requiresConfirmation'],
    equals: { requiresConfirmation: true },
  },
);
request(
  'Identity không human-confirm -> 400',
  'POST',
  '/api/v1/capture/residents/{{residentId}}/confirm',
  {
    role: 'staff',
    requires: ['residentId'],
    body: {
      humanConfirmed: false,
      citizenIdentityNumber: '000000000000',
      fullName: 'SYNTHETIC ONLY',
      dateOfBirth: '2000-01-01',
    },
    expected: [400],
    problemCode: 'human_confirmation_required',
  },
);
request('Xác nhận identity tổng hợp', 'POST', '/api/v1/capture/residents/{{residentId}}/confirm', {
  role: 'staff',
  write: true,
  gates: ['enableIdentityConfirmation'],
  body: {
    humanConfirmed: true,
    citizenIdentityNumber: v('syntheticCitizenNumber'),
    fullName: v('identityFullName'),
    dateOfBirth: v('identityDateOfBirth'),
    residentialAddress: 'ĐỊA CHỈ TỔNG HỢP',
    gender: null,
    nationality: null,
    placeOfOrigin: null,
    dateOfIssue: null,
    dateOfExpiry: null,
  },
  fields: ['verificationStatus'],
  description:
    'syntheticCitizenNumber cần 12 chữ số synthetic duy nhất. Không có ảnh định danh thật. Nếu Resident đã được xác minh, dùng lại payload gốc hoặc chọn Resident mới.',
});
for (const [type, name] of [
  [0, 'electricity'],
  [1, 'water'],
])
  request('Tạo meter ' + name, 'POST', '/api/v1/capture/meters', {
    write: true,
    body: {
      roomId: v('roomId'),
      code: 'PM-' + name + '-' + v('runLabel'),
      utilityType: type,
      display: 1,
      decimalPlaces: 0,
      installedOn: v('meterInstalledOn'),
    },
    saves: { [name + 'MeterId']: 'id' },
  });
request('Danh sách meters scoped', 'GET', '/api/v1/capture/locations/{{locationId}}/meters', {
  role: 'staff',
  ...array,
});
request('Tạo task - chọn baseline/periodic/final', 'POST', '/api/v1/capture/meter-tasks', {
  write: true,
  body: {
    meterId: v('meterId'),
    purpose: n('readingPurpose'),
    readingDate: v('readingDate'),
    billingPeriod: j('taskBillingPeriodJson'),
    contractId: j('taskContractIdJson'),
  },
  saves: { meterTaskId: 'id' },
  description:
    'Initial=0: billingPeriod null, contractId null. Periodic=1: billingPeriod yyyy-MM-01. Final=2: contractId của hợp đồng được kiểm tra trả phòng. Không tạo task trùng Room/type/kỳ.',
});
request(
  'Staff lọc task Location/Room/status',
  'GET',
  '/api/v1/capture/meter-tasks?locationId={{locationId}}&roomId={{roomId}}&status={{meterTaskStatus}}&page=1',
  { role: 'staff', ...array },
);
request(
  'Staff lọc task theo hạn VN',
  'GET',
  '/api/v1/capture/meter-tasks?locationId={{locationId}}&dueDate={{meterTaskDueDate}}&page=1',
  { role: 'staff', ...array },
);
request('Chi tiết task và baseline', 'GET', '/api/v1/capture/meter-tasks/{{meterTaskId}}', {
  role: 'staff',
  fields: ['meterId', 'status', 'previousValue'],
  saves: { meterTaskVersion: 'version' },
});
request(
  'OCR meter - chưa là chỉ số chính thức',
  'POST',
  '/api/v1/ocr/meter-tasks/{{meterTaskId}}',
  {
    role: 'staff',
    binary: true,
    fields: ['proposedFields', 'isFallback', 'requiresConfirmation'],
    equals: { requiresConfirmation: true },
  },
);
request('Upload ảnh meter private', 'PUT', '/api/v1/capture/meter-tasks/{{meterTaskId}}/evidence', {
  role: 'staff',
  write: true,
  binary: true,
  saves: { meterEvidenceId: 'id' },
});
const meterBody = {
  humanConfirmed: true,
  confirmedValue: v('meterConfirmedValue'),
  evidenceId: v('meterEvidenceId'),
};
request(
  'Meter thiếu human-confirm -> 400',
  'POST',
  '/api/v1/capture/meter-tasks/{{meterTaskId}}/confirm',
  {
    role: 'staff',
    body: { ...meterBody, humanConfirmed: false },
    expected: [400],
    problemCode: 'human_confirmation_required',
  },
);
request(
  'Staff xác nhận meter thủ công sau kiểm tra',
  'POST',
  '/api/v1/capture/meter-tasks/{{meterTaskId}}/confirm',
  {
    role: 'staff',
    write: true,
    body: meterBody,
    fields: ['id', 'confirmedValue', 'consumption'],
    saves: { readingId: 'id' },
    description:
      'Tạo/confirm baseline trước periodic. Chạy riêng điện/nước; lưu electricityReadingId/waterReadingId từ readingId cho handover/inspection.',
  },
);
request('Đọc confirmed reading', 'GET', '/api/v1/capture/readings/{{readingId}}', {
  role: 'staff',
  fields: ['taskId', 'confirmedValue', 'consumption'],
});
request(
  'Tải ảnh confirmed reading có scope',
  'GET',
  '/api/v1/capture/readings/{{readingId}}/evidence',
  { role: 'staff', format: 'binary' },
);

group(
  '04 - Main Contract và ký - BH16',
  'Chỉ Main Tenancy đã có backend; không Holding ledger. Dùng configuration để phân biệt Simulated/production. Signing thật chỉ chạy khi chủ động bật gate provider.',
  'ContractsController; ContractSigningCertificatesController; ContractContracts/WorkflowContracts; BF-03 / UC-14..16 / GBR-04',
);
request('Cấu hình template và signing mode thực', 'GET', '/api/v1/contracts/configuration', {
  fields: ['template', 'signingMode', 'holdingBlocker', 'settlementBlocker'],
  saves: { signingMode: 'signingMode' },
});
request('Preparation Owner', 'GET', '/api/v1/contracts/preparation?locationId={{locationId}}', {
  fields: ['rooms', 'residents', 'ownerSigners'],
});
request(
  'Preparation Staff scoped',
  'GET',
  '/api/v1/contracts/preparation?locationId={{locationId}}',
  { role: 'staff', fields: ['rooms', 'residents'] },
);
request('Owner chọn Tenant account đã có', 'GET', '/api/v1/contracts/preparation/accounts', array);
request(
  'Owner liên kết Resident với Tenant',
  'POST',
  '/api/v1/contracts/preparation/residents/{{residentId}}/account',
  { write: true, body: { tenantUserId: v('tenantUserId') }, expected: [204] },
);
request('Tạo Main Contract test', 'POST', '/api/v1/contracts', {
  write: true,
  key: true,
  body: {
    roomId: v('roomId'),
    ownerSignerId: v('ownerUserId'),
    tenantUserId: v('tenantUserId'),
    representativeResidentId: v('residentId'),
    residentIds: [v('residentId')],
    startDate: v('contractStart'),
    endDate: v('contractEnd'),
    monthlyRent: v('monthlyRent'),
    requiredDeposit: v('requiredDeposit'),
    terms: v('contractTerms'),
    holdingContractId: null,
  },
  expected: [201],
  saves: contractSave,
});
request('Owner contracts page', 'GET', '/api/v1/contracts?page=1&pageSize=20', page);
request('Tenant own contracts page', 'GET', '/api/v1/contracts?page=1&pageSize=20', {
  role: 'tenant',
  ...page,
});
request('Contract detail', 'GET', c, {
  fields: ['id', 'status', 'signatures', 'residentIds'],
  saves: contractSave,
});
request('Contract history', 'GET', c + '/history', array);
request('Contract version chain', 'GET', c + '/versions', array);
request('Activation readiness', 'GET', c + '/activation-readiness', {
  fields: ['ready', 'verifiedDeposit', 'remainingDeposit', 'blockers'],
});
request('Owner generate preview PDF', 'POST', c + '/previews', {
  write: true,
  key: true,
  fields: ['id', 'kind', 'snapshotHash'],
  saves: { contractPreviewFileId: 'id' },
});
request('List private previews', 'GET', c + '/previews', array);
request('Download preview PDF', 'GET', c + '/previews/{{contractPreviewFileId}}', {
  format: 'binary',
  contentType: 'application/pdf',
});
request('Owner declared certificates', 'GET', '/api/v1/digital-signing/certificates', array);
request('Tenant declared certificates', 'GET', '/api/v1/digital-signing/certificates', {
  role: 'tenant',
  ...array,
});
for (const role of ['owner', 'tenant']) {
  request(role + ' request signing', 'POST', c + '/signing', {
    role,
    write: true,
    gates: ['enableExternalSigning'],
    key: true,
    body: { certificateId: v(role + 'CertificateId') },
    fields: ['id', 'signerUserId', 'status'],
    description:
      'Simulated Development có thể dùng Guid.Empty; production cần certificate/provider đã duyệt. Không coi pending/sync là ký thành công.',
  });
  request(role + ' sync signing', 'POST', c + '/signing/sync', {
    role,
    write: true,
    gates: ['enableExternalSigning'],
    fields: ['status', 'signatures'],
  });
}
request('Owner verified deposit - statement tổng hợp', 'POST', c + '/deposit-verifications', {
  write: true,
  gates: ['enableFinancialWrites'],
  key: true,
  body: {
    bankTransactionReference: v('depositReference'),
    amount: v('depositAmount'),
    verificationReason: 'SYNTHETIC POSTMAN STATEMENT - NO REAL BANK PAYMENT',
  },
  fields: ['id'],
});
request('Xem verified deposits', 'GET', c + '/deposit-verifications', array);
request('Owner activate sau readiness', 'POST', c + '/activate', {
  write: true,
  gates: ['enableLifecycleActions'],
  key: true,
  fields: ['status', 'activatedAt'],
  equals: { status: 'Active' },
});
request('Download contract document', 'GET', c + '/document', {
  role: 'tenant',
  format: 'binary',
  contentType: 'application/pdf',
});

group(
  '05 - Move-in Handover - UC17',
  'Điện/nước baseline đã được Staff xác nhận, asset snapshot đầy đủ. Owner/Tenant không ghi chỉ số thay Staff. Các nhánh dispute chỉ chạy riêng.',
  'ContractsController; ContractHandoverContracts; ContractHandoverService; BF-04 / UC-17',
);
request('Staff handover choices', 'GET', c + '/handover/choices', {
  role: 'staff',
  fields: ['assets', 'readings', 'evidence'],
});
request('Staff upload handover evidence', 'POST', c + '/handover/evidence', {
  role: 'staff',
  write: true,
  binary: true,
  saves: { handoverEvidenceId: 'id' },
});
request('Staff lưu handover snapshot', 'POST', c + '/handover', {
  role: 'staff',
  write: true,
  key: true,
  body: {
    version: n('expectedHandoverVersion'),
    date: v('handoverDate'),
    roomCondition: 'Phòng tổng hợp tốt',
    keysAndAccess: '2 chìa khóa tổng hợp',
    notes: 'SYNTHETIC HANDOVER',
    assets: j('handoverAssetsJson'),
    electricityReadingId: v('electricityReadingId'),
    waterReadingId: v('waterReadingId'),
    evidenceIds: [v('handoverEvidenceId')],
  },
  fields: ['version', 'status', 'snapshot'],
  saves: { handoverVersion: 'version' },
});
request('Xem handover', 'GET', c + '/handover', {
  fields: ['version', 'status', 'snapshot'],
  saves: { handoverVersion: 'version' },
});
request('Tenant confirm đúng version', 'POST', c + '/handover/tenant-confirmation', {
  role: 'tenant',
  write: true,
  key: true,
  body: { version: n('handoverVersion'), note: 'Đã đối chiếu snapshot tổng hợp' },
  fields: ['status'],
});
request('Staff confirm handover', 'POST', c + '/handover/staff-confirmation', {
  role: 'staff',
  write: true,
  key: true,
  body: { version: n('handoverVersion'), note: 'Staff xác nhận bàn giao tổng hợp' },
  fields: ['status'],
});
request('History handover', 'GET', c + '/handover/history', array);
request(
  'Tenant tải evidence được cấp quyền',
  'GET',
  c + '/handover/evidence/{{handoverEvidenceId}}',
  { role: 'tenant', format: 'binary' },
);
request('Tenant dispute - nhánh riêng', 'POST', c + '/handover/disputes', {
  role: 'tenant',
  write: true,
  gates: ['enableOptionalBranches'],
  key: true,
  body: { version: n('handoverVersion'), note: 'SYNTHETIC dispute - chạy trên fixture riêng' },
  fields: ['status'],
});

group(
  '06 - Billing Schedule và Invoice - BH21',
  'Owner lựa chọn đầy đủ chính sách tính tiền. Không mặc định ngày/rounding/partial month; các biến lịch ban đầu để trống. GET cập nhật version trước mutation.',
  'InvoicesController/BillingSchedulesController; InvoiceContracts; BF-05 / UC-20/21 / DBR-06/07 (approved Room/kỳ)',
);
request('GET calendar đang lưu', 'GET', '/api/v1/billing-schedules/{{locationId}}', {
  expected: [200, 204],
  saves: { billingScheduleVersion: 'version' },
  emptyDefaults: { billingScheduleVersion: 0 },
});
const calendar = {
  locationId: v('locationId'),
  rateDate: n('rateDateRule'),
  rentSource: n('rentSourceRule'),
  partialMonth: n('partialMonthRule'),
  rounding: n('roundingRule'),
  draftDay: n('draftDay'),
  draftMonthOffset: n('draftMonthOffset'),
  finalDay: n('finalDay'),
  finalMonthOffset: n('finalMonthOffset'),
  dueDay: n('dueDay'),
  dueMonthOffset: n('dueMonthOffset'),
  expectedVersion: n('billingScheduleVersion'),
};
request('Owner lưu calendar được chọn', 'PUT', '/api/v1/billing-schedules', {
  write: true,
  body: calendar,
  fields: ['version'],
  saves: { billingScheduleVersion: 'version' },
});
request(
  'Invoice Owner page theo Room',
  'GET',
  '/api/v1/invoices?roomId={{roomId}}&page=1&pageSize=20',
  page,
);
request('Tenant entitled invoice page', 'GET', '/api/v1/invoices?page=1&pageSize=20', {
  role: 'tenant',
  ...page,
});
request('Owner Generate Draft', 'POST', '/api/v1/invoices/drafts', {
  write: true,
  body: {
    roomId: v('roomId'),
    billingPeriod: v('billingPeriod'),
    representativeContractId: v('contractId'),
  },
  fields: ['id', 'status', 'missingInputs', 'lines'],
  saves: invoiceSave,
});
request('Owner xem invoice và missing inputs', 'GET', inv, {
  fields: ['status', 'missingInputs', 'lines', 'dueDate'],
  saves: invoiceSave,
});
request('Owner refresh Draft từ confirmed inputs', 'POST', inv + '/refresh', {
  write: true,
  body: { expectedVersion: n('invoiceVersion') },
  fields: ['missingInputs', 'lines'],
  saves: invoiceSave,
});
request('Owner Finalize đủ dữ liệu và đến lịch', 'POST', inv + '/finalize', {
  write: true,
  gates: ['enableFinancialWrites'],
  body: { expectedVersion: n('invoiceVersion') },
  fields: ['finalizedAt', 'lines'],
  equals: { status: 'Final' },
  saves: invoiceSave,
  invoiceSnapshot: true,
});
request('Lưu snapshot Final đang test', 'GET', inv, {
  requires: ['invoiceId'],
  fields: ['status', 'total', 'lines'],
  equals: { status: 'Final' },
  invoiceSnapshot: true,
  saves: invoiceSave,
});
request('Tenant A xem shared invoice', 'GET', inv, {
  role: 'tenant',
  fields: ['id', 'total', 'lines'],
  noPrivate: true,
});
request('CoTenant B xem cùng invoice', 'GET', inv, {
  role: 'coTenant',
  fields: ['id', 'total', 'lines'],
  noPrivate: true,
});
request(
  'Draft thiếu inputs không Final -> 409',
  'POST',
  '/api/v1/invoices/{{missingInputsInvoiceId}}/finalize',
  {
    write: true,
    gates: ['enableOptionalBranches'],
    body: { expectedVersion: n('missingInputsInvoiceVersion') },
    expected: [409],
    problemCode: 'confirmed_billing_inputs_required',
    description:
      'Chọn Draft thật thiếu confirmed readings/giá, đã đến ngày Final; không dùng invoice chính đã Final.',
  },
);
request('Final không refresh trực tiếp -> 409', 'POST', inv + '/refresh', {
  write: true,
  gates: ['enableOptionalBranches'],
  body: { expectedVersion: n('invoiceVersion') },
  expected: [409],
  problemCode: 'invoice_changed_or_final',
});

group(
  '07 - Payment và debt - BH25',
  'Chỉ manual statement verification đã triển khai; QR không làm Paid. Tạo/allocate demo có gate tài chính riêng. Giữ cùng key+payload khi replay; không sửa amount sau register.',
  'PaymentTransactionsController; DebtsController; ReceivingAccountsController; BF-06 / UC-22/23/25 / GBR-10/18',
);
request('Receiving account Owner', 'GET', '/api/v1/receiving-bank-accounts/{{locationId}}', {
  expected: [200, 204],
  saves: { receivingAccountVersion: 'version' },
  emptyDefaults: { receivingAccountVersion: 0 },
});
request('Owner cấu hình tài khoản tổng hợp Development', 'PUT', '/api/v1/receiving-bank-accounts', {
  write: true,
  gates: ['enableFinancialWrites'],
  body: {
    locationId: v('locationId'),
    bankIdentifier: v('syntheticBankIdentifier'),
    accountNumber: v('syntheticAccountNumber'),
    accountHolder: 'BHOME SYNTHETIC POSTMAN',
    enabled: true,
    isDevelopmentDemo: true,
    humanVerified: true,
    expectedVersion: n('receivingAccountVersion'),
  },
  fields: ['version', 'isDevelopmentDemo'],
  saves: { receivingAccountVersion: 'version' },
});
request('Transfer instructions từ dư nợ server', 'GET', inv + '/transfer-instructions', {
  role: 'tenant',
  fields: ['availability', 'outstandingAmount', 'transferReference'],
  saves: { transferReference: 'transferReference' },
});
request('Owner payment state trước phân bổ', 'GET', inv + '/payment', {
  fields: ['paymentStatus', 'payableAmount', 'paidAmount', 'outstandingAmount', 'history'],
  saves: { paymentAmount: 'outstandingAmount', transferReference: 'transferReference' },
});
request('Eligible payers của invoice', 'GET', inv + '/payment/eligible-payers', array);
const payment = {
  providerIdentity: 'SYNTHETIC-POSTMAN',
  bankReference: v('bankReference'),
  amount: v('paymentAmount'),
  currency: 'VND',
  occurredAt: v('paymentOccurredAt'),
  transferDescription: v('transferReference'),
  statementReference: 'POSTMAN_PRIVATE_STATEMENT_SYNTHETIC',
  verificationReason: 'SYNTHETIC MANUAL VERIFICATION ONLY - NO REAL MONEY',
  proposedInvoiceId: v('invoiceId'),
  humanVerified: true,
  isDevelopmentDemo: true,
};
request('Owner register verified statement', 'POST', '/api/v1/payment-transactions', {
  write: true,
  gates: ['enableFinancialWrites'],
  key: true,
  stableKey: 'paymentRegisterKey',
  body: payment,
  fields: ['id', 'status', 'amount'],
  saves: { paymentTransferId: 'id' },
});
const allocation = {
  invoiceId: v('invoiceId'),
  paidByUserId: v('tenantUserId'),
  humanVerified: true,
};
request(
  'Owner allocate exact verified transfer',
  'POST',
  '/api/v1/payment-transactions/{{paymentTransferId}}/allocate',
  {
    write: true,
    gates: ['enableFinancialWrites'],
    key: true,
    stableKey: 'paymentAllocateKey',
    body: allocation,
    fields: ['status', 'reason', 'invoiceId'],
    equals: { status: 'Allocated' },
  },
);
request(
  'Replay allocate cùng key và payload',
  'POST',
  '/api/v1/payment-transactions/{{paymentTransferId}}/allocate',
  {
    write: true,
    gates: ['enableFinancialWrites'],
    key: true,
    stableKey: 'paymentAllocateKey',
    body: allocation,
    equals: { status: 'Allocated' },
    description:
      'Không đổi invoiceId/paidByUserId so với lần đầu; server không tạo allocation thứ hai.',
  },
);
request('Owner payment state sau phân bổ', 'GET', inv + '/payment', {
  fields: ['history', 'paidAmount', 'outstandingAmount'],
  equals: { paymentStatus: 'Paid', outstandingAmount: '0' },
});
request('Tenant payment state - payer privacy', 'GET', inv + '/payment', {
  role: 'tenant',
  fields: ['paymentStatus', 'history'],
  noPrivate: true,
});
request('CoTenant payment state chung', 'GET', inv + '/payment', {
  role: 'coTenant',
  fields: ['paymentStatus', 'history'],
  noPrivate: true,
});
request('Owner transfers page', 'GET', '/api/v1/payment-transactions?page=1&pageSize=20', page);
request('Transfer detail', 'GET', '/api/v1/payment-transactions/{{paymentTransferId}}', {
  fields: ['status', 'amount', 'allocatedInvoiceId'],
});
request(
  'Reconciliation history',
  'GET',
  '/api/v1/payment-transactions/{{paymentTransferId}}/reconciliation-history?page=1&pageSize=20',
  page,
);
request(
  'Owner debt theo cơ sở',
  'GET',
  '/api/v1/debts?locationId={{locationId}}&page=1&pageSize=20',
  page,
);
request(
  'Staff debt operational DTO',
  'GET',
  '/api/v1/debts?locationId={{locationId}}&page=1&pageSize=20',
  { role: 'staff', ...page, noPrivate: true },
);
request('Tenant payment history', 'GET', '/api/v1/payment-history?page=1&pageSize=20', {
  role: 'tenant',
  ...page,
  noPrivate: true,
});
request(
  'Owner payment invoices',
  'GET',
  '/api/v1/payment-invoices?locationId={{locationId}}&page=1&pageSize=20',
  page,
);
request(
  'Reject unmatched transfer - fixture riêng',
  'POST',
  '/api/v1/payment-transactions/{{unmatchedTransferId}}/reject',
  {
    write: true,
    gates: ['enableFinancialWrites', 'enableOptionalBranches'],
    key: true,
    body: { reason: 'SYNTHETIC unmatched statement review' },
    fields: ['status'],
    equals: { status: 'Rejected' },
  },
);

group(
  '08 - Invoice Adjustment - BH41',
  'Requester Tenant hoặc Owner được phép đọc. CoTenant chỉ xem effective balance, không nội dung yêu cầu/evidence. Approve và Reject dùng request riêng.',
  'InvoiceAdjustmentsController; AdjustmentContracts; BF-06 / UC-24 / DBR-07 / GBR-10',
);
request('Tenant upload adjustment evidence', 'PUT', inv + '/adjustment-evidence', {
  role: 'tenant',
  write: true,
  binary: true,
  saves: { adjustmentEvidenceId: 'id' },
});
request('Tenant submit adjustment', 'POST', inv + '/adjustment-requests', {
  role: 'tenant',
  write: true,
  key: true,
  stableKey: 'adjustmentSubmitKey',
  body: {
    invoiceLineId: null,
    proposedAmount: v('proposedAmount'),
    reason: 'POSTMAN_PRIVATE_TENANT_REASON synthetic only',
    evidenceIds: j('evidenceIdsJson'),
    expectedInvoiceVersion: n('invoiceVersion'),
  },
  fields: ['id', 'status', 'version'],
  saves: { adjustmentId: 'id', adjustmentVersion: 'version' },
});
request(
  'Owner request queue',
  'GET',
  '/api/v1/invoice-adjustments?invoiceId={{invoiceId}}&page=1&pageSize=20',
  page,
);
const adjustmentSaves = {
  adjustmentVersion: 'version',
  adjustmentInvoiceVersion: 'currentInvoice.version',
  adjustmentFinancialVersion: 'currentFinancialVersion',
};
request(
  'Owner review - GET fresh financial versions',
  'GET',
  '/api/v1/invoice-adjustments/{{adjustmentId}}',
  { fields: ['status', 'currentInvoice', 'currentFinancialVersion'], saves: adjustmentSaves },
);
request('Requester own detail', 'GET', '/api/v1/invoice-adjustments/{{adjustmentId}}', {
  role: 'tenant',
  fields: ['reason', 'status'],
});
const decision = {
  expectedVersion: n('adjustmentVersion'),
  expectedInvoiceVersion: n('adjustmentInvoiceVersion'),
  expectedFinancialVersion: n('adjustmentFinancialVersion'),
  correctedAmount: v('correctedAmount'),
  chargeCode: null,
  reason: 'POSTMAN_PRIVATE_OWNER_DECISION synthetic',
  humanConfirmed: true,
};
request(
  'Owner approve adjustment',
  'POST',
  '/api/v1/invoice-adjustments/{{adjustmentId}}/approve',
  {
    write: true,
    gates: ['enableFinancialWrites'],
    key: true,
    stableKey: 'adjustmentDecisionKey',
    body: decision,
    fields: ['decision', 'financials'],
    equals: { status: 'Approved' },
  },
);
request(
  'Replay approve - nguyên body và key',
  'POST',
  '/api/v1/invoice-adjustments/{{adjustmentId}}/approve',
  {
    write: true,
    gates: ['enableFinancialWrites'],
    key: true,
    stableKey: 'adjustmentDecisionKey',
    body: decision,
    equals: { status: 'Approved' },
    description:
      'Không GET ghi đè version trước bước replay này; key/body phải nguyên như lần đầu.',
  },
);
request(
  'Effective adjustment effects - CoTenant được xem',
  'GET',
  inv + '/adjustments?page=1&pageSize=20',
  { role: 'coTenant', ...page, noPrivate: true },
);
request('Payment effective balance sau adjustment', 'GET', inv + '/payment', {
  role: 'tenant',
  fields: [
    'originalIssuedAmount',
    'approvedAdjustmentTotal',
    'payableAmount',
    'outstandingAmount',
    'potentialExcessAmount',
    'reviewStatus',
  ],
});
request('Final gốc bất biến sau thanh toán/điều chỉnh', 'GET', inv, {
  requires: ['originalFinalSnapshot'],
  compareFinal: true,
});
request(
  'Owner GET request nhánh Reject',
  'GET',
  '/api/v1/invoice-adjustments/{{rejectAdjustmentId}}',
  {
    gates: ['enableOptionalBranches'],
    saves: {
      rejectVersion: 'version',
      rejectInvoiceVersion: 'currentInvoice.version',
      rejectFinancialVersion: 'currentFinancialVersion',
    },
  },
);
request(
  'Owner Reject request riêng',
  'POST',
  '/api/v1/invoice-adjustments/{{rejectAdjustmentId}}/reject',
  {
    write: true,
    gates: ['enableOptionalBranches'],
    key: true,
    body: {
      expectedVersion: n('rejectVersion'),
      expectedInvoiceVersion: n('rejectInvoiceVersion'),
      expectedFinancialVersion: n('rejectFinancialVersion'),
      correctedAmount: null,
      chargeCode: null,
      reason: 'SYNTHETIC REJECTION - REVIEW COMPLETED',
      humanConfirmed: true,
    },
    equals: { status: 'Rejected' },
  },
);
request(
  'Requester download private evidence',
  'GET',
  '/api/v1/invoice-adjustments/{{adjustmentId}}/evidence/{{adjustmentEvidenceId}}',
  { role: 'tenant', format: 'binary' },
);

group(
  '09 - Renewal và move-out - BH40',
  'Chọn lifecycleContractId riêng. Renewal và termination là nhánh khác nhau; không Run cả folder trên cùng contract. Settlement lưu kết quả backend kể cả Pending; đóng chỉ khi thực sự Resolved.',
  'ContractsController; ContractContracts; ContractLifecycleService/FinalInspectionService; BF-04 / UC-19 / JOB-02',
);
request('Owner expiry reminders JOB02', 'GET', '/api/v1/contracts/expiry-reminders', array);
request('Tenant own expiry reminders', 'GET', '/api/v1/contracts/expiry-reminders', {
  role: 'tenant',
  ...array,
});
request('Contract vòng đời đã chọn', 'GET', life, { fields: ['id', 'status', 'endDate'] });
request('Owner tạo Renewal - nhánh riêng', 'POST', life + '/renewals', {
  write: true,
  gates: ['enableLifecycleActions', 'enableOptionalBranches'],
  key: true,
  body: {
    endDate: v('renewalEnd'),
    monthlyRent: v('monthlyRent'),
    terms: 'SYNTHETIC RENEWAL - sign and activate separately',
  },
  expected: [201],
  saves: { renewalContractId: 'id' },
  description:
    'Lưu renewalContractId; sau đó dùng làm contractId và chạy signing/readiness/activate ở folder 04. Không tự ký/cấp quyền provider.',
});
request('Version chain giữ lịch sử', 'GET', life + '/versions', array);
request(
  'Cancel Renewal chưa active - nhánh riêng',
  'POST',
  '/api/v1/contracts/{{renewalContractId}}/renewal-cancellation',
  {
    write: true,
    gates: ['enableLifecycleActions', 'enableOptionalBranches'],
    key: true,
    fields: ['status'],
  },
);
request('Tenant request termination', 'POST', life + '/termination-requests', {
  role: 'tenant',
  write: true,
  gates: ['enableLifecycleActions'],
  key: true,
  body: {
    proposedDate: v('moveOutDate'),
    reason: 'SYNTHETIC termination requested by test Tenant',
  },
  fields: ['status', 'version'],
  saves: { moveOutVersion: 'version' },
});
request('GET move-out state', 'GET', life + '/move-out', {
  fields: ['status', 'pendingReason', 'version'],
  saves: { moveOutVersion: 'version' },
});
request('Owner approve termination', 'POST', life + '/move-out/approve', {
  write: true,
  gates: ['enableLifecycleActions'],
  key: true,
  fields: ['status', 'version'],
  saves: { moveOutVersion: 'version' },
});
request('Owner schedule inspection + assignee', 'POST', life + '/move-out/schedule', {
  write: true,
  gates: ['enableLifecycleActions'],
  key: true,
  body: {
    scheduledAt: v('inspectionScheduledAt'),
    staffUserId: v('staffUserId'),
    expectedVersion: n('moveOutVersion'),
  },
  fields: ['inspectionStaffId', 'version'],
  saves: { moveOutVersion: 'version' },
});
request('Staff assigned move-outs', 'GET', '/api/v1/contracts/move-out-assignments', {
  role: 'staff',
  ...array,
});
request(
  'Staff inspection preparation - baseline và final readings',
  'GET',
  life + '/move-out/inspection-preparation',
  { role: 'staff', fields: ['baseline', 'finalReadings', 'otherTenantsRemain'] },
);
request('Staff upload inspection evidence', 'POST', life + '/move-out/evidence', {
  role: 'staff',
  write: true,
  binary: true,
  saves: { inspectionEvidenceId: 'id' },
});
request('Staff final inspection', 'POST', life + '/move-out/inspection', {
  role: 'staff',
  write: true,
  gates: ['enableLifecycleActions'],
  key: true,
  body: {
    electricityReadingId: v('finalElectricityReadingId'),
    waterReadingId: v('finalWaterReadingId'),
    notes: 'SYNTHETIC inspection based on confirmed readings',
    evidenceIds: [v('inspectionEvidenceId')],
    assets: j('inspectionAssetsJson'),
    roomCondition: 'Đã kiểm tra phòng tổng hợp',
    keysAndAccess: 'Đã đối chiếu khóa tổng hợp',
    expectedVersion: n('moveOutVersion'),
  },
  fields: ['status', 'version'],
  saves: { moveOutVersion: 'version' },
});
request('Inspections và Owner review status', 'GET', life + '/move-out/inspections', { ...array });
request(
  'Owner confirm inspection - version mới nhất',
  'POST',
  life + '/move-out/inspection-review',
  {
    write: true,
    gates: ['enableLifecycleActions'],
    key: true,
    body: {
      version: n('inspectionVersion'),
      confirmed: true,
      reason: 'SYNTHETIC inspection review by test Owner',
      noAdditionalCharges: b('confirmedInspectionNoCharges'),
    },
    fields: ['status', 'version'],
    saves: { moveOutVersion: 'version' },
  },
);
request(
  'Owner settlement summary - backend authoritative',
  'GET',
  life + '/move-out/settlement-summary',
  {
    fields: ['resolved', 'reference', 'unresolvedItems', 'otherActiveContracts'],
    saves: { settlementReference: 'reference', settlementResolved: 'resolved' },
  },
);
request('Tenant settlement summary', 'GET', life + '/move-out/settlement-summary', {
  role: 'tenant',
  fields: ['resolved', 'unresolvedItems'],
});
request('Owner record settlement review', 'POST', life + '/move-out/settlement', {
  write: true,
  gates: ['enableLifecycleActions', 'enableFinancialWrites'],
  key: true,
  body: {
    decision: 'SYNTHETIC Owner review; preserve unresolved obligations',
    expectedReference: v('settlementReference'),
  },
  fields: ['status', 'pendingReason'],
});
request('Settlement review history', 'GET', life + '/move-out/settlement-history', array);
request('Move-out history', 'GET', life + '/move-out/history', array);
request('Complete khi thật sự Resolved', 'POST', life + '/move-out/complete', {
  write: true,
  gates: ['enableLifecycleActions'],
  requires: ['settlementReference'],
  key: true,
  body: { actualEndDate: v('moveOutDate') },
  fields: ['status', 'actualEndDate'],
  equals: { status: 'Terminated' },
  description:
    'Chỉ Send khi GET summary Resolved=true, review khớp fingerprint. Còn nợ/cọc/refund/usage/dispute sẽ bị chặn; không coi 409 là pass của nhánh complete.',
});
request(
  'PendingSettlement không close - fixture còn blocker',
  'POST',
  '/api/v1/contracts/{{blockedLifecycleContractId}}/move-out/complete',
  {
    write: true,
    gates: ['enableOptionalBranches'],
    key: true,
    body: { actualEndDate: v('moveOutDate') },
    expected: [409],
    description:
      'Fixture riêng đã có review PendingSettlement. Endpoint không được làm Room vacant khi nghĩa vụ chưa xử lý.',
  },
);

group(
  '10 - Automation JOB09 JOB10',
  'Cấu hình Owner opt-in; không đoán ngày/kỳ. GET preview trước Run Now. Run Now chỉ Development/Testing và không bỏ qua điều kiện ngày/dữ liệu.',
  'BillingAutomationController; BillingAutomationContracts/Jobs; BF-05 / JOB-09/10 / GBR-18',
);
request(
  'Plan áp dụng cho kỳ',
  'GET',
  '/api/v1/billing-automation/{{locationId}}?period={{billingPeriod}}',
  { expected: [200, 204], saves: { automationPlanId: 'id' } },
);
request(
  'History - latest version trước save',
  'GET',
  '/api/v1/billing-automation/{{locationId}}/history',
  { ...array, saves: { automationVersion: '0.version' }, emptyDefaults: { automationVersion: 0 } },
);
request('Save plan với calendar version Owner chọn', 'PUT', '/api/v1/billing-automation', {
  write: true,
  body: {
    locationId: v('locationId'),
    effectiveFrom: v('automationEffectiveFrom'),
    enabled: b('automationEnabled'),
    authorizeAutomaticFinalization: b('authorizeAutomaticFinalization'),
    meterDay: n('meterDay'),
    meterDueDay: n('meterDueDay'),
    meterDueMonthOffset: n('meterDueMonthOffset'),
    timeZone: v('timeZone'),
    expectedVersion: n('automationVersion'),
    expectedBillingScheduleVersion: n('billingScheduleVersion'),
  },
  fields: ['id', 'version', 'billingScheduleVersion'],
  saves: { automationPlanId: 'id', automationVersion: 'version' },
});
request(
  'Preview thực tế - ngày VN và runtime flags',
  'GET',
  '/api/v1/billing-automation/preview?locationId={{locationId}}&period={{billingPeriod}}',
  {
    fields: ['developerActionsEnabled', 'workerEnabled', 'businessDate', 'phases', 'timeZone'],
    equals: { timeZone: 'Asia/Ho_Chi_Minh' },
  },
);
request(
  'Owner chọn representative trước invoice',
  'PUT',
  '/api/v1/billing-automation/representative',
  {
    write: true,
    body: {
      roomId: v('roomId'),
      billingPeriod: v('billingPeriod'),
      contractId: v('contractId'),
      expectedVersion: n('representativeVersion'),
    },
    fields: ['contractId', 'version'],
    saves: { representativeVersion: 'version' },
  },
);
request(
  'GET representative',
  'GET',
  '/api/v1/billing-automation/representative?roomId={{roomId}}&period={{billingPeriod}}',
  {
    expected: [200, 204],
    saves: { representativeVersion: 'version' },
    emptyDefaults: { representativeVersion: 0 },
  },
);
for (const phase of ['Meter', 'Draft', 'Final'])
  request('Run Now ' + phase, 'POST', '/api/v1/billing-automation/run-now', {
    write: true,
    gates: ['enableDevActions'],
    body: { locationId: v('locationId'), billingPeriod: v('billingPeriod'), phase },
    fields: ['phase', 'status', 'createdCount', 'existingCount', 'exceptionsJson'],
    equals: { phase },
    description:
      'Chọn kỳ đã đến lịch; 200 xác nhận đã xử lý, status có thể PendingInputs. Nếu muốn test chưa đến lịch dùng request riêng bên dưới.',
  });
request('Run future period không chạy sớm -> 204', 'POST', '/api/v1/billing-automation/run-now', {
  write: true,
  gates: ['enableDevActions', 'enableOptionalBranches'],
  body: { locationId: v('locationId'), billingPeriod: v('futureConfiguredPeriod'), phase: 'Meter' },
  expected: [204],
  description: 'Phải có plan Enabled cho kỳ tương lai này. Không dùng kỳ thiếu cấu hình (sẽ 409).',
});
request(
  'Executions theo kỳ',
  'GET',
  '/api/v1/billing-automation/executions?locationId={{locationId}}&period={{billingPeriod}}',
  array,
);
request(
  'Attempts và lỗi lịch sử',
  'GET',
  '/api/v1/billing-automation/attempts?locationId={{locationId}}&period={{billingPeriod}}',
  array,
);
request(
  'Queue - tên job/attempt/retry không payload',
  'GET',
  '/api/v1/billing-automation/queue?locationId={{locationId}}&period={{billingPeriod}}',
  { ...array, noPrivate: true },
);
request('Task IDs trước replay', 'GET', '/api/v1/capture/meter-tasks?roomId={{roomId}}&page=1', {
  ...array,
  listSnapshot: 'meterTaskIdsBeforeReplay',
});
request('Replay JOB09', 'POST', '/api/v1/billing-automation/run-now', {
  write: true,
  gates: ['enableDevActions'],
  body: { locationId: v('locationId'), billingPeriod: v('billingPeriod'), phase: 'Meter' },
  fields: ['status'],
});
request(
  'Task IDs sau replay giữ nguyên',
  'GET',
  '/api/v1/capture/meter-tasks?roomId={{roomId}}&page=1',
  {
    ...array,
    requires: ['meterTaskIdsBeforeReplay'],
    compareList: 'meterTaskIdsBeforeReplay',
    description:
      'Snapshot chỉ trang đầu; integration DB riêng mới chứng minh toàn bộ uniqueness/concurrency.',
  },
);
request(
  'Owner gán lại generated task',
  'POST',
  '/api/v1/billing-automation/meter-tasks/{{meterTaskId}}/assignment',
  {
    write: true,
    body: { staffUserId: v('staffUserId'), expectedVersion: n('meterTaskVersion') },
    expected: [204],
  },
);

group(
  '11 - Inbox và JOB04 delivery',
  'Không có endpoint giả gửi push/email thành công. process-events dùng event đã commit. Mỗi role có notificationId riêng, không dùng ID người khác.',
  'NotificationsController; NotificationDeliveryController; NotificationAutomationController; UC-35/36 / JOB-02/04 / GBR-01/02/18',
);
request(
  'Publish pending source events - Dev only',
  'POST',
  '/api/v1/notifications/process-events',
  { write: true, gates: ['enableDevActions'], fields: ['createdCount'] },
);
for (const role of ['owner', 'staff', 'tenant', 'coTenant']) {
  request(role + ' inbox', 'GET', '/api/v1/notifications?page=1&pageSize=20', {
    role,
    ...page,
    noPrivate: true,
  });
  request(role + ' unread count', 'GET', '/api/v1/notifications/unread-count', {
    role,
    fields: ['unreadCount'],
  });
  request(
    role + ' authorized target',
    'GET',
    '/api/v1/notifications/{{' + role + 'NotificationId}}/target',
    { role, fields: ['objectType', 'objectId'] },
  );
  request(
    role + ' mark read',
    'POST',
    '/api/v1/notifications/{{' + role + 'NotificationId}}/read',
    { role, write: true, expected: [204] },
  );
}
request(
  'Tenant filter Invoice chưa đọc',
  'GET',
  '/api/v1/notifications?category=Invoice&unread=true&page=1&pageSize=20',
  { role: 'tenant', ...page, noPrivate: true },
);
request('Tenant mark all read', 'POST', '/api/v1/notifications/read-all', {
  role: 'tenant',
  write: true,
  gates: ['enableOptionalBranches'],
  expected: [204],
});
request(
  'Owner delivery monitor - Unconfigured vẫn là thật',
  'GET',
  '/api/v1/notifications/delivery-status?locationId={{locationId}}&page=1&pageSize=20',
  {
    fields: ['enabled', 'configured', 'supportsIdempotency', 'maxAttempts', 'deliveries'],
    noPrivate: true,
  },
);
request('Inbox IDs trước process replay', 'GET', '/api/v1/notifications?page=1&pageSize=100', {
  role: 'tenant',
  ...page,
  listSnapshot: 'tenantInboxIdsBeforeReplay',
});
request('Replay publication consumer', 'POST', '/api/v1/notifications/process-events', {
  write: true,
  gates: ['enableDevActions'],
  fields: ['createdCount'],
});
request('Inbox IDs sau replay', 'GET', '/api/v1/notifications?page=1&pageSize=100', {
  role: 'tenant',
  ...page,
  requires: ['tenantInboxIdsBeforeReplay'],
  compareList: 'tenantInboxIdsBeforeReplay',
  description:
    'Chỉ đánh giá replay khi không có sự kiện mới/worker khác đang tạo notification trong khoảng snapshot.',
});

group(
  '12 - Task vận hành tích hợp',
  'API thực có, bổ sung cho phạm vi nền tảng trong báo cáo. Không dùng incident/work-order placeholders. Task priority dùng string, status DTO string.',
  'OperationalTasksController; TaskContracts; BF-02 / UC-10..12 / DBR-01',
);
request('Owner Task page', 'GET', '/api/v1/operational-tasks?page=1&pageSize=20', page);
request('Staff scoped Task page', 'GET', '/api/v1/operational-tasks?page=1&pageSize=20', {
  role: 'staff',
  ...page,
});
request('Owner create operational Task', 'POST', '/api/v1/operational-tasks', {
  write: true,
  key: true,
  body: {
    locationId: v('locationId'),
    work: {
      title: v('taskTitle'),
      requirements: 'Synthetic operational task',
      priority: 'Normal',
      dueAt: v('taskDueAt'),
      evidenceRequired: true,
    },
  },
  expected: [201],
  saves: taskSave,
});
request('Task detail fresh version', 'GET', '/api/v1/operational-tasks/{{operationalTaskId}}', {
  fields: ['version', 'status', 'currentResponsibleStaffUserId'],
  saves: taskSave,
});
for (const [action, role] of [
  ['assign', 'owner'],
  ['start', 'staff'],
  ['progress', 'staff'],
  ['blockers', 'staff'],
  ['coordinate', 'owner'],
])
  request(
    role + ' ' + action,
    'POST',
    '/api/v1/operational-tasks/{{operationalTaskId}}/' + action,
    {
      role,
      write: true,
      key: true,
      body: { version: n('operationalTaskVersion'), note: v('taskNote') },
      fields: ['status', 'version'],
      saves: taskSave,
    },
  );
request(
  'Staff upload Task evidence',
  'PUT',
  '/api/v1/operational-tasks/{{operationalTaskId}}/evidence',
  { role: 'staff', write: true, key: true, binary: true, saves: { operationalEvidenceId: 'id' } },
);
request(
  'Task detail sau upload - version mới',
  'GET',
  '/api/v1/operational-tasks/{{operationalTaskId}}',
  { saves: taskSave, fields: ['version'] },
);
request(
  'Staff submit Owner verification',
  'POST',
  '/api/v1/operational-tasks/{{operationalTaskId}}/submit',
  {
    role: 'staff',
    write: true,
    key: true,
    body: {
      version: n('operationalTaskVersion'),
      note: 'SYNTHETIC submitted evidence',
      evidenceIds: [v('operationalEvidenceId')],
    },
    equals: { status: 'PendingVerification' },
    saves: taskSave,
  },
);
request('Owner verify Task', 'POST', '/api/v1/operational-tasks/{{operationalTaskId}}/verify', {
  write: true,
  key: true,
  body: { version: n('operationalTaskVersion'), note: 'SYNTHETIC verified work' },
  equals: { status: 'Completed' },
  saves: taskSave,
});
request(
  'Task history',
  'GET',
  '/api/v1/operational-tasks/{{operationalTaskId}}/history?page=1&pageSize=20',
  page,
);
request(
  'Task evidence metadata',
  'GET',
  '/api/v1/operational-tasks/{{operationalTaskId}}/evidence',
  array,
);
request(
  'Staff legacy task notices',
  'GET',
  '/api/v1/operational-tasks/notifications?page=1&pageSize=20',
  { role: 'staff', ...page },
);

group(
  '13 - Negative quyền, IDOR và validation',
  'Không dùng token sai để suy ra server đã pass. HTTP được assert chính xác; outsider phải khác requester/coTenant. Các mutation sai role sẽ bị từ chối trước nghiệp vụ.',
  'Controllers + service guards hiện có; GBR-01/02/07/10/18; tests/backend/BHome.IntegrationTests',
);
for (const [name, role, method, route, expected] of [
  ['Staff không xem Invoice', 'staff', 'GET', '/api/v1/invoices', 403],
  ['Staff không xem full payment history', 'staff', 'GET', '/api/v1/payment-history', 403],
  ['Tenant không xem bank statement', 'tenant', 'GET', '/api/v1/payment-transactions', 403],
  ['Staff không review Adjustment', 'staff', 'GET', '/api/v1/invoice-adjustments', 403],
  [
    'Tenant không cấu hình calendar',
    'tenant',
    'GET',
    '/api/v1/billing-schedules/{{locationId}}',
    403,
  ],
  [
    'Staff không xem billing automation',
    'staff',
    'GET',
    '/api/v1/billing-automation/preview?locationId={{locationId}}&period={{billingPeriod}}',
    403,
  ],
  [
    'Tenant không xem delivery admin',
    'tenant',
    'GET',
    '/api/v1/notifications/delivery-status',
    403,
  ],
  [
    'Staff không đọc settlement finance',
    'staff',
    'GET',
    life + '/move-out/settlement-summary',
    403,
  ],
  [
    'Staff không chọn account Tenant',
    'staff',
    'GET',
    '/api/v1/contracts/preparation/accounts',
    403,
  ],
  ['Tenant không xem Capture', 'tenant', 'GET', '/api/v1/capture/locations', 403],
  ['Outsider không xem Invoice', 'outsider', 'GET', inv, 404],
  ['Outsider không xem Contract', 'outsider', 'GET', c, 404],
  [
    'CoTenant không xem private Adjustment',
    'coTenant',
    'GET',
    '/api/v1/invoice-adjustments/{{adjustmentId}}',
    404,
  ],
  [
    'CoTenant không tải private Adjustment evidence',
    'coTenant',
    'GET',
    '/api/v1/invoice-adjustments/{{adjustmentId}}/evidence/{{adjustmentEvidenceId}}',
    404,
  ],
  [
    'Tenant không xem notification người khác',
    'tenant',
    'GET',
    '/api/v1/notifications/{{ownerNotificationId}}/target',
    404,
  ],
  [
    'Tenant không mark notification người khác',
    'tenant',
    'POST',
    '/api/v1/notifications/{{ownerNotificationId}}/read',
    404,
  ],
  [
    'Staff ngoài scope không đọc meter task',
    'otherStaff',
    'GET',
    '/api/v1/capture/meter-tasks/{{meterTaskId}}',
    404,
  ],
])
  request(name, method, route, { role, expected: [expected] });
request('Staff không activate Contract', 'POST', c + '/activate', {
  role: 'staff',
  key: true,
  expected: [403],
});
request('Staff không signing', 'POST', c + '/signing', {
  role: 'staff',
  key: true,
  body: { certificateId: '00000000-0000-0000-0000-000000000000' },
  expected: [403],
});
request('Staff không Finalize', 'POST', inv + '/finalize', {
  role: 'staff',
  body: { expectedVersion: 1 },
  expected: [403],
});
request(
  'Tenant không approve adjustment',
  'POST',
  '/api/v1/invoice-adjustments/{{adjustmentId}}/approve',
  {
    role: 'tenant',
    key: true,
    body: {
      expectedVersion: 1,
      expectedInvoiceVersion: 1,
      expectedFinancialVersion: 0,
      correctedAmount: '0',
      chargeCode: null,
      reason: 'MUST BE DENIED',
      humanConfirmed: true,
    },
    expected: [403],
  },
);
request('Tenant không publish events', 'POST', '/api/v1/notifications/process-events', {
  role: 'tenant',
  expected: [403],
});
request('Invoice invalid page -> 400', 'GET', '/api/v1/invoices?page=0&pageSize=20', {
  expected: [400],
});
request('Inbox invalid category -> 400', 'GET', '/api/v1/notifications?category=PRIVATE_BANK', {
  role: 'tenant',
  expected: [400],
  problemCode: 'invalid_notification_query',
});
request('Meter invalid filter -> 400', 'GET', '/api/v1/capture/meter-tasks?page=0', {
  role: 'staff',
  expected: [400],
  problemCode: 'invalid_meter_task_filter',
});
request('Contract không tồn tại -> 404', 'GET', '/api/v1/contracts/{{missingId}}', {
  expected: [404],
});
request('Tạo Contract thiếu Idempotency-Key -> 400', 'POST', '/api/v1/contracts', {
  write: true,
  gates: ['enableOptionalBranches'],
  body: {
    roomId: v('roomId'),
    ownerSignerId: v('ownerUserId'),
    tenantUserId: v('tenantUserId'),
    representativeResidentId: v('residentId'),
    residentIds: [v('residentId')],
    startDate: v('contractStart'),
    endDate: v('contractEnd'),
    monthlyRent: v('monthlyRent'),
    requiredDeposit: v('requiredDeposit'),
    terms: 'Synthetic must be rejected without idempotency key',
  },
  expected: [400],
  problemCode: 'idempotency_key_required',
});

group(
  '14 - Auth refresh/logout riêng cuối lượt',
  'Chỉ chạy riêng cuối lượt. Refresh rotation ghi đè token runtime; logout-all/change-password không đặt vào collection này để tránh phá các phiên test khác.',
  'AuthController; API_CONVENTIONS.md; UC-01/02 / GBR-01',
);
request('Owner rotate refresh token', 'POST', '/api/v1/auth/refresh', {
  role: null,
  gates: ['enableAuthCleanup'],
  requires: ['ownerRefreshToken'],
  body: { refreshToken: v('ownerRefreshToken') },
  login: { prefix: 'owner', role: 'Owner' },
});
request('Owner logout current session', 'POST', '/api/v1/auth/logout', {
  gates: ['enableAuthCleanup'],
  expected: [204],
});
request('JWT sau logout -> 401', 'GET', '/api/v1/auth/me', {
  gates: ['enableAuthCleanup'],
  expected: [401],
});

// Register every runtime save/require so the environment has no unexplained unresolved variables.
for (const f of folders)
  for (const item of f.item) {
    const line = item.event[0].script.exec[0];
    const spec = JSON.parse(JSON.parse(line.slice(line.indexOf(', ') + 2, -2)));
    for (const key of [
      ...spec.requires,
      ...Object.keys(spec.saves || {}),
      ...(spec.listSnapshot ? [spec.listSnapshot] : []),
    ])
      variable(key);
  }
for (const [key, value] of Object.entries({
  readingPurpose: '0',
  taskBillingPeriodJson: 'null',
  taskContractIdJson: 'null',
  meterTaskStatus: '0',
  inspectionAssetsJson: '[]',
})) {
  variable(key, value);
  if (vars.get(key).value === '') vars.get(key).value = value;
}
const rootPre = String.raw`(function () {
  const base=String(pm.variables.get('baseUrl')||'').replace(/\/$/,'');
  const match=/^(https?):\/\/([^/]+)$/i.exec(base);
  if(!match||/@/.test(base))throw new Error('baseUrl phải là URL gốc không path/query/userinfo');
  const local=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(match[2]);
  if(!local && String(pm.variables.get('allowRemoteRequests'))!=='true')throw new Error('Đích ngoài loopback: cấu hình allowRemoteRequests=true sau khi chọn môi trường test được phép');
  if(!local && match[1]!=='https')throw new Error('Môi trường ngoài loopback cần HTTPS');
  if(!pm.environment.get('baseUrl'))throw new Error('Chọn Environment BHOME - Nguyễn Quốc Huy trước khi Send');
  pm.variables.set('baseUrl', base + '/');
})();`;
// One shared pre-request/test implementation; dispatch immutable request specs by their unique names.
// Avoid copying the same assertion program into every saved request.
const requestSpecs = {};
for (const f of folders)
  for (const item of f.item) {
    const line = item.event[0].script.exec[0];
    requestSpecs[item.name] = JSON.parse(JSON.parse(line.slice(line.indexOf(', ') + 2, -2)));
    delete item.event;
  }
const dispatch =
  'const requestSpecs = ' +
  JSON.stringify(requestSpecs) +
  ';\n' +
  rootPre +
  '\n' +
  'if (!requestSpecs[pm.info.requestName]) throw new Error("Tên request đã đổi; regenerate collection để đồng bộ spec");\n' +
  'pm.variables.set("__requestSpec", JSON.stringify(requestSpecs[pm.info.requestName]));\n(' +
  prepareRequest.toString() +
  ')();';
const collection = {
  info: {
    _postman_id: 'ce48500a-8646-426d-934a-38524ec686d3',
    name: 'BHOME - Nguyễn Quốc Huy - API đã triển khai',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description:
      'Đối chiếu source thực tế và báo cáo Nguyễn Quốc Huy 02/11/2026. Auth/Scope/Capture/Contract/Handover/Invoice/Payment/Adjustment/Renewal/Move-out/Jobs/Inbox. Import Environment cùng tên. Xem NGUYEN_QUOC_HUY_POSTMAN_GUIDE.md. Mặc định bỏ qua mutation, thiếu credentials/IDs sẽ SKIP chứ không PASS. Chỉ dùng dữ liệu synthetic trong môi trường test. Không có Holding completion, provider webhook hoặc VNeID giả. Các flags enable* là tiện ích test, không thay quyền backend. Không Run toàn bộ các nhánh lifecycle khi chưa đọc hướng dẫn. Scripts dùng chung ở cấp Collection; giữ nguyên tên request hoặc regenerate khi sửa.',
  },
  event: [event('prerequest', dispatch), event('test', '(' + verifyResponse.toString() + ')();')],
  item: folders,
};
const environment = {
  id: '5c8b6a8c-f508-493c-83a7-c4492f45c097',
  name: 'BHOME - Nguyễn Quốc Huy - Local',
  values: [...vars.values()],
  _postman_variable_scope: 'environment',
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, stem + '.postman_collection.json'),
  JSON.stringify(collection, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(out, stem + '.Local.postman_environment.json'),
  JSON.stringify(environment, null, 2) + '\n',
);
// A plainly synthetic 320x120 meter fixture: white background, black block digits, no identity image.
function crc(bytes) {
  let x = 0xffffffff;
  for (const byte of bytes) {
    x ^= byte;
    for (let i = 0; i < 8; i++) x = (x >>> 1) ^ (x & 1 ? 0xedb88320 : 0);
  }
  return (x ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, sum]);
}
const width = 320,
  height = 120,
  pixels = Buffer.alloc((width * 3 + 1) * height, 255);
for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0;
const digits = ['111101101101111', '010110010010111', '111001111100111'];
digits.forEach((digit, index) => {
  for (let yy = 0; yy < 5; yy++)
    for (let xx = 0; xx < 3; xx++)
      if (digit[yy * 3 + xx] === '1')
        for (let y = 0; y < 14; y++)
          for (let x = 0; x < 14; x++) {
            const p =
              (25 + yy * 14 + y) * (width * 3 + 1) + 1 + (60 + index * 65 + xx * 14 + x) * 3;
            pixels.fill(0, p, p + 3);
          }
});
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;
fs.mkdirSync(path.join(out, 'fixtures'), { recursive: true });
fs.writeFileSync(
  path.join(out, 'fixtures/synthetic-meter.png'),
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk(
      'tEXt',
      Buffer.from('Description\0BHOME SYNTHETIC POSTMAN FIXTURE - NOT A REAL METER PHOTO'),
    ),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
const summary = {
  requests: folders.reduce((count, f) => count + f.item.length, 0),
  folders: folders.map((f) => ({ name: f.name, requests: f.item.length })),
  variables: vars.size,
  collectionSha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(out, stem + '.postman_collection.json')))
    .digest('hex'),
};
fs.writeFileSync(
  path.join(out, 'BHome.NguyenQuocHuy.coverage.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(
  `Generated ${summary.requests} requests in ${folders.length} folders; ${vars.size} empty/runtime-configurable variables. No real secrets included.`,
);
