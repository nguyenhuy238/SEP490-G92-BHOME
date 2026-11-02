import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { inputDate } from '../lib/identity';

export function ContractDateField({
  label,
  value,
  onChange,
  disabled,
  error,
  onCalendarChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error?: string;
  onCalendarChange?: (close: (() => void) | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  function show() {
    try {
      const raw = inputDate(value)!;
      setMonth(new Date(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)) - 1, 1));
    } catch {
      /* Keep current month for an empty/invalid input. */
    }
    setOpen(true);
    onCalendarChange?.(close);
  }
  function close() {
    setOpen(false);
    onCalendarChange?.(null);
  }
  const year = month.getFullYear(),
    index = month.getMonth(),
    days = new Date(year, index + 1, 0).getDate();
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.row}>
        <TextInput
          mode="outlined"
          style={{ flex: 1 }}
          label={label.replace(' (dd/MM/yyyy)', '')}
          placeholder="dd/MM/yyyy"
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          disabled={disabled}
          error={!!error}
          keyboardType="numbers-and-punctuation"
        />
        <IconButton
          icon="calendar-month-outline"
          accessibilityLabel={`Chọn ${label}`}
          disabled={disabled}
          onPress={show}
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: '#B91C1C' }}>
          {error}
        </Text>
      )}
      <Portal>
        <Dialog visible={open} onDismiss={close}>
          <Dialog.Title>{label}</Dialog.Title>
          <Dialog.Content>
            <View style={styles.row}>
              <IconButton
                icon="chevron-left"
                accessibilityLabel="Tháng trước"
                onPress={() => setMonth(new Date(year, index - 1, 1))}
              />
              <Text style={{ flex: 1, textAlign: 'center' }}>
                Tháng {index + 1}/{year}
              </Text>
              <IconButton
                icon="chevron-right"
                accessibilityLabel="Tháng sau"
                onPress={() => setMonth(new Date(year, index + 1, 1))}
              />
            </View>
            <View style={styles.days}>
              {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
                <Button
                  compact
                  key={day}
                  style={styles.day}
                  accessibilityLabel={`Ngày ${day}/${index + 1}/${year}`}
                  onPress={() => {
                    onChange(
                      `${String(day).padStart(2, '0')}/${String(index + 1).padStart(2, '0')}/${year}`,
                    );
                    close();
                  }}
                >
                  {day}
                </Button>
              ))}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={close}>Đóng lịch</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  days: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { minWidth: 44, minHeight: 44, width: '14.28%' },
});
