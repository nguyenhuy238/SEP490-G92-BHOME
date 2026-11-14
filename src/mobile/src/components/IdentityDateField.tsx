import React, { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { IconButton, TextInput } from 'react-native-paper';
import { DatePickerModal, registerTranslation } from 'react-native-paper-dates';
import { inputDate } from '../lib/identity';

registerTranslation('vi', {
  save: 'Chọn ngày',
  selectSingle: 'Chọn ngày',
  selectMultiple: 'Chọn các ngày',
  selectRange: 'Chọn khoảng ngày',
  notAccordingToDateFormat: (format) => `Nhập ngày theo ${format}`,
  mustBeHigherThan: (date) => `Ngày phải sau ${date}`,
  mustBeLowerThan: (date) => `Ngày phải trước ${date}`,
  mustBeBetween: (from, to) => `Ngày phải từ ${from} đến ${to}`,
  dateIsDisabled: 'Ngày không thể chọn',
  previous: 'Tháng trước',
  next: 'Tháng sau',
  typeInDate: 'Nhập ngày',
  pickDateFromCalendar: 'Chọn từ lịch',
  close: 'Đóng lịch',
  hour: 'Giờ',
  minute: 'Phút',
});

export function IdentityDateField({
  label,
  accessibilityLabel,
  value,
  onChange,
  onBlur,
  disabled,
  error,
}: {
  label: string;
  accessibilityLabel: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled: boolean;
  error: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setOpen(false);
    });
    return () => subscription.remove();
  }, []);
  let date: Date | undefined;
  try {
    const [year, month, day] = inputDate(value)!.split('-').map(Number);
    date = new Date(year, month - 1, day, 12);
  } catch {
    // An empty/invalid manual value must not silently roll over to another day.
  }
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TextInput
          mode="outlined"
          label={label}
          accessibilityLabel={accessibilityLabel}
          placeholder="dd/MM/yyyy"
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          keyboardType="numbers-and-punctuation"
          disabled={disabled}
          error={error}
          style={{ flex: 1, minHeight: 50, backgroundColor: '#FFFFFF' }}
        />
        <IconButton
          icon="calendar-month-outline"
          accessibilityLabel={`Chọn ${accessibilityLabel}`}
          disabled={disabled}
          onPress={() => setOpen(true)}
        />
      </View>
      {open && !disabled && (
        <DatePickerModal
          locale="vi"
          mode="single"
          visible
          label={label.replace(' *', '')}
          saveLabel="Chọn ngày"
          date={date}
          startWeekOnMonday
          allowEditing={false}
          onDismiss={() => setOpen(false)}
          onConfirm={({ date: selected }) => {
            if (selected && !disabled) {
              onChange(
                `${String(selected.getDate()).padStart(2, '0')}/${String(selected.getMonth() + 1).padStart(2, '0')}/${String(selected.getFullYear()).padStart(4, '0')}`,
              );
            }
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
