#!/usr/bin/env python3
"""Fail-closed application release checks. Never write business data or print secrets."""
import hashlib
import json
import re
import subprocess
import sys
import time
import stat
from pathlib import Path

PREFIX = 'ghcr.io/nguyenhuy238/'
STAGE = 'bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989'
CONTAINERS = {
    'staging': ['bhome-sepay-api-stage', 'bhome-sepay-owner-web-stage', 'bhome-sepay-stage-public'],
    'production': ['bhome-vps-api-1', 'bhome-vps-owner-web-1', 'bhome-vps-public-web-1'],
}
RELEASE_PDF_TOOLS = {
    'MainDraft__LibreOfficePath': '/usr/bin/libreoffice',
    'MainDraft__PdfToPpmPath': '/usr/bin/pdftoppm',
}
RELEASE_OCR_DEFAULTS = {
    'Ocr__Enabled': 'true',
    'Ocr__ModelDirectory': '/models',
}


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.DEVNULL)


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def env(name):
    return dict(v.split('=', 1) for v in inspect(name)['Config']['Env'] if '=' in v)


def validate_sepay(settings):
    if settings.get('SePay__Mode', 'Test') not in ('Test', 'Live'):
        raise ValueError('Invalid SePay default mode')
    if settings.get('SePay__Enabled', '').lower() not in ('true', 'false'):
        raise ValueError('SePay enablement must be explicit')
    dual = any('SePay__' + mode + '__Enabled' in settings for mode in ('Test', 'Live'))
    if not dual or settings.get('SePay__Enabled') == 'false':
        return
    if not re.fullmatch('[A-Z0-9]{4}', settings.get('SePay__InstanceCode', '')):
        raise ValueError('SePay requires a unique four-character deployment code')
    active = []
    for mode in ('Test', 'Live'):
        prefix = 'SePay__' + mode + '__'
        if settings.get(prefix + 'Enabled') not in ('true', 'false'):
            raise ValueError('SePay profile enablement must be explicit')
        if settings[prefix + 'Enabled'] == 'false':
            continue
        secret = settings.get(prefix + 'WebhookSecret', '')
        if len(secret) < 32 or 'replace' in secret.lower():
            raise ValueError('SePay requires a strong profile webhook secret')
        expected = 'https://userapi-sandbox.sepay.vn/v2' if mode == 'Test' else 'https://userapi.sepay.vn/v2'
        if settings.get(prefix + 'ApiBaseUrl', '').rstrip('/') != expected:
            raise ValueError('SePay profile endpoint mismatch')
        legacy = [value for key, value in settings.items() if key.startswith(prefix + 'LegacyPaymentCodes__')]
        if len(set(legacy)) != len(legacy) or any(not re.fullmatch('BH[0-9]{8}', code) for code in legacy):
            raise ValueError('Invalid or duplicate legacy SePay routing code')
        active.append(prefix)
    if not active:
        raise ValueError('No enabled SePay profile')
    if len(active) == 2:
        for key in ('WebhookSecret', 'ApiToken'):
            if settings.get(active[0] + key) and settings.get(active[0] + key) == settings.get(active[1] + key):
                raise ValueError('SePay Test/Live credentials must be isolated')


def validate_sepay_routing(stage, prod):
    if stage.get('SePay__InstanceCode') and stage.get('SePay__InstanceCode') == prod.get('SePay__InstanceCode'):
        raise ValueError('SePay instance codes must differ between deployments')
    def legacy(settings, mode):
        prefix = 'SePay__' + mode + '__LegacyPaymentCodes__'
        return {value for key, value in settings.items() if key.startswith(prefix)}
    def banks(settings, prefix):
        keys = [key for key in settings if key.startswith(prefix) and key.endswith('__AccountNumber')]
        return {(settings.get(key.rsplit('__', 1)[0] + '__Gateway', '').upper(), settings[key]) for key in keys}
    for mode in ('Test', 'Live'):
        key = 'SePay__' + mode + '__WebhookSecret'
        if stage.get(key) and stage.get(key) == prod.get(key):
            raise ValueError('SePay webhook identity must be environment-specific')
        if legacy(stage, mode) & legacy(prod, mode):
            raise ValueError('Legacy SePay codes must have exactly one deployment owner per mode')
        profiles = []
        for settings in (stage, prod):
            dual = any('SePay__' + name + '__Enabled' in settings for name in ('Test', 'Live'))
            prefix = 'SePay__' + mode + '__' if dual else 'SePay__'
            active = settings.get('SePay__Enabled') == 'true' and settings.get(prefix + 'Enabled') == 'true' and (dual or settings.get('SePay__Mode') == mode)
            profiles.append((dual, banks(settings, prefix + 'ReceivingAccounts__') if active else set()))
        if profiles[0][1] & profiles[1][1] and not all(profile[0] for profile in profiles):
            raise ValueError('Upgrade both shared-bank deployments before enabling same-mode SePay routing')


