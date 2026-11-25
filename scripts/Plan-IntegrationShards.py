"""Plan two class-level shards from measured TRX; this does not run or enable CI sharding."""
import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def plan(trx):
    sources = list((ROOT / 'tests/backend/BHome.IntegrationTests').rglob('*.cs'))
    collections = [str(p.relative_to(ROOT)) for p in sources
                   if re.search(r'\[Collection(?:Definition)?\s*\(', p.read_text(encoding='utf-8-sig'))]
    if collections:
        raise ValueError('Explicit xUnit collections need a reviewed grouping: ' + ', '.join(collections))
    root = ET.parse(trx).getroot()
    definitions = {}
    for definition in root.findall('./{*}TestDefinitions/{*}UnitTest'):
        method = definition.find('{*}TestMethod')
        if method is None or not method.get('className', '').startswith('BHome.IntegrationTests.'):
            raise ValueError('Expected Integration TRX only')
        definitions[definition.find('{*}Execution').get('id')] = method.get('className')
    classes = defaultdict(lambda: {'seconds': 0, 'testIds': [], 'notExecuted': 0})
    seen = set()
    for result in root.findall('./{*}Results/{*}UnitTestResult'):
        test_id = result.get('testId')
        if not test_id or test_id in seen or result.get('outcome') not in ('Passed', 'NotExecuted'):
            raise ValueError('Invalid baseline identity or outcome')
        seen.add(test_id)
        group = classes[definitions[result.get('executionId')]]
        hours, minutes, seconds = map(float, result.get('duration', '0:0:0').split(':'))
        group['seconds'] += hours * 3600 + minutes * 60 + seconds
        group['testIds'].append(test_id)
        group['notExecuted'] += result.get('outcome') == 'NotExecuted'
    if not seen:
        raise ValueError('Empty Integration baseline')
    shards = [{'classes': [], 'testIds': [], 'testSeconds': 0, 'notExecuted': 0} for _ in range(2)]
    for cls, group in sorted(classes.items(), key=lambda item: (-item[1]['seconds'], item[0])):
        shard = min(shards, key=lambda item: item['testSeconds'])
        shard['classes'].append(cls)
        shard['testIds'].extend(group['testIds'])
        shard['testSeconds'] += group['seconds']
        shard['notExecuted'] += group['notExecuted']
    for shard in shards:
        shard['classes'].sort()
        shard['testIds'].sort()
        shard['testSeconds'] = round(shard['testSeconds'], 2)
        shard['filter'] = '(' + '|'.join('FullyQualifiedName~' + cls + '.' for cls in shard['classes']) + ')'
    first, second = (set(shard['testIds']) for shard in shards)
    if first & second or first | second != seen:
        raise ValueError('Shard partition is incomplete or overlapping')
    return {'status': 'PLAN_ONLY_NOT_ACCEPTED', 'baselineSha256': hashlib.sha256(trx.read_bytes()).hexdigest(),
            'classes': len(classes), 'tests': len(seen), 'explicitCollections': collections,
            'setupAndCleanupMeasured': False, 'shards': shards,
            'classDurations': {cls: round(group['seconds'], 2) for cls, group in sorted(classes.items())},
            'runsettings': 'tests/backend/ci.runsettings (unchanged; mandatory exclusions still apply)'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline_trx', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = plan(args.baseline_trx)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
