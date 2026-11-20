// Runs in the build image and locally; reads only compiled, public web assets.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function verify(directory, environment, origin, app, revision) {
  const hosts = {
    Staging: ['api-staging', 'owner-staging', 'public-staging'],
    Production: ['api', 'owner', 'www'],
  };
  assert.ok(hosts[environment], 'An explicit Staging/Production release environment is required');
  assert.ok(['owner-web', 'public-web'].includes(app), 'Unknown web application');
  const allowed = hosts[environment].map((host) => `https://${host}.103.146.23.157.sslip.io`);
  assert.ok(allowed.includes(origin), 'API origin belongs to a different environment');
  assert.match(revision, /^[0-9a-f]{40}$/, 'Full source revision is required');
  const files = fs
    .readdirSync(path.join(directory, 'assets'))
    .filter((file) => file.endsWith('.js'));
  assert.ok(files.length, 'No compiled JavaScript');
  const bundle = files
    .map((file) => fs.readFileSync(path.join(directory, 'assets', file), 'utf8'))
    .join('\n');
  assert.ok(bundle.includes(origin), 'Expected API origin is absent from compiled JavaScript');
  const other = environment === 'Staging' ? 'Production' : 'Staging';
  for (const host of hosts[other])
    assert.ok(
      !bundle.includes(`${host}.103.146.23.157.sslip.io`),
      'Cross-environment hostname in bundle',
    );
  for (const host of ['api-sepay-test', 'owner-sepay-test', 'public-sepay-test'])
    assert.ok(
      !bundle.includes(`${host}.103.146.23.157.sslip.io`),
      'Legacy hostname in a canonical release bundle',
    );
  assert.ok(
    !/https?:\/\/[^\s"'`]*?(?:trycloudflare\.com|ngrok-free\.(?:app|dev))/.test(bundle),
    'Temporary tunnel in bundle',
  );
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  assert.ok(!/<script\b[^>]*src=["']http:\/\//i.test(html), 'Insecure script in release index');
  assert.ok(!/impeccable-live|localhost:8400/.test(html), 'Development overlay in release index');
  const metadata = { environment, apiOrigin: origin, app, revision, apiMode: 'api' };
  fs.writeFileSync(
    path.join(directory, 'bhome-release.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  );
  return metadata;
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verify(...process.argv.slice(2))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { verify };