def webhook_policy(target):
    settings = env(CONTAINERS[target][0])
    enabled = settings.get('SePay__Enabled', '').lower()
    if enabled not in ('true', 'false'):
        raise ValueError('SePay enablement must be explicit before webhook smoke')
    validate_sepay(settings)
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
    for key in ('DevelopmentDatabase__InitializeOnStartup', 'Jobs__Enabled'):
        if current.get(key, '').lower() != 'false':
            raise ValueError('Unapproved startup initializer or job: ' + key)
    if current.get('BillingAutomation__AutomaticJobsEnabled', '').lower() not in ('true', 'false'):
        raise ValueError('Invalid dedicated billing worker flag')
    for values, database, host in ((stage, STAGE, 'postgres'), (prod, 'bhome', 'postgres')):
        connection = dict(p.split('=', 1) for p in values.get('ConnectionStrings__Database', '').split(';') if '=' in p)
        if connection.get('Database') != database or connection.get('Host') != host:
            raise ValueError('Database target mismatch; credentials withheld')
    for settings in (stage, prod):
        validate_sepay(settings)
    validate_sepay_routing(stage, prod)
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
    # Canonical tool paths are supplied by Api.Release.Dockerfile, rather than
    # private runtime configuration. Reject arbitrary paths; normalize only the
    # reviewed defaults when upgrading an older operator image.
    for key, expected_path in RELEASE_PDF_TOOLS.items():
        allowed = {expected_path, '/usr/bin/soffice'} if key == 'MainDraft__LibreOfficePath' else {expected_path}
        if key in current and current[key] not in allowed:
            raise ValueError('Unapproved contract PDF tool path: ' + key)
    # The verified release image supplies these exact OCR defaults. An older
    # image may omit them. Retain every noncanonical value in the fingerprint
    # so disabling OCR or changing the model directory still counts as drift.
    # Explicit Compose overrides (including canonical values) are independently
    # protected by release-config.py's image-only transition check.
    return environment_fingerprint(current)


def environment_fingerprint(current):
    managed = {k: v for k, v in current.items() if not (k in RELEASE_PDF_TOOLS and v == RELEASE_PDF_TOOLS[k]) and
               not (k in RELEASE_OCR_DEFAULTS and v == RELEASE_OCR_DEFAULTS[k]) and
               (('__' in k and not k.startswith('Deployment__')) or k in ('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'AllowedHosts'))}
    return hashlib.sha256(json.dumps(managed, sort_keys=True).encode()).hexdigest()


def runtime_transition_matches(approval, target, sha, before, after, now):
    return (target == 'production' and isinstance(approval, dict) and
            re.fullmatch('[0-9a-f]{40}', sha or '') is not None and
            approval.get('target') == target and approval.get('sha') == sha and
            approval.get('beforeConfig') == before and approval.get('afterConfig') == after and
            all(re.fullmatch('[0-9a-f]{64}', value or '') for value in (before, after)) and
            isinstance(approval.get('expiresAt'), (int, float)) and
            now < approval['expiresAt'] <= now + 86400)


def verify_unchanged(target, snapshot, sha=None):
    before = json.loads(Path(snapshot).read_text())
    after = {'containers': protected(target), 'config': check_environment(target)}
    if before == after:
        return
    if before['containers'] != after['containers']:
        raise ValueError('Protected containers changed')
    approval = Path('/opt/bhome-deploy') / target / 'runtime-transition.json'
    if target == 'production' and sha and approval.exists():
        metadata = approval.lstat()
        if (stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and
                stat.S_IMODE(metadata.st_mode) == 0o600 and
                runtime_transition_matches(json.loads(approval.read_text()), target, sha,
                                           before['config'], after['config'], time.time())):
            return
    raise ValueError('Protected containers or application configuration changed without an exact, unexpired runtime approval')


def verify_image(image, sha, app, target):
    suffix = '-production' if target == 'production' and app != 'api' else ''
    if not re.fullmatch(re.escape(PREFIX + 'bhome-' + app + suffix + ':sha-' + sha + '@sha256:') + '[0-9a-f]{64}', image):
        raise ValueError('Image repository, revision or immutable digest mismatch')
    config = json.loads(docker('image', 'inspect', image))[0]
    if config['Config']['Labels'].get('org.opencontainers.image.revision') != sha:
        raise ValueError('Image OCI revision does not match the release')
    if app == 'api' and config['Config']['Labels'].get('io.bhome.staging-regressions') != 'v1':
        raise ValueError('API image predates the required Staging hotfix regression gate')
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
        verify_unchanged(target, args[0], args[1] if len(args) > 1 else None)
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
