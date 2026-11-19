import React from 'react';
import { View } from 'react-native';
import { HelperText, Text, TextInput } from 'react-native-paper';
import type { OnboardingPerson } from './onboarding';
import { inputDate } from '../../lib/identity';

export const emptyMember = () => ({
  fullName: '',
  dateOfBirth: '',
  relationship: '',
  phone: '',
  citizenNumber: '',
});
export function memberReady(person: OnboardingPerson) {
  const m = person.member;
  let dob: string | null = null;
  try {
    if (m?.dateOfBirth.trim()) dob = inputDate(m.dateOfBirth);
  } catch {
    return false;
  }
  return (
    !!m &&
    !!m.fullName.trim() &&
    m.fullName.trim().length <= 150 &&
    !!dob &&
    dob <= new Date().toISOString().slice(0, 10) &&
    !!m.relationship.trim() &&
    m.relationship.length <= 100 &&
    (!m.citizenNumber.trim() || /^\d{12}$/.test(m.citizenNumber.trim())) &&
    (!m.phone.trim() || /^(?:0|\+84|84)\d{9,10}$/.test(m.phone.replace(/[\s().-]/g, '')))
  );
}
function fieldError(field: string, value: string) {
  if (!value.trim()) return '';
  if (field === 'dateOfBirth') {
    try {
      if (inputDate(value)! > new Date().toISOString().slice(0, 10))
        return 'Ngày sinh không được ở tương lai.';
    } catch {
      return 'Nhập ngày sinh hợp lệ theo dd/MM/yyyy.';
    }
  }
  if (field === 'citizenNumber' && !/^\d{12}$/.test(value.trim()))
    return 'CCCD gồm 12 chữ số, hoặc để trống nếu chưa có.';
  if (field === 'phone' && !/^(?:0|\+84|84)\d{9,10}$/.test(value.replace(/[\s().-]/g, '')))
    return 'Số điện thoại chưa hợp lệ.';
  return '';
}
export function HouseholdMemberEditor({
  person,
  disabled,
  onChange,
}: {
  person: OnboardingPerson;
  disabled: boolean;
  onChange: (value: NonNullable<OnboardingPerson['member']>) => void;
}) {
  const m = person.member ?? emptyMember();
  return (
    <View style={{ gap: 12, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 14 }}>
      <Text variant="titleMedium">Thông tin thành viên</Text>
      <Text>
        Nhập họ tên, ngày sinh và quan hệ với người đại diện. Số điện thoại và CCCD không bắt buộc.
      </Text>
      {(
        [
          ['fullName', 'Họ tên thành viên'],
          ['dateOfBirth', 'Ngày sinh thành viên (dd/MM/yyyy)'],
          ['relationship', 'Quan hệ với người đại diện'],
          ['phone', 'Số điện thoại (nếu có)'],
          ['citizenNumber', 'CCCD (nếu có)'],
        ] as const
      ).map(([field, label]) => (
        <View key={field}>
          <TextInput
            label={label}
            accessibilityLabel={label}
            mode="outlined"
            value={m[field]}
            disabled={disabled}
            error={!!fieldError(field, m[field])}
            maxLength={
              field === 'citizenNumber'
                ? 12
                : field === 'phone'
                  ? 30
                  : field === 'dateOfBirth'
                    ? 10
                    : field === 'relationship'
                      ? 100
                      : 150
            }
            keyboardType={
              field === 'phone' ? 'phone-pad' : field === 'citizenNumber' ? 'number-pad' : 'default'
            }
            onChangeText={(value) => onChange({ ...m, [field]: value })}
          />
          {!!fieldError(field, m[field]) && (
            <HelperText type="error" accessibilityRole="alert">
              {fieldError(field, m[field])}
            </HelperText>
          )}
        </View>
      ))}
      <Text>CCCD không bắt buộc với thành viên. Thông tin chỉ được lưu khi hoàn tất bước này.</Text>
    </View>
  );
}
