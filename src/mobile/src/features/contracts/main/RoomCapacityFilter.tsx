import React from 'react';
import { TextInput } from 'react-native-paper';

export function RoomCapacityFilter({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <TextInput
      mode="outlined"
      label="Sức chứa tối thiểu"
      accessibilityLabel="Sức chứa tối thiểu"
      placeholder="Số người"
      keyboardType="number-pad"
      maxLength={5}
      disabled={disabled}
      value={value}
      onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
    />
  );
}
