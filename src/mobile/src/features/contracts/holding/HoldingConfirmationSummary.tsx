import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { formatContractMoney } from '../../../../../../packages/client-core/src/contracts';
import { displayDate, inputDate } from '../../../lib/identity';
import { HoldingInfoRow, HoldingSectionCard, HoldingStatusBadge } from './HoldingUi';

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
      <HoldingSectionCard title="Thông tin phòng">
        <HoldingInfoRow label="Cơ sở" value={location || missing} />
        <HoldingInfoRow label="Phòng" value={room || missing} />
      </HoldingSectionCard>
      <HoldingSectionCard title="Người giữ chỗ">
        <HoldingInfoRow label="Họ và tên" value={name || missing} />
        <HoldingInfoRow label="Email nhận lời mời ký" value={email || missing} />
        {!!birthDate && <HoldingInfoRow label="Ngày sinh" value={dateText(birthDate)} />}
        <HoldingInfoRow
          label="CCCD"
          value={
            <HoldingStatusBadge
              label={verified ? 'Đã xác minh' : 'Chưa xác minh'}
              tone={verified ? 'success' : 'warning'}
            />
          }
        />
      </HoldingSectionCard>
      <HoldingSectionCard title="Thông tin giữ chỗ">
        <HoldingInfoRow
          label="Tiền cọc"
          value={
            <Text style={styles.money}>
              {deposit != null ? formatContractMoney(deposit) : missing}
            </Text>
          }
        />
        <HoldingInfoRow label="Bắt đầu" value={dateText(startDate)} />
        <HoldingInfoRow label="Hết hạn" value={dateText(endDate)} />
        {!!terms?.trim() && (
          <HoldingInfoRow
            label="Điều khoản hợp đồng"
            value={
              <Button
                mode="text"
                icon="file-document-outline"
                onPress={() => setOpen(true)}
                compact
                contentStyle={styles.termsButton}
              >
                Xem chi tiết
              </Button>
            }
          />
        )}
      </HoldingSectionCard>
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
const styles = StyleSheet.create({
  sections: { gap: 10 },
  money: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: '#193653' },
  termsButton: { minHeight: 40 },
});
