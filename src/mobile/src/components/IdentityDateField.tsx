import React, { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, View } from 'react-native';
import { IconButton, TextInput, useTheme } from 'react-native-paper';
import {
  DatePickerModal,
  DatePickerModalContent,
  registerTranslation,
  type DatePickerModalSingleProps,
} from 'react-native-paper-dates';
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
  hyphenated = false,
  compactCalendar = false,
}: {
  label: string;
  accessibilityLabel: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled: boolean;
  error?: boolean;
  hyphenated?: boolean;
  compactCalendar?: boolean;
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
    const [year, month, day] = inputDate(hyphenated ? value.replaceAll('-', '/') : value)!
      .split('-')
      .map(Number);
    date = new Date(year, month - 1, day, 12);
  } catch {
    // An empty/invalid manual value must not silently roll over to another day.
  }
  const picker: Omit<DatePickerModalSingleProps, 'visible'> = {
    locale: 'vi',
    mode: 'single',
    label: label.replace(' *', ''),
    saveLabel: 'Chọn ngày',
    date,
    startWeekOnMonday: true,
    allowEditing: false,
    onDismiss: () => setOpen(false),
    onConfirm: ({ date: selected }) => {
      if (selected && !disabled) {
        const separator = hyphenated ? '-' : '/';
        onChange(
          `${String(selected.getDate()).padStart(2, '0')}${separator}${String(selected.getMonth() + 1).padStart(2, '0')}${separator}${String(selected.getFullYear()).padStart(4, '0')}`,
        );
      }
      setOpen(false);
    },
  };
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TextInput
          mode="outlined"
          label={label}
          accessibilityLabel={accessibilityLabel}
          placeholder={hyphenated ? 'dd-MM-yyyy' : 'dd/MM/yyyy'}
          value={value}
          onChangeText={(text) => {
            if (!hyphenated) {
              onChange(text);
              return;
            }
            if (value.endsWith('-') && text === value.slice(0, -1)) {
              onChange(text);
              return;
            }
            const digits = text.replace(/\D/g, '').slice(0, 8);
            onChange(
              digits.replace(/^(\d{2})(\d{2})?/, (_, day, month) =>
                month ? `${day}-${month}-` : `${day}-`,
              ),
            );
          }}
          onBlur={onBlur}
          keyboardType={hyphenated ? 'number-pad' : 'numbers-and-punctuation'}
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
      {open &&
        !disabled &&
        (compactCalendar ? (
          <CompactCalendar {...picker} />
        ) : (
          <DatePickerModal {...picker} visible />
        ))}
    </>
  );
}

function CompactCalendar(picker: Omit<DatePickerModalSingleProps, 'visible'>) {
  const theme = useTheme();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={picker.onDismiss}>
      <View style={styles.overlay}>
        <Pressable
          accessible={false}
          onPress={picker.onDismiss}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.backdrop }]}
        />
        <View
          accessibilityViewIsModal
          style={[styles.popup, { backgroundColor: theme.colors.elevation.level3 }]}
        >
          <DatePickerModalContent {...picker} disableSafeTop disableStatusBar />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  popup: {
    width: '90%',
    maxWidth: 360,
    height: 500,
    maxHeight: '92%',
    borderRadius: 24,
    overflow: 'hidden',
  },
});
