const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const FULL = ['backend', 'owner-web', 'public-web', 'mobile', 'quality', 'images'];

function full(reason) {
  return { mode: 'full', reason, checks: [...FULL] };
}

// Conservative candidate policy, used only for measurement. Unknown files, dependency
// manifests/configuration, deployment assets and docs runtime files require full CI.
function classifyPaths(paths) {
  if (!Array.isArray(paths) || !paths.length) return full('empty-or-unknown-diff');
  const checks = new Set(['quality']);
  let docsOnly = true;
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('..')) {
      return full('unknown-path');
    }
    if (path === 'README.md') continue;
    docsOnly = false;
    const web = /^src\/(owner-web|public-web)\/src\/.+\.(tsx?|css|svg|png|jpe?g|webp)$/.exec(path);
    if (web) {
      checks.add(web[1]);
      checks.add('images');
    } else if (
      /^src\/mobile\/(src|app)\/.+\.(tsx?|css|svg|png|jpe?g|webp)$/.test(path) ||
      /^tests\/mobile\/ocr\/.+\.test\.tsx?$/.test(path)
    ) {
      checks.add('mobile');
    } else {
      return full('shared-backend-runtime-or-unknown');
    }
  }
  return { mode: docsOnly ? 'docs-only' : 'scoped', reason: 'known-paths', checks: [...checks] };
}

function detect(eventName, event, git, expectedSha) {
  if (eventName !== 'pull_request' || event?.pull_request?.base?.ref !== 'develop') {
    return full('non-develop-pr');
  }
  const base = event.pull_request.base.sha;
  const head = event.pull_request.head?.sha;
  if (![base, head, expectedSha].every((sha) => /^[a-f0-9]{40}$/.test(sha || ''))) {
    return full('invalid-sha');
  }
  try {
    if (git(['rev-parse', 'HEAD']).trim() !== expectedSha) return full('revision-mismatch');
    // The tested checkout must include both exact PR parents. An unavailable or
    // incomplete history is never interpreted as a small diff.
    git(['merge-base', '--is-ancestor', base, 'HEAD']);
    git(['merge-base', '--is-ancestor', head, 'HEAD']);
    // --no-renames reports both the old and new path, including cross-module renames.
    const raw = git([
      'diff',
      '--no-ext-diff',
      '--name-only',
      '-z',
      '--no-renames',
      base,
      'HEAD',
      '--',
    ]);
    if (raw && !raw.endsWith('\0')) return full('incomplete-diff');
    return classifyPaths(raw.split('\0').filter(Boolean));
  } catch {
    return full('unavailable-git-history');
  }
}

function main() {
  let recommendation;
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const git = (args) =>
      execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    recommendation = detect(process.env.GITHUB_EVENT_NAME, event, git, process.env.GITHUB_SHA);
  } catch {
    recommendation = full('unavailable-event');
  }
  // The recommendation is deliberately not used to skip any job yet.
  const report = { effective: full('shadow-mode'), recommendation };
  const output = JSON.stringify(report, null, 2);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], output + '\n');
  console.log(output);
}

if (require.main === module) main();
module.exports = { classifyPaths, detect };
