import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import type { Named } from '../lib/api';
export const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  row: { gap: 8 },
  error: { color: '#b91c1c' },
  note: { color: '#475569' },
  card: { borderWidth: 1, borderColor: '#d1d5db', padding: 14, borderRadius: 12, gap: 8 },
});
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      {children}
    </ScrollView>
  );
}
export function Field({
  label,
  value,
  onChange,
  secure = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  numeric?: boolean;
}) {
  return (
    <TextInput
      mode="outlined"
      label={label}
      value={value}
      onChangeText={onChange}
      secureTextEntry={secure}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={numeric ? 'decimal-pad' : 'default'}
    />
  );
}
export function Select({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: Named[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.row}>
      <Text variant="titleSmall">{label}</Text>
      {items.length === 0 && <Text>Chưa có dữ liệu.</Text>}
      {items.map((item) => (
        <Button
          key={item.id}
          mode={selected === item.id ? 'contained-tonal' : 'outlined'}
          onPress={() => onSelect(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </View>
  );
}
