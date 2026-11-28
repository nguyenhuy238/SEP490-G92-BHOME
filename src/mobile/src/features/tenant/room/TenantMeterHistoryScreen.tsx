import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import type {
  TenantMeterReading,
  TenantMeterReadingPage,
} from '../../../../../../packages/client-core/src/tenantReadings';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { Action, Box, Heading } from '../../../components/WorkspaceKit';
import { Pagination, QueryState } from '../../../components/WorkspaceQueryState';
import { TenantMeterReadingEvidence } from '../../../components/TenantMeterReadingEvidence';
import { useWorkspaceQuery } from '../../workspace/useWorkspaceQuery';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { useSession } from '../../../lib/SessionProvider';
import { loadTenantReadings } from '../../workspace/tenantFinancialLoads';
import { colors as c } from '../../../theme/theme';

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function monthKey(reading: TenantMeterReading) {
  // Initial/Final readings may have no billing period. Display them in the
  // month of the actual reading without inventing a billing period.
  return (reading.billingPeriod ?? reading.readingDate).slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split('-');
  return `Tháng ${month}/${year}`;
}

function groupedByMonth(readings: TenantMeterReading[]) {
  const months = new Map<string, TenantMeterReading[]>();
  for (const reading of readings) {
    const key = monthKey(reading);
    const rows = months.get(key) ?? [];
    rows.push(reading);
    months.set(key, rows);
  }
  return [...months]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, rows]) => ({
      key,
      readings: rows.sort(
        (a, b) =>
          b.readingDate.localeCompare(a.readingDate) ||
          b.confirmedAt.localeCompare(a.confirmedAt) ||
          a.id.localeCompare(b.id),
      ),
    }));
}

function displayDate(date: string) {
  return date.split('-').reverse().join('/');
}

function UtilityReading({ reading }: { reading: TenantMeterReading }) {
  const electric = reading.utilityType === 'Electricity';
  const label = electric ? 'Điện' : 'Nước';
  const unit = electric ? 'kWh' : 'm³';
  const isBaseline = reading.purpose === 'Initial';
  const hasConsumption = reading.consumption !== null;

  return (
    <View style={styles.reading} accessibilityLabel={`${label} phòng ${reading.roomNumber}`}>
      <View style={styles.readingTitle}>
        <Text variant="titleMedium" style={styles.utilityName}>
          {label} · Phòng {reading.roomNumber}
        </Text>
        <Text variant="labelSmall" style={styles.unit}>
          {unit}
        </Text>
      </View>

      <View style={styles.usageArea}>
        <Text variant="titleLarge" style={[styles.usage, !hasConsumption && styles.unknownUsage]}>
          Tiêu thụ:{' '}
          {reading.consumption !== null
            ? `${formatBillingDecimal(reading.consumption)} ${unit}`
            : isBaseline
              ? 'Chỉ số mốc'
              : 'Chưa có chỉ số'}
        </Text>
        {!hasConsumption && (
          <Text variant="bodySmall" style={styles.explain}>
            {isBaseline
              ? 'Đây là chỉ số ban đầu, chưa có lượng tiêu thụ.'
              : 'Chưa có lượng tiêu thụ được xác nhận cho lần ghi này.'}
          </Text>
        )}
      </View>

      <View style={styles.readingValues}>
        <View style={styles.valueCell}>
          <Text variant="labelSmall" style={styles.muted}>
            Đầu kỳ
          </Text>
          <Text variant="bodyMedium" style={styles.readingValue}>
            Chỉ số trước:{' '}
            {reading.previousValue === null
              ? 'Chưa có'
              : formatBillingDecimal(reading.previousValue)}
          </Text>
        </View>
        <View style={styles.valueCell}>
          <Text variant="labelSmall" style={styles.muted}>
            Cuối kỳ
          </Text>
          <Text variant="bodyMedium" style={styles.readingValue}>
            Đã xác nhận: {formatBillingDecimal(reading.confirmedValue)}
          </Text>
        </View>
      </View>

      <View style={styles.details}>
        <Text variant="bodySmall" style={styles.muted}>
          Ngày đo: {displayDate(reading.readingDate)}
          {reading.billingPeriod ? ' · Kỳ ' + reading.billingPeriod.slice(0, 7) : ''}
        </Text>
        <Text variant="bodySmall" style={styles.muted}>
          Đồng hồ: {reading.meterCode}
        </Text>
        <Text variant="bodySmall" style={styles.muted}>
          Xác nhận lúc: {formatInstant(reading.confirmedAt)}
          {reading.status === 'Corrected' ? ' · Đã hiệu chỉnh' : ''}
        </Text>
        <Text variant="bodySmall" style={styles.muted}>
          {reading.locationName}
        </Text>
      </View>
      <TenantMeterReadingEvidence id={reading.id} label="Ảnh bằng chứng" />
    </View>
  );
}

