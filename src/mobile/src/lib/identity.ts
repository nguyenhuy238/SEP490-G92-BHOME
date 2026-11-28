import type { Proposal } from './api';
export const identityFields = [
  ['citizenIdentityNumber', 'Số CCCD (12 chữ số)'],
  ['fullName', 'Họ và tên'],
  ['dateOfBirth', 'Ngày sinh (dd/MM/yyyy)'],
  ['gender', 'Giới tính'],
  ['nationality', 'Quốc tịch'],
  ['placeOfOrigin', 'Quê quán'],
  ['residentialAddress', 'Nơi cư trú'],
  ['dateOfIssue', 'Ngày cấp (dd/MM/yyyy)'],
  ['dateOfExpiry', 'Ngày hết hạn (dd/MM/yyyy)'],
] as const;
export type IdentityFields = Record<(typeof identityFields)[number][0], string>;
export function emptyIdentity(): IdentityFields {
  return Object.fromEntries(identityFields.map(([key]) => [key, ''])) as IdentityFields;
}
export function displayDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso;
}
export function inputDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error('date');
  const [, d, m, y] = match;
  const date = new Date(Date.UTC(+y!, +m! - 1, +d!));
  if (date.getUTCFullYear() !== +y! || date.getUTCMonth() + 1 !== +m! || date.getUTCDate() !== +d!)
    throw new Error('date');
  return `${y}-${m}-${d}`;
}
export function mergeIdentity(
  current: IdentityFields,
  proposal: Proposal,
  options: { unaccentedName?: boolean } = {},
): { fields: IdentityFields; conflicts: string[] } {
  const fields = { ...current };
  const conflicts: string[] = [];
  const incomingIdentity = proposal.proposedFields.citizenIdentityNumber;
  const identityDisagrees =
    !!fields.citizenIdentityNumber &&
    !!incomingIdentity &&
    fields.citizenIdentityNumber !== incomingIdentity;
  if (identityDisagrees)
    return {
      fields,
      conflicts: identityFields
        .filter(([key]) => !!proposal.proposedFields[key])
        .map(([key]) => key),
    };
  for (const [key] of identityFields) {
    const raw = proposal.proposedFields[key];
    if (!raw) continue;
    const value = key.startsWith('dateOf') ? displayDate(raw) : raw;
    if (
      key === 'fullName' &&
      !identityDisagrees &&
      fields.fullName &&
      foldIdentityName(fields.fullName) === foldIdentityName(value) &&
      (options.unaccentedName || proposal.warnings.includes('mrz_name_unaccented'))
    ) {
      if (options.unaccentedName && !proposal.warnings.includes('mrz_name_unaccented'))
        fields.fullName = value;
    } else if (
      (key === 'residentialAddress' || key === 'placeOfOrigin') &&
      fields[key] &&
      incomingIdentity &&
      incomingIdentity === current.citizenIdentityNumber &&
      value.startsWith(fields[key].trim() + ' ')
    )
      fields[key] = value;
    else if (fields[key] && fields[key] !== value) conflicts.push(key);
    else fields[key] = value;
  }
  return { fields, conflicts };
}
export function foldIdentityName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
export function confirmedIdentity(fields: IdentityFields) {
  if (!/^[0-9]{12}$/.test(fields.citizenIdentityNumber.trim()) || !fields.fullName.trim())
    throw new Error('identity');
  return {
    ...fields,
    citizenIdentityNumber: fields.citizenIdentityNumber.trim(),
    fullName: fields.fullName.trim(),
    humanConfirmed: true,
    dateOfBirth: inputDate(fields.dateOfBirth),
    dateOfIssue: fields.dateOfIssue ? inputDate(fields.dateOfIssue) : null,
    dateOfExpiry: fields.dateOfExpiry ? inputDate(fields.dateOfExpiry) : null,
  };
}
