"""Summarize the rejected public validation experiment, without tuning on test."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def summarize(report, raw_hash):
    counts = defaultdict(Counter)
    rows = []
    for row in report['rows']:
        output = {'imageId': row['imageId'], 'sourceSha256': row['sha256'],
                  'fullyDigitLabeled': row['completeDigitGroundTruth'] is not None,
                  'sceneAllowed': row['sceneAllowed'], 'sceneWarnings': row['sceneWarnings'], 'outcomes': {}}
        for variant in row['variants']:
            if variant['name'] == 'diagnostics':
                output['originalNumericDisagreement'] = variant['originalDisagreement']
                continue
            metrics = {key: variant[key] for key in ('proposed', 'exactDigits', 'falseProposal', 'unknownGroundTruth')}
            if any(not isinstance(value, bool) for value in metrics.values()):
                raise ValueError('Boolean outcome flags required')
            if (metrics['exactDigits'] or metrics['falseProposal'] or metrics['unknownGroundTruth']) and not metrics['proposed']:
                raise ValueError('Outcome without a proposal')
            output['outcomes'][variant['name']] = metrics
            counts[variant['name']].update({key: int(value) for key, value in metrics.items()})
        rows.append(output)
    return {'experiment': report['experiment'], 'selectionSet': report['selectionSet'],
            'inputs': len(rows), 'fullyDigitLabeled': sum(row['fullyDigitLabeled'] for row in rows),
            'manifestSha256': report['manifestSha256'], 'excludedManifestSha256': report['excludedManifestSha256'],
            'rawEvidenceSha256': raw_hash, 'metrics': dict(counts),
            'decision': 'REJECTED', 'runtimeEnabled': False, 'testEvaluated': False,
            'reason': 'Validation study only. Strict aligned PP agreement reduces coverage. The permissive variant can erase valid original numeric disagreement through malformed PP; it is not accepted. No runtime policy or threshold selected.',
            'rows': rows, 'limitations': report['limitations']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raw', type=Path)
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    content = args.raw.read_bytes()
    result = summarize(json.loads(content), hashlib.sha256(content).hexdigest())
    args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result['metrics']))
