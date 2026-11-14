// Offline validation only: no API requests, credentials, or database mutations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const folder = path.join(root, 'docs/testing/postman');
const read = (name) => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const collection = read('BHome.Simple.postman_collection.json');
const environment = read('BHome.Local.postman_environment.json');
const api = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
const values = new Map(environment.values.map((v) => [v.key, v.value]));
const local = new Map();
assert.equal(values.size, environment.values.length, 'Duplicate environment key');
assert.equal(
  collection.info.schema,
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
);
for (const value of environment.values) {
  if (
    value.type === 'secret' ||
    /password|accessToken|refreshToken|clientSecret|pushToken/i.test(value.key)
  )
    assert.equal(value.value, '', 'Credentials must be blank: ' + value.key);
}
function* walk(items) {
  for (const item of items || []) {
    if (item.request) yield item;
    if (item.item) yield* walk(item.item);
  }
}
function compile(item) {
  for (const event of item.event || []) new vm.Script(event.script.exec.join('\n'));
  for (const child of item.item || []) compile(child);
}
compile(collection);
assert.equal(collection.item.length, 20, 'Health + 19 business folders');
assert.ok(collection.item.every((g) => g.item && !g.request));
const entries = [...walk(collection.item)];
const routes = new Map();
const report = fs.readFileSync(
  path.join(root, 'docs/reports/BHOME_BE_BUSINESS_FLOW_API_COVERAGE_2026-11-09.md'),
  'utf8',
);
const expected = new Set(
  [...report.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE) ([^`]+)`/gm)].map(
    (m) => m[1] + ' ' + m[2].replace(/:[^}]+/g, ''),
  ),
);
const rawUrl = (r) => (typeof r.url === 'string' ? r.url : r.url.raw);
const normalize = (r) =>
  r.method +
  ' ' +
  rawUrl(r)
    .replace(/^\{\{baseUrl\}\}/, '')
    .split('?')[0]
    .replace(/\{\{[^}]+\}\}/g, '{}');
const normalizedExpected = new Set([...expected].map((x) => x.replace(/\{[^}]+\}/g, '{}')));
const schemes = api?.components?.schemas || {};
function resolve(s) {
  if (s.$ref)
    return {
      ...schemes[s.$ref.split('/').at(-1)],
      ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$ref')),
    };
  if (s.allOf)
    return Object.assign(
      {},
      ...s.allOf.map(resolve),
      Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'allOf')),
    );
  return s;
}
function validateData(data, original, label) {
  const s = resolve(original);
  if (data === null) {
    assert.ok(s.nullable || !s.type, label + ': null');
    return;
  }
  if (s.enum) assert.ok(s.enum.includes(data), label + ': enum');
  if (s.type === 'object' || s.properties) {
    assert.equal(typeof data, 'object', label);
    assert.ok(!Array.isArray(data), label);
    for (const k of s.required || []) assert.ok(k in data, label + ': required ' + k);
    for (const [k, v] of Object.entries(data)) {
      if (s.additionalProperties === false)
        assert.ok(k in (s.properties || {}), label + ': unknown field ' + k);
      if (s.properties?.[k]) validateData(v, s.properties[k], label + '.' + k);
    }
  } else if (s.type === 'array') {
    assert.ok(Array.isArray(data), label);
    for (const x of data) validateData(x, s.items, label + '[]');
  } else if (s.type === 'integer' || s.type === 'number') {
    assert.equal(typeof data, 'number', label + ': number');
    if (s.type === 'integer') assert.ok(Number.isInteger(data), label);
  } else if (s.type === 'boolean') assert.equal(typeof data, 'boolean', label);
  else if (s.type === 'string') assert.equal(typeof data, 'string', label);
}
function substituted(raw) {
  // Concrete local values plus dummy placeholders are only for syntax/type checks, never sent.
  return raw.replace(/\{\{([^}]+)\}\}/g, (_all, key) => {
    assert.ok(values.has(key), 'Undefined variable: ' + key);
    return (
      values.get(key) || (/version$/i.test(key) ? '0' : '00000000-0000-4000-8000-000000000001')
    );
  });
}
let bodyCount = 0;
let binaryCount = 0;
for (const item of entries) {
  const r = item.request;
  const key = normalize(r);
  routes.set(key, (routes.get(key) || 0) + 1);
  for (const match of JSON.stringify(r).matchAll(/\{\{([^}]+)\}\}/g))
    assert.ok(
      values.has(match[1]) || match[1] === 'requestIdempotencyKey',
      item.name + ': unknown variable ' + match[1],
    );
  const url = rawUrl(r)
    .replace(/^\{\{baseUrl\}\}/, '')
    .split('?')[0];
  const pathEntry =
    api &&
    Object.entries(api.paths).find(
      ([p]) => p.replace(/\{[^}]+\}/g, '{}') === url.replace(/\{\{[^}]+\}\}/g, '{}'),
    );
  const op = pathEntry?.[1][r.method.toLowerCase()];
  if (api && !url.startsWith('/health/') && !url.startsWith('/development/'))
    assert.ok(op, item.name + ': missing OpenAPI route');
  if (r.body?.mode === 'raw') {
    const body = JSON.parse(substituted(r.body.raw));
    bodyCount++;
    if (api) validateData(body, op.requestBody.content['application/json'].schema, item.name);
  }
  if (r.body?.mode === 'file') {
    binaryCount++;
    assert.ok(
      r.header.some((h) => h.key.toLowerCase() === 'content-type' && h.value.startsWith('image/')),
      item.name,
    );
    assert.equal(r.body.file.src, '', 'Must choose local upload file explicitly');
  }
  if (r.body?.mode === 'formdata') {
    assert.ok(
      !r.header.some((h) => h.key.toLowerCase() === 'content-type'),
      'Let Postman set multipart boundary',
    );
    if (api) {
      const s = resolve(op.requestBody.content['multipart/form-data'].schema);
      for (const field of r.body.formdata)
        assert.ok(field.key in s.properties, item.name + ': invalid form field');
      for (const k of s.required || [])
        assert.ok(
          r.body.formdata.some((x) => x.key === k),
          item.name + ': missing form field ' + k,
        );
    }
  }
  if (r.method === 'GET') assert.ok(!r.body, 'GET body: ' + item.name);
}
assert.equal(entries.length, 376);
for (const key of normalizedExpected) assert.ok(routes.has(key), 'Missing route: ' + key);
for (const [key, count] of routes) {
  assert.ok(
    normalizedExpected.has(key) || /^GET \/health\/(live|ready)$/.test(key),
    'Unexpected route ' + key,
  );
  assert.equal(count, key === 'POST /api/v1/auth/login' ? 3 : 1, 'Unexpected duplicate: ' + key);
}
// Exercise success/failure captures with synthetic responses. No provider/DB involved.
function execute(item, data, status = 200) {
  const store = {
    get: (k) => values.get(k),
    set: (k, v) => values.set(k, v),
    unset: (k) => values.delete(k),
  };
  const expect = (value) => ({
    to: {
      be: {
        below: (n) => assert.ok(value < n),
        within: (a, b) => assert.ok(value >= a && value <= b),
      },
    },
  });
  const pm = {
    environment: store,
    response: { code: status, json: () => data },
    expect,
    test: (_n, fn) => {
      try {
        fn();
      } catch (e) {
        if (status < 400) throw e;
      }
    },
  };
  for (const event of item.event || [])
    if (event.listen === 'test') vm.runInNewContext(event.script.exec.join('\n'), { pm });
}
const find = (method, suffix) =>
  entries.find(
    (x) => x.request.method === method && rawUrl(x.request).split('?')[0].endsWith(suffix),
  );
