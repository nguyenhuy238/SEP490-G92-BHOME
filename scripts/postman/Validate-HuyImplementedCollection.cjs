// Offline contract/script checks plus optional real Newman smoke. Dependencies stay in ignored .tools.
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'),
  dir = path.join(root, 'docs/testing/postman');
const requireTool = (name) =>
  require(require.resolve(name, { paths: [path.join(root, '.tools/postman-validation'), root] }));
const Ajv = requireTool('ajv'),
  addFormats = requireTool('ajv-formats'),
  chai = requireTool('chai');
const collection = JSON.parse(
  fs.readFileSync(
    path.join(dir, 'BHome.NguyenQuocHuy.Implemented.postman_collection.json'),
    'utf8',
  ),
);
const environment = JSON.parse(
  fs.readFileSync(
    path.join(dir, 'BHome.NguyenQuocHuy.Implemented.Local.postman_environment.json'),
    'utf8',
  ),
);
const schemaFile = path.join(root, '.tools/postman-validation/collection-v2.1.schema.json');
let checks = 0;
function check(label, work) {
  work();
  checks++;
  console.log('PASS ' + label);
}
if (fs.existsSync(schemaFile))
  check('official Postman collection v2.1 JSON schema', () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
    assert.ok(validate(collection), JSON.stringify(validate.errors));
  });
else
  throw Error(
    'Download official schema to .tools/postman-validation/collection-v2.1.schema.json first.',
  );
