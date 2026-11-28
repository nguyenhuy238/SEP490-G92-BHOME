"""Measure local Owner Web test sharding without changing the normal CI suite."""
import argparse
import concurrent.futures
import importlib.util
import json
import os
import subprocess
import time
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('evidence', ROOT / 'scripts/Verify-FrontendEvidence.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def inventory(path):
    evidence.verify(path)
    root = ET.parse(path).getroot()
    files = set()
    cases = Counter()
    for suite in root.findall('testsuite'):
        name = suite.attrib['name']
        if name in files:
            raise ValueError('Duplicate test file: ' + name)
        files.add(name)
        for case in suite.findall('testcase'):
            cases[(name, case.attrib['classname'], case.attrib['name'])] += 1
    return files, cases


def run_shard(index, folder, node, npm):
    target = folder / f'shard-{index}.xml'
    started = time.monotonic()
    with (folder / f'shard-{index}.log').open('wb') as log:
        subprocess.run([str(node), str(npm), 'run', 'test', '--workspace', './src/owner-web', '--',
                        '--run', f'--shard={index}/2', '--maxWorkers=1', '--reporter=default', '--reporter=junit',
                        f'--outputFile.junit={target}'],
                       cwd=ROOT, env=dict(os.environ, VITE_API_BASE_URL='https://api.example.com',
                                          PATH=str(node.parent) + os.pathsep + os.environ.get('PATH', '')),
                       stdout=log, stderr=log, check=True)
    files, cases = inventory(target)
    return files, cases, round(time.monotonic() - started, 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--npm-cli', type=Path, required=True)
    parser.add_argument('--rounds', type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    files, cases = inventory(args.baseline)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    rounds = []
    for number in range(1, args.rounds + 1):
        folder = output / f'round-{number}'
        folder.mkdir()
        start = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run_shard, i, folder, args.node.resolve(), args.npm_cli.resolve())
                       for i in (1, 2)]
            (files1, cases1, time1), (files2, cases2, time2) = [future.result() for future in futures]
        if files1 & files2 or files1 | files2 != files or cases1 + cases2 != cases:
            raise ValueError('Shard union does not exactly match baseline test files and cases')
        result = {'round': number, 'wallSeconds': round(time.monotonic() - start, 2),
                  'shardSeconds': [time1, time2], 'workerBudget': 2,
                  'totalShardSeconds': round(time1 + time2, 2),
                  'files': len(files), 'passed': sum(cases.values())}
        rounds.append(result)
        (output / 'summary.json').write_text(json.dumps(rounds, indent=2), encoding='utf-8')
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
