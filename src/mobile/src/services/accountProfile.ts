import { MobileApiError, type MobileApi } from '../lib/api';
import { normalizeLoginPhone } from '../../../../packages/client-core/src/loginValidation';

// OperationsContracts.cs: ProfileView / ProfileUpdate (UC-03).
export interface AccountProfile {
  userId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  isActive: boolean;
  version: string;
}
export interface ProfileFields {
  fullName: string;
  phone: string;
  email: string;
}
export interface ProfileUpdate {
  fullName: string;
  phone: string | null;
  email: string;
  version: string;
  currentPassword?: string;
}
export const profilePath = '/api/v1/account/profile';

export function decodeProfile(value: unknown): AccountProfile {
  const p = value as Partial<AccountProfile> | null;
  if (
    !p ||
    typeof p.userId !== 'string' ||
    typeof p.fullName !== 'string' ||
    !(p.phone === null || typeof p.phone === 'string') ||
    !(p.email === null || typeof p.email === 'string') ||
    !Array.isArray(p.roles) ||
    !p.roles.every((role) => typeof role === 'string') ||
    typeof p.isActive !== 'boolean' ||
    typeof p.version !== 'string' ||
    !p.version
  )
    throw new MobileApiError(502, 'invalid_response');
  return p as AccountProfile;
}
export async function loadAccountProfile(api: MobileApi, path: string, signal: AbortSignal) {
  return decodeProfile(await api.request<unknown>(path, { signal }));
}
export async function updateAccountProfile(
  api: MobileApi,
  input: ProfileUpdate,
  signal: AbortSignal,
) {
  // Explicit allowlist: never serialize userId, roles or account status.
  return decodeProfile(
    await api.request<unknown>(profilePath, {
      method: 'PUT',
      signal,
      body: JSON.stringify({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        version: input.version,
        ...(input.currentPassword ? { currentPassword: input.currentPassword } : {}),
      }),
    }),
  );
}
export function profileFields(p: AccountProfile): ProfileFields {
  return { fullName: p.fullName, phone: p.phone ?? '', email: p.email ?? '' };
}
// Mirrors LoginIdentifier.NormalizePhone: 8–15 ASCII digits, optional leading +,
// at most 30 input characters; spaces, -, ., (, ) are accepted separators.
export function normalizeProfilePhone(value: string): string | null | undefined {
  if (!value.trim()) return null;
  return normalizeLoginPhone(value);
}
export function validateProfile(
  fields: ProfileFields,
  tenant = false,
): Partial<Record<keyof ProfileFields, string>> {
  const errors: Partial<Record<keyof ProfileFields, string>> = {};
  const name = fields.fullName.trim(),
    email = fields.email.trim();
  if (name.length < 2 || name.length > 150) errors.fullName = 'Nhập họ tên từ 2 đến 150 ký tự.';
  // .NET EmailAddressAttribute accepts one @ with nonempty parts and rejects CR/LF;
  // do not require a dot/TLD that the backend does not require.
  const at = email.indexOf('@');
  if (
    !email ||
    email.length > 256 ||
    /[\r\n]/.test(email) ||
    at <= 0 ||
    at !== email.lastIndexOf('@') ||
    at === email.length - 1
  )
    errors.email = 'Nhập email hợp lệ, tối đa 256 ký tự.';
  if (normalizeProfilePhone(fields.phone) === undefined)
    errors.phone = 'Nhập số điện thoại gồm 8–15 chữ số, có thể bắt đầu bằng +.';
  if (tenant && !fields.phone.trim()) errors.phone = 'Vui lòng nhập số điện thoại.';
  return errors;
}
export function contactChanged(before: AccountProfile, after: AccountProfile) {
  return (
    before.email?.toUpperCase() !== after.email?.toUpperCase() ||
    normalizeProfilePhone(before.phone ?? '') !== normalizeProfilePhone(after.phone ?? '')
  );
}
export function profileError(error: unknown): string {
  if (error instanceof MobileApiError) {
    if (error.code === 'stale_profile_version')
      return 'Hồ sơ đã được cập nhật ở nơi khác. Tải hồ sơ mới trước khi lưu lại.';
    if (error.code === 'email_already_used')
      return 'Email này đã được sử dụng. Vui lòng chọn email khác.';
    if (error.code === 'phone_already_used')
      return 'Số điện thoại này đã được sử dụng. Vui lòng kiểm tra lại.';
    if (error.code === 'current_password_required')
      return 'Vui lòng nhập mật khẩu hiện tại để xác nhận thay đổi liên hệ.';
    if (error.code === 'current_password_invalid') return 'Mật khẩu hiện tại không đúng.';
    if (error.code === 'tenant_profile_phone_required') return 'Vui lòng nhập số điện thoại.';
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền cập nhật hồ sơ này.';
    if (error.status === 404) return 'Chưa tìm thấy hồ sơ của tài khoản này.';
    if (error.status === 400) return 'Thông tin chưa hợp lệ. Kiểm tra các trường rồi thử lại.';
    if (error.status === 502) return 'Chưa đọc được hồ sơ từ máy chủ. Vui lòng thử lại.';
  }
  return 'Chưa thể kết nối hoặc lưu hồ sơ. Vui lòng thử lại.';
}
