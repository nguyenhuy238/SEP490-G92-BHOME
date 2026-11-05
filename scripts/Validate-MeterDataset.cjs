// Offline annotation validation. No image upload, model training or mutation.
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const categories = new Set([
  'electricity_mechanical',
  'electricity_digital',
  'water_mechanical',
  'water_digital',
  'not_meter',
]);
const splits = new Set(['train', 'validation', 'test']);
const opaque = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s);
function polygon(p) {
  if (
    !Array.isArray(p) ||
    p.length !== 4 ||
    p.some(
      (v) =>
        !Array.isArray(v) || v.length !== 2 || v.some((n) => !Number.isFinite(n) || n < 0 || n > 1),
    )
  )
    return false;
  const crosses = p.map((v, i) => {
    const b = p[(i + 1) % 4],
      c = p[(i + 2) % 4];
    return (b[0] - v[0]) * (c[1] - b[1]) - (b[1] - v[1]) * (c[0] - b[0]);
  });
  return crosses.every((n) => n > 1e-8) || crosses.every((n) => n < -1e-8);
}
function inside(point, p) {
  const crosses = p.map((a, i) => {
    const b = p[(i + 1) % 4];
    return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
  });
  return crosses.every((n) => n >= -1e-8) || crosses.every((n) => n <= 1e-8);
}
function validateMeterDataset(manifest, imageRoot) {
  const errors = [],
    counts = Object.create(null);
  const issue = (index, code) => errors.push({ index, code });
  if (
    !manifest ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.samples) ||
    !manifest.samples.length
  )
    return { valid: false, errors: [{ index: null, code: 'invalid_manifest' }], counts };
  let root;
  try {
    root = fs.realpathSync(imageRoot);
  } catch {
    return { valid: false, errors: [{ index: null, code: 'missing_image_root' }], counts };
  }
  const ids = new Set(),
    files = new Set(),
    hashes = new Map(),
    meters = new Map(),
    sites = new Map(),
    extraGroups = new Map();
  manifest.samples.forEach((s, index) => {
    if (!s || typeof s !== 'object') {
      issue(index, 'invalid_sample');
      return;
    }
    if (!opaque(s.id) || ids.has(s.id)) issue(index, 'invalid_or_duplicate_id');
    ids.add(s.id);
    if (!categories.has(s.category)) issue(index, 'invalid_category');
    if (!splits.has(s.split)) issue(index, 'invalid_split');
    if (!opaque(s.meterGroup) || !opaque(s.siteGroup)) issue(index, 'invalid_group');
    for (const [map, key, code] of [
      [meters, s.meterGroup, 'meter_split_leakage'],
      [sites, s.siteGroup, 'site_split_leakage'],
    ]) {
      if (map.has(key) && map.get(key) !== s.split) issue(index, code);
      map.set(key, s.split);
    }
    // Optional for existing complete-reading manifests; required by the training
    // exporter. Group IDs are declarations to audit, not discovered identities.
    for (const field of ['sourceGroup', 'captureGroup', 'nearDuplicateGroup']) {
      if (s[field] === undefined) continue;
      if (!opaque(s[field])) issue(index, 'invalid_training_group');
      const key = `${field}:${s[field]}`;
      if (extraGroups.has(key) && extraGroups.get(key) !== s.split)
        issue(index, 'training_group_split_leakage');
      extraGroups.set(key, s.split);
    }
    if (s.annotationLevel !== undefined && !['meter', 'complete'].includes(s.annotationLevel))
      issue(index, 'invalid_annotation_level');
    if (
      !s.provenance ||
      !['public', 'synthetic', 'authorized-private'].includes(s.provenance.kind) ||
      typeof s.provenance.license !== 'string' ||
      !s.provenance.license.trim()
    )
      issue(index, 'missing_provenance');
    else if (s.provenance.kind === 'public' && !/^https:\/\//.test(s.provenance.sourceUrl || ''))
      issue(index, 'missing_public_source');
    else if (s.provenance.kind === 'authorized-private' && !opaque(s.provenance.permissionRef))
      issue(index, 'missing_private_permission');
    if (!s.quality || typeof s.quality.blur !== 'boolean' || typeof s.quality.glare !== 'boolean')
      issue(index, 'missing_quality_labels');
    if (
      typeof s.image !== 'string' ||
      !s.image ||
      path.isAbsolute(s.image) ||
      s.image.includes(':') ||
      s.image.split(/[\\/]/).some((p) => p === '..')
    ) {
      issue(index, 'unsafe_image_path');
    } else {
      try {
        const file = fs.realpathSync(path.resolve(root, s.image));
        if (!file.startsWith(root + path.sep)) issue(index, 'unsafe_image_path');
        else {
          if (files.has(file)) issue(index, 'duplicate_image');
          files.add(file);
          if (!/\.(png|jpe?g)$/i.test(file)) issue(index, 'unsupported_image');
          if (fs.statSync(file).size > 20 * 1024 * 1024) {
            issue(index, 'image_too_large');
            return;
          }
          const content = fs.readFileSync(file);
          const png = content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          const jpeg =
            content.length > 2 && content[0] === 255 && content[1] === 216 && content[2] === 255;
          if (!png && !jpeg) issue(index, 'invalid_image_content');
          const hash = nodeCrypto.createHash('sha256').update(content).digest('hex');
          if (hash !== s.sha256) issue(index, 'image_hash_mismatch');
          if (hashes.has(hash) && hashes.get(hash) !== s.split)
            issue(index, 'duplicate_content_split_leakage');
          hashes.set(hash, s.split);
        }
      } catch {
        issue(index, 'missing_or_unreadable_image');
      }
    }
    if (s.category === 'not_meter') {
      if (s.meterPolygon !== null || s.windowPolygon !== null || s.reading !== null)
        issue(index, 'negative_has_meter_labels');
    } else if (s.annotationLevel === 'meter') {
      // Detection-only data must not invent a window, reading or precision.
      if (!polygon(s.meterPolygon)) issue(index, 'invalid_polygons');
      if (s.windowPolygon !== null || s.reading !== null)
        issue(index, 'detection_only_has_reading_labels');
    } else {
      if (!polygon(s.meterPolygon) || !polygon(s.windowPolygon)) issue(index, 'invalid_polygons');
      else if (!s.windowPolygon.every((p) => inside(p, s.meterPolygon)))
        issue(index, 'window_outside_meter');
      const r = s.reading;
      if (
        !r ||
        !Number.isInteger(r.digitCount) ||
        r.digitCount < 1 ||
        r.digitCount > 12 ||
        !Array.isArray(r.unreadablePositions) ||
        new Set(r.unreadablePositions).size !== r.unreadablePositions.length ||
        r.unreadablePositions.some((p) => !Number.isInteger(p) || p < 0 || p >= r.digitCount)
      )
        issue(index, 'invalid_digit_layout');
      else {
        if (
          r.unreadablePositions.length
            ? r.digits !== null
            : typeof r.digits !== 'string' ||
              !/^[0-9]+$/.test(r.digits) ||
              r.digits.length !== r.digitCount
        )
          issue(index, 'invalid_exact_digits');
        if (
          r.decimalPlaces !== null &&
          (!Number.isInteger(r.decimalPlaces) ||
            r.decimalPlaces < 0 ||
            r.decimalPlaces > 4 ||
            r.decimalPlaces >= r.digitCount)
        )
          issue(index, 'invalid_decimal_places');
        if (!['single', 'multiple', 'unknown'].includes(r.displayState))
          issue(index, 'invalid_display_state');
        if (
          !['total_energy', 'total_volume', 'flow_rate', 'other', 'unknown'].includes(
            r.billingRegister,
          )
        )
          issue(index, 'invalid_register');
        if (
          (String(s.category).startsWith('water_') && r.billingRegister === 'total_energy') ||
          (String(s.category).startsWith('electricity_') &&
            ['total_volume', 'flow_rate'].includes(r.billingRegister))
        )
          issue(index, 'register_utility_mismatch');
      }
    }
    if (categories.has(s.category)) counts[s.category] = (counts[s.category] || 0) + 1;
  });
  return { valid: errors.length === 0, errors, counts, samples: manifest.samples.length };
}
module.exports = { validateMeterDataset };
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('usage');
    const result = validateMeterDataset(
      JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
      process.argv[3],
    );
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write(
      'Cannot validate dataset. Usage: node scripts/Validate-MeterDataset.cjs <manifest.json> <image-root>\n',
    );
    process.exitCode = 2;
  }
}
