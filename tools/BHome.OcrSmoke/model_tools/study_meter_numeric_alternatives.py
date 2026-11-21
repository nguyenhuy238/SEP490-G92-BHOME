"""Actual PARSeq, character CNN, Paddle and native-row-margin comparisons.

Character training uses publisher digit boxes only, not provisional sequences or
historical tests. Twenty fixed epochs, no CTC blank token or epoch selection from
test. Every reading remains experimental without billing/register acceptance.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import sys
import time

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compare_paddle_meter_models import PaddleCtcReader
from parseq_reader import ParseqReader, REVISION, WEIGHTS
from lcd_cell_reader import LcdCellCnn, cell_tensor, read_cells


def train_cells(dataset, output, device):
    audit = json.loads((dataset / 'audit.json').read_text())
    cells = []; labels = []; training_sources = []
    for sample in audit['samples']:
        if sample['split'] != 'train' or not sample['id'].startswith('mendeley_'): continue
        image_path = dataset / sample['image']; label_path = dataset / sample['label']
        if hashlib.sha256(image_path.read_bytes()).hexdigest() != sample['sha256'] or hashlib.sha256(label_path.read_bytes()).hexdigest() != sample['labelSha256']:
            raise ValueError('Publisher digit training data changed')
        image = cv2.imread(str(image_path)); h, w = image.shape[:2]
        for line in label_path.read_text().splitlines():
            cls, x, y, cw, ch = map(float, line.split())
            x1, y1 = max(0, int((x - .55 * cw) * w)), max(0, int((y - .55 * ch) * h))
            x2, y2 = min(w, int((x + .55 * cw) * w) + 1), min(h, int((y + .55 * ch) * h) + 1)
            cells.append(cell_tensor(image[y1:y2, x1:x2])); labels.append(int(cls))
        training_sources.append(sample['id'])
    images = torch.from_numpy(np.stack(cells)).to(device)
    targets = torch.tensor(labels, dtype=torch.long, device=device)
    model = LcdCellCnn().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.001)
    losses = []
    for epoch in range(20):
        model.train(); total = 0
        for indices in torch.randperm(len(images), device=device).split(64):
            batch = images[indices]
            # Small affine and photometric changes preserve the publisher label.
            theta = torch.eye(2, 3, device=device)[None].repeat(len(batch), 1, 1)
            theta[:, 0, 2] = (torch.rand(len(batch), device=device) - .5) * .08
            theta[:, 1, 2] = (torch.rand(len(batch), device=device) - .5) * .08
            grid = torch.nn.functional.affine_grid(theta, batch.shape, align_corners=False)
            batch = torch.nn.functional.grid_sample(batch, grid, padding_mode='border', align_corners=False)
            loss = torch.nn.functional.cross_entropy(model(batch), targets[indices])
            optimizer.zero_grad(); loss.backward(); optimizer.step(); total += loss.item() * len(indices)
        losses.append(total / len(images))
    model.eval(); torch.save(model.state_dict(), output / 'lcd-character-cnn.pt')
    return model, {'publisherSources': len(training_sources), 'publisherDigitCells': len(cells), 'epochs': 20,
                   'lossByEpoch': losses, 'trainingSourceIds': training_sources,
                   'datasetAuditSha256': hashlib.sha256((dataset / 'audit.json').read_bytes()).hexdigest(),
                   'provisionalOrHistoricalNumericTrainingSamples': 0}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['parseq_source', 'parseq_weights', 'digit_dataset', 'english', 'server', 'display_manifest', 'localization_report', 'water_diagnostic', 'root', 'output']:
        p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists(): raise ValueError('Use a fresh numeric experiment directory')
    a.output.mkdir(parents=True)
    random.seed(19); np.random.seed(19); torch.manual_seed(19); torch.set_num_threads(2)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    cell_model, training = train_cells(a.digit_dataset, a.output, device)
    readers = {'english': PaddleCtcReader('english_mobile', a.english), 'server': PaddleCtcReader('multilingual_server', a.server),
               'parseq': ParseqReader(a.parseq_source, a.parseq_weights)}
    inputs = []
    for sample in json.loads(a.display_manifest.read_text())['samples']:
        if not sample['display_screen']: continue
        path = a.root / sample['image']
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']: raise ValueError('Frozen source changed')
        image = cv2.imread(str(path))
        for field in ['display_screen', 'numeric_register']:
            x1, y1, x2, y2 = sample[field]
            inputs.append((sample['id'], 'electricity_digital', 'provisional_oracle_' + field, sample['expectedDigits'], image[y1:y2, x1:x2]))
    localization = json.loads(a.localization_report.read_text())
    display_by_id = {s['id']: s for s in json.loads(a.display_manifest.read_text())['samples']}
    for row in localization['rows']:
        if row['method'] != 'native_text1280' or row['selected'] is None: continue
        sample = display_by_id[row['id']]; image = cv2.imread(str(a.root / sample['image']))
        x1, y1, x2, y2 = row['selected']['box']; margin = .5 * (y2 - y1)
        for mode, left, right in [('predicted_native_numeric', x1, x2), ('predicted_native_row_margin', x1 - margin, x2 + margin)]:
            window = image[max(0, int(y1)):min(image.shape[0], int(np.ceil(y2))), max(0, int(left)):min(image.shape[1], int(np.ceil(right)))]
            inputs.append((row['id'], sample['category'], mode, sample['expectedDigits'], window))
    water = json.loads(a.water_diagnostic.read_text())
    for sample in water['rows']:
        for mode in sample['modes']:
            if mode['mode'] not in ['oracle_window', 'predicted_window']: continue
            window = cv2.imread(str(a.water_diagnostic.parent / mode['cropFile']))
            inputs.append((sample['imageId'], 'water_mechanical', 'historical_' + mode['mode'], sample['expectedDigits'], window))
    # Existing provisional wheel examples remain separate from LCD and historical water.
    mechanical = json.loads((a.root / 'docs/datasets/meter/mechanical-electric-provisional-pilot.json').read_text())
    for sample in mechanical['samples']:
        path = a.root / sample['crop']
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample['cropSha256']: raise ValueError('Frozen wheel crop changed')
        inputs.append((sample['id'], 'electricity_mechanical', 'provisional_wheel_oracle', sample['expectedDigits'], cv2.imread(str(path))))
    rows = []
    for identifier, category, scope, expected, window in inputs:
        for name in [*readers, 'character_cnn']:
            if name == 'character_cnn' and category != 'electricity_digital': continue
            started = time.perf_counter()
            result = read_cells(cell_model, window, device) if name == 'character_cnn' else readers[name].read(window)
            rows.append({'id': identifier, 'category': category, 'scope': scope, 'reader': name, 'expectedDigits': expected,
                         'exactOnAvailableLabel': expected is not None and result['digits'] == expected,
                         'incorrectNumericOnAvailableLabel': expected is not None and result['digits'] is not None and result['digits'] != expected,
                         'cropSha256': hashlib.sha256(window.tobytes()).hexdigest(), **result, 'pipelineMs': (time.perf_counter() - started) * 1000})
    summary = {}
    for row in rows:
        key = row['category'] + ':' + row['scope'] + ':' + row['reader']
        counts = summary.setdefault(key, Counter(inputs=0, labeled=0, exact=0, incorrectNumeric=0, fallback=0,
                                                 labeledFallback=0, unlabeledNumeric=0))
        counts.update(inputs=1, labeled=row['expectedDigits'] is not None, exact=row['exactOnAvailableLabel'],
                      incorrectNumeric=row['incorrectNumericOnAvailableLabel'], fallback=row['digits'] is None,
                      labeledFallback=row['expectedDigits'] is not None and row['digits'] is None,
                      unlabeledNumeric=row['expectedDigits'] is None and row['digits'] is not None)
    report = {'scope': 'offline_component_comparison_not_billing_or_independent_acceptance', 'training': training,
              'parseq': {'sourceRevision': REVISION, 'weightsSha256': WEIGHTS, 'license': 'Apache-2.0', 'timmVersion': '0.9.16',
                         'decoding': 'official autoregressive with one refinement; full94 charset; no digits-only filtering'},
              'rowMarginStatus': 'exploratory_after_localization_failure_analysis_not_fresh_heldout_selection',
              'runtimeEnabled': False, 'modelStatus': {'parseq': 'REJECTED', 'character_cnn': 'REJECTED'},
              'activationReason': 'Character CNN fails provisional positives; PARSeq does not beat the best CTC reader and neither verifies invalid states or billing registers',
              'rows': rows, 'summary': summary}
    (a.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'trainingSources': training['publisherSources'], 'digitCells': training['publisherDigitCells'], 'summary': summary}))


if __name__ == '__main__': main()
