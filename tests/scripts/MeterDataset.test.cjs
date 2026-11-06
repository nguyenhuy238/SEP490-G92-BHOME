const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { validateMeterDataset } = require('../../scripts/Validate-MeterDataset.cjs');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bhome-meter-dataset-'));
  try {
    // Synthetic one-pixel PNG; no identity or real meter images.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ8kAAAAASUVORK5CYII=',
      'base64',
    );
    fs.writeFileSync(path.join(root, 'synthetic.png'), png);
    const sample = {
      id: 'sample_1',
      image: 'synthetic.png',
      sha256: nodeCrypto.createHash('sha256').update(png).digest('hex'),
      meterGroup: 'meter_1',
      siteGroup: 'site_1',
      split: 'test',
      category: 'water_mechanical',
      meterPolygon: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      windowPolygon: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.5],
        [0.1, 0.5],
      ],
      reading: {
        digits: '00123',
        digitCount: 5,
        decimalPlaces: 2,
        billingRegister: 'total_volume',
        displayState: 'single',
        unreadablePositions: [],
      },
      quality: { blur: false, glare: false },
      provenance: { kind: 'synthetic', license: 'CC0-1.0' },
    };
    run(root, { version: 1, samples: [sample] }, sample);
  } finally {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'bhome-meter-dataset-'),
    );
    fs.rmSync(root, { recursive: true });
  }
}
test('keeps leading zeros and permits known or unverified decimal precision', () =>
  fixture((root, m, s) => {
    assert.equal(validateMeterDataset(m, root).valid, true);
    s.reading.decimalPlaces = null;
    assert.equal(validateMeterDataset(m, root).valid, true);
    assert.equal(s.reading.digits, '00123');
  }));

test('blank and status displays have no invented zero digits or precision', () =>
  fixture((root, m, s) => {
    s.category = 'water_digital';
    s.reading = { visibility: 'blank', digits: null, digitCount: 0, decimalPlaces: null,
      billingRegister: 'unknown', displayState: 'single', unreadablePositions: [] };
    assert.equal(validateMeterDataset(m, root).valid, true);
    s.reading.visibility = 'status';
    assert.equal(validateMeterDataset(m, root).valid, true);
    s.reading.digits = '000000';
    assert.ok(validateMeterDataset(m, root).errors.some(e => e.code === 'non_numeric_display_has_reading'));
    s.reading.digits = null;
    s.reading.decimalPlaces = 0;
    assert.equal(validateMeterDataset(m, root).valid, false);
    s.reading.decimalPlaces = null;
    s.reading.visibility = 'unverified_model_output';
    assert.ok(validateMeterDataset(m, root).errors.some(e => e.code === 'invalid_display_visibility'));
  }));
test('accepts explicit detection-only annotations without fabricated reading labels', () =>
  fixture((root, m, s) => {
    s.annotationLevel = 'meter';
    s.windowPolygon = null;
    s.reading = null;
    assert.equal(validateMeterDataset(m, root).valid, true);
    s.reading = { digits: '123' };
    assert.ok(
      validateMeterDataset(m, root).errors.some(
        (e) => e.code === 'detection_only_has_reading_labels',
      ),
    );
  }));
test('detection-only mode still rejects a missing meter polygon', () =>
  fixture((root, m, s) => {
    s.annotationLevel = 'meter';
    s.meterPolygon = null;
    s.windowPolygon = null;
    s.reading = null;
    assert.ok(validateMeterDataset(m, root).errors.some((e) => e.code === 'invalid_polygons'));
  }));
test('rejects cross-split source, capture and near-duplicate groups', () =>
  fixture((root, m, s) => {
    for (const field of ['sourceGroup', 'captureGroup', 'nearDuplicateGroup']) {
      s[field] = 'shared';
      m.samples = [
        s,
        { ...s, id: 'second', meterGroup: 'second', siteGroup: 'second', split: 'train' },
      ];
      assert.ok(
        validateMeterDataset(m, root).errors.some((e) => e.code === 'training_group_split_leakage'),
      );
      delete s[field];
    }
  }));
