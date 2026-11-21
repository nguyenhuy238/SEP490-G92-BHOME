import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { labels } from '../../../../../packages/client-core/src/contracts';
import type { MainDraftPreparation } from '../../../../../packages/client-core/src/mainDrafts';
import { colors as c } from '../../theme/theme';

export function ContractPreviewSummary({
  preparation,
  status,
  start,
  end,
  showSigner = true,
}: {
  preparation: MainDraftPreparation;
  status: string;
  start: string;
  end: string;
  showSigner?: boolean;
}) {
  const representative = preparation.residents.find((person) => person.representative);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Hợp đồng thuê phòng</Text>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{labels[status] ?? status}</Text>
        </View>
      </View>
      <Text style={styles.room}>
        Phòng {preparation.roomNumber} · {preparation.locationName}
      </Text>
      <View style={styles.values}>
        <Text style={styles.label}>Thời hạn</Text>
        <Text style={styles.value}>
          {start} → {end}
        </Text>
      </View>
      {showSigner && (
        <>
          <View style={styles.divider} />
          <View style={styles.values}>
            <Text style={styles.label}>Đại diện</Text>
            <Text style={styles.value}>{representative?.fullName ?? 'Chưa có dữ liệu'}</Text>
          </View>
          <View style={styles.values}>
            <Text style={styles.label}>CCCD</Text>
            <Text style={styles.value}>
              {representative?.maskedCitizenNumber ?? 'Chưa có dữ liệu'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{preparation.residents.length} người ở</Text>
            <View style={styles.verified}>
              <Icon source="check-decagram" size={16} color={c.green} />
              <Text style={styles.verifiedText}>Đã xác minh danh tính</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: c.ink },
  room: { fontSize: 14, lineHeight: 20, color: c.primary },
  chip: { backgroundColor: c.tint, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, color: c.blue, fontWeight: '600' },
  values: { flexDirection: 'row', gap: 12 },
  label: { color: '#475569', fontSize: 13, lineHeight: 20 },
  value: { flex: 1, minWidth: 0, textAlign: 'right', color: c.ink, fontSize: 13, lineHeight: 20 },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 2 },
  verified: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  verifiedText: { color: c.green, fontSize: 12, lineHeight: 18 },
});
