"""Local experiment only: compare two isolated Compact24 class groups.

Uses existing Release binaries and baseline TRX, never the development database.
No default CI settings, fixture behavior or test exclusions are changed.
"""
import argparse
import concurrent.futures
import json
import os
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'BHome.IntegrationTests.Compact24.'
GROUPS = [
    ('Compact24AssignmentTests', 'Compact24PersistenceTests'),
    ('LocationAssetInventoryAssignmentTests', 'Compact24LoginValidationTests',
     'Compact24ResidenceQueryTests'),
]
EXCLUSIONS = 'Suite!=Report-5.2-Authentication&Suite!=QA-BugHunt&Suite!=QA-SrsUnit'


def command(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, **kwargs)


def identities(path):
    root = ET.parse(path).getroot()
    classes = {}
    for definition in root.findall('./{*}TestDefinitions/{*}UnitTest'):
        classes[definition.find('{*}Execution').get('id')] = definition.find('{*}TestMethod').get('className')
    cases = {}
    for result in root.findall('./{*}Results/{*}UnitTestResult'):
        test_id = result.get('testId')
        if test_id in cases:
            raise ValueError('Duplicate test ID in pilot evidence')
        cases[test_id] = (classes[result.get('executionId')], result.get('outcome'))
    return cases


def run_group(folder, classes, baseline):
    folder.mkdir(parents=True, exist_ok=False)
    name = 'bhome-ci-shard-pilot-' + uuid.uuid4().hex[:12]
    password = uuid.uuid4().hex
    admin_started = False
    started = time.monotonic()
    logger = None
    try:
        command('docker', 'run', '--rm', '-d', '--name', name,
                '--label', 'bhome.purpose=isolated-shard-pilot',
                '-e', 'POSTGRES_USER=bhome_ci', '-e', 'POSTGRES_DB=postgres',
                '-e', 'POSTGRES_PASSWORD=' + password, '-p', '127.0.0.1::5432',
                'postgres:16-alpine', '-c', 'log_parameter_max_length=0',
                '-c', 'log_parameter_max_length_on_error=0',
                '-c', 'log_line_prefix=%m [%p] db=%d ', '-c', 'log_statement=all',
                stdout=subprocess.DEVNULL)
        admin_started = True
        for _ in range(60):
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1',
                                    '-U', 'bhome_ci', '-d', 'postgres'], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Disposable PostgreSQL was not ready')
        port = int(command('docker', 'port', name, '5432/tcp', capture_output=True).stdout.strip().rsplit(':', 1)[1])
        env = dict(os.environ, BHOME_COMPACT24_TEST_ADMIN=
                   f'Host=127.0.0.1;Port={port};Database=postgres;Username=bhome_ci;Password={password}',
                   BHOME_COMPACT24_QUERY_LOG=str(folder / 'statements.log'))
        selected = {PREFIX + cls for cls in classes}
        expected = {key: value for key, value in baseline.items() if value[0] in selected}
        if not expected or any(value[1] != 'Passed' for value in expected.values()):
            raise ValueError('Pilot requires nonempty passing baseline classes')
        filter_text = '(' + '|'.join('FullyQualifiedName~' + cls + '.' for cls in sorted(selected)) + ')&' + EXCLUSIONS
        with (folder / 'statements.log').open('w', encoding='utf-8') as statements, \
                (folder / 'test.log').open('w', encoding='utf-8') as log:
            logger = subprocess.Popen(['docker', 'logs', '--follow', name], stdout=statements, stderr=statements)
            command('dotnet', 'test', 'tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj',
                    '-c', 'Release', '--no-build', '--settings', 'tests/backend/ci.runsettings',
                    '--filter', filter_text, '--logger', 'trx;LogFileName=pilot.trx',
                    '--results-directory', str(folder), '-m:1', env=env, stdout=log, stderr=log)
        actual = identities(folder / 'pilot.trx')
        if actual != expected:
            raise ValueError('Pilot test identities or outcomes differ from unsharded baseline')
        return {'tests': len(actual), 'seconds': round(time.monotonic() - started, 2),
                'classes': sorted(selected), 'port': port}
    finally:
        if logger is not None:
            logger.terminate()
            logger.wait(timeout=10)
        if admin_started:
            command('docker', 'stop', name, stdout=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline_trx', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    baseline = identities(args.baseline_trx)
    folder = args.output.resolve()
    folder.mkdir(parents=True, exist_ok=False)
    summary = []
    for mode in ('sequential', 'parallel-1', 'parallel-2'):
        start = time.monotonic()
        if mode == 'sequential':
            groups = [run_group(folder / mode / str(i), classes, baseline)
                      for i, classes in enumerate(GROUPS)]
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                tasks = [pool.submit(run_group, folder / mode / str(i), classes, baseline)
                         for i, classes in enumerate(GROUPS)]
                groups = [task.result() for task in tasks]
        result = {'mode': mode, 'seconds': round(time.monotonic() - start, 2), 'groups': groups}
        summary.append(result)
        (folder / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