const invalid = [
  ['identity category', (s) => (s.category = 'cccd_front'), 'invalid_category'],
  ['missing category', (s) => delete s.category, 'invalid_category'],
  ['absolute path', (s) => (s.image = 'C:/private/photo.png'), 'unsafe_image_path'],
  ['path traversal', (s) => (s.image = '../outside.png'), 'unsafe_image_path'],
  ['missing file', (s) => (s.image = 'missing.png'), 'missing_or_unreadable_image'],
  ['hash mismatch', (s) => (s.sha256 = '00'), 'image_hash_mismatch'],
  ['numeric digits lose zeros', (s) => (s.reading.digits = 123), 'invalid_exact_digits'],
  ['decimal range', (s) => (s.reading.decimalPlaces = 5), 'invalid_decimal_places'],
  ['digit count mismatch', (s) => (s.reading.digitCount = 8), 'invalid_exact_digits'],
  [
    'wrong utility register',
    (s) => (s.reading.billingRegister = 'total_energy'),
    'register_utility_mismatch',
  ],
  ['missing register', (s) => delete s.reading.billingRegister, 'invalid_register'],
  ['missing display state', (s) => delete s.reading.displayState, 'invalid_display_state'],
  ['missing quality', (s) => delete s.quality, 'missing_quality_labels'],
  ['missing license', (s) => delete s.provenance.license, 'missing_provenance'],
  [
    'private image without permission',
    (s) => (s.provenance.kind = 'authorized-private'),
    'missing_private_permission',
  ],
  ['public image without source', (s) => (s.provenance.kind = 'public'), 'missing_public_source'],
  [
    'crossed window polygon',
    (s) =>
      (s.windowPolygon = [
        [0.1, 0.1],
        [0.9, 0.5],
        [0.9, 0.1],
        [0.1, 0.5],
      ]),
    'invalid_polygons',
  ],
  [
    'outside window',
    (s) =>
      (s.meterPolygon = [
        [0, 0],
        [0.5, 0],
        [0.5, 1],
        [0, 1],
      ]),
    'window_outside_meter',
  ],
  ['nonfinite polygon', (s) => (s.windowPolygon[0][0] = NaN), 'invalid_polygons'],
];
for (const [name, mutate, code] of invalid)
  test(`rejects ${name}`, () =>
    fixture((root, m, s) => {
      mutate(s);
      const result = validateMeterDataset(m, root);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.code === code));
    }));
test('unreadable positions require a null exact string rather than invented digits', () =>
  fixture((root, m, s) => {
    s.reading.unreadablePositions = [4];
    assert.equal(validateMeterDataset(m, root).valid, false);
    s.reading.digits = null;
    assert.equal(validateMeterDataset(m, root).valid, true);
  }));
test('detects physical meter, site and identical-content leakage between splits', () =>
  fixture((root, m, s) => {
    const second = structuredClone(s);
    second.id = 'sample_2';
    second.split = 'validation';
    m.samples.push(second);
    const codes = validateMeterDataset(m, root).errors.map((e) => e.code);
    for (const expected of [
      'meter_split_leakage',
      'site_split_leakage',
      'duplicate_content_split_leakage',
    ])
      assert.ok(codes.includes(expected));
  }));
test('negative non-meter examples never carry an invented reading', () =>
  fixture((root, m, s) => {
    s.category = 'not_meter';
    assert.equal(validateMeterDataset(m, root).valid, false);
    s.reading = null;
    s.meterPolygon = null;
    s.windowPolygon = null;
    assert.equal(validateMeterDataset(m, root).valid, true);
  }));
test('rejects missing and empty manifests', () =>
  fixture((root) => {
    assert.equal(validateMeterDataset(null, root).valid, false);
    assert.equal(validateMeterDataset({ version: 1, samples: [] }, root).valid, false);
  }));
test('rejects a link that escapes the image root', () =>
  fixture((root, m, s) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bhome-meter-dataset-outside-'));
    try {
      fs.copyFileSync(path.join(root, s.image), path.join(outside, 'outside.png'));
      fs.symlinkSync(
        outside,
        path.join(root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      s.image = 'linked/outside.png';
      assert.ok(validateMeterDataset(m, root).errors.some((e) => e.code === 'unsafe_image_path'));
    } finally {
      fs.unlinkSync(path.join(root, 'linked'));
      fs.unlinkSync(path.join(outside, 'outside.png'));
      fs.rmdirSync(outside);
    }
  }));
