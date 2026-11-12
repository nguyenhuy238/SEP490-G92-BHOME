export const locale = 'vi-VN';
export const currency = 'VND';
export const businessTimeZone = 'Asia/Ho_Chi_Minh';
// Callers validate unsigned integer digits. String grouping also works on native
// Intl implementations that cannot format BigInt, without losing large amounts.
export const groupVietnameseIntegerDigits = (digits: string) =>
  digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const formatVnd = (value: number) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
export const formatInstant = (isoInstant: string) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: businessTimeZone,
  }).format(new Date(isoInstant));

/**
 * Formats electricity and water meter readings and consumption values
 * following Vietnamese conventions:
 * - Dots (.) as thousands separators
 * - Commas (,) as decimal separator
 * - Removes unnecessary trailing decimal zeros (e.g. 55555.0000 -> 55.555)
 * - Removes decimal separator when the fractional part is zero (e.g. 150.0000 -> 150)
 * - Preserves all meaningful decimal digits without rounding (e.g. 1234.5000 -> 1.234,5, 1234.5678 -> 1.234,5678)
 * - Safely handles 0 / 0.0000 -> "0"
 * - Optionally appends unit if provided (e.g. "55.555 kWh", "65.555 m³")
 */
export function formatMeterReading(
  value: string | number | null | undefined,
  unit?: string,
): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const isNegative = raw.startsWith('-');
  const unsigned = isNegative ? raw.slice(1).trim() : raw;
  const normalized = unsigned.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return unit ? `${raw} ${unit}` : raw;
  }
  const [rawInteger, rawFraction = ''] = normalized.split('.');
  const fraction = rawFraction.replace(/0+$/, '');
  const cleanInteger = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const formattedInteger = cleanInteger.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const formatted = fraction ? `${formattedInteger},${fraction}` : formattedInteger;
  const signed = isNegative ? `-${formatted}` : formatted;
  return unit ? `${signed} ${unit}` : signed;
}