function MissingUtility({ type }: { type: 'Electricity' | 'Water' }) {
  return (
    <View style={styles.missingUtility}>
      <Text variant="titleSmall" style={styles.muted}>
        {type === 'Electricity' ? 'Điện' : 'Nước'}
      </Text>
      <Text variant="bodyMedium" style={styles.missingText}>
        Chưa có chỉ số
      </Text>
      <Text variant="bodySmall" style={styles.muted}>
        Chưa có lần ghi đã xác nhận trong tháng này.
      </Text>
    </View>
  );
}

export function TenantMeterHistoryScreen() {
  const [page, setPage] = useState(1);
  const { roomId } = useLocalSearchParams<{ roomId?: string }>();
  const validRoomId =
    roomId && guidPattern.test(roomId) && roomId !== '00000000-0000-0000-0000-000000000000'
      ? roomId
      : undefined;
  const { go } = useWorkspace(),
    { session } = useSession();
  const query = useWorkspaceQuery<TenantMeterReadingPage>(
    session?.roles.includes('Tenant')
      ? `/api/v1/tenant/meter-readings?page=${page}&pageSize=20${validRoomId ? '&roomId=' + encodeURIComponent(validRoomId) : ''}`
      : null,
    { load: loadTenantReadings },
  );
  const reload = query.reload;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  const groups = groupedByMonth(query.data?.items ?? []);

  return (
    <>
      <Heading
        title="Điện nước theo tháng"
        detail="Số liệu đồng hồ đã được xác nhận trong thời gian thuê của bạn"
      />
      <View style={styles.introduction}>
        <Text variant="bodySmall" style={styles.explain}>
          Lượng điện (kWh) và nước (m³) được lấy từ chỉ số đã xác nhận. Số 0 nghĩa là đã ghi nhận
          không phát sinh; “Chưa có chỉ số” nghĩa là chưa có dữ liệu.
        </Text>
      </View>
      <QueryState {...query} />
      {!query.loading && !query.error && query.data?.items.length === 0 && (
        <Box style={styles.empty}>
          <Text variant="titleMedium" style={styles.utilityName}>
            Chưa có chỉ số đã xác nhận trong thời gian ở của bạn.
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Khi nhân viên xác nhận số điện, nước, lịch sử sẽ xuất hiện tại đây.
          </Text>
        </Box>
      )}
      {groups.map((group) => (
        <View key={group.key} style={styles.month}>
          <Text variant="titleMedium" style={styles.monthHeading}>
            {monthLabel(group.key)}
          </Text>
          <Box style={styles.monthCard}>
            {(['Electricity', 'Water'] as const).map((type, index) => {
              const entries = group.readings.filter((reading) => reading.utilityType === type);
              return (
                <View key={type} style={styles.utilityGroup}>
                  {index > 0 && <View style={styles.divider} />}
                  {entries.length === 0 ? (
                    <MissingUtility type={type} />
                  ) : (
                    entries.map((reading) => <UtilityReading key={reading.id} reading={reading} />)
                  )}
                </View>
              );
            })}
          </Box>
        </View>
      ))}
      {query.data && query.data.totalCount > query.data.pageSize && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          pageSize={query.data.pageSize}
          loading={query.loading}
          onChange={setPage}
        />
      )}
      <Action secondary onPress={() => go('billing-history')}>
        Xem hóa đơn và thanh toán
      </Action>
    </>
  );
}

const styles = StyleSheet.create({
  introduction: { paddingHorizontal: 4 },
  explain: { color: c.muted, lineHeight: 19 },
  muted: { color: c.muted },
  month: { gap: 10 },
  monthHeading: { color: c.navy, paddingHorizontal: 4 },
  monthCard: { padding: 16, gap: 16, borderColor: c.border },
  utilityGroup: { gap: 16 },
  divider: { height: 1, backgroundColor: c.border },
  reading: { gap: 12 },
  readingTitle: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  utilityName: { color: c.navy, flexShrink: 1 },
  unit: {
    color: c.blue,
    backgroundColor: c.tint,
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  usageArea: { gap: 3 },
  usage: { color: c.navy, fontVariant: ['tabular-nums'], flexShrink: 1 },
  unknownUsage: { color: c.muted },
  readingValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  valueCell: { flexGrow: 1, flexBasis: '45%', minWidth: 116, gap: 4 },
  readingValue: { color: c.ink, fontVariant: ['tabular-nums'] },
  details: { gap: 4 },
  missingUtility: { paddingVertical: 8, gap: 5 },
  missingText: { color: c.ink },
  empty: { gap: 8, borderColor: c.border },
});