for (const role of ['owner', 'staff', 'tenant']) {
  const login = entries.find((x) => x.name === role.toUpperCase() + ' — Đăng nhập và lưu token');
  execute(login, {
    userId: role + '-user',
    sessionId: role + '-session',
    accessToken: role + '-token',
    refreshToken: role + '-refresh',
  });
  assert.equal(values.get(role + 'AccessToken'), role + '-token');
}
execute(find('POST', '/api/v1/locations'), { id: 'location-test', version: 1 });
assert.equal(values.get('locationId'), 'location-test');
execute(find('POST', '/api/v1/staff-location-assignments'), { id: 'assignment-test' });
assert.equal(values.has('locationVersion'), false);
execute(find('GET', '/api/v1/locations/{{locationId}}'), { id: 'location-test', version: 2 });
assert.equal(values.get('locationVersion'), 2);
execute(find('POST', '/api/v1/contracts/main-drafts/{{mainDraftId}}/release'), {
  id: 'released-contract',
});
assert.equal(values.get('contractId'), 'released-contract');
execute(find('POST', '/api/v1/payment-transactions'), { transferId: 'transfer-test' });
assert.equal(values.get('paymentId'), 'transfer-test');
execute(find('POST', '/api/v1/locations'), { id: 'must-not-save', version: 999 }, 400);
assert.equal(values.get('locationId'), 'location-test');
// Validate collection pre-request missing-variable guard and replay/new key behavior.
const pre = collection.event.find((x) => x.listen === 'prerequest').script.exec.join('\n');
const req = {
  url: { toString: () => '{{baseUrl}}/api/v1/locations' },
  headers: { all: () => [] },
  body: null,
};
const runPre = () =>
  vm.runInNewContext(pre, {
    pm: {
      environment: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
      variables: {
        get: (k) => local.get(k) ?? values.get(k),
        set: (k, v) => local.set(k, v),
        replaceIn: () => 'fresh-key',
      },
      request: req,
    },
  });
values.set('idempotencyKey', '');
runPre();
assert.equal(local.get('requestIdempotencyKey'), 'fresh-key');
values.set('idempotencyKey', 'fixed-key');
runPre();
assert.equal(local.get('requestIdempotencyKey'), 'fixed-key');
req.url.toString = () => '{{baseUrl}}/api/v1/contracts/{{missingContractId}}';
assert.throws(runPre, /missingContractId/);
console.log(
  `PASS: ${expected.size} API routes + 2 extra role logins + 2 health = ${entries.length} requests; ${collection.item.length} folders.`,
);
console.log(
  `PASS: ${bodyCount} JSON bodies${api ? ' checked against OpenAPI types/fields' : ''}; ${binaryCount} binary uploads; all scripts compile; unique variables and empty secrets.`,
);
console.log(
  'PASS: token isolation, ID/version capture, assignment invalidation, failed-response guard, idempotency new/replay keys, missing-variable guard. No HTTP requests sent.',
);
