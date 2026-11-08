import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { TenantFeatureDirectory } from '../components/TenantFeatureDirectory';
import { positiveAmount, tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';
import type {
  ContractSummary,
  ContractExpiryNotice,
} from '../../../../packages/client-core/src/contracts';
import {
  formatContractMoney,
  displayContractDate,
  text,
} from '../../../../packages/client-core/src/contracts';
import type { Invoice } from '../../../../packages/client-core/src/invoices';
import { formatBillingDecimal } from '../../../../packages/client-core/src/invoices';
import type { InvoicePayment, DebtInvoice } from '../../../../packages/client-core/src/payments';
import type { NotificationItem } from '../../../../packages/client-core/src/notifications';

type LoadState = {
  loading: boolean;
  error: string;
  reload: () => void;
  fetching?: boolean;
  stale?: boolean;
  updatedAt?: number;
};
export interface TenantDashboardProps {
  contracts?: ContractSummary[];
  invoice?: Invoice;
  payment?: InvoicePayment;
  contractState?: LoadState;
  invoiceState?: LoadState;
  paymentState?: LoadState;
  debt?: DebtInvoice;
  notices?: NotificationItem[];
  expiryNotices?: ContractExpiryNotice[];
  alertsState?: LoadState;
}
function Status({ state }: { state?: LoadState }) {
  if (state?.loading)
    return <ActivityIndicator accessibilityLabel="Đang tải dữ liệu" size="small" />;
  if (!state?.error)
    return state?.updatedAt && (state.fetching || state.stale) ? (
      <Text style={styles.secondary}>
        {state.fetching
          ? 'Đang cập nhật dữ liệu…'
          : 'Dữ liệu lần tải trước. Kéo xuống để cập nhật.'}
      </Text>
    ) : null;
  return (
    <View style={styles.statusRow}>
      <Text accessibilityRole="alert" style={styles.error}>
        {state.updatedAt
          ? 'Đang hiển thị dữ liệu lần tải trước. Chưa cập nhật được.'
          : 'Chưa tải được dữ liệu.'}
      </Text>
      <Button compact onPress={state.reload}>
        Thử lại
      </Button>
    </View>
  );
}
function Section({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.between}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {detail && <Text style={styles.secondary}>{detail}</Text>}
      </View>
      {children}
    </View>
  );
}
function LinkRow({
  icon,
  title,
  detail,
  label = title,
  onPress,
}: {
  icon: string;
  title: string;
  detail?: string;
  label?: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.link}>
        <Icon source={icon} size={20} color={s.blue} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {title}
          </Text>
          {detail && (
            <Text style={styles.secondary} numberOfLines={1}>
              {detail}
            </Text>
          )}
        </View>
        <Icon source="chevron-right" size={18} color={c.muted} />
      </View>
    </TouchableRipple>
  );
}
function RoomSummary({ contract, state }: { contract?: ContractSummary; state?: LoadState }) {
  const { go } = useWorkspace();
  return (
    <View style={styles.surface}>
      <Status state={state} />
      {contract ? (
        <TouchableRipple
          accessibilityRole="button"
          accessibilityLabel="Xem hợp đồng phòng này"
          onPress={() => go('contract', { contractId: contract.id })}
        >
          <View style={styles.room}>
            <View style={styles.grow}>
              <Text style={styles.roomTitle}>Phòng {contract.roomNumber}</Text>
              <Text style={styles.secondary} numberOfLines={1}>
                {contract.locationName}
              </Text>
              <View style={styles.contractRow}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>{text(contract.status)}</Text>
                <Text style={styles.secondary}>
                  Hết hạn {displayContractDate(contract.endDate)}
                </Text>
              </View>
            </View>
            <Icon source="chevron-right" size={20} color={c.muted} />
          </View>
        </TouchableRipple>
      ) : (
        !state?.loading &&
        !state?.error && (
          <View style={styles.empty}>
            <Icon source="home-outline" size={24} color={c.muted} />
            <View style={styles.grow}>
              <Text style={styles.cardTitle}>Thông tin phòng thuê</Text>
              <Text style={styles.secondary}>Chưa có hợp đồng đang hiệu lực.</Text>
            </View>
          </View>
        )
      )}
    </View>
  );
}
function InvoiceSummary({
  invoice,
  payment,
  debt,
  invoiceState,
  paymentState,
}: Pick<TenantDashboardProps, 'invoice' | 'payment' | 'debt' | 'invoiceState' | 'paymentState'>) {
  const { go } = useWorkspace();
  const open = () => (invoice ? go('invoice', { invoiceId: invoice.id }) : go('invoice'));
  if (!invoice)
    return (
      <View style={styles.surface}>
        <View style={styles.empty}>
          <Icon source="receipt-text-outline" size={24} color={c.muted} />
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>Hóa đơn của bạn</Text>
            {!invoiceState?.loading && !invoiceState?.error && (
              <Text style={styles.secondary}>Chưa có hóa đơn tháng này.</Text>
            )}
            <Status state={invoiceState} />
          </View>
          <TouchableRipple
            style={styles.iconAction}
            accessibilityRole="button"
            accessibilityLabel="Xem hóa đơn"
            onPress={open}
          >
            <Icon source="chevron-right" size={20} color={s.blue} />
          </TouchableRipple>
        </View>
      </View>
    );
  const period = invoice.billingPeriod.slice(0, 7).split('-').reverse().join('/');
  const scopedDebt = debt?.invoiceId === invoice.id ? debt : undefined;
  const canPay =
    invoice.status === 'Final' &&
    payment?.paymentStatus === 'Unpaid' &&
    positiveAmount(payment.outstandingAmount);
  const overdue = canPay && payment.overdueDays > 0 ? payment.overdueDays : 0;
  const paid = invoice.status === 'Final' && payment?.paymentStatus === 'Paid';
  const amount =
    invoice.status === 'Draft'
      ? invoice.total
      : (payment?.outstandingAmount ?? scopedDebt?.outstandingAmount ?? invoice.total);
  const amountLabel =
    invoice.status === 'Draft'
      ? 'Tổng tạm tính'
      : payment || scopedDebt
        ? 'Số tiền cần thanh toán'
        : 'Tổng hóa đơn';
  const stateLabel =
    invoice.status === 'Draft'
      ? 'Chưa phát hành'
      : payment
        ? tenantPaymentLabel(payment)
        : 'Xem trạng thái trong chi tiết';
  return (
    <View style={[styles.surface, styles.payment]}>
      <View style={styles.between}>
        <Text style={styles.cardTitle}>Hóa đơn tháng {period}</Text>
        <View
          style={[
            styles.badge,
            overdue > 0 ? styles.badgeRed : paid ? styles.badgeGreen : styles.badgeBlue,
          ]}
        >
          <Text
            style={[styles.badgeText, { color: overdue > 0 ? c.red : paid ? s.green : s.blue }]}
          >
            {overdue > 0 ? `Quá hạn ${overdue} ngày` : stateLabel}
          </Text>
        </View>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={styles.secondary}>{amountLabel}</Text>
        <Text style={[styles.amount, paid && { color: s.green }]}>
          {formatContractMoney(amount)}
        </Text>
      </View>
      <Text style={styles.secondary}>
        Hạn thanh toán:{' '}
        {(payment?.dueDate ?? invoice.dueDate)
          ? displayContractDate(payment?.dueDate ?? invoice.dueDate)
          : 'Chưa có dữ liệu'}
      </Text>
      {overdue > 0 && <Text style={styles.secondary}>{stateLabel}</Text>}
      <Status state={invoiceState} />
      <Status state={paymentState} />
      <View style={styles.paymentActions}>
        <Button
          mode="contained"
          buttonColor={s.blue}
          style={styles.payButton}
          contentStyle={{ minHeight: 46 }}
          onPress={open}
        >
          {canPay ? 'Thanh toán ngay' : 'Xem hóa đơn'}
        </Button>
        {canPay && (
          <Button
            compact
            style={{ flexShrink: 1 }}
            accessibilityLabel="Xem chi tiết hóa đơn"
            onPress={open}
          >
            Chi tiết
          </Button>
        )}
      </View>
    </View>
  );
}
export function TenantDashboard({
  contracts = [],
  invoice,
  payment,
  contractState,
  invoiceState,
  paymentState,
  debt,
  notices = [],
  expiryNotices = [],
  alertsState,
}: TenantDashboardProps) {
  const { go } = useWorkspace();
  const contract = contracts.find((item) => item.status === 'Active' && item.kind !== 'Holding');
  const otherDebt = debt && debt.invoiceId !== invoice?.id ? debt : undefined;
  const important = notices.filter(
    (notice) =>
      !(
        invoice &&
        notice.relatedObjectId === invoice.id &&
        ['Invoice', 'Payment'].includes(notice.category)
      ),
  );
  const hasAlerts = !!otherDebt || expiryNotices.length > 0 || important.length > 0;
  const period = invoice?.billingPeriod.slice(0, 7).split('-').reverse().join('/');
  return (
    <View style={styles.page}>
      <RoomSummary contract={contract} state={contractState} />
      <InvoiceSummary
        invoice={invoice}
        payment={payment}
        debt={debt}
        invoiceState={invoiceState}
        paymentState={paymentState}
      />
      <Status state={alertsState} />
      {hasAlerts && (
        <Section title="Thông tin cần chú ý">
          <View style={styles.surface}>
            {otherDebt && (
              <LinkRow
                icon="receipt-text-clock-outline"
                title="Có hóa đơn cần xem"
                detail={`${formatContractMoney(otherDebt.outstandingAmount)}${otherDebt.overdueDays > 0 ? ` · Quá hạn ${otherDebt.overdueDays} ngày` : ''}`}
                onPress={() => go('invoice', { invoiceId: otherDebt.invoiceId })}
              />
            )}
            {expiryNotices.slice(0, 2).map((notice) => (
              <LinkRow
                key={notice.id}
                icon="calendar-clock-outline"
                title={notice.stage === 'Expired' ? 'Hợp đồng đã hết hạn' : 'Cần xem hạn hợp đồng'}
                detail={`Phòng ${notice.roomNumber} · ${displayContractDate(notice.endDate)}`}
                onPress={() => go('contract', { contractId: notice.contractId })}
              />
            ))}
            {important.slice(0, 2).map((notice) => (
              <LinkRow
                key={notice.id}
                icon="bell-outline"
                title={notice.title}
                detail="Xem thông báo"
                onPress={() => go('notifications')}
              />
            ))}
          </View>
        </Section>
      )}
      <TenantFeatureDirectory contractId={contract?.id} />
      <Section title="Điện & nước" detail={invoice ? `Kỳ ${period}` : undefined}>
        <View style={styles.gridRow}>
          {[
            { label: 'Điện', category: 'Electricity', unit: 'kWh', icon: 'lightning-bolt-outline' },
            { label: 'Nước', category: 'Water', unit: 'm³', icon: 'water-outline' },
          ].map((utility) => {
            const line = invoice?.lines?.find(
              (item) => item.category === utility.category && !!item.meterReadingId,
            );
            return (
              <View key={utility.label} style={[styles.surface, styles.utility]}>
                <View style={styles.utilityHeading}>
                  <View style={styles.utilityIcon}>
                    <Icon source={utility.icon} size={20} color={s.blue} />
                  </View>
                  <Text style={styles.cardTitle}>{utility.label}</Text>
                </View>
                {line?.quantity != null ? (
                  <Text style={styles.utilityValue}>
                    {formatBillingDecimal(line.quantity)}{' '}
                    <Text style={styles.unit}>{utility.unit}</Text>
                  </Text>
                ) : (
                  <Text style={styles.secondary}>Chưa có chỉ số</Text>
                )}
              </View>
            );
          })}
        </View>
        <View style={styles.surface}>
          <LinkRow
            icon="chart-line"
            title="Lịch sử điện nước"
            onPress={() => go('tenant-meters')}
          />
        </View>
      </Section>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { gap: 22, width: '100%' },
  surface: {
    backgroundColor: c.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  room: { padding: 16, gap: 12, flexDirection: 'row', alignItems: 'center', minHeight: 110 },
  roomTitle: { ...typography.screenTitle, color: '#173654' },
  secondary: { ...typography.secondary, color: c.muted, flexShrink: 1 },
  cardTitle: {
    color: '#173654',
    ...typography.cardTitle,
    flexShrink: 1,
  },
  contractRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    paddingTop: 4,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: s.green },
  activeText: { ...typography.label, color: s.green },
  section: { gap: 12 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionTitle: { ...typography.sectionHeading, color: '#173654' },
  payment: { padding: 16, gap: 12 },
  amount: {
    color: '#173654',
    ...typography.money,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: '100%' },
  badgeBlue: { backgroundColor: s.blueSoft },
  badgeRed: { backgroundColor: c.redSoft },
  badgeGreen: { backgroundColor: c.greenSoft },
  badgeText: typography.status,
  paymentActions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  payButton: { borderRadius: 12, flexGrow: 1 },
  empty: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  link: { minHeight: 52, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  rowTitle: { ...typography.link, color: '#173654' },
  gridRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  utility: { flex: 1, minWidth: 0, padding: 14, gap: 12, minHeight: 116 },
  utilityHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  utilityIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: s.blueSoft,
  },
  utilityValue: {
    color: '#173654',
    ...typography.value,
  },
  unit: { ...typography.body, color: c.muted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 8 },
  error: { ...typography.secondary, color: c.red },
});
