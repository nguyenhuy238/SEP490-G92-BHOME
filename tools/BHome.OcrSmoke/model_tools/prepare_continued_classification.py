"""Freeze new provisional source-separated classification probes before inference.

No model predictions determine labels. Originals remain outside Git. Historical
classification TRAIN supplies few-shot features only; historical tests stay out.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))


def author_key(asset):
    plain = html.unescape(re.sub('<[^>]+>', '', asset.get('author') or ''))
    return re.sub(r'\s+', ' ', plain).strip().casefold()


def assert_isolation(samples):
    if len({s['id'] for s in samples}) != len(samples):
        raise ValueError('Duplicate sample ID')
    for field in ['id', 'sha256', 'sourceGroup']:
        seen = {}
        for sample in samples:
            value = sample[field]
            if value in seen and seen[value] != sample['split']:
                raise ValueError('Cross-split ' + field)
            seen[value] = sample['split']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('output', type=Path)
    a = parser.parse_args()
    if a.output.exists():
        raise ValueError('Never overwrite a frozen manifest')
    old_path = a.root / 'docs/datasets/meter/four-class-development-v2.json'
    old = json.loads(old_path.read_text(encoding='utf-8'))['samples']
    assets = {}
    for name in ['public-sources.json', 'public-sources-expanded.json']:
        assets.update({x['id']: x for x in json.loads((a.root / 'docs/datasets/meter' / name).read_text())['assets']})
    acquired = json.loads((a.root / 'docs/datasets/meter/continued-public-sources.json').read_text())['assets']
    assets.update({x['id']: x for x in acquired})
    controls = json.loads((a.root / 'docs/datasets/meter/independent-reading-controls.json').read_text())['samples']
    old_ids = {x['id'] for x in old + controls}
    old_authors = {author_key(assets[x]) for x in old_ids if x in assets}
    rows = []
    for sample in old:
        if sample['split'] != 'train':
            continue
        rows.append({**sample, 'sourceGroup': 'author_' + hashlib.sha256(author_key(assets[sample['id']]).encode()).hexdigest()[:20]
                     if sample['id'] in assets else sample['sourceGroup'], 'labelStatus': 'historical_agent_provisional',
                     'newHeldOut': False})
    # Category/body appearance inspected visually before model inference. The
    # Octave image is a product illustration, not a real-photo acceptance sample.
    selections = {
        'validation': [('15315072', 'electricity_mechanical'), ('48039403', 'electricity_digital'),
                       ('42461220', 'water_mechanical'),
                       ('195597533', 'not_meter'), ('134293571', 'not_meter'),
                       ('151445788', 'not_meter'), ('19089918', 'not_meter')],
        'test': [('18880869', 'electricity_mechanical'), ('11930077', 'electricity_mechanical'),
                 ('54903199', 'electricity_digital'), ('33635608', 'electricity_digital'),
                 ('38382735', 'water_mechanical'), ('166496308', 'water_mechanical'),
                 ('15920280', 'water_digital'), ('192931434', 'not_meter'),
                 ('51969773', 'not_meter')],
        'multiple_meter_challenge': [('4948052', 'multiple_meters'), ('33635609', 'multiple_meters')],
    }
    for split, selected in selections.items():
        for number, category in selected:
            identifier = 'commons_' + number
            asset = assets[identifier]
            author = author_key(asset)
            if identifier in old_ids or not author or author in old_authors:
                raise ValueError('New probes must be disjoint from historical authors: ' + identifier)
            candidates = [a.root / folder / (identifier + '.jpg') for folder in
                          ['.tools/ocr-continued', '.tools/master-dataset/commons', '.tools/ocr-next-public-images-expanded']]
            path = next(p for p in candidates if p.exists())
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if asset.get('sha256') and asset['sha256'] != digest:
                raise ValueError('Catalog checksum changed')
            rows.append({'id': identifier, 'image': path.relative_to(a.root).as_posix(), 'sha256': digest,
                         'split': split, 'category': category, 'sourceGroup': 'author_' + hashlib.sha256(author.encode()).hexdigest()[:20],
                         'physicalMeterGroup': None, 'labelStatus': 'agent_provisional', 'humanReviewCount': 0,
                         'newHeldOut': split == 'test', 'isProductIllustration': number == '15920280',
                         'meterPolygon': None, 'display_screen': None, 'numeric_register': None,
                         'serial_region': None, 'non_billing_display': None, 'expectedDigits': None,
                         'provenance': {'sourceUrl': asset['sourceUrl'], 'license': asset['license'],
                                        'licenseUrl': asset.get('licenseUrl'), 'author': asset.get('author')},
                         'notes': 'Visually selected before inference; no numeric or billing ground truth'})
    # Challenge pictures from the same author/site as test are one held-out role.
    assert_isolation([{**r, 'split': 'test' if r['split'] == 'multiple_meter_challenge' else r['split']} for r in rows])
    from PIL import Image, ImageOps
    import numpy as np
    from prepare_meter_training import perceptual_hash
    hashes = {}
    near = []
    for sample in rows:
        path = a.root / sample['image']
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
            raise ValueError('Image checksum mismatch')
        with Image.open(path) as image:
            h = perceptual_hash(np.asarray(ImageOps.exif_transpose(image).convert('RGB')))
        for other in rows[:len(hashes)]:
            distance = (h ^ hashes[other['id']]).bit_count()
            if distance <= 6:
                if ('train' if sample['split'] == 'train' else sample['split'].replace('multiple_meter_challenge', 'test')) != other['split'].replace('multiple_meter_challenge', 'test'):
                    raise ValueError('Near-duplicate crosses split')
                near.append({'first': sample['id'], 'second': other['id'], 'distance': distance})
        hashes[sample['id']] = h
        sample['pHash63'] = format(h, '016x')
    a.output.write_text(json.dumps({'scope': 'provisional_source_disjoint_research_not_independent_acceptance',
        'sourceBaselineManifestSha256': hashlib.sha256(old_path.read_bytes()).hexdigest(),
        'historicalTestUsedForTrainingOrSelection': False, 'humanReviewsReceived': 0,
        'taxonomy': ['meter_body', 'display_screen', 'numeric_register', 'serial_region', 'non_billing_display'],
        'physicalIndependenceUnknown': True, 'perceptualPairs': near, 'samples': rows}, indent=2) + '\n')
    from collections import Counter
    print(json.dumps(dict(Counter(r['split'] + ':' + r['category'] for r in rows))))


if __name__ == '__main__':
    main()
