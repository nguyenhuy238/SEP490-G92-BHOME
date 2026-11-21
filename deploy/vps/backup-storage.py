#!/usr/bin/env python3
"""Copy private objects to a root-only release backup on the same VPS."""
import json
import subprocess
import sys
from pathlib import Path

BACKUP_ROOT = Path('/opt/bhome-backups')


def main():
    target, directory = sys.argv[1:]
    if target not in ('staging', 'production'):
        raise ValueError('Unknown backup environment')
    root = Path(directory).resolve()
    if root.parent != BACKUP_ROOT:
        raise ValueError('Unexpected backup directory')
    api = 'bhome-sepay-api-stage' if target == 'staging' else 'bhome-vps-api-1'
    storage = 'bhome-sepay-stage-minio' if target == 'staging' else 'bhome-vps-minio-1'
    network = 'bhome-sepay-stage_default' if target == 'staging' else 'bhome-vps_default'
    inspect = lambda name: json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
    env = dict(value.split('=', 1) for value in inspect(api)['Config']['Env'] if '=' in value)
    address = inspect(storage)['NetworkSettings']['Networks'][network]['IPAddress']
    config = root / 'storage-client'
    config.mkdir(mode=0o700)
    file = config / 'config.json'
    file.write_text(json.dumps({'version': '10', 'aliases': {'backup': {
        'url': 'http://' + address + ':9000', 'accessKey': env['ObjectStorage__AccessKey'],
        'secretKey': env['ObjectStorage__SecretKey'], 'api': 'S3v4', 'path': 'auto',
    }}}))
    file.chmod(0o600)
    bucket = 'backup/' + env['ObjectStorage__Bucket']
    # mc mirror needs an existing local target even when the private bucket is empty.
    storage = root / 'storage'
    storage.mkdir(mode=0o700)
    with (root / 'storage-copy.log').open('w') as log:
        subprocess.run(['mc', '--config-dir', str(config), 'mirror', bucket, str(storage)], check=True, stdout=log, stderr=log)
    difference = subprocess.check_output(['mc', '--config-dir', str(config), 'diff', bucket, str(storage)], stderr=subprocess.DEVNULL)
    if difference.strip():
        raise ValueError('Storage changed during backup; review and retry before release')
    print('PASS: private storage mirror and source comparison; no objects uploaded outside the VPS')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Storage backup failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
