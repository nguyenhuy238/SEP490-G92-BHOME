import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Text } from 'react-native-paper';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import { colors as c } from '../theme/theme';
import { ui } from './WorkspaceKit';
import { fontStyle, typography } from '../theme/typography';

export const invoiceUi = StyleSheet.create({
  card: {
    backgroundColor: c.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 10,
  },
  stack: { gap: 12 },
  surface: { backgroundColor: c.white, borderRadius: 14, paddingHorizontal: 16 },
  section: { paddingVertical: 18, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  heading: { ...typography.sectionHeading, color: c.ink },
  pageTitle: { ...fontStyle('bold', 22, 30), color: c.navy },
  cardTitle: { ...fontStyle('semibold', 16, 22), color: c.navy, flexShrink: 1 },
  listCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
    overflow: 'hidden',
  },
  listContent: { padding: 14, gap: 8 },
  listAmount: { ...fontStyle('bold', 24, 32), color: c.navy, fontVariant: ['tabular-nums'] },
  title: { ...typography.cardTitle, color: c.ink },
  secondary: { ...typography.secondary, color: c.muted },
  detailLabel: { ...typography.secondary, color: c.muted, flex: 1, minWidth: 0 },
  detailValue: { ...typography.body, color: c.ink, textAlign: 'right', flexShrink: 1 },
  charge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    minHeight: 48,
  },
  chargeText: { flex: 1, minWidth: 0, gap: 2 },
  chargeDetails: { gap: 8, paddingBottom: 12, paddingLeft: 28 },
  chargeBorder: { borderTopWidth: 1, borderTopColor: c.border },
  chargeAmount: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter-SemiBold',
    fontVariant: ['tabular-nums'],
    color: c.ink,
  },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  totalAmount: {
    fontSize: 17,
    lineHeight: 24,
    fontFamily: 'Inter-SemiBold',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 1,
    color: c.navy,
  },
  tabBar: { flexDirection: 'row', gap: 20, borderBottomWidth: 1, borderBottomColor: c.border },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    flexShrink: 1,
  },
  tabActive: { borderBottomColor: c.navy },
  tabText: { ...typography.body, color: c.muted },
  tabTextActive: { ...typography.cardTitle, color: c.navy },
  inlineAction: { alignSelf: 'flex-start', marginLeft: -8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  amount: {
    color: c.ink,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
    fontFamily: 'Inter-SemiBold',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  detail: { gap: 8 },
  divider: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 8 },
  hero: {
    ...typography.money,
    color: c.navy,
  },
});
export function InvoiceMoneyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={invoiceUi.row}>
      <Text style={invoiceUi.detailLabel}>{label}</Text>
      <Text style={invoiceUi.amount}>{formatContractMoney(value)}</Text>
    </View>
  );
}
export function InvoiceDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={invoiceUi.row}>
      <Text style={invoiceUi.detailLabel}>{label}</Text>
      <Text style={invoiceUi.detailValue}>{value}</Text>
    </View>
  );
}
export function InvoiceFeedback({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  if (loading)
    return <ActivityIndicator size="small" accessibilityLabel="Đang tải thông tin hóa đơn" />;
  if (!error) return null;
  return (
    <View style={invoiceUi.row}>
      <Text accessibilityRole="alert" style={[ui.grow, ui.red]}>
        {error}
      </Text>
      <Button compact onPress={reload}>
        Thử lại
      </Button>
    </View>
  );
}
export function InvoicePager({
  page,
  total,
  loading,
  onChange,
}: {
  page: number;
  total: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  if (total <= 20) return null;
  return (
    <View style={invoiceUi.row}>
      <IconButton
        icon="chevron-left"
        accessibilityLabel="Trang trước"
        disabled={loading || page <= 1}
        onPress={() => onChange(page - 1)}
      />
      <Text style={ui.muted}>
        Trang {page} / {Math.ceil(total / 20)}
      </Text>
      <IconButton
        icon="chevron-right"
        accessibilityLabel="Trang sau"
        disabled={loading || page * 20 >= total}
        onPress={() => onChange(page + 1)}
      />
    </View>
  );
}
