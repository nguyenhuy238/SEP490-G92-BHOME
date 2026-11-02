import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import {
  formatContractMoney,
  displayContractDate,
} from '../../../../packages/client-core/src/contracts';
import {
  missingBillingInput,
  formatBillingDecimal,
  type Invoice,
  type Page,
} from '../../../../packages/client-core/src/invoices';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { TenantPaymentPanel } from './TenantPaymentPanel';
import { TenantAdjustmentPanel } from './TenantAdjustmentPanel';
import { paymentText, type DebtInvoice } from '../../../../packages/client-core/src/payments';

export function TenantInvoicesScreen() {
  const { session } = useSession();
  // Remount account-specific selection when the principal changes.
  return <TenantInvoiceList key={session?.userId} />;
}
function TenantInvoiceList() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId?: string }>();
  const { go } = useWorkspace();
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(invoiceId ?? '');
  const list = useWorkspaceQuery<Page<Invoice>>(
    allowed ? `/api/v1/invoices?page=${page}&pageSize=20` : null,
  );
  const detail = useWorkspaceQuery<Invoice>(
    allowed && selected ? `/api/v1/invoices/${encodeURIComponent(selected)}` : null,
  );
  const finalIds =
    list.data?.items
      .filter((i) => i.status === 'Final')
      .map((i) => 'invoiceIds=' + encodeURIComponent(i.id)) ?? [];
  const states = useWorkspaceQuery<Page<DebtInvoice>>(
    finalIds.length ? '/api/v1/payment-invoices?pageSize=100&' + finalIds.join('&') : null,
  );
  if (!allowed)
    return (
      <Box>
        <Text>Tài khoản không có quyền xem hóa đơn Tenant.</Text>
      </Box>
    );
  if (selected)
    return (
      <>
        <Heading title="Chi tiết hóa đơn" />
        <Action secondary onPress={() => setSelected('')}>
          Về danh sách hóa đơn
        </Action>
        <QueryState {...detail} />
        <Action secondary onPress={() => detail.reload()}>
          Tải lại hóa đơn
        </Action>
        {detail.data && (
          <>
            <InvoiceDetail invoice={detail.data} />
            <TenantAdjustmentPanel
              key={detail.data.id + ':' + detail.data.version}
              invoice={detail.data}
            />
            {detail.data.status === 'Final' && (
              <TenantPaymentPanel key={detail.data.id} invoiceId={detail.data.id} />
            )}
          </>
        )}
      </>
    );
  return (
    <>
      <Heading title="Hóa đơn của tôi" detail="Hóa đơn chung của phòng trong những kỳ bạn đã ở" />
      <Action onPress={() => go('billing-history')}>Lịch sử thanh toán</Action>
      <QueryState {...list} />
      {!!states.error && <QueryState {...states} />}
      {list.data?.items.length === 0 && (
        <Box>
          <Text>Bạn chưa có hóa đơn.</Text>
        </Box>
      )}
      {list.data?.items.map((invoice) => (
        <Box key={invoice.id}>
          <Heading
            title={`Phòng ${invoice.roomNumber} · ${invoice.billingPeriod.slice(0, 7)}`}
            detail={invoice.locationName}
          />
          <Pill tone={invoice.status === 'Final' ? 'green' : 'blue'}>
            {invoice.status === 'Final' ? 'Đã phát hành' : 'Nháp để kiểm tra'}
          </Pill>
          <Text style={ui.money}>{formatContractMoney(invoice.total)}</Text>
          {states.data?.items
            .filter((item) => item.invoiceId === invoice.id)
            .map((item) => (
              <Pill key={item.invoiceId} tone={item.paymentStatus === 'Paid' ? 'green' : 'blue'}>
                {paymentText(item.paymentStatus)}
              </Pill>
            ))}
          {invoice.missingInputs.length > 0 && <Text>Chưa đủ dữ liệu tính tiền chính thức.</Text>}
          <Action onPress={() => setSelected(invoice.id)}>Xem hóa đơn</Action>
        </Box>
      ))}
      {list.data && (
        <Pagination
          page={page}
          total={list.data.totalCount}
          loading={list.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
export function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <Box>
        <Heading
          title={`Phòng ${invoice.roomNumber} · Kỳ ${invoice.billingPeriod.slice(0, 7)}`}
          detail={invoice.locationName}
        />
        <Pill tone={invoice.status === 'Final' ? 'green' : 'blue'}>
          {invoice.status === 'Final' ? 'Đã phát hành' : 'Nháp để kiểm tra'}
        </Pill>
        <Text>Hạn thanh toán: {displayContractDate(invoice.dueDate)}</Text>
        {invoice.missingInputs.length > 0 && (
          <Text accessibilityRole="alert" style={ui.red}>
            Còn thiếu: {invoice.missingInputs.map(missingBillingInput).join(', ')}. Tổng hiện tại
            chưa phải số tiền chính thức.
          </Text>
        )}
      </Box>
      {invoice.lines.map((line) => (
        <Box key={line.id}>
          <Heading title={line.name} />
          {line.meterReadingId && (
            <>
              <Text>
                Chỉ số trước: {formatBillingDecimal(line.previousReading ?? '')} · Chỉ số xác nhận:{' '}
                {formatBillingDecimal(line.confirmedReading ?? '')}
              </Text>
              <Text>
                Tiêu thụ: {formatBillingDecimal(line.quantity)}{' '}
                {line.category === 'Electricity' ? 'kWh' : 'm³'}
              </Text>
            </>
          )}
          <Text>
            Đơn giá: {formatBillingDecimal(line.rate)} đ · Ngày áp dụng:{' '}
            {displayContractDate(line.rateDate)}
          </Text>
          {!line.meterReadingId && (
            <Text>
              Ngày có khách: {line.occupiedDays}/{line.periodDays}
            </Text>
          )}
          <Text style={ui.money}>{formatContractMoney(line.amount)}</Text>
          {line.calculatedAmount != null && (
            <Text>Trước correction đã duyệt: {formatContractMoney(line.calculatedAmount)}</Text>
          )}
        </Box>
      ))}
      <Box>
        <Heading title={invoice.status === 'Final' ? 'Tổng tiền hóa đơn' : 'Tổng tạm tính'} />
        <Text style={ui.money}>{formatContractMoney(invoice.total)}</Text>
      </Box>
    </>
  );
}
