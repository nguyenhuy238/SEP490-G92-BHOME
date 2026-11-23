import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import {
  businessToday,
  displayContractDate,
  formatContractMoney,
} from '../../../../packages/client-core/src/contracts';
import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import {
  formatBillingDecimal,
  hasSettlementUsageCoverage,
} from '../../../../packages/client-core/src/invoices';
import { Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { TenantBillingTabs } from '../components/TenantBillingTabs';
import { colors } from '../theme/theme';
import { positiveAmount, tenantPaymentLabel } from '../features/tenant/paymentPresentation';
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
import { TenantSettlementReceivableDetail } from './TenantSettlementReceivableDetail';
import { paymentText, type DebtInvoice } from '../../../../packages/client-core/src/payments';

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
  const thisMonth = businessToday().slice(0, 7);
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(invoiceId ?? ''),
    [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('all'),
    [historyOpen, setHistoryOpen] = useState(false),
    [settlementOpen, setSettlementOpen] = useState(false);
  const visited = useRef(false);
  // Request the exact Vietnamese billing period, not merely the latest 20 invoices.
  // Old or unpaid invoices from other months must not masquerade as this month's bill.
  const monthList = useWorkspaceQuery<Page<Invoice>>(
    allowed && !selected
      ? `/api/v1/invoices?page=1&pageSize=20&billingPeriod=${thisMonth}-01`
      : null,
    { load: loadInvoiceList, notifyError: false },
  );
  const list = useWorkspaceQuery<Page<Invoice>>(
    allowed && !selected && historyOpen ? `/api/v1/invoices?page=${page}&pageSize=20` : null,
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
  const finalIds = !selected
    ? [
        ...new Set(
          [...(monthList.data?.items ?? []), ...(list.data?.items ?? [])]
            .filter((i) => i.status === 'Final')
            .map((i) => i.id),
        ),
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
    reloadMonth = monthList.reload,
    reloadStates = states.reload;
  const refreshList = useCallback(() => {
    reloadList();
    reloadMonth();
    reloadStates();
  }, [reloadList, reloadMonth, reloadStates]);
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
    selected ? detail.loading : monthList.loading || (historyOpen && list.loading),
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
  const monthItems = monthList.data?.items ?? [];
  const paymentByInvoiceId = new Map(
    (states.data?.items ?? []).map((item) => [item.invoiceId, item]),
  );
  const currentInvoices = monthItems.filter(
    (invoice) => invoice.billingPeriod.slice(0, 7) === thisMonth,
  );
  const olderInvoices = items.filter((invoice) => invoice.billingPeriod.slice(0, 7) !== thisMonth);
  const historyItems = olderInvoices.filter((invoice) => {
    if (statusFilter === 'all') return true;
    const payment = paymentByInvoiceId.get(invoice.id);
    if (invoice.status !== 'Final' || !payment) return false;
    return statusFilter === 'paid'
      ? payment.paymentStatus === 'Paid'
      : payment.paymentStatus === 'Unpaid';
  });
  const unpaidCount = (states.data?.items ?? []).filter(
    (item) => item.paymentStatus === 'Unpaid' && positiveAmount(item.outstandingAmount),
  ).length;
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
      <InvoiceFeedback {...monthList} reload={refreshList} />
      {!!states.error && <InvoiceFeedback {...states} />}
      {monthList.data && !currentInvoices.length && (
        <Box>
          <Heading title="Tháng này chưa có hóa đơn" />
          <Text style={invoiceUi.secondary}>
            Chưa có hóa đơn cho kỳ tháng này. Bạn có thể xem những kỳ trước trong lịch sử bên dưới.
          </Text>
        </Box>
      )}
      {!!currentInvoices.length && (
        <View style={invoiceUi.stack}>
          <Text style={invoiceUi.heading}>Hóa đơn tháng này</Text>
          {currentInvoices.map((invoice) => (
            <InvoiceSummaryCard
              key={invoice.id}
              invoice={invoice}
              payment={paymentByInvoiceId.get(invoice.id)}
              featured
              open={() => go('invoice', { invoiceId: invoice.id })}
            />
          ))}
        </View>
      )}
      {!!states.data && unpaidCount > 0 && (
        <Text style={invoiceUi.secondary}>
          {unpaidCount} hóa đơn còn số dư phải thanh toán trong danh sách đã tải. Mỗi hóa đơn có số
          tiền đối soát riêng.
        </Text>
      )}
      <View style={invoiceUi.card}>
        <TouchableRipple
          accessibilityRole="button"
          accessibilityLabel="Hóa đơn các kỳ trước"
          accessibilityState={{ expanded: historyOpen }}
          onPress={() => setHistoryOpen((open) => !open)}
        >
          <View style={invoiceUi.row}>
            <Text style={invoiceUi.heading}>Hóa đơn các kỳ trước</Text>
            <Icon
              source={historyOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.muted}
            />
          </View>
        </TouchableRipple>
        {historyOpen && (
          <View style={invoiceUi.stack}>
            <Text style={invoiceUi.secondary}>
              Xem từng hóa đơn các kỳ trước và trạng thái thanh toán.
            </Text>
            <InvoiceFeedback {...list} />
            {items.length > 1 && !states.error && (
              <View style={[invoiceUi.row, { gap: 4 }]}>
                {(
                  [
                    ['all', 'Các kỳ trước'],
                    ['unpaid', 'Còn nợ'],
                    ['paid', 'Đã trả'],
                  ] as const
                ).map(([key, label]) => (
                  <Button
                    key={key}
                    compact
                    mode={statusFilter === key ? 'contained-tonal' : 'outlined'}
                    accessibilityRole="tab"
                    accessibilityLabel={`Lọc hóa đơn: ${key === 'all' ? 'Tất cả' : key === 'unpaid' ? 'Chưa thanh toán' : 'Đã thanh toán'}`}
                    accessibilityState={{ selected: statusFilter === key }}
                    onPress={() => setStatusFilter(key)}
                  >
                    {label}
                  </Button>
                ))}
              </View>
            )}
            {historyItems.length === 0 && (
              <Text style={invoiceUi.secondary}>Chưa có hóa đơn phù hợp.</Text>
            )}
            {historyItems.map((invoice) => (
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
        )}
      </View>
      {purpose !== 'adjustment' && (
        <View style={invoiceUi.card}>
          <TouchableRipple
            accessibilityRole="button"
            accessibilityLabel="Khoản phải thu khi trả phòng"
            accessibilityState={{ expanded: settlementOpen }}
            onPress={() => setSettlementOpen((open) => !open)}
          >
            <View style={invoiceUi.row}>
              <Text style={invoiceUi.heading}>Khoản phải thu khi trả phòng</Text>
              <Icon
                source={settlementOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.muted}
              />
            </View>
          </TouchableRipple>
          {settlementOpen && <TenantSettlementReceivables />}
        </View>
      )}
    </>
  );
}
function InvoiceSummaryCard({
  invoice,
  payment,
  featured = false,
  open,
}: {
  invoice: Invoice;
  payment?: DebtInvoice;
  featured?: boolean;
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
  const overdue =
    payment &&
    payment.paymentStatus !== 'Paid' &&
    payment.overdueDays > 0 &&
    positiveAmount(payment.outstandingAmount);
  const details = featured
    ? (invoice.lines ?? []).filter((line) =>
        ['Electricity', 'Water', 'ServiceFee'].includes(line.category),
      )
    : [];
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
            {featured && payment?.paidAmount != null && (
              <Text style={invoiceUi.secondary}>
                Đã thanh toán: {formatContractMoney(payment.paidAmount)}
              </Text>
            )}
            {featured && invoice.status === 'Final' && !payment && (
              <Text style={invoiceUi.secondary}>
                Đang kiểm tra trạng thái thanh toán từ máy chủ.
              </Text>
            )}
          </View>
          <Icon source="chevron-right" size={20} color={colors.muted} />
        </View>
        {featured && (
          <View style={invoiceUi.divider}>
            <Text style={invoiceUi.secondary}>Điện, nước và phí dịch vụ</Text>
            {details.length === 0 ? (
              <Text style={invoiceUi.secondary}>
                Mở chi tiết để xem các khoản thu của tháng này.
              </Text>
            ) : (
              details.slice(0, 4).map((line) => (
                <View key={line.id} style={invoiceUi.row}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={invoiceUi.title}>
                      {line.category === 'Electricity'
                        ? 'Điện'
                        : line.category === 'Water'
                          ? 'Nước'
                          : line.name}
                    </Text>
                    {(line.category === 'Electricity' || line.category === 'Water') && (
                      <Text style={invoiceUi.secondary}>
                        {hasSettlementUsageCoverage(line)
                          ? 'Đã tính trong quyết toán trả phòng'
                          : line.quantity == null
                            ? 'Chưa có tiêu thụ'
                            : `${formatBillingDecimal(line.quantity)} ${line.category === 'Electricity' ? 'kWh' : 'm³'}`}
                      </Text>
                    )}
                  </View>
                  <Text style={invoiceUi.chargeAmount}>{formatContractMoney(line.amount)}</Text>
                </View>
              ))
            )}
            {details.length > 4 && (
              <Text style={invoiceUi.secondary}>
                Còn {details.length - 4} khoản. Xem chi tiết hóa đơn.
              </Text>
            )}
          </View>
        )}
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
