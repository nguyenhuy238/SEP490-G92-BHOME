// Read-only Postman/OpenAPI checks. Uses only Node built-ins; sends no mutations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'docs/testing/postman');
const openapiPath = process.argv[2];
const api = openapiPath ? JSON.parse(fs.readFileSync(openapiPath, 'utf8')) : null;
const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
function* requests(items) {
  for (const item of items) {
    if (item.item) yield* requests(item.item);
    if (item.request) yield item;
  }
}
function scripts(item) {
  for (const event of item.event || []) new vm.Script(event.script.exec.join('\n'));
  for (const child of item.item || []) scripts(child);
}
const routes = api
  ? Object.entries(api.paths).flatMap(([url, operations]) =>
      Object.keys(operations)
        .filter((method) => /^(get|post|put|patch|delete)$/.test(method))
        .map((method) => ({
          method: method.toUpperCase(),
          pattern: new RegExp('^' + url.replace(/\{[^}]+\}/g, '[^/]+') + '$'),
        })),
    )
  : [];
let total = 0;
for (const name of ['BHome.Simple.postman_collection.json']) {
  const collection = read(name);
  assert.equal(
    collection.info.schema,
    'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  );
  assert.ok(
    collection.item.every((item) => item.request && !item.item),
    'Requests must stay at the collection root without folders.',
  );
  scripts(collection);
  const entries = [...requests(collection.item)];
  for (const item of entries) {
    const request = item.request;
    let url = typeof request.url === 'string' ? request.url : request.url.raw;
    assert.ok(
      !/\/api\/v1\/(chain|room-types)(?:[/?]|$)|\/capture\/chains/.test(url),
      item.name + ': retired route',
    );
    assert.ok(
      !/(?:roomTypeId|chainId)=/.test(url) &&
        !/"(?:roomTypeId|chainId)"\s*:/.test(request.body?.raw || ''),
      item.name + ': retired field',
    );
    assert.ok(!/DIEN_ROOM_TYPE/.test(JSON.stringify(item)), item.name + ': retired placeholder');
    if (request.body?.mode === 'raw') {
      // Preserve quoted strings and substitute standalone runtime JSON variables.
      JSON.parse(
        request.body.raw.replace(/"(?:\\.|[^"\\])*"|\{\{[^}]+\}\}/g, (token) =>
          token.startsWith('"') ? token : '0',
        ),
      );
    }
    if (/^(?:11[9]|1[2-7][0-9]|18[01]) —/.test(item.name)) {
      const prepare = (item.event || [])
        .filter((event) => event.listen === 'prerequest')
        .map((event) => event.script.exec.join('\n'))
        .join('\n');
      for (const stable of ['', 'synthetic-stable-key']) {
        const values = new Map([['incidentIdempotencyKey', stable]]);
        vm.runInNewContext(prepare, {
          pm: {
            variables: {
              get: (key) => values.get(key),
              set: (key, value) => values.set(key, value),
              replaceIn: () => 'synthetic-fresh-key',
            },
          },
        });
        assert.equal(
          values.get('incidentRequestKey'),
          stable || 'synthetic-fresh-key',
          item.name + ': inherited idempotency script',
        );
      }
    }
    if (api) {
      url = url
        .replace(/^\{\{baseUrl\}\}\/?/, '/')
        .replace(/^https?:\/\/[^/]+/, '')
        .split('?')[0];
      const health = request.method === 'GET' && ['/health/live', '/health/ready'].includes(url);
      assert.ok(
        health ||
          routes.some((route) => route.method === request.method && route.pattern.test(url)),
        item.name + ': no matching OpenAPI route',
      );
    }
  }
  total += entries.length;
  console.log(
    `PASS ${name}: ${entries.length} requests, JSON bodies, scripts${api ? ', current OpenAPI routes' : ''}`,
  );
}
for (const name of ['BHome.Local.postman_environment.json']) {
  const environment = read(name);
  assert.equal(
    new Set(environment.values.map((value) => value.key)).size,
    environment.values.length,
  );
  for (const value of environment.values) {
    if (value.type === 'secret' || /(?:password|accessToken|refreshToken)$/i.test(value.key))
      assert.equal(value.value, '', name + ': credentials must remain empty');
  }
  console.log(`PASS ${name}: unique variables, empty credentials`);
}
{
  const collection = read('BHome.Simple.postman_collection.json');
  const item = (number) => collection.item.find((entry) => entry.name.startsWith(number + ' '));
  const values = new Map();
  const storage = {
    name: 'Synthetic test',
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    unset: (key) => values.delete(key),
  };
  const locationId = '00000000-0000-4000-8000-000000000001';
  function execute(number, listen, status, data) {
    const pm = {
      environment: storage,
      collectionVariables: storage,
      variables: storage,
      test: (_name, work) => work(),
      expect: (value) => ({ to: { eql: (expected) => assert.equal(value, expected) } }),
      response: {
        code: status,
        json: () => data,
        to: { have: { status: (expected) => assert.equal(status, expected) } },
      },
    };
    for (const event of item(number).event || [])
      if (event.listen === listen) vm.runInNewContext(event.script.exec.join('\n'), { pm });
  }
  execute('26', 'test', 201, { id: locationId, version: 1 });
  assert.equal(values.get('locationVersion'), 1);
  execute('28', 'test', 201, { id: 'synthetic-assignment' });
  assert.equal(values.has('locationVersion'), false);
  assert.throws(() => execute('37', 'prerequest'), /GET Location/);
  execute('36', 'test', 200, { id: locationId, version: 2 });
  execute('37', 'prerequest');
  assert.equal(values.get('locationVersion'), 2);
  execute('37', 'test', 200, { id: locationId, version: 3 });
  assert.equal(values.get('locationVersion'), 3);
  for (const number of ['37', '76', '79'])
    assert.match(item(number).request.body.raw, /"version":\s*\{\{locationVersion\}\}/);
  console.log(
    'PASS Location create -> assignment invalidation -> GET -> PUT version synchronization.',
  );
}
console.log(`PASS ${total} request definitions. No business HTTP requests sent.`);
