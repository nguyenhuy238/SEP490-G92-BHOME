"""Reduce actual pinned public model traces; no policy selection or relabeling."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def metric(values):
    counts = Counter(inputs=len(values))
    for expected, value in values:
        counts['proposed'] += value is not None
        counts['exactDigits'] += expected is not None and value is not None and value.replace('.', '') == expected
        counts['incorrectOnPublisherCompleteLabels'] += expected is not None and value is not None and value.replace('.', '') != expected
        counts['unknownGroundTruthProposal'] += expected is None and value is not None
    counts['fallback'] = counts['inputs'] - counts['proposed']
    return dict(counts)


def summarize(data):
    groups = {}; causes = Counter(); rows=[]
    for row in data['rows']:
        expected = row['expectedDigits']
        if row['localizedAtIoU50']: causes['windowIoU50'] += 1
        if row['canRecognize']: causes['sceneAllowed'] += 1
        causes.update('scene:' + warning for warning in row['selectionWarnings'])
        outputs={}
        for mode in row['modes']:
            if mode['mode'] == 'A_full_pipeline':
                outputs['A_full_pipeline'] = mode['value']
                continue
            prefix = mode['mode']
            for field in ('stage2Value', 'ppNumericCandidate', 'ppDirectNumericCandidate', 'fusedValue'):
                outputs[prefix + ':' + field] = mode[field]
            if prefix == 'predicted_window':
                causes.update('digits:' + warning for warning in mode['stage2Warnings'])
                causes.update('fusion:' + warning for warning in mode['fusionWarnings'])
        # Missing predicted crops remain fallbacks in whole-corpus comparisons.
        for prefix in ('predicted_window', 'oracle_window'):
            for field in ('stage2Value', 'ppNumericCandidate', 'ppDirectNumericCandidate', 'fusedValue'):
                outputs.setdefault(prefix + ':' + field, None)
        for key, value in outputs.items(): groups.setdefault(key, []).append((expected, value))
        rows.append({'imageId':row['imageId'],'sourceSha256':row['sourceSha256'],'publisherCompleteDigits':expected,
                     'readability':row['readability'],'physicalMeterGroup':None,'windowIoU':row['bestWindowIoU'],
                     'sceneAllowed':row['canRecognize'],'selectionWarnings':row['selectionWarnings'],'outputs':outputs})
    return {'inputs':len(rows),'publisherCompleteLabels':sum(row['publisherCompleteDigits'] is not None for row in rows),
            'manifestSha256':data['manifestSha256'],'metrics':{key:metric(values) for key,values in groups.items()},
            'overlappingObservations':dict(causes),'rows':rows,'limitations':data['limitations'],
            'billingAccuracy':None,'independentAcceptance':False}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('trace',type=Path);parser.add_argument('report',type=Path)
    args=parser.parse_args(); raw=args.trace.read_bytes();r=summarize(json.loads(raw));r['rawTraceSha256']=hashlib.sha256(raw).hexdigest()
    args.report.write_text(json.dumps(r,indent=2)+'\n',encoding='utf-8');print(json.dumps(r['metrics']))
