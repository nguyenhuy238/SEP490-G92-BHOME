"""Construct a release manifest only from successful jobs of the same CI attempt."""

import hashlib
import json
import os
import re
import sys
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def build(env):
    ref = env['GITHUB_REF']
    require(env['GITHUB_EVENT_NAME'] == 'push' and ref in ('refs/heads/main', 'refs/heads/develop'),
            'Release requires a trusted branch push')
    production = ref == 'refs/heads/main'
    target = 'Production' if production else 'Staging'
    suffix = '-production' if production else ''
    require(env['TARGET'] == target and env['SUFFIX'] == suffix, 'Release environment mismatch')
    registry = 'ghcr.io/' + env['GITHUB_REPOSITORY_OWNER'].lower()
    require(env['REGISTRY'] == registry, 'Release registry mismatch')
    sha = env['GITHUB_SHA']
    run = env['GITHUB_RUN_ID'] + '-' + env['GITHUB_RUN_ATTEMPT']
    require(re.fullmatch(r'[0-9a-f]{40}', sha), 'Invalid release revision')
    require(re.fullmatch(r'[0-9]+-[0-9]+', run), 'Invalid release run')
    images = {}
    for app, repo, key in (
        ('api', 'bhome-api', 'API'),
        ('owner-web', 'bhome-owner-web' + suffix, 'OWNER'),
        ('public-web', 'bhome-public-web' + suffix, 'PUBLIC'),
    ):
        require(env[key + '_PROVENANCE'] == f'{sha}:{run}:{target}',
                f'{app}: build is from a different commit, attempt or environment; rerun all jobs')
        digest = env[key + '_DIGEST']
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', digest), f'{app}: missing or invalid digest')
        images[app] = f'{registry}/{repo}:sha-{sha}@{digest}'
    return {'environment': target, 'sha': sha, 'run': run, 'images': images}


def verify_download(path, expected_sha256, env):
    raw = Path(path).read_bytes()
    require(re.fullmatch(r'[0-9a-f]{64}', expected_sha256 or '') and
            hashlib.sha256(raw).hexdigest() == expected_sha256, 'Release manifest checksum mismatch')
    ref = env['GITHUB_REF']
    require(ref in ('refs/heads/main', 'refs/heads/develop'), 'Unexpected deployment branch')
    target = 'Production' if ref == 'refs/heads/main' else 'Staging'
    expected = dict(env, TARGET=target, SUFFIX='-production' if target == 'Production' else '',
                    REGISTRY='ghcr.io/' + env['GITHUB_REPOSITORY_OWNER'].lower())
    require(not ('RELEASE_MANIFEST_ATTEMPT' in env and 'STAGING_MANIFEST_ATTEMPT' in env),
            'Conflicting manifest producer attempts')
    attempt_key = 'RELEASE_MANIFEST_ATTEMPT' if 'RELEASE_MANIFEST_ATTEMPT' in env else 'STAGING_MANIFEST_ATTEMPT'
    if attempt_key in env:
        if attempt_key == 'STAGING_MANIFEST_ATTEMPT':
            require(target == 'Staging', 'Invalid Staging manifest producer attempt')
        attempt = env[attempt_key]
        current = env['GITHUB_RUN_ATTEMPT']
        require(re.fullmatch(r'[1-9][0-9]*', attempt) and
                re.fullmatch(r'[1-9][0-9]*', current) and int(attempt) <= int(current),
                'Invalid release manifest producer attempt')
        expected['GITHUB_RUN_ATTEMPT'] = attempt
    run = env['GITHUB_RUN_ID'] + '-' + expected['GITHUB_RUN_ATTEMPT']
    for key in ('API', 'OWNER', 'PUBLIC'):
        expected[key + '_PROVENANCE'] = f"{env['GITHUB_SHA']}:{run}:{target}"
    require(json.loads(raw) == build(expected), 'Release manifest does not match deployment inputs')


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2 and sys.argv[1] == '--verify':
            verify_download('release-manifest.json', os.environ['MANIFEST_SHA256'], os.environ)
            print('PASS: release manifest checksum, revision, attempt, environment and all image digests')
        elif len(sys.argv) == 1:
            manifest = build(os.environ)
            path = Path('release-manifest.json')
            path.write_bytes((json.dumps(manifest, indent=2) + '\n').encode('utf-8'))
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
                output.write('sha256=' + hashlib.sha256(path.read_bytes()).hexdigest() + '\n')
                output.write('attempt=' + os.environ['GITHUB_RUN_ATTEMPT'] + '\n')
        else:
            raise ValueError('Unknown release manifest operation')
    except (ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
