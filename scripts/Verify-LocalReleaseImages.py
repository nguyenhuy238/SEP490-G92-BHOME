"""Smoke-test the local CI-performance images on a disposable internal network.

This does not publish, deploy, read workstation .env files or use an existing
database. Only containers and the network created by this invocation are removed.
"""
import argparse
import json
import subprocess
import time
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / 'docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql'
PREFIX = 'bhome/ci-performance-'


def docker(*args, **kwargs):
    return subprocess.run(['docker', *args], cwd=ROOT, check=True, **kwargs)


def wait_for(probe, attempts=45):
    for _ in range(attempts):
        if probe().returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError('Service readiness probe failed')


def smoke(output, ocr_assembly=None, ocr_models=None, ocr_fixtures=None):
    output.mkdir(parents=True, exist_ok=False)
    token = uuid.uuid4().hex[:12]
    network = 'bhome-ci-smoke-' + token
    names = []
    password = uuid.uuid4().hex
    checks = {'environment': 'Development', 'network': 'internal', 'completed': False}

    def start(app, image, environment=None, command=()):
        name = network + '-' + app
        flags = []
        for key, value in (environment or {}).items():
            flags.extend(['-e', key + '=' + value])
        docker('run', '-d', '--name', name, '--network', network, '--network-alias', app,
               '--label', 'bhome.purpose=isolated-release-smoke', *flags, image, *command,
               stdout=subprocess.DEVNULL)
        names.append(name)
        return name

    def http(client, url, headers=()):
        return subprocess.run(['docker', 'exec', client, 'curl', '-fsS', '--max-time', '3',
                               *headers, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    docker('network', 'create', '--internal', network, stdout=subprocess.DEVNULL)
    try:
        checks['imageIds'] = {
            app: docker('image', 'inspect', PREFIX + app + ':local', '--format', '{{.Id}}',
                        capture_output=True, text=True).stdout.strip()
            for app in ('api', 'owner', 'public', 'minio', 'converter')
        }
        postgres = start('postgres', 'postgres:16-alpine',
                         {'POSTGRES_USER': 'bhome_ci', 'POSTGRES_PASSWORD': password,
                          'POSTGRES_DB': 'bhome_ci_smoke'})
        wait_for(lambda: subprocess.run(['docker', 'exec', postgres, 'pg_isready',
                                        '-h', '127.0.0.1', '-U', 'bhome_ci', '-d', 'bhome_ci_smoke'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        with SCHEMA.open('rb') as schema, (output / 'schema.log').open('wb') as log:
            docker('exec', '-i', postgres, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'bhome_ci',
                   '-d', 'bhome_ci_smoke', stdin=schema, stdout=log, stderr=log)
        minio = start('minio', PREFIX + 'minio:local',
                      {'MINIO_ROOT_USER': 'synthetic-smoke', 'MINIO_ROOT_PASSWORD': password},
                      ('server', '/data'))
        wait_for(lambda: http(minio, 'http://127.0.0.1:9000/minio/health/live'))
        start('mailpit', 'axllent/mailpit:v1.27')
        wait_for(lambda: http(minio, 'http://mailpit:8025/'))
        start('owner', PREFIX + 'owner:local')
        start('public', PREFIX + 'public:local')
        for app in ('owner', 'public'):
            wait_for(lambda: http(minio, f'http://{app}:8080/'))
        settings = {
            'ASPNETCORE_ENVIRONMENT': 'Development', 'DOTNET_ENVIRONMENT': 'Development',
            'ConnectionStrings__Database': f'Host=postgres;Port=5432;Database=bhome_ci_smoke;Username=bhome_ci;Password={password}',
            'Jwt__SigningKey': uuid.uuid4().hex + uuid.uuid4().hex,
            'Api__ReadDevelopmentEnvironmentFile': 'false', 'Api__UseHttpsRedirection': 'false',
            'DevelopmentDatabase__InitializeOnStartup': 'false', 'DevelopmentDatabase__AllowRemoteDatabase': 'true',
            'DevelopmentDatabase__AllowPreviousPropertySchema': 'false',
            'Jobs__Enabled': 'false', 'BillingAutomation__AutomaticJobsEnabled': 'false',
            'DemoClock__Enabled': 'false', 'OwnerSetup__AssetSyncEnabled': 'false',
            'StaffAssignments__AutoReconcileEnabled': 'false', 'Email__Enabled': 'false',
            'NotificationChannels__Enabled': 'false', 'NotificationChannels__AutomationEnabled': 'false',
            'NotificationChannels__Mode': 'Unconfigured', 'SePay__Enabled': 'false',
            'ObjectStorage__Endpoint': 'minio:9000', 'ObjectStorage__AccessKey': 'synthetic-smoke',
            'ObjectStorage__SecretKey': password, 'ObjectStorage__Bucket': 'synthetic-smoke',
            'ObjectStorage__UseSsl': 'false', 'AllowedHosts': 'localhost;api',
        }
        start('api', PREFIX + 'api:local', settings)
        wait_for(lambda: http(minio, 'http://api:8080/health/live'))
        wait_for(lambda: http(minio, 'http://api:8080/health/ready'))
        checks.update(apiLive=True, apiReady=True, ownerHttp=True, publicHttp=True,
                      minioLive=True, mailpitHttp=True)
        with (output / 'dependencies.log').open('wb') as log:
            docker('exec', names[-1], 'sh', '-ec',
                   'test -s BHome.DigitalSigning.Application.dll; '
                   'test -s BHome.DigitalSigning.Infrastructure.dll; '
                   'test -s BHome.DigitalSigning.MySign.dll; '
                   'find /app -name libonnxruntime.so -size +0c | grep .; '
                   'find /app -name libOpenCvSharpExtern.so -size +0c | grep .; '
                   'fc-match :lang=vi | grep .', stdout=log, stderr=log)
        checks['runtimeAssetsAndVietnameseFonts'] = True
        # This document contains only task-generated text, with no template or PII.
        document = output / 'synthetic.docx'
        with zipfile.ZipFile(document, 'w') as doc:
            doc.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
            doc.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
            doc.writestr('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>BHOME synthetic — Kiểm thử tiếng Việt</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
        for app in ('api', 'converter'):
            name = network + '-pdf-' + app
            names.append(name)
            with (output / ('pdf-' + app + '.log')).open('wb') as log:
                docker('run', '--name', name, '--network', network,
                       '--mount', f'type=bind,source={document},target=/fixture.docx,readonly',
                       '--entrypoint', 'sh', PREFIX + app + ':local', '-ec',
                       'libreoffice -env:UserInstallation=file:///tmp/bhome-profile --headless '
                       '--convert-to pdf --outdir /tmp /fixture.docx; '
                       'test -s /tmp/fixture.pdf; pdfinfo /tmp/fixture.pdf; '
                       'pdftotext /tmp/fixture.pdf - | grep -F "Kiểm thử tiếng Việt"', stdout=log, stderr=log)
            docker('cp', name + ':/tmp/fixture.pdf', str(output / (app + '.pdf')), stdout=subprocess.DEVNULL)
        checks['syntheticPdfConversion'] = True
        checks['ocrInference'] = 'NOT_RUN (provide assembly, verified models and synthetic fixtures)'
        if all((ocr_assembly, ocr_models, ocr_fixtures)):
            name = network + '-ocr'
            names.append(name)
            mounts = []
            for source, target in ((ocr_assembly, '/app/BHome.OcrSmoke.dll'),
                                   (ocr_models, '/models'), (ocr_fixtures, '/fixtures')):
                mounts += ['--mount', f'type=bind,source={source.resolve()},target={target},readonly']
            with (output / 'ocr-inference.log').open('wb') as log:
                docker('run', '--name', name, '--network', network, *mounts,
                       '--entrypoint', 'dotnet', PREFIX + 'api:local',
                       'exec', '--depsfile', '/app/BHome.Api.deps.json',
                       '--runtimeconfig', '/app/BHome.Api.runtimeconfig.json',
                       '/app/BHome.OcrSmoke.dll', '/models', '/fixtures', stdout=log, stderr=log)
            checks['ocrInference'] = 'PASS (existing synthetic smoke assertions)'
        checks['completed'] = True
    finally:
        cleanup_errors = []
        for name in reversed(names):
            with (output / (name.rsplit('-', 1)[-1] + '.log')).open('wb') as log:
                subprocess.run(['docker', 'logs', name], stdout=log, stderr=log)
            result = subprocess.run(['docker', 'rm', '-f', '-v', name], capture_output=True)
            if result.returncode:
                cleanup_errors.append(name)
        if subprocess.run(['docker', 'network', 'rm', network], capture_output=True).returncode:
            cleanup_errors.append(network)
        checks['cleanup'] = {'passed': not cleanup_errors, 'errors': cleanup_errors, 'containers': names,
                             'network': network}
        (output / 'summary.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')
        if cleanup_errors:
            raise RuntimeError('Task resource cleanup failed; see summary.json')
    print('PASS: isolated services, runtime dependencies, synthetic PDF conversion and cleanup')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--ocr-assembly', type=Path)
    parser.add_argument('--ocr-models', type=Path)
    parser.add_argument('--ocr-fixtures', type=Path)
    args = parser.parse_args()
    if any((args.ocr_assembly, args.ocr_models, args.ocr_fixtures)) and not all((args.ocr_assembly, args.ocr_models, args.ocr_fixtures)):
        parser.error('All three OCR inputs are required together')
    smoke(args.output.resolve(), args.ocr_assembly, args.ocr_models, args.ocr_fixtures)
