import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import {
  displayContractDate,
  formatContractMoney,
} from '../../../../packages/client-core/src/contracts';
import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import { Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { TenantBillingTabs } from '../components/TenantBillingTabs';
import { colors } from '../theme/theme';
import { tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import { InvoiceFeedback, InvoicePager, invoiceUi } from '../components/InvoiceDetailUi';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import {
  loadInvoiceList,
  loadTenantInvoice,
  loadInvoicePaymentStates,
} from '../services/tenantInvoices';
import { TenantInvoiceSummary, TenantInvoiceCharges } from './TenantInvoiceCharges';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { TenantPaymentPanel, TenantPaymentDetails } from './TenantPaymentPanel';
import { useTenantInvoicePayment } from '../features/tenant/useTenantInvoicePayment';
import { TenantAdjustmentPanel } from './TenantAdjustmentPanel';
import { TenantSettlementReceivables } from './TenantSettlementReceivables';
import { paymentText, type DebtInvoice } from '../../../../packages/client-core/src/payments';

export function TenantInvoicesScreen({ intent }: { intent?: 'adjustment' } = {}) {
  const { session } = useSession();
  const { invoiceId } = useLocalSearchParams<{ invoiceId?: string }>();
  // Remount account-specific selection when the principal changes.
  return <TenantInvoiceList key={`${session?.userId}:${invoiceId ?? ''}`} intent={intent} />;
}
function TenantInvoiceList({ intent }: { intent?: 'adjustment' }) {
  const { invoiceId, focus, returnTo, historyTab, view, newRequest } = useLocalSearchParams<{
    invoiceId?: string;
    focus?: string;
    returnTo?: string;
    historyTab?: string;
    view?: string;
    newRequest?: string;
  }>();
  const purpose = intent ?? focus;
  const { go } = useWorkspace();
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(invoiceId ?? ''),
    [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const visited = useRef(false);
  const list = useWorkspaceQuery<Page<Invoice>>(
    allowed && !selected ? `/api/v1/invoices?page=${page}&pageSize=20` : null,
    { load: loadInvoiceList, notifyError: false },
  );
  const detail = useWorkspaceQuery<Invoice>(
    allowed && selected ? `/api/v1/invoices/${encodeURIComponent(selected)}` : null,
    { load: loadTenantInvoice, notifyError: false },
  );
  const paymentView = view === 'payment';
  const adjustmentView = purpose === 'adjustment';
  const payment = useTenantInvoicePayment(
    allowed && selected && detail.data?.status === 'Final' && !paymentView && !adjustmentView
      ? selected
      : null,
  );
  const finalIds =
    (!selected ? list.data?.items : undefined)
      ?.filter((i) => i.status === 'Final')
      .map((i) => 'invoiceIds=' + encodeURIComponent(i.id)) ?? [];
  const states = useWorkspaceQuery<Page<DebtInvoice>>(
    finalIds.length ? '/api/v1/payment-invoices?pageSize=100&' + finalIds.join('&') : null,
    { load: loadInvoicePaymentStates, notifyError: false },
  );
  const backToList = useCallback(() => {
    if (paymentView || (adjustmentView && selected)) {
      if (router.canGoBack()) router.back();
      else go('invoice', { invoiceId: selected });
    } else if (returnTo === 'billing-history') {
      if (router.canGoBack()) router.back();
      else
        go('billing-history', {
          historyTab: historyTab === 'outstanding' ? 'outstanding' : 'verified',
        });
    } else if (invoiceId) {
      if (router.canGoBack()) router.back();
      else go('invoice');
    } else setSelected('');
  }, [paymentView, adjustmentView, selected, returnTo, historyTab, invoiceId, go]);
  const reloadList = list.reload,
    reloadStates = states.reload;
  const refreshList = useCallback(() => {
    reloadList();
    reloadStates();
  }, [reloadList, reloadStates]);
  const reloadDetail = detail.reload,
    reloadPayment = payment.reload;
  const refreshDetail = useCallback(() => {
    reloadDetail();
    reloadPayment();
  }, [reloadDetail, reloadPayment]);
  const refresh = selected ? refreshDetail : refreshList;
  useFocusEffect(
    useCallback(() => {
      if (visited.current) refresh();
      visited.current = true;
    }, [refresh]),
  );
  const header = useWorkspaceHeaderRefresh(refresh, selected ? detail.loading : list.loading, {
    title: selected
      ? paymentView
        ? 'Thanh toán hóa đơn'
        : adjustmentView
          ? 'Điều chỉnh hóa đơn'
          : 'Chi tiết hóa đơn'
      : 'Hóa đơn & thanh toán',
    onBack: selected ? backToList : undefined,
  });
  if (!allowed)
    return (
      <Box>
        <Text>Tài khoản không có quyền xem hóa đơn Tenant.</Text>
      </Box>
    );
  if (selected)
    return (
      <>
        {!header && (
          <View style={invoiceUi.row}>
            <IconButton
              icon="arrow-left"
              accessibilityLabel={
                paymentView || adjustmentView
                  ? 'Quay lại chi tiết hóa đơn'
                  : returnTo === 'billing-history'
                    ? 'Quay lại lịch sử và công nợ'
                    : 'Quay lại danh sách hóa đơn'
              }
              onPress={backToList}
            />
            <View style={ui.grow}>
              <Heading
                title={
                  paymentView
                    ? 'Thanh toán hóa đơn'
                    : adjustmentView
                      ? 'Điều chỉnh hóa đơn'
                      : 'Chi tiết hóa đơn'
                }
              />
            </View>
            <IconButton
              icon="refresh"
              accessibilityLabel="Tải lại hóa đơn"
              disabled={detail.loading}
              onPress={refreshDetail}
            />
          </View>
        )}
        <InvoiceFeedback {...detail} />
        {detail.data && (
          <View style={invoiceUi.stack}>
            {paymentView ? (
              <TenantPaymentPanel key={detail.data.id} invoiceId={detail.data.id} />
            ) : adjustmentView ? (
              <View style={invoiceUi.card}>
                <Text style={invoiceUi.secondary}>
                  Phòng {detail.data.roomNumber} · Kỳ{' '}
                  {detail.data.billingPeriod.slice(0, 7).split('-').reverse().join('/')}
                </Text>
                <TenantAdjustmentPanel
                  key={detail.data.id + ':' + detail.data.version}
                  invoice={detail.data}
                  initialOpen={newRequest === 'true'}
                />
              </View>
            ) : (
              <>
                <TenantInvoiceSummary
                  invoice={detail.data}
                  payment={payment.error ? null : payment.data}
                  onPay={() => go('invoice', { invoiceId: detail.data!.id, view: 'payment' })}
                />
                {detail.data.status === 'Final' && <InvoiceFeedback {...payment} />}
                <TenantInvoiceCharges invoice={detail.data} />
                {payment.data && !payment.error && (
                  <TenantPaymentDetails key={detail.data.id} state={payment.data} />
                )}
                <TenantAdjustmentPanel
                  key={detail.data.id + ':' + detail.data.version}
                  invoice={detail.data}
                  compact
                />
              </>
            )}
          </View>
        )}
      </>
    );
  const items = list.data?.items ?? [];
  const paymentByInvoiceId = new Map(
    (states.data?.items ?? []).map((item) => [item.invoiceId, item]),
  );
  const filteredItems = items.filter((invoice) => {
    if (statusFilter === 'all') return true;
    const payment = paymentByInvoiceId.get(invoice.id);
    const isPaid = invoice.status === 'Final' && payment?.paymentStatus === 'Paid';
    return statusFilter === 'paid' ? isPaid : !isPaid;
  });
  const canSummarizeUnpaid =
    !!list.data &&
    list.data.items.length > 1 &&
    list.data.totalCount <= list.data.pageSize &&
    !states.error &&
    (finalIds.length === 0 || !!states.data);
  const unpaidFinalItems = canSummarizeUnpaid
    ? (states.data?.items ?? []).filter((item) => item.paymentStatus !== 'Paid')
    : [];
  const totalOutstanding = unpaidFinalItems.reduce(
    (sum, item) => sum + BigInt(item.outstandingAmount),
    0n,
  );
  return (
    <>
      {!header && (
        <View style={invoiceUi.row}>
          <Text style={invoiceUi.pageTitle}>Hóa đơn & thanh toán</Text>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại hóa đơn"
            disabled={list.loading}
            onPress={refreshList}
          />
        </View>
      )}
      <TenantBillingTabs active="invoices" />
      {purpose !== 'adjustment' && <TenantSettlementReceivables />}
      <Text style={invoiceUi.secondary}>
        Theo dõi hóa đơn và thanh toán · Hóa đơn chung của phòng trong những kỳ bạn đã ở.
      </Text>
      {canSummarizeUnpaid && unpaidFinalItems.length > 0 && (
        <Box>
          <Text style={invoiceUi.title}>
            {unpaidFinalItems.length} hóa đơn cần thanh toán ·{' '}
            {formatContractMoney(String(totalOutstanding))}
          </Text>
        </Box>
      )}
      {items.length > 1 && !states.error && (
        <View style={invoiceUi.tabBar}>
          {(
            [
              ['all', 'Tất cả'],
              ['unpaid', 'Chưa thanh toán'],
              ['paid', 'Đã thanh toán'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              compact
              mode={statusFilter === key ? 'contained-tonal' : 'outlined'}
              style={invoiceUi.tab}
              accessibilityRole="tab"
              accessibilityLabel={`Lọc hóa đơn: ${label}`}
              accessibilityState={{ selected: statusFilter === key }}
              onPress={() => setStatusFilter(key)}
            >
              {label}
            </Button>
          ))}
        </View>
      )}
      {purpose === 'adjustment' && (
        <Box>
          <Text>
            Chọn hóa đơn cần kiểm tra, sau đó mở mục Yêu cầu điều chỉnh trong chi tiết hóa đơn.
          </Text>
        </Box>
      )}
      {purpose === 'payment' && (
        <Box>
          <Text>
            Chọn hóa đơn đã phát hành để xem thông tin chuyển khoản và số tiền còn phải trả. Hóa đơn
            nháp chưa thể thanh toán.
          </Text>
        </Box>
      )}
      <InvoiceFeedback {...list} reload={refreshList} />
      {!!states.error && <InvoiceFeedback {...states} />}
      {list.data?.items.length === 0 && (
        <Box>
          <Text>Bạn chưa có hóa đơn.</Text>
        </Box>
      )}
      {items.length > 0 && filteredItems.length === 0 && (
        <Box>
          <Text>Không có hóa đơn phù hợp với bộ lọc đã chọn.</Text>
        </Box>
      )}
      {filteredItems.map((invoice) => (
        <InvoiceSummaryCard
          key={invoice.id}
          invoice={invoice}
          payment={paymentByInvoiceId.get(invoice.id)}
          open={() => go('invoice', { invoiceId: invoice.id })}
        />
      ))}
      {list.data && (
        <InvoicePager
          page={page}
          total={list.data.totalCount}
          loading={list.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
function InvoiceSummaryCard({
  invoice,
  payment,
  open,
}: {
  invoice: Invoice;
  payment?: DebtInvoice;
  open: () => void;
}) {
  const label =
    invoice.status === 'Draft'
      ? 'Bản nháp'
      : payment
        ? payment.paidAmount === null
          ? paymentText(payment.paymentStatus)
          : tenantPaymentLabel({ ...payment, paidAmount: payment.paidAmount })
        : 'Đã phát hành';
  const overdue = payment && payment.paymentStatus !== 'Paid' && payment.overdueDays > 0;
  return (
    <TouchableRipple
      style={invoiceUi.listCard}
      accessibilityRole="button"
      accessibilityLabel={`Xem hóa đơn phòng ${invoice.roomNumber}, kỳ ${invoice.billingPeriod.slice(0, 7)}`}
      onPress={open}
    >
      <View style={invoiceUi.listContent}>
        <View style={invoiceUi.row}>
          <Text style={invoiceUi.cardTitle}>
            Kỳ {invoice.billingPeriod.slice(0, 7).split('-').reverse().join('/')}
          </Text>
          <Pill tone={overdue ? 'red' : payment?.paymentStatus === 'Paid' ? 'green' : 'blue'}>
            {overdue ? 'Quá hạn' : label}
          </Pill>
        </View>
        <Text style={invoiceUi.secondary}>
          Phòng {invoice.roomNumber} · {invoice.locationName}
        </Text>
        <View style={invoiceUi.row}>
          <View style={ui.grow}>
            <Text style={invoiceUi.secondary}>
              {payment ? 'Còn phải thanh toán' : 'Tổng hóa đơn'}
            </Text>
            <Text style={invoiceUi.listAmount}>
              {formatContractMoney(payment?.outstandingAmount ?? invoice.total)}
            </Text>
            {payment && payment.outstandingAmount !== invoice.total && (
              <Text style={invoiceUi.secondary}>
                Tổng hóa đơn: {formatContractMoney(invoice.total)}
              </Text>
            )}
          </View>
          <Icon source="chevron-right" size={20} color={colors.muted} />
        </View>
        {!!invoice.dueDate && (
          <Text style={invoiceUi.secondary}>
            Hạn thanh toán: {displayContractDate(invoice.dueDate)}
          </Text>
        )}
        {!!invoice.missingInputs.length && (
          <Text style={invoiceUi.secondary}>Chưa đủ dữ liệu tính tiền chính thức.</Text>
        )}
      </View>
    </TouchableRipple>
  );
}
