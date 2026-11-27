export { formatMeterReading } from '../../../../../packages/client-core/src/localization';

// Fixed-point arithmetic matches the backend's numeric(18,4) without rounding a
// 14-digit meter reading through a JavaScript floating-point number.
export function normalizedReading(input: string) {
  return input.trim().replace(',', '.');
}
function scaled(input: string) {
  const [whole, fraction = ''] = normalizedReading(input).split('.');
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
}
// Stored historical readings can still contain fractions; only new input is integer.
function validStoredReading(input: string) {
  return /^\d{1,14}(\.\d{1,4})?$/.test(normalizedReading(input));
}
export function integerReadingInput(input: string) {
  return normalizedReading(input).replace(/^(\d+)\.0+$/, '$1');
}
export function readingError(input: string) {
  const value = input.trim();
  if (!value) return 'Vui lòng nhập chỉ số.';
  if (!/^\d+$/.test(value)) return 'Chỉ số phải là số nguyên không âm.';
  if (value.length > 14) return 'Chỉ số không được vượt quá 14 chữ số.';
  return '';
}
export function estimatedConsumption(input: string, previous: string | null) {
  if (previous === null || !validStoredReading(input) || !validStoredReading(previous)) return null;
  const delta = scaled(input) - scaled(previous);
  if (delta < 0n) return null;
  const fraction = (delta % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return (delta / 10000n).toString() + (fraction ? '.' + fraction : '');
}
export function readingDecreased(input: string, previous: string | null) {
  return (
    previous !== null &&
    validStoredReading(input) &&
    validStoredReading(previous) &&
    scaled(input) < scaled(previous)
  );
}
