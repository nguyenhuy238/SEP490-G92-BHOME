/** Contact numbers: Vietnamese mobile/landline, or an explicitly international number.
 * Keep login normalization separate so existing account aliases remain readable. */
export function normalizeContactPhone(value: string): string | undefined {
  if (value.length > 30) return undefined;
  const compact = value.trim().replace(/[ .()-]/g, '');
  if (/^0(?:[35789][0-9]{8}|2[0-9]{9})$/.test(compact)) return '+84' + compact.slice(1);
  if (compact.startsWith('+84'))
    return /^\+84(?:[35789][0-9]{8}|2[0-9]{9})$/.test(compact) ? compact : undefined;
  return /^\+[1-9][0-9]{7,14}$/.test(compact) ? compact : undefined;
}

export function contactPhoneError(value: string, required = false): string {
  if (!value.trim()) return required ? 'Vui lòng nhập số điện thoại.' : '';
  return normalizeContactPhone(value)
    ? ''
    : 'Nhập số điện thoại Việt Nam hợp lệ hoặc số quốc tế có mã nước (+).';
}
