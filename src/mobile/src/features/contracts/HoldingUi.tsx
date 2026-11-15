import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text } from 'react-native-paper';

// Matches the existing Staff workspace palette while keeping presentation helpers
// independent from the Paper theme bootstrap.
const colors = {
  navy: '#193653',
  green: '#16804A',
  orange: '#CE7B16',
  red: '#D44747',
};

export function HoldingSectionCard({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {title && <Text style={styles.sectionTitle}>{title}</Text>}
      {children}
    </View>
  );
}

export function HoldingInfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.value}>{typeof value === 'string' ? <Text style={styles.valueText}>{value || '—'}</Text> : value ?? <Text style={styles.valueText}>—</Text>}</View>
    </View>
  );
}

export function HoldingStatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'success' | 'warning' | 'error' | 'neutral';
}) {
  const palette = {
    success: { background: '#E8F7EE', text: colors.green },
    warning: { background: '#FFF3E3', text: colors.orange },
    error: { background: '#FDECEC', text: colors.red },
    neutral: { background: '#EFF3F8', text: colors.navy },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Text style={[styles.badgeText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

export function HoldingChecklistRow({
  label,
  complete,
}: {
  label: string;
  complete: boolean;
}) {
  return (
    <View style={styles.checklistRow}>
      <Icon
        source={complete ? 'check-circle' : 'clock-outline'}
        size={20}
        color={complete ? colors.green : '#94A3B8'}
      />
      <Text style={styles.checklistLabel}>{label}</Text>
      <Text style={[styles.checklistState, complete && { color: colors.green }]}>
        {complete ? 'Hoàn tất' : 'Đang chờ'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#17345C' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  label: { fontSize: 13, color: '#64748B', flexShrink: 1 },
  value: { alignItems: 'flex-end', flex: 1, minWidth: 0 },
  valueText: { fontSize: 13, color: '#1F2937', fontWeight: '600', textAlign: 'right' },
  badge: { borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  checklistRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  checklistLabel: { flex: 1, fontSize: 13, color: '#1F2937' },
  checklistState: { fontSize: 12, color: '#64748B' },
});
