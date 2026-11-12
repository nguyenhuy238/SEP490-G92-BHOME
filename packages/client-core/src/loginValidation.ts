export const invalidCredentialsMessage =
  'Email, số điện thoại hoặc mật khẩu không chính xác. Vui lòng kiểm tra và thử lại.';

export function normalizeLoginPhone(value: string): string | undefined {
  if (value.length > 30) return undefined;
  const phone = value.trim().replace(/[ .()-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(phone)) return undefined;
  return /^0[0-9]{9,10}$/.test(phone) ? '+84' + phone.slice(1) : phone;
}

export function loginIdentifierError(value: string): string {
  const identifier = value.trim();
  if (!identifier) return 'Vui lòng nhập email hoặc số điện thoại.';
  if (identifier.includes('@') || /[a-z]/i.test(identifier)) {
    return value.length <= 256 && /^[^\s@]+@[^\s@]+$/.test(identifier)
      ? ''
      : 'Email không đúng định dạng.';
  }
  return normalizeLoginPhone(value) ? '' : 'Số điện thoại không đúng định dạng.';
}

export function loginPasswordError(value: string): string {
  if (!value.trim()) return 'Vui lòng nhập mật khẩu.';
  return value.length > 1024 ? 'Mật khẩu vượt quá độ dài cho phép.' : '';
}

export function loginPayload(identifier: string, password: string) {
  return identifier.includes('@')
    ? { email: identifier.trim(), password }
    : { phone: normalizeLoginPhone(identifier) ?? identifier.trim(), password };
}
