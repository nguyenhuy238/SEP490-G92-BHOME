#!/usr/bin/env python3
"""Root-only Production health/backup operations; never print private payloads."""
import datetime
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKUPS = Path('/opt/bhome-backups')
STATE = Path('/var/lib/bhome-operations')
TOOLS = Path('/opt/bhome-deploy/production')
CONTAINERS = ['bhome-vps-api-1', 'bhome-vps-owner-web-1', 'bhome-vps-public-web-1',
              'bhome-vps-postgres-1', 'bhome-vps-minio-1', 'bhome-vps-caddy-1']


def command(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=kwargs.pop('timeout', 180), **kwargs)


def inspect():
    return json.loads(command(['docker', 'inspect', *CONTAINERS]).stdout)


def health():
    containers = inspect()
    for container in containers:
        if not container['State']['Running'] or container['State'].get('Health', {}).get('Status') not in (None, 'healthy'):
            raise ValueError('Unhealthy container: ' + container['Name'])
    if shutil.disk_usage('/opt').free < 4 * 1024 ** 3:
        raise ValueError('Available disk below 4 GiB release safety reserve')
    command(['docker', 'run', '--rm', '--network', 'container:bhome-vps-api-1',
             '--entrypoint', 'curl', 'bhome/minio-local:2025-10-15', '-fsS',
             '--max-time', '15', 'http://127.0.0.1:8080/health/ready'], timeout=30)
    for url in ['https://owner.103.146.23.157.sslip.io/login',
                'https://www.103.146.23.157.sslip.io/locations',
                'https://api.103.146.23.157.sslip.io/api/v1/public/locations']:
        command(['curl', '-fsS', '--max-time', '20', '-o', '/dev/null', url], timeout=25)
    return {'containers': len(containers), 'readiness': 'PASS', 'https': 'PASS',
            'disk_free_bytes': shutil.disk_usage('/opt').free}


def backup():
    health()
    retention = int(os.environ.get('BHOME_BACKUP_RETENTION_DAYS', '7'))
    if retention < 1:
        raise ValueError('Backup retention must be at least one day')
    root = Path(tempfile.mkdtemp(prefix='production-scheduled-backup-' +
                datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-', dir=BACKUPS))
    before = inspect()
    (root / 'containers.private.json').write_text(json.dumps(before))
    command(['tar', '--exclude=bhome-config/backups',
             '--exclude=bhome-config/quarantine-git-paste-20261120', '-czf', str(root / 'config.tar.gz'),
             '-C', '/opt', 'bhome-config'])
    pg = 'bhome-vps-postgres-1'
    with (root / 'database.dump').open('wb') as output:
        subprocess.run(['docker', 'exec', pg, 'sh', '-c',
                        'pg_dump -U "$POSTGRES_USER" -d bhome -Fc'], check=True,
                       stdout=output, stderr=subprocess.PIPE, timeout=600)
    verify = 'bhome_ops_verify_' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
    command(['docker', 'exec', pg, 'sh', '-c', 'createdb -U "$POSTGRES_USER" "$1"', 'sh', verify])
    with (root / 'database.dump').open('rb') as source:
        command(['docker', 'exec', '-i', pg, 'sh', '-c',
                 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error', 'sh', verify], stdin=source, timeout=600)
    # Drop only the disposable database this invocation just created and restored.
    command(['docker', 'exec', pg, 'sh', '-c', 'dropdb -U "$POSTGRES_USER" "$1"', 'sh', verify])
    command(['python3', str(TOOLS / 'backup-storage.py'), 'production', str(root)], timeout=600)
    after = inspect()
    if any(a['Id'] != b['Id'] or a['State']['StartedAt'] != b['State']['StartedAt']
           for a, b in zip(before, after)):
        raise ValueError('Protected services changed during scheduled backup')
    hashes = {}
    for file in root.rglob('*'):
        if file.is_file():
            digest = hashlib.sha256()
            with file.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            hashes[str(file.relative_to(root))] = digest.hexdigest()
    (root / 'checksums.json').write_text(json.dumps(hashes, indent=2))
    manifest = {'kind': 'bhome-production-scheduled-backup-v1',
                'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'restoreVerified': True, 'storageCompared': True}
    (root / 'backup-manifest.json').write_text(json.dumps(manifest, indent=2))
    prune_backups(root, retention)
    return {'evidence': str(root), 'restore': 'PASS', 'storage': 'PASS', 'retention_days': retention}


def prune_backups(current, retention):
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=retention)
    for old in BACKUPS.glob('production-scheduled-backup-*'):
        if old == current or old.is_symlink() or old.resolve().parent != BACKUPS or old.stat().st_uid != 0:
            continue
        marker = old / 'backup-manifest.json'
        if not marker.is_file() or marker.is_symlink():
            continue
        try:
            record = json.loads(marker.read_text())
            created = datetime.datetime.fromisoformat(record['createdAt'])
            if created.tzinfo is None:
                continue
        except (ValueError, KeyError, TypeError):
            continue  # Unknown or incomplete evidence is not owned retention data.
        if record.get('kind') == 'bhome-production-scheduled-backup-v1' and record.get('restoreVerified') is True and \
                created < cutoff:
            shutil.rmtree(old)


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('health', 'backup'):
        raise ValueError('Use root and the health or backup operation')
    STATE.mkdir(mode=0o700, exist_ok=True)
    mode = sys.argv[1]
    # A nonblocking lock makes monitoring skip a concurrent approved release.
    with open('/run/lock/bhome-vps-application-release.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('SKIP: application release in progress; next timer run will retry')
            return
        result = {'operation': mode, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'status': 'PASS', 'details': health() if mode == 'health' else backup()}
        temporary = STATE / (mode + '.tmp')
        temporary.write_text(json.dumps(result, indent=2))
        temporary.replace(STATE / (mode + '.json'))
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Provider/command stderr and config content may contain credentials.
        print('FAIL: Production operation: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
