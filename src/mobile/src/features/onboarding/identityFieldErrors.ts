import { inputDate, type IdentityFields } from '../../lib/identity';

// Display the existing confirmedIdentity validation per field; no additional admission rules.
export function identityFieldErrors(
  fields: IdentityFields,
): Partial<Record<keyof IdentityFields, string>> {
  const errors: Partial<Record<keyof IdentityFields, string>> = {};
  if (!/^[0-9]{12}$/.test(fields.citizenIdentityNumber.trim()))
    errors.citizenIdentityNumber = 'Nhập đủ 12 chữ số CCCD.';
  if (!fields.fullName.trim()) errors.fullName = 'Nhập họ và tên theo giấy tờ.';
  for (const key of ['dateOfBirth', 'dateOfIssue', 'dateOfExpiry'] as const) {
    if (key !== 'dateOfBirth' && !fields[key]) continue;
    try {
      inputDate(fields[key]);
    } catch {
      errors[key] = 'Nhập ngày hợp lệ theo dd/MM/yyyy.';
    }
  }
  return errors;
}
