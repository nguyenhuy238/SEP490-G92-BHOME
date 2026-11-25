"""Cold, warm and imported local BuildKit cache on task-owned builders only; no push/prune."""
import argparse
import json
import io
import re
import subprocess
import time
import tarfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def cached_instruction(content, instruction):
    steps = re.findall(r'^(#\d+) \[[^\n]+\] RUN ' + instruction + r'[^\n]*$', content, re.M)
    if len(steps) != 1:
        raise ValueError('Cannot identify cache probe instruction: ' + instruction)
    return steps[0] + ' CACHED' in content


def measure(output, cache_source=None):
    output.mkdir(parents=True, exist_ok=False)
    token = uuid.uuid4().hex[:10]
    builders, tags, results = [], [], []
    summary = {'completed': False, 'mode': 'isolation-probes-only' if cache_source else 'full',
               'cacheBackend': 'local (GHA requires an Actions runner)', 'results': results}

    def run(args, log=None, stdin=None):
        return subprocess.run(['docker', *args], cwd=ROOT, stdout=log or subprocess.PIPE,
                              stderr=subprocess.STDOUT, stdin=stdin, check=True)

    try:
        for suffix in ('cold-warm', 'import'):
            builder = 'bhome-cache-' + token + '-' + suffix
            run(['buildx', 'create', '--name', builder, '--driver', 'docker-container'])
            builders.append(builder)
        apps = [
            ('minio', 'deploy/docker/Minio.Dockerfile', []),
            ('converter', 'deploy/docker/ContractConverter.Dockerfile', []),
            ('api', 'deploy/docker/Api.Release.Dockerfile', ['--target', 'api']),
            ('owner', 'deploy/docker/Web.Dockerfile', ['--build-arg', 'APP=owner-web']),
            ('public', 'deploy/docker/Web.Dockerfile', ['--build-arg', 'APP=public-web']),
            ('runtime-base', 'deploy/docker/Api.Release.Dockerfile', ['--target', 'runtime-base']),
        ]
        build_arguments = {}
        for app, file, extra in apps:
            tag = 'bhome/ci-cache-' + token + '-' + app + ':local'
            tags.append(tag)
            cache = output / ('cache-' + app)
            if app in ('owner', 'public'):
                extra += ['--build-arg', 'VITE_API_BASE_URL=https://api-staging.103.146.23.157.sslip.io',
                          '--build-arg', 'VITE_DEPLOYMENT_ENVIRONMENT=Staging',
                          '--build-arg', 'BHOME_REVISION=' + subprocess.check_output(
                              ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()]
            build_arguments[app] = ['buildx', 'build', '--builder', builders[0], '--progress', 'plain',
                                    '--load', '-f', file, '-t', tag, *extra]
            if cache_source:
                source = cache_source / ('cache-' + app)
                if not (source / 'index.json').is_file():
                    raise ValueError('Missing previously exported cache: ' + app)
                build_arguments[app] += ['--cache-from', f'type=local,src={source.resolve()}']
                continue
            for mode, builder in (('cold', builders[0]), ('warm', builders[0]), ('import', builders[1])):
                args = ['buildx', 'build', '--builder', builder, '--progress', 'plain',
                        '--load', '-f', file, '-t', tag, *extra]
                if mode == 'cold':
                    # Each image has an empty instruction cache even if it shares a base with a prior image.
                    args += ['--no-cache', '--cache-to', f'type=local,dest={cache},mode=max']
                elif mode == 'import':
                    args += ['--cache-from', f'type=local,src={cache}']
                started = time.monotonic()
                log_path = output / (app + '-' + mode + '.log')
                with log_path.open('wb') as log:
                    run([*args, '.'], log)
                content = log_path.read_text(encoding='utf-8', errors='replace')
                results.append({'image': app, 'mode': mode, 'wallSeconds': round(time.monotonic() - started, 2),
                                'cachedSteps': len(re.findall(r'^#\d+ CACHED$', content, re.M)), 'exitCode': 0})
                (output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
        # Build synthetic contexts from the current tracked inputs. Mutations are
        # comments/JSON whitespace inside the tar stream, never edits to the checkout.
        paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
        prefixes = ('src/', 'packages/client-core/', 'deploy/docker/', '.config/',
                    'docs/database/', 'tools/BHome.LocalDevelopment/')
        singles = {'.dockerignore', 'global.json', 'Directory.Build.targets', 'package.json',
                   'package-lock.json', 'tsconfig.base.json', 'scripts/Verify-WebArtifact.cjs',
                   'docs/mau-hop-dong-thue-nha-tro-ngan-gon.docx'}
        paths = [p for p in paths if p and (p.startswith(prefixes) or p in singles)]
        for label, changed, app, restore_cached, source_cached in (
            ('tar-control-owner', None, 'owner', None, None),
            ('tar-control-public', None, 'public', None, None),
            ('tar-control-api', None, 'api', None, None),
            ('backend-does-not-invalidate-owner', 'src/backend/BHome.Api/Program.cs', 'owner', True, True),
            ('owner-does-not-invalidate-public', 'src/owner-web/src/main.tsx', 'public', True, True),
            ('mobile-does-not-invalidate-api', 'src/mobile/src/features/owner/OwnerPlaceLabel.tsx', 'api', True, True),
            ('backend-reuses-restore', 'src/backend/BHome.Api/Program.cs', 'api', True, False),
            ('lockfile-invalidates-restore', 'package-lock.json', 'owner', False, False),
        ):
            if changed is not None and changed not in paths:
                raise ValueError('Missing cache probe source: ' + changed)
            context = output / 'probe-context.tar'
            with tarfile.open(context, 'w') as archive:
                for relative in paths:
                    source = (ROOT / relative).resolve()
                    if not source.is_relative_to(ROOT):
                        raise ValueError('Context escaped repository')
                    raw = source.read_bytes()
                    if relative == changed:
                        raw += b'\n' if changed.endswith('.json') else b'\n// synthetic cache probe\n'
                    info = tarfile.TarInfo(relative)
                    info.size = len(raw)
                    info.mode = 0o644
                    archive.addfile(info, io.BytesIO(raw))
            started = time.monotonic()
            log_path = output / (label + '.log')
            with log_path.open('wb') as log, context.open('rb') as stdin:
                run([*build_arguments[app], '-'], log, stdin)
            content = log_path.read_text(encoding='utf-8', errors='replace')
            dependency = r'dotnet restore' if app == 'api' else r'npm ci'
            build = r'dotnet publish' if app == 'api' else r'test "(?:owner-web|public-web)"'
            actual_restore = cached_instruction(content, dependency)
            actual_source = cached_instruction(content, build)
            if restore_cached is not None and (actual_restore != restore_cached or actual_source != source_cached):
                raise ValueError('Unexpected cache invalidation: ' + label)
            results.append({'probe': label, 'wallSeconds': round(time.monotonic() - started, 2),
                            'restoreCached': actual_restore, 'sourceCached': actual_source, 'exitCode': 0})
            context.unlink()
        summary['completed'] = True
    finally:
        errors = []
        for builder in reversed(builders):
            if subprocess.run(['docker', 'buildx', 'rm', builder], capture_output=True).returncode:
                errors.append(builder)
        # Only task-specific tags; never remove the shared baseline images or prune any cache.
        for tag in tags:
            if subprocess.run(['docker', 'image', 'inspect', tag], capture_output=True).returncode == 0:
                if subprocess.run(['docker', 'image', 'rm', tag], capture_output=True).returncode:
                    errors.append(tag)
        summary['cleanup'] = {'passed': not errors, 'errors': errors, 'builders': builders, 'tags': tags}
        (output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
        if errors:
            raise RuntimeError('Task cache benchmark cleanup failed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--cache-source', type=Path,
                        help='Run only isolation probes using existing exported caches; keep previous timing evidence')
    args = parser.parse_args()
    measure(args.output.resolve(), args.cache_source)
