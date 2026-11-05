import { expect, it } from 'vitest';
import {
  TemporaryOcrImage,
  ocrPreview,
  categoryLabel,
  reviewWarning,
} from '../../../src/mobile/src/lib/automaticOcr';

it('explains recognizer conflict and profile confirmation without exposing internal codes', () => {
  expect(reviewWarning('recognizer_conflict')).toContain('không khớp');
  expect(reviewWarning('recognizer_profile_required')).toContain('xác nhận loại');
  expect(reviewWarning('digit_model_unavailable')).toContain('chưa khả dụng');
});

it('keeps an owned image copy and zeroes it on replacement and disposal', () => {
  const image = new TemporaryOcrImage();
  const input = new Uint8Array([1, 2, 3]);
  image.replace(input);
  const previous = image.bytes!;
  input.fill(0);
  expect([...previous]).toEqual([1, 2, 3]);
  image.replace(new Uint8Array([4]));
  expect([...previous]).toEqual([0, 0, 0]);
  const current = image.bytes!;
  image.clear();
  expect([...current]).toEqual([0]);
  expect(image.bytes).toBeNull();
});
it.each([0, 1, 2, 3, 100000])(
  'encodes an in-memory preview without corrupting %i bytes',
  (length) => {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    expect(ocrPreview(bytes).split(',')[1]).toBe(Buffer.from(bytes).toString('base64'));
  },
);
it.each([
  'cccd_front',
  'cccd_back',
  'electricity_mechanical',
  'electricity_digital',
  'water_mechanical',
  'water_digital',
])('labels %s without exposing implementation codes', (category) =>
  expect(categoryLabel(category)).not.toBe('Chưa xác định'),
);
it.each([
  'classification_unavailable',
  'classification_requires_review',
  'multiple_meters',
  'low_confidence',
  'new_warning',
])('presents %s as review guidance', (code) => expect(reviewWarning(code)).not.toContain(code));
