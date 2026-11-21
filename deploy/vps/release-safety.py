#!/usr/bin/env python3
"""Fail-closed application release checks. Never write business data or print secrets."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PREFIX = 'ghcr.io/nguyenhuy238/'
STAGE = 'bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989'
CONTAINERS = {
    'staging': ['bhome-sepay-api-stage', 'bhome-sepay-owner-web-stage', 'bhome-sepay-stage-public'],
    'production': ['bhome-vps-api-1', 'bhome-vps-owner-web-1', 'bhome-vps-public-web-1'],
}


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.DEVNULL)


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def env(name):
    return dict(v.split('=', 1) for v in inspect(name)['Config']['Env'] if '=' in v)


def webhook_policy(target):
    enabled = env(CONTAINERS[target][0]).get('SePay__Enabled', '').lower()
    if enabled not in ('true', 'false'):
        raise ValueError('SePay enablement must be explicit before webhook smoke')
    # SePayWebhookSecurity rejects disabled integrations before authenticating.
    return (401, 'sepay_authentication_failed') if enabled == 'true' else (503, 'sepay_disabled')


def protected(target):
    names = ['bhome-vps-postgres-1', 'bhome-vps-minio-1', 'bhome-vps-caddy-1', 'bhome-sepay-vps-stage', 'bhome-sepay-stage-minio', 'bhome-staging-owner-legacy', 'bhome-staging-public-legacy']
    names += CONTAINERS['production' if target == 'staging' else 'staging']
    return [{k: c[k] for k in ('Id', 'Image', 'Mounts')} | {'started': c['State']['StartedAt']}
            for c in (inspect(name) for name in names)]


def check_environment(target):
    stage, prod = env(CONTAINERS['staging'][0]), env(CONTAINERS['production'][0])
    current = stage if target == 'staging' else prod
    expected = 'Staging' if target == 'staging' else 'Production'
    # A root-owned, reviewed fingerprint permits commissioning the inspected old
    # Production image, which predates Deployment anchors. A new image never gets
    # that exception. The separate ENABLED_AFTER_REVIEW marker is also mandatory.
    legacy = Path('/opt/bhome-deploy/production/legacy-image-id')
    legacy_production = target == 'production' and not current.get('Deployment__Environment') and legacy.exists() and inspect(CONTAINERS[target][0])['Image'] == legacy.read_text().strip()
    for key in ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'Deployment__Environment'):
        if key == 'Deployment__Environment' and legacy_production:
            continue
        if current.get(key) != expected:
            raise ValueError('Environment anchor mismatch: ' + key)
    origins = {
        'staging': ['https://owner-staging.103.146.23.157.sslip.io', 'https://api-staging.103.146.23.157.sslip.io', 'https://public-staging.103.146.23.157.sslip.io'],
        'production': ['https://owner.103.146.23.157.sslip.io', 'https://api.103.146.23.157.sslip.io', 'https://www.103.146.23.157.sslip.io'],
    }
    if not legacy_production:
        for key, value in zip(('OwnerOrigin', 'ApiOrigin', 'PublicOrigin'), origins[target], strict=True):
            if current.get('Deployment__' + key) != value:
                raise ValueError('Deployment origin mismatch: ' + key)
    for key in ('DevelopmentDatabase__InitializeOnStartup', 'Jobs__Enabled', 'BillingAutomation__AutomaticJobsEnabled'):
        if current.get(key, '').lower() != 'false':
            raise ValueError('Unapproved startup initializer or job: ' + key)
    for values, database, host in ((stage, STAGE, 'postgres'), (prod, 'bhome', 'postgres')):
        connection = dict(p.split('=', 1) for p in values.get('ConnectionStrings__Database', '').split(';') if '=' in p)
        if connection.get('Database') != database or connection.get('Host') != host:
            raise ValueError('Database target mismatch; credentials withheld')
    if stage.get('SePay__Enabled') != 'true' or stage.get('SePay__Mode') != 'Test':
        raise ValueError('Staging SePay must remain Test')
    if prod.get('SePay__Mode') == 'Test':
        raise ValueError('Production contains a Sandbox payment mode')
    # Older Production images inherit non-secret issuer/audience from appsettings.
    # Resolve those effective defaults without reading signing keys from a file.
    for values, name in ((stage, CONTAINERS['staging'][0]), (prod, CONTAINERS['production'][0])):
        if any(not values.get('Jwt__' + key) for key in ('Issuer', 'Audience')):
            defaults = json.loads(docker('exec', name, 'cat', '/app/appsettings.json')).get('Jwt', {})
            for key in ('Issuer', 'Audience'):
                values.setdefault('Jwt__' + key, defaults.get(key, ''))
    for key in ('Jwt__SigningKey', 'Jwt__Issuer', 'Jwt__Audience', 'ObjectStorage__AccessKey', 'ObjectStorage__SecretKey'):
        if not stage.get(key) or not prod.get(key) or stage[key] == prod[key]:
            raise ValueError('Missing or shared environment identity: ' + key)
    if stage.get('ObjectStorage__Bucket') == prod.get('ObjectStorage__Bucket'):
        raise ValueError('Storage bucket must be environment-specific')
    managed = {k: v for k, v in current.items() if ('__' in k and not k.startswith('Deployment__')) or k in ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'AllowedHosts')}
    return hashlib.sha256(json.dumps(managed, sort_keys=True).encode()).hexdigest()


def verify_image(image, sha, app, target):
    suffix = '-production' if target == 'production' and app != 'api' else ''
    if not re.fullmatch(re.escape(PREFIX + 'bhome-' + app + suffix + ':sha-' + sha + '@sha256:') + '[0-9a-f]{64}', image):
        raise ValueError('Image repository, revision or immutable digest mismatch')
    config = json.loads(docker('image', 'inspect', image))[0]
    if config['Config']['Labels'].get('org.opencontainers.image.revision') != sha:
        raise ValueError('Image OCI revision does not match the release')
    if image.split('@')[1] not in [v.split('@')[1] for v in config.get('RepoDigests', [])]:
        raise ValueError('Pulled image digest is not the manifest digest')
    if app != 'api':
        meta = json.loads(docker('run', '--rm', '--network', 'none', '--entrypoint', 'cat', image, '/usr/share/nginx/html/bhome-release.json'))
        environment = 'Production' if target == 'production' else 'Staging'
        origin = ('https://owner.103.146.23.157.sslip.io' if app == 'owner-web' else 'https://api.103.146.23.157.sslip.io') if target == 'production' else 'https://api-staging.103.146.23.157.sslip.io'
        if meta != dict(environment=environment, apiOrigin=origin, app=app, revision=sha, apiMode='api'):
            raise ValueError('Web artifact metadata does not match the release')
        js = docker('run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c', 'cat /usr/share/nginx/html/assets/*.js')
        forbidden = ['api-sepay-test.', 'owner-sepay-test.', 'public-sepay-test.']
        forbidden += ['api-staging.', 'owner-staging.', 'public-staging.'] if target == 'production' else ['api.103.146.', 'owner.103.146.', 'www.103.146.']
        if origin not in js or any(host in js for host in forbidden):
            raise ValueError('Compiled web artifact crosses environment boundary')


def main():
    command, target, *args = sys.argv[1:]
    if target not in CONTAINERS:
        raise ValueError('Unknown environment')
    if command == 'webhook-policy':
        print(*webhook_policy(target))
        return
    if command == 'snapshot':
        Path(args[0]).write_text(json.dumps({'containers': protected(target), 'config': check_environment(target)}, sort_keys=True))
    elif command == 'unchanged':
        before = json.loads(Path(args[0]).read_text())
        if before != {'containers': protected(target), 'config': check_environment(target)}:
            raise ValueError('Protected containers or application configuration changed')
    elif command == 'verify-image':
        verify_image(*args, target=target)
    elif command == 'verify-running':
        for name, image in zip(CONTAINERS[target], args, strict=True):
            running = inspect(name)
            expected = json.loads(docker('image', 'inspect', image))[0]
            if running['Config']['Image'] != image or running['Image'] != expected['Id'] or not running['State']['Running']:
                raise ValueError('Running application does not match the approved digest')
    elif command == 'check':
        check_environment(target)
    else:
        raise ValueError('Unknown release check')
    print('PASS: ' + command + ' ' + target)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Release check failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
