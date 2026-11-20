#!/usr/bin/env python3
"""Legacy PR142 bootstrap/overlay checks; never migrate a DB.

The historical check-api targets the original shared PostgreSQL namespace.
Current releases use release-safety.py and connect-staging-edge.py instead.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PROTECTED = [
    'bhome-vps-api-1', 'bhome-vps-postgres-1', 'bhome-vps-minio-1',
    'bhome-vps-owner-web-1', 'bhome-vps-public-web-1', 'bhome-vps-caddy-1',
    'bhome-sepay-vps-stage',
]
STAGE_DB = 'bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989'
API_ORIGIN = 'https://api-sepay-test.103.146.23.157.sslip.io'


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True)


def snapshot():
    return [{
        'name': c['Name'], 'id': c['Id'], 'image': c['Image'],
        'started': c['State']['StartedAt'],
        'mounts': [{k: m.get(k) for k in ('Type', 'Name', 'Source', 'Destination')}
                   for m in c['Mounts']],
    } for c in json.loads(docker('inspect', *PROTECTED))]


def check_api():
    c = json.loads(docker('inspect', 'bhome-sepay-api-stage'))[0]
    e = dict(v.split('=', 1) for v in c['Config']['Env'] if '=' in v)
    required = {
        'ASPNETCORE_ENVIRONMENT': 'Staging', 'DOTNET_ENVIRONMENT': 'Staging',
        'Deployment__Environment': 'Staging', 'Jobs__Enabled': 'false',
        'BillingAutomation__AutomaticJobsEnabled': 'false',
        'DevelopmentDatabase__InitializeOnStartup': 'false',
        'SePay__Enabled': 'true', 'SePay__Mode': 'Test',
    }
    for key, expected in required.items():
        if e.get(key) != expected:
            raise ValueError('Staging guard failed: ' + key)
    db = dict(p.split('=', 1) for p in e.get('ConnectionStrings__Database', '').split(';') if '=' in p)
    if db.get('Host') != '127.0.0.1' or db.get('Database') != STAGE_DB:
        raise ValueError('Staging database target mismatch; connection withheld')
    pg = json.loads(docker('inspect', 'bhome-sepay-vps-stage'))[0]
    if c['HostConfig']['NetworkMode'] != 'container:' + pg['Id']:
        raise ValueError('API is outside the isolated staging database network namespace')
    print('PASS: Staging environment, database target, jobs and SePay Test guards')


def clean_web(image, output):
    html = docker('run', '--rm', '--network', 'none', '--entrypoint', 'cat', image,
                  '/usr/share/nginx/html/index.html')
    html = re.sub(r'\s*<!-- impeccable-live-start -->.*?<!-- impeccable-live-end -->', '', html, flags=re.S)
    if re.search(r'<script\b[^>]*\bsrc=[\"\']http://', html, re.I):
        raise ValueError('Insecure script in the web release')
    # Read files through the image's shell; no provider calls or application startup.
    origins = docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c',
                     'grep -ohE "https://[a-zA-Z0-9._:-]+" /usr/share/nginx/html/assets/*.js | sort -u')
    if API_ORIGIN not in origins.splitlines():
        raise ValueError('The Vite bundle does not contain the approved staging API origin')
    if any(origin in origins.splitlines() for origin in (
        'https://api.103.146.23.157.sslip.io', 'https://owner.103.146.23.157.sslip.io')):
        raise ValueError('Production origin found in staging bundle')
    Path(output).write_text(html)
    Path(output).chmod(0o644)
    print('PASS: Vite staging origin; index SHA256=' + hashlib.sha256(html.encode()).hexdigest())


def main():
    mode, *args = sys.argv[1:]
    if mode == 'snapshot':
        Path(args[0]).write_text(json.dumps(snapshot(), sort_keys=True, indent=2))
    elif mode == 'unchanged':
        if json.loads(Path(args[0]).read_text()) != snapshot():
            raise ValueError('Protected container identity, image, start time or volume changed')
        print('PASS: Production containers and staging PostgreSQL unchanged')
    elif mode == 'check-api':
        check_api()
    elif mode == 'prepare-web':
        clean_web(*args)
    else:
        raise ValueError('Unknown staging guard mode')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Configuration values, tokens and response bodies must never enter CD logs.
        print('Staging safety check failed: ' + str(error) if isinstance(error, ValueError)
              else 'Staging safety check failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
