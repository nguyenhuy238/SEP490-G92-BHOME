const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verify } = require('../../scripts/Verify-WebArtifact.cjs');

const sha = 'a'.repeat(40);
function fixture(bundle, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bhome-artifact-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets/app.js'), bundle);
    fs.writeFileSync(path.join(root, 'index.html'), '<script src="/assets/app.js"></script>');
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
for (const [environment, origin, wrong] of [
  [
    'Production',
    'https://owner.103.146.23.157.sslip.io',
    'https://api-staging.103.146.23.157.sslip.io',
  ],
  ['Staging', 'https://api-staging.103.146.23.157.sslip.io', 'https://api.103.146.23.157.sslip.io'],
]) {
  for (const app of ['owner-web', 'public-web']) {
    test(`${environment} ${app} accepts its own compiled API and records revision`, () => {
      fixture(`fetch('${origin}/api/v1/public/locations')`, (root) => {
        assert.equal(verify(root, environment, origin, app, sha).revision, sha);
      });
    });
    test(`${environment} ${app} rejects cross-environment compiled API`, () => {
      fixture(`fetch('${origin}'); fetch('${wrong}')`, (root) => {
        assert.throws(() => verify(root, environment, origin, app, sha), /Cross-environment/);
      });
    });
  }
}
test('rejects missing environment, wrong build origin, missing origin and invalid revision', () => {
  fixture('unrelated bundle', (root) => {
    assert.throws(() => verify(root, '', '', 'owner-web', sha));
    assert.throws(() =>
      verify(root, 'Production', 'https://api-staging.103.146.23.157.sslip.io', 'owner-web', sha),
    );
    assert.throws(
      () => verify(root, 'Production', 'https://owner.103.146.23.157.sslip.io', 'owner-web', sha),
      /absent/,
    );
    assert.throws(
      () =>
        verify(root, 'Production', 'https://owner.103.146.23.157.sslip.io', 'owner-web', 'main'),
      /revision/,
    );
  });
});
test('canonical Staging bundles cannot retain legacy SePay Test hostnames', () => {
  const origin = 'https://api-staging.103.146.23.157.sslip.io';
  fixture(`fetch('${origin}'); fetch('https://api-sepay-test.103.146.23.157.sslip.io')`, (root) => {
    assert.throws(() => verify(root, 'Staging', origin, 'owner-web', sha), /Legacy hostname/);
  });
});
for (const app of ['owner-web', 'public-web']) {
  test(`Production ${app} rejects legacy Staging API references`, () => {
    const origin = 'https://api.103.146.23.157.sslip.io';
    fixture(
      `fetch('${origin}'); fetch('https://api-sepay-test.103.146.23.157.sslip.io')`,
      (root) => {
        assert.throws(() => verify(root, 'Production', origin, app, sha), /Legacy hostname/);
      },
    );
  });
}
