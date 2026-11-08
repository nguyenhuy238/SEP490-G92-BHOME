"""Freeze agent-provisional oracle wheel crops before any recognizer is run.

These historical classification TRAIN images are not independent numeric test
data. A rolling digit stays unlabeled. No billing precision is inferred.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.manifest.exists():
        raise ValueError('Use fresh outputs; never relabel an existing run')
    source_manifest = args.root / 'docs/datasets/meter/four-class-development-v2.json'
    sources = {s['id']: s for s in json.loads(source_manifest.read_text())['samples']}
    args.output.mkdir(parents=True)
    rows = []
    for identifier, bounds, digits, uncertain in [
        ('commons_49855905', [429, 337, 900, 414], '003443', []),
        ('commons_77534681', [432, 455, 899, 528], '011049', []),
        ('commons_4508761', [378, 349, 778, 448], None, [5]),
    ]:
        sample = sources[identifier]
        source = args.root / sample['image']
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        if sample['split'] != 'train' or source_hash != sample['sha256']:
            raise ValueError('Frozen source/split changed')
        destination = args.output / (identifier + '-oracle.png')
        with Image.open(source) as image:
            image.crop(bounds).convert('RGB').save(destination)
        rows.append({'id': identifier, 'sourceImage': sample['image'], 'sourceSha256': source_hash,
                     'sourceSplit': 'historical_classification_train', 'boundsPixels': bounds,
                     'crop': destination.resolve().relative_to(args.root.resolve()).as_posix(),
                     'cropSha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                     'expectedDigits': digits, 'uncertainPositions': uncertain,
                     'decimalPlaces': None, 'annotationStatus': 'agent_provisional', 'humanReviewCount': 0})
    args.manifest.write_text(json.dumps({'scope': 'oracle_crops_provisional_development_only',
        'selectionBeforeInference': True, 'excludedStyles': ['pointer_dials', 'multiple_registers', 'obscured_wheels'],
        'samples': rows}, indent=2) + '\n')


if __name__ == '__main__':
    main()
