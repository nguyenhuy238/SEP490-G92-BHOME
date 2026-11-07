import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import { formatBillingDecimal } from '../../../../packages/client-core/src/invoices';
import { Action, Box, Heading } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';

export function TenantMeterHistoryScreen() {
  const [page, setPage] = useState(1);
  const { go } = useWorkspace();
  const { session } = useSession();
  const query = useWorkspaceQuery<Page<Invoice>>(
    session?.roles.includes('Tenant') ? `/api/v1/invoices?page=${page}&pageSize=20` : null,
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
        detail="Chỉ số đã xác nhận trong hóa đơn nháp hoặc đã phát hành"
      />
      <Box>
        <Text>
          Chỉ số trước khi lập hóa đơn chưa có nguồn dữ liệu riêng cho khách thuê. Kết quả OCR chưa
          xác nhận không được hiển thị tại đây.
        </Text>
      </Box>
      <QueryState {...query} />
      {query.data?.items.length === 0 && (
        <Box>
          <Text>Chưa có kỳ hóa đơn để xem chỉ số.</Text>
        </Box>
      )}
      {query.data?.items.map((invoice) => {
        const lines = invoice.lines.filter(
          (line) =>
            !!line.meterReadingId &&
            line.confirmedReading !== null &&
            ['Electricity', 'Water'].includes(line.category),
        );
        return (
          <Box key={invoice.id}>
            <Heading
              title={`Kỳ ${invoice.billingPeriod.slice(0, 7)} · Phòng ${invoice.roomNumber}`}
              detail={invoice.locationName}
            />
            {lines.map((line) => (
              <Box key={line.id}>
                <Text>{line.category === 'Electricity' ? 'Điện' : 'Nước'}</Text>
                <Text>
                  Chỉ số trước:{' '}
                  {line.previousReading === null
                    ? 'Chưa có'
                    : formatBillingDecimal(line.previousReading)}
                </Text>
                <Text>Đã xác nhận: {formatBillingDecimal(line.confirmedReading!)}</Text>
                <Text>
                  Tiêu thụ: {formatBillingDecimal(line.quantity)}{' '}
                  {line.category === 'Electricity' ? 'kWh' : 'm³'}
                </Text>
              </Box>
            ))}
            {!lines.length && (
              <Text>Kỳ này chưa có chỉ số điện nước đã xác nhận trong hóa đơn.</Text>
            )}
            <Action secondary onPress={() => go('invoice', { invoiceId: invoice.id })}>
              Xem hóa đơn của kỳ
            </Action>
          </Box>
        );
      })}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          loading={query.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
