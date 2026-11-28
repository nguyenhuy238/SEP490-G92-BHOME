import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import {
  businessToday,
  formatContractMoney,
} from '../../../../../../packages/client-core/src/contracts';
import type { Invoice, Page } from '../../../../../../packages/client-core/src/invoices';
import { Box, Heading, Pill, ui } from '../../../components/WorkspaceKit';
import { colors } from '../../../theme/theme';
import { tenantPaymentLabel } from './paymentPresentation';
import { InvoiceFeedback, InvoicePager, invoiceUi } from '../../../components/InvoiceDetailUi';
import { useWorkspaceHeaderRefresh } from '../../../components/WorkspaceHeaderContext';
import {
  loadInvoiceList,
  loadTenantInvoicePeriod,
  tenantInvoiceScheduleMessage,
  type TenantInvoicePeriod,
  loadTenantInvoice,
  loadInvoicePaymentStates,
} from '../../../services/tenantInvoices';
import { TenantInvoiceSummary, TenantInvoiceCharges } from './TenantInvoiceCharges';
import { useWorkspaceQuery } from '../../workspace/useWorkspaceQuery';
import { useSession } from '../../../lib/SessionProvider';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { TenantPaymentPanel, TenantPaymentDetails, TenantPaymentModal } from './TenantPaymentPanel';
import { useTenantInvoicePayment } from './useTenantInvoicePayment';
import { TenantAdjustmentPanel } from './TenantAdjustmentPanel';
import { TenantSettlementReceivableDetail } from './TenantSettlementReceivableDetail';
import { paymentText, type DebtInvoice } from '../../../../../../packages/client-core/src/payments';

export function TenantInvoicesScreen({ intent }: { intent?: 'adjustment' } = {}) {
  const { session } = useSession();
  const { invoiceId, view, settlementContractId, settlementChargeId } = useLocalSearchParams<{
    invoiceId?: string;
    view?: string;
    settlementContractId?: string;
    settlementChargeId?: string;
  }>();
  if (view === 'settlement')
    return (
      <TenantSettlementReceivableDetail
        key={`${session?.userId}:${settlementContractId ?? ''}:${settlementChargeId ?? ''}`}
        contractId={settlementContractId ?? ''}
        chargeId={settlementChargeId ?? ''}
      />
    );
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
  const businessDate = businessToday();
  const previousBusinessDate = useRef(businessDate);

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(invoiceId ?? '');
  const [paymentModal, setPaymentModal] = useState(false);
  const visited = useRef(false);
  // The server owns the business date (including Demo Clock) and configured calendar.
  const period = useWorkspaceQuery<TenantInvoicePeriod>(
    allowed && !selected ? '/api/v1/invoices/current-period' : null,
    { load: loadTenantInvoicePeriod, notifyError: false },
  );
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
    allowed && selected && detail.data?.status === 'Final' && !paymentView ? selected : null,
  );
  const canSubmitAdjustment =
    detail.data?.status === 'Draft' || (!payment.error && payment.data?.paymentStatus === 'Unpaid');
  const finalIds = !selected
    ? [
        ...new Set((list.data?.items ?? []).filter((i) => i.status === 'Final').map((i) => i.id)),
      ].map((id) => 'invoiceIds=' + encodeURIComponent(id))
    : [];
  const states = useWorkspaceQuery<Page<DebtInvoice>>(
    allowed && finalIds.length
      ? '/api/v1/payment-invoices?pageSize=100&' + finalIds.join('&')
      : null,
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
    reloadMonth = period.reload,
    reloadStates = states.reload;
  const refreshList = useCallback(() => {
    reloadList();
    reloadMonth();
    reloadStates();
  }, [reloadList, reloadMonth, reloadStates]);
  useEffect(() => {
    if (previousBusinessDate.current === businessDate) return;
    previousBusinessDate.current = businessDate;
    if (allowed && !selected) refreshList();
  }, [allowed, businessDate, refreshList, selected]);
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
  const header = useWorkspaceHeaderRefresh(
    refresh,
    selected ? detail.loading : period.loading || list.loading,
    {
      title: selected
        ? paymentView
          ? 'Thanh toán hóa đơn'
          : adjustmentView
            ? 'Điều chỉnh hóa đơn'
            : 'Chi tiết hóa đơn'
        : 'Hóa đơn & thanh toán',
      onBack: selected ? backToList : undefined,
    },
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
                  Kỳ {detail.data.billingPeriod.slice(0, 7).split('-').reverse().join('/')}
                </Text>
                <TenantAdjustmentPanel
                  key={detail.data.id + ':' + detail.data.version}
                  invoice={detail.data}
                  initialOpen={newRequest === 'true'}
                  canSubmit={canSubmitAdjustment}
                />
              </View>
            ) : (
              <>
                <TenantInvoiceSummary
                  invoice={detail.data}
                  payment={payment.error ? null : payment.data}
                  onPay={() => setPaymentModal(true)}
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
                  canSubmit={canSubmitAdjustment}
                />
                {paymentModal && (
                  <TenantPaymentModal
                    key={'payment-modal:' + detail.data.id}
                    invoiceId={detail.data.id}
                    onClose={() => setPaymentModal(false)}
                  />
                )}
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
  const hasCurrentInvoice =
    period.data?.hasInvoice ||
    items.some((item) => item.billingPeriod === period.data?.billingPeriod);

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
      <InvoiceFeedback {...period} reload={refreshList} />
      {period.data && !hasCurrentInvoice && (
        <Box>
          <Heading title="Chưa có hóa đơn kỳ này" />
          <Text style={invoiceUi.secondary}>{tenantInvoiceScheduleMessage(period.data)}</Text>
        </Box>
      )}
      <View style={invoiceUi.card}>
        <Heading title="Danh sách hóa đơn" />
        <InvoiceFeedback {...list} />
        {!!states.error && <InvoiceFeedback {...states} />}
        {list.data && items.length === 0 && (
          <Text style={invoiceUi.secondary}>Chưa có hóa đơn.</Text>
        )}
        {items.map((invoice) => (
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
      </View>
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
        : 'Chưa xác định thanh toán';
  return (
    <TouchableRipple
      style={invoiceUi.listCard}
      accessibilityRole="button"
      accessibilityLabel={`Xem hóa đơn phòng ${invoice.roomNumber}, kỳ ${invoice.billingPeriod.slice(0, 7)}`}
      onPress={open}
    >
      <View style={[invoiceUi.listContent, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text style={invoiceUi.cardTitle}>
            Hóa đơn tháng {invoice.billingPeriod.slice(0, 7).split('-').reverse().join('/')}
          </Text>
          <Pill
            tone={
              invoice.status === 'Final' && payment?.paymentStatus === 'Paid' ? 'green' : 'neutral'
            }
          >
            {label}
          </Pill>
        </View>
        <Text style={invoiceUi.chargeAmount}>{formatContractMoney(invoice.total)}</Text>
        <Icon source="chevron-right" size={18} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}
