// Fixed-point arithmetic matches the backend's numeric(18,4) without rounding a
// 14-digit meter reading through a JavaScript floating-point number.
export function normalizedReading(input: string) {
  return input.trim().replace(',', '.');
}
function scaled(input: string) {
  const [whole, fraction = ''] = normalizedReading(input).split('.');
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
}
export function readingError(input: string, decimalPlaces: number) {
  const value = normalizedReading(input);
  if (!value) return 'Vui lòng nhập chỉ số xác nhận.';
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(value))
    return 'Nhập số không âm, tối đa 14 chữ số nguyên và 4 chữ số thập phân.';
  if ((value.split('.')[1] ?? '').slice(decimalPlaces).replace(/0/g, ''))
    return `Công tơ này cho phép tối đa ${decimalPlaces} chữ số thập phân.`;
  return '';
}
export function estimatedConsumption(input: string, previous: string | null) {
  if (previous === null || readingError(input, 4) || readingError(previous, 4)) return null;
  const delta = scaled(input) - scaled(previous);
  if (delta < 0n) return null;
  const fraction = (delta % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return (delta / 10000n).toString() + (fraction ? '.' + fraction : '');
}
export function readingDecreased(input: string, previous: string | null) {
  return (
    previous !== null &&
    !readingError(input, 4) &&
    !readingError(previous, 4) &&
    scaled(input) < scaled(previous)
  );
}
