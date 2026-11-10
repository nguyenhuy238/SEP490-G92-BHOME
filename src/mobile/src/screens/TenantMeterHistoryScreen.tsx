import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import type { TenantMeterReadingPage } from '../../../../packages/client-core/src/tenantReadings';
import { formatBillingDecimal } from '../../../../packages/client-core/src/invoices';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Action, Box, Heading } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { ocrPreview } from '../lib/automaticOcr';
import { errorMessage } from '../lib/api';

function ReadingEvidence({ id }: { id: string }) {
  const { api } = useSession();
  const [uri, setUri] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load() {
    if (!api || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const bytes = await api.request<Uint8Array>(
        '/api/v1/tenant/meter-readings/' + id + '/evidence',
        { signal: controller.signal },
        'bytes',
      );
      try {
        if (
          bytes.length > 5 * 1024 * 1024 ||
          bytes.length < 3 ||
          !(bytes[0] === 137 || (bytes[0] === 255 && bytes[1] === 216))
        )
          throw new Error('Ảnh bằng chứng không hợp lệ.');
        if (!controller.signal.aborted) setUri(ocrPreview(bytes));
      } finally {
        bytes.fill(0);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <Action secondary disabled={busy} onPress={() => (uri ? setUri('') : void load())}>
        {busy ? 'Đang tải ảnh…' : uri ? 'Ẩn ảnh bằng chứng' : 'Xem ảnh bằng chứng'}
      </Action>
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      {!!uri && (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: 260 }}
          resizeMode="contain"
          accessibilityLabel="Ảnh đồng hồ đã xác nhận"
        />
      )}
    </>
  );
}
export function TenantMeterHistoryScreen() {
  const [page, setPage] = useState(1);
  const { go } = useWorkspace(),
    { session } = useSession();
  const query = useWorkspaceQuery<TenantMeterReadingPage>(
    session?.roles.includes('Tenant')
      ? '/api/v1/tenant/meter-readings?page=' + page + '&pageSize=20'
      : null,
  );
  const reload = query.reload;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  return (
    <>
      <Heading
        title="Điện nước theo kỳ"
        detail="Chỉ số Staff đã xác nhận, xem được trước khi lập hóa đơn nháp"
      />
      <Box>
        <Text>
          Kết quả OCR chưa xác nhận không được hiển thị. Lịch sử được giới hạn theo thời gian ở và
          quyền hóa đơn của bạn.
        </Text>
      </Box>
      <QueryState {...query} />
      {query.data?.items.length === 0 && (
        <Box>
          <Text>Chưa có chỉ số đã xác nhận trong thời gian ở của bạn.</Text>
        </Box>
      )}
      {query.data?.items.map((reading) => (
        <Box key={reading.id}>
          <Heading
            title={
              (reading.utilityType === 'Electricity' ? 'Điện' : 'Nước') +
              ' · Phòng ' +
              reading.roomNumber
            }
            detail={reading.locationName}
          />
          <Text>
            Ngày đo: {reading.readingDate.split('-').reverse().join('/')}
            {reading.billingPeriod ? ' · Kỳ ' + reading.billingPeriod.slice(0, 7) : ''}
          </Text>
          <Text>Đồng hồ: {reading.meterCode}</Text>
          <Text>
            Chỉ số trước:{' '}
            {reading.previousValue === null
              ? 'Chưa có'
              : formatBillingDecimal(reading.previousValue)}
          </Text>
          <Text>Đã xác nhận: {formatBillingDecimal(reading.confirmedValue)}</Text>
          <Text>
            Tiêu thụ:{' '}
            {reading.consumption === null
              ? 'Chỉ số mốc'
              : formatBillingDecimal(reading.consumption) +
                (reading.utilityType === 'Electricity' ? ' kWh' : ' m³')}
          </Text>
          <Text>
            Xác nhận lúc: {formatInstant(reading.confirmedAt)}
            {reading.status === 'Corrected' ? ' · Đã hiệu chỉnh' : ''}
          </Text>
          <ReadingEvidence id={reading.id} />
        </Box>
      ))}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
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