const requests = collection.item.flatMap((folder) => folder.item);
const specLine = collection.event.find((x) => x.listen === 'prerequest').script.exec[0];
const specs = JSON.parse(specLine.slice('const requestSpecs = '.length, -1));
check('all secret templates are empty; writes and optional branches default off', () => {
  assert.equal(new Set(environment.values.map((x) => x.key)).size, environment.values.length);
  for (const value of environment.values) {
    if (value.type === 'secret') assert.equal(value.value, '');
    if (value.key.startsWith('enable') || value.key === 'allowRemoteRequests')
      assert.equal(value.value, 'false');
  }
  assert.equal(
    environment.values.find((x) => x.key === 'baseUrl').value,
    'https://localhost:7240/',
  );
});
check('every request has status assertions, explicit auth and valid scripts', () => {
  const names = new Set();
  for (const event of collection.event) new vm.Script(event.script.exec.join('\n'));
  for (const item of requests) {
    assert.ok(!names.has(item.name), 'Duplicate request name ' + item.name);
    names.add(item.name);
    assert.ok(item.request.auth);
    assert.equal(item.protocolProfileBehavior.disableCookies, true);
    for (const kind of ['test', 'prerequest']) {
      const event = collection.event.find((x) => x.listen === kind);
      assert.ok(event);
      new vm.Script(event.script.exec.join('\n'));
    }
    assert.ok(specs[item.name]);
  }
});
// Derive route templates from the actual C# controller attributes, including absolute routes.
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((x) => (x.isDirectory() ? files(path.join(dir, x.name)) : [path.join(dir, x.name)]));
}
const routes = [];
for (const file of files(path.join(root, 'src/backend/BHome.Api/Controllers')).filter((x) =>
  x.endsWith('.cs'),
)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const block of text.split(/(?=\[ApiController)/).slice(1)) {
    const base = /\bRoute\("([^"]+)"\)/.exec(block)?.[1];
    if (!base) continue;
    for (const match of block.matchAll(/\[Http(Get|Post|Put|Delete|Patch)(?:\("([^"]*)"\))?/g)) {
      const suffix = match[2] || '';
      const route = suffix.startsWith('/') ? suffix : '/' + base + (suffix ? '/' + suffix : '');
      routes.push({
        method: match[1].toUpperCase(),
        pattern: new RegExp(
          '^' +
            route
              .replace(/\{[^}]+\}/g, '___PARAM___')
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replaceAll('___PARAM___', '[^/]+') +
            '$',
        ),
      });
    }
  }
}
check('all request method/path pairs exist in current C# routes', () => {
  for (const item of requests) {
    const route = item.request.url
      .replace('{{baseUrl}}', '/')
      .split('?')[0]
      .replace(/\{\{[^}]+\}\}/g, 'parameter');
    if (['/health/live', '/health/ready'].includes(route)) {
      assert.ok(
        fs
          .readFileSync(path.join(root, 'src/backend/BHome.Api/Program.cs'), 'utf8')
          .includes('"' + route + '"'),
      );
      continue;
    }
    assert.ok(
      routes.some((x) => x.method === item.request.method && x.pattern.test(route)),
      item.request.method + ' ' + route + ' (' + item.name + ')',
    );
  }
});
const baseValues = new Map(environment.values.map((x) => [x.key, x.value]));
function context(item, overrides = {}, response = null) {
  const env = new Map(baseValues),
    local = new Map();
  for (const [k, v] of Object.entries(overrides)) env.set(k, v);
  let skipped = false;
  const failures = [];
  const get = (k) => (local.has(k) ? local.get(k) : env.get(k));
  const pm = {
    info: { requestName: item.name },
    request: {
      body: item.request.body && {
        ...item.request.body,
        update(value) {
          this.raw = value;
        },
      },
    },
    execution: {
      skipRequest: () => {
        skipped = true;
        throw new Error('__SKIP__');
      },
    },
    environment: {
      get: (k) => env.get(k),
      set: (k, v) => env.set(k, v),
      unset: (k) => env.delete(k),
    },
    variables: {
      get,
      set: (k, v) => local.set(k, v),
      replaceIn: (text) =>
        text.replace(/\{\{([^}]+)\}\}/g, (_, key) =>
          key === '$guid' ? '10000000-0000-4000-8000-000000000001' : String(get(key) ?? ''),
        ),
    },
    expect: chai.expect,
    test: (name, fn) => {
      try {
        fn();
      } catch (e) {
        failures.push(name + ': ' + e.message);
      }
    },
    response: response && {
      code: response.code,
      json: () => response.body,
      text: () =>
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
      headers: {
        get: (k) => ({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json' })[k],
      },
      size: () => ({ body: 100 }),
    },
  };
  const sandbox = vm.createContext({ pm, console: { info: () => {} } });
  function run(kind) {
    for (const event of [...collection.event, ...(item.event || [])].filter(
      (x) => x.listen === kind,
    )) {
      try {
        new vm.Script(event.script.exec.join('\n')).runInContext(sandbox);
      } catch (error) {
        if (error.message === '__SKIP__') return;
        throw error;
      }
    }
  }
  return {
    env,
    local,
    get,
    body: () => pm.request.body?.raw,
    failures,
    run,
    get skipped() {
      return skipped;
    },
  };
}
const byName = (text) => {
  const item = requests.find((x) => x.name.includes(text));
  assert.ok(item, 'Unknown request ' + text);
  return item;
};
function spec(item) {
  return specs[item.name];
}
function fill(item) {
  const s = spec(item),
    data = {};
  for (const key of s.requires) data[key] = 'synthetic';
  for (const match of (item.request.body?.raw || '').matchAll(/\{\{([^}]+)\}\}/g))
    if (!baseValues.get(match[1])) data[match[1]] = 'synthetic';
  for (const key of s.gates) data[key] = 'true';
  function walk(value) {
    if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) {
        if (k === '$number') data[v] = '1';
        else if (k === '$boolean') data[v] = 'true';
        else if (k === '$json') data[v] = '[]';
        else walk(v);
      }
  }
  walk(s.body);
  return data;
}
check('every declared variable exists in the environment', () => {
  for (const item of requests) {
    const s = spec(item);
    for (const key of [...s.requires, ...s.gates, ...Object.keys(s.saves || {})])
      assert.ok(baseValues.has(key), key);
    for (const match of JSON.stringify(item.request).matchAll(/\{\{([^}]+)\}\}/g))
      assert.ok(baseValues.has(match[1]) || match[1] === 'commandKey', match[1]);
  }
});
check('all JSON bodies are visible templates; upload bodies stay binary', () => {
  for (const item of requests) {
    if (spec(item).body !== undefined) {
      assert.equal(item.request.body.mode, 'raw');
      assert.ok(item.request.body.raw.trim().startsWith('{'), item.name);
      assert.ok(!item.request.body.raw.includes('huyRequestBody'), item.name);
    }
    if (item.request.body?.mode === 'file')
      assert.equal(item.request.body.file.src, 'fixtures/synthetic-meter.png');
    assert.ok(!item.request.url.startsWith('{{baseUrl}}/'), item.name);
  }
});
check('245 pre-request scripts resolve into valid JSON with no placeholders', () => {
  for (const item of requests) {
    const ctx = context(item, fill(item));
    ctx.run('prerequest');
    assert.equal(ctx.skipped, false, item.name);
    const body = ctx.body();
    if (spec(item).body !== undefined) {
      assert.ok(body);
      JSON.parse(body);
      assert.ok(!body.includes('{{'), item.name);
    }
  }
});
check('credentials containing quotes/backslashes are JSON-escaped correctly', () => {
  const item = byName('Đăng nhập owner'),
    password = 'Synthetic!Quote"Backslash\\123';
  const ctx = context(item, { ownerEmail: 'owner@example.invalid', ownerPassword: password });
  ctx.run('prerequest');
  assert.equal(JSON.parse(ctx.body()).password, password);
});
check('editing the visible Body changes the actual payload without hidden spec overrides', () => {
  const item = JSON.parse(JSON.stringify(byName('Tạo Room test')));
  item.request.body.raw = '{"locationId":"{{locationId}}","capacity":7,"note":"{{taskNote}}"}';
  const ctx = context(item, {
    ...fill(item),
    taskNote: 'Synthetic "edited" \\ note',
    enableWrites: 'true',
  });
  ctx.run('prerequest');
  assert.equal(ctx.skipped, false);
  assert.deepEqual(JSON.parse(ctx.body()), {
    locationId: ctx.get('locationId'),
    capacity: 7,
    note: 'Synthetic "edited" \\ note',
  });
});
check('raw variables retain JSON number/boolean/null/array types and reject malformed JSON', () => {
  const item = JSON.parse(JSON.stringify(byName('Tạo Room test')));
  item.request.body.raw =
    '{"capacity":{{roomCapacity}},"enabled":{{automationEnabled}},"ids":{{evidenceIdsJson}},"period":{{taskBillingPeriodJson}}}';
  const values = {
    ...fill(item),
    roomCapacity: '3',
    automationEnabled: 'false',
    evidenceIdsJson: '["synthetic-id"]',
    taskBillingPeriodJson: 'null',
  };
  const ctx = context(item, values);
  ctx.run('prerequest');
  assert.deepEqual(JSON.parse(ctx.body()), {
    capacity: 3,
    enabled: false,
    ids: ['synthetic-id'],
    period: null,
  });
  assert.throws(
    () => context(item, { ...values, roomCapacity: 'not-a-number' }).run('prerequest'),
    /roomCapacity/,
  );
});
check('baseUrl with or without trailing slash resolves exactly one path separator', () => {
  const item = byName('00.01 Live');
  for (const baseUrl of ['https://localhost:7240/', 'https://localhost:7240']) {
    const ctx = context(item, { baseUrl });
    ctx.run('prerequest');
    assert.equal(
      item.request.url.replace('{{baseUrl}}', ctx.get('baseUrl')),
      'https://localhost:7240/health/live',
    );
  }
});
check('missing credentials never send login or reuse another principal token', () => {
  const ctx = context(byName('Đăng nhập owner'));
  ctx.run('prerequest');
  assert.ok(ctx.skipped);
  const denied = context(
    byName('Đăng nhập owner'),
    {
      ownerEmail: 'owner@example.invalid',
      ownerPassword: 'synthetic',
      ownerAccessToken: 'stale-owner-token',
    },
    { code: 401, body: { status: 401 } },
  );
  denied.run('prerequest');
  assert.equal(denied.env.get('ownerAccessToken'), '');
  denied.run('test');
  assert.ok(denied.failures.length);
  assert.equal(denied.env.get('ownerAccessToken'), '');
});
check('default financial write and lifecycle gates actually skip the HTTP request', () => {
  for (const item of requests.filter((x) => spec(x).gates.includes('enableWrites'))) {
    const values = fill(item);
    values.enableWrites = 'false';
    const ctx = context(item, values);
    ctx.run('prerequest');
    assert.ok(ctx.skipped, item.name);
  }
});
check('wrong role on login fails and cannot populate runtime credentials', () => {
  const ctx = context(
    byName('Đăng nhập owner'),
    { ownerEmail: 'owner@example.invalid', ownerPassword: 'synthetic' },
    {
      code: 200,
      body: {
        roles: ['Tenant'],
        accessToken: 'synthetic-access-token-long-enough',
        refreshToken: 'synthetic-refresh',
        userId: 'wrong-user',
      },
    },
  );
  ctx.run('prerequest');
  ctx.run('test');
  assert.ok(ctx.failures.length);
  assert.equal(ctx.env.get('ownerAccessToken'), '');
});
check('unexpected 200 on an authorization negative test is a failure', () => {
  const item = byName('Staff không xem Invoice');
  const ctx = context(item, { staffAccessToken: 'synthetic' }, { code: 200, body: { items: [] } });
  ctx.run('prerequest');
  ctx.run('test');
  assert.ok(ctx.failures.some((x) => x.startsWith('HTTP')));
});
check('error response does not overwrite previously selected invoice', () => {
  const item = byName('Owner Generate Draft'),
    data = { ...fill(item), invoiceId: 'previous-invoice' };
  const ctx = context(item, data, { code: 409, body: { status: 409 } });
  ctx.run('prerequest');
  ctx.run('test');
  assert.equal(ctx.env.get('invoiceId'), 'previous-invoice');
  assert.ok(ctx.failures.length);
});
check('approved shared-viewer inbox cannot leak private reason marker', () => {
  const item = byName('tenant inbox');
  const ctx = context(item, fill(item), {
    code: 200,
    body: {
      items: [{ id: 'n', summary: 'POSTMAN_PRIVATE_SECRET' }],
      page: 1,
      pageSize: 20,
      totalCount: 1,
    },
  });
  ctx.run('prerequest');
  ctx.run('test');
  assert.ok(ctx.failures.some((x) => x.startsWith('Không lộ')));
});
check('Final immutability assertion detects financial changes', () => {
  const item = byName('Final gốc bất biến'),
    original = { id: 'invoice', total: '100000', version: 2, lines: [] };
  const ctx = context(
    item,
    { ...fill(item), originalFinalSnapshot: JSON.stringify(original) },
    { code: 200, body: { ...original, total: '90000' } },
  );
  ctx.run('prerequest');
  ctx.run('test');
  assert.ok(ctx.failures.some((x) => x.startsWith('Final giữ nguyên')));
});
check('stable payment allocation key is reused across sends', () => {
  const item = byName('Owner allocate exact'),
    first = context(item, fill(item));
  first.run('prerequest');
  const key = first.env.get('paymentAllocateKey');
  assert.ok(key);
  const replay = context(byName('Replay allocate'), { ...fill(item), paymentAllocateKey: key });
  replay.run('prerequest');
  assert.equal(replay.env.get('paymentAllocateKey'), key);
  assert.equal(first.body(), replay.body());
});
check('non-loopback requests require explicit target flag and HTTPS', () => {
  const item = byName('00.01 Live');
  assert.throws(
    () => context(item, { baseUrl: 'https://external.example.invalid' }).run('prerequest'),
    /loopback/,
  );
  assert.throws(
    () =>
      context(item, {
        baseUrl: 'http://external.example.invalid',
        allowRemoteRequests: 'true',
      }).run('prerequest'),
    /HTTPS/,
  );
  context(item, { baseUrl: 'https://staging.example.invalid', allowRemoteRequests: 'true' }).run(
    'prerequest',
  );
});
console.log(
  `PASS ${checks} offline verification groups; ${requests.length} request routes/specs and ${collection.event.length} shared script blocks checked. No business HTTP requests were sent by this validator.`,
);
