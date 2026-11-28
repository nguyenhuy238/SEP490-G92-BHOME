const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const release = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');

test('release images depend on CI including the retained Staging regression gate', () => {
  const backend = ci.split('\n  backend:')[1].split('\n  frontend:')[0];
  assert.match(backend, /python3 scripts\/Verify-StagingRegressions\.py/);
  assert.match(ci.split('\n  release:')[1], /needs: \[backend, frontend, ci-quality-gate\]/);
  const api = release
    .split('name: Build API from the exact triggering commit')[1]
    .split('name: Build the environment-specific Owner Web')[0];
  assert.match(api, /io\.bhome\.staging-regressions=v1/);
});

test('Staging and Production retry download the manifest from the successful images job', () => {
  const images = release.split('\n  images:')[1].split('\n  production-policy:')[0];
  const staging = release.split('\n  staging:')[1].split('\n  production:')[0];
  const production = release.split('\n  production:')[1];
  assert.match(images, /manifest-attempt: \$\{\{ steps\.manifest\.outputs\.attempt \}\}/);
  assert.match(
    staging,
    /name: release-\$\{\{ github\.sha \}\}-\$\{\{ needs\.images\.outputs\.manifest-attempt \}\}/,
  );
  assert.match(
    staging,
    /STAGING_MANIFEST_ATTEMPT: \$\{\{ needs\.images\.outputs\.manifest-attempt \}\}/,
  );
  assert.match(staging, /MANIFEST_SHA256: \$\{\{ needs\.images\.outputs\.manifest-sha256 \}\}/);
  assert.match(staging, /\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT/);
  assert.doesNotMatch(production, /STAGING_MANIFEST_ATTEMPT/);
  assert.match(
    production,
    /name: release-\$\{\{ github\.sha \}\}-\$\{\{ needs\.images\.outputs\.manifest-attempt \}\}/,
  );
  assert.match(
    production,
    /RELEASE_MANIFEST_ATTEMPT: \$\{\{ needs\.images\.outputs\.manifest-attempt \}\}/,
  );
  assert.match(production, /MANIFEST_SHA256: \$\{\{ needs\.images\.outputs\.manifest-sha256 \}\}/);
  assert.match(production, /\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT/);
});
