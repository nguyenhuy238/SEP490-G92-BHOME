const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyPaths, detect } = require('../../scripts/Detect-CiScope.cjs');
const { verify } = require('../../scripts/Verify-CiGate.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('change recommendations remain conservative for module and mixed changes', () => {
  assert.deepEqual(classifyPaths(['src/owner-web/src/Screen.tsx']).checks, [
    'quality',
    'owner-web',
    'images',
  ]);
  assert.deepEqual(classifyPaths(['src/mobile/app/index.tsx']).checks, ['quality', 'mobile']);
  assert.deepEqual(
    classifyPaths(['src/public-web/src/Home.tsx', 'src/mobile/app/index.tsx']).checks,
    ['quality', 'public-web', 'images', 'mobile'],
  );
  assert.equal(classifyPaths(['README.md']).mode, 'docs-only');
  for (const path of [
    'docs/contracts/template.docx',
    'docs/database/schema.sql',
    'package-lock.json',
    'src/mobile/package.json',
    'src/backend/BHome.Api/Program.cs',
    'src/digital-signing/Signing.cs',
    'packages/client-core/src/api.ts',
    '.github/workflows/ci.yml',
    'deploy/docker/Web.Dockerfile',
    'scripts/deploy.sh',
    'unknown.txt',
  ]) {
    assert.equal(classifyPaths([path]).mode, 'full', path);
  }
  assert.equal(classifyPaths([]).mode, 'full');
});

test('diff classification requires exact tested revision and both PR parents', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const merge = 'c'.repeat(40);
  const event = { pull_request: { base: { ref: 'develop', sha: base }, head: { sha: head } } };
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return merge;
    if (args[0] === 'diff') return 'src/owner-web/src/Old.tsx\0src/public-web/src/New.tsx\0';
    return '';
  };
  assert.deepEqual(detect('pull_request', event, git, merge).checks, [
    'quality',
    'owner-web',
    'images',
    'public-web',
  ]);
  assert.ok(calls.at(-1).includes('--no-renames'));
  assert.equal(detect('pull_request', event, git, base).mode, 'full');
  assert.equal(
    detect(
      'pull_request',
      event,
      () => {
        throw new Error('shallow');
      },
      merge,
    ).mode,
    'full',
  );
  assert.equal(detect('workflow_dispatch', event, git, merge).mode, 'full');
  assert.equal(detect('merge_group', event, git, merge).mode, 'full');
  assert.equal(
    detect(
      'pull_request',
      { pull_request: { base: { ref: 'main', sha: base }, head: { sha: head } } },
      git,
      merge,
    ).mode,
    'full',
  );
});

test('CI gate rejects missing failed cancelled or improperly skipped jobs', () => {
  const ok = {
    backend: 'success',
    frontend: 'success',
    'change-detection': 'success',
    'build-staging-images': 'success',
  };
  for (const event of ['pull_request', 'workflow_dispatch', 'merge_group']) {
    assert.doesNotThrow(() => verify(event, ok));
    for (const job of Object.keys(ok)) {
      for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
        assert.throws(() => verify(event, { ...ok, [job]: status }));
      }
    }
  }
  assert.doesNotThrow(() => verify('push', { ...ok, 'build-staging-images': 'skipped' }));
  assert.throws(() => verify('push', ok));
  assert.throws(() => verify('unknown', ok));
});

test('release handles a deliberately skipped validation ancestor without bypassing mandatory gates', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
  const release = source.split('\n  release:')[1].split('\n  validate-api-image:')[0];
  assert.match(release, /!cancelled\(\)/);
  assert.match(release, /github\.event_name == 'push'/);
  for (const job of ['backend', 'frontend', 'ci-quality-gate']) {
    assert.ok(release.includes(`needs.${job}.result == 'success'`));
  }
  assert.match(release, /needs: \[backend, frontend, ci-quality-gate\]/);
});
