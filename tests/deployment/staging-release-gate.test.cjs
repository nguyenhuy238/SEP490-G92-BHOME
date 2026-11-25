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
