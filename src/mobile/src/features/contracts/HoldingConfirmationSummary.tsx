import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Icon, Portal, Text } from 'react-native-paper';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { displayDate, inputDate } from '../../lib/identity';

const missing = 'Chưa có dữ liệu';
function dateText(value?: string) {
  if (!value) return missing;
  try {
    const text = displayDate(value);
    inputDate(text);
    return text;
  } catch {
    return missing;
  }
}
export function HoldingConfirmationSummary({
  location,
  room,
  name,
  email,
  birthDate,
  verified,
  deposit,
  startDate,
  endDate,
  terms,
}: {
  location?: string;
  room?: string;
  name?: string;
  email?: string;
  birthDate?: string;
  verified: boolean;
  deposit?: string | null;
  startDate?: string;
  endDate?: string;
  terms?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.sections}>
      <View style={styles.card}>
        <Text style={styles.title}>Thông tin phòng</Text>
        <Value label="Cơ sở" value={location} />
        <Value label="Phòng" value={room} />
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Người giữ chỗ</Text>
        <Value label="Họ và tên" value={name} />
        <Value label="Email" value={email} />
        {!!birthDate && <Value label="Ngày sinh" value={dateText(birthDate)} />}
        <View style={styles.row}>
          <Text style={styles.label}>CCCD</Text>
          <View style={styles.verification}>
            {verified && <Icon source="check-circle-outline" size={18} color="#15803D" />}
            <Text style={[styles.value, verified && styles.verified]}>
              {verified ? 'Đã xác minh' : 'Chưa xác minh'}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Thông tin giữ chỗ</Text>
        <Value
          label="Tiền cọc"
          value={deposit != null ? formatContractMoney(deposit) : undefined}
          prominent
        />
        <Value label="Bắt đầu" value={dateText(startDate)} />
        <Value label="Hết hạn" value={dateText(endDate)} />
        {!!terms?.trim() && (
          <View style={styles.row}>
            <Text style={styles.label}>Điều khoản hợp đồng</Text>
            <Button
              mode="text"
              icon="file-document-outline"
              onPress={() => setOpen(true)}
              compact
              contentStyle={{ minHeight: 44 }}
            >
              Xem chi tiết
            </Button>
          </View>
        )}
      </View>
      {open && !!terms?.trim() && (
        <Portal>
          <Dialog visible onDismiss={() => setOpen(false)}>
            <Dialog.Title>Điều khoản hợp đồng</Dialog.Title>
            <Dialog.Content>
              <ScrollView style={{ maxHeight: 320 }}>
                <Text>{terms}</Text>
              </ScrollView>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setOpen(false)}>Đóng</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      )}
    </View>
  );
}
function Value({
  label,
  value,
  prominent,
}: {
  label: string;
  value?: string;
  prominent?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, prominent && styles.money]}>{value || missing}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  sections: { gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  title: { color: '#172B4D', fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  label: { color: '#64748B', fontSize: 13, lineHeight: 20, flex: 2 },
  value: {
    color: '#172B4D',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'right',
    flex: 3,
    minWidth: 0,
    flexShrink: 1,
  },
  money: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  verification: { flex: 3, flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  verified: { color: '#15803D', flex: 0 },
});
