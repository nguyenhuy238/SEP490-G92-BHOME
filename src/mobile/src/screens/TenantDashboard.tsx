import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { dashboardStyles } from '../components/DashboardKit';
import { TenantFeatureDirectory } from '../components/TenantFeatureDirectory';
import { positiveAmount, tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { colors as c, staffColors as s } from '../theme/theme';
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

type LoadState = { loading: boolean; error: string; reload: () => void };
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
  reload?: () => void;
}

function Status({ state }: { state?: LoadState }) {
  if (state?.loading)
    return <ActivityIndicator accessibilityLabel="Đang tải dữ liệu" size="small" />;
  if (!state?.error) return null;
  return (
    <View style={styles.statusRow}>
      <Text style={styles.error}>Chưa tải được dữ liệu.</Text>
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
      <View style={styles.sectionHeading}>
        <View style={dashboardStyles.accent} />
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
  label = title,
  onPress,
}: {
  icon: string;
  title: string;
  label?: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.link}>
        <Icon source={icon} size={20} color={c.muted} />
        <Text style={styles.rowTitle}>{title}</Text>
        <Icon source="chevron-right" size={18} color={c.muted} />
      </View>
    </TouchableRipple>
  );
}

// Tenant-only presentation. Existing endpoint data and navigation callbacks stay intact.
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
  reload,
}: TenantDashboardProps) {
  const { go } = useWorkspace();
  const contract = contracts.find((item) => item.status === 'Active' && item.kind !== 'Holding');
  const openInvoice = () => (invoice ? go('invoice', { invoiceId: invoice.id }) : go('invoice'));
  const period = invoice?.billingPeriod.slice(0, 7).split('-').reverse().join('/');
  const utilities = [
    { label: 'Điện', category: 'Electricity', unit: 'kWh', icon: 'lightning-bolt-outline' },
    { label: 'Nước', category: 'Water', unit: 'm³', icon: 'water-outline' },
  ];
  return (
    <View style={styles.page}>
      <View style={[styles.surface, styles.overview]}>
        <Text style={styles.greeting}>Xin chào bạn!</Text>
        <Text style={styles.secondary}>
          {contract
            ? `Phòng ${contract.roomNumber} · ${contract.locationName}`
            : 'Thông tin thuê của bạn'}
        </Text>
        <Status state={contractState} />
        {contract && (
          <>
            <Text style={styles.cardTitle}>Hợp đồng: {text(contract.status)}</Text>
            <Text style={styles.secondary}>Hết hạn: {displayContractDate(contract.endDate)}</Text>
            <Button compact onPress={() => go('contract', { contractId: contract.id })}>
              Xem hợp đồng phòng này
            </Button>
          </>
        )}
        {!contract && !contractState?.loading && !contractState?.error && (
          <Text style={styles.secondary}>
            Chưa có hợp đồng đang hiệu lực. Bạn vẫn có thể xem các hồ sơ được cấp quyền.
          </Text>
        )}
        {reload && (
          <Button compact icon="refresh" onPress={reload}>
            Làm mới tổng quan
          </Button>
        )}
      </View>

      {invoice ? (
        <View style={[styles.surface, styles.paymentCard]}>
          <View style={styles.paymentHeading}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.cardTitle}>
                {debt ? 'Hóa đơn cần thanh toán' : 'Hóa đơn tháng này'}
              </Text>
              <Text style={styles.secondary}>Kỳ {period}</Text>
            </View>
            <Icon source="receipt-text-outline" size={22} color={s.navy} />
          </View>
          <View style={styles.amountBlock}>
            <Text style={styles.secondary}>
              {invoice.status === 'Draft'
                ? 'Tổng tạm tính'
                : payment
                  ? 'Còn phải trả'
                  : 'Tổng hóa đơn'}
            </Text>
            <Text style={styles.amount}>
              {formatContractMoney(payment?.outstandingAmount ?? invoice.total)}
            </Text>
          </View>
          <Status state={invoiceState} />
          <Status state={paymentState} />
          <Text
            style={[
              styles.paymentStatus,
              { color: payment?.paymentStatus === 'Paid' ? s.green : s.orange },
            ]}
          >
            {invoice.status === 'Draft'
              ? 'Chưa phát hành'
              : payment
                ? tenantPaymentLabel(payment)
                : 'Xem trạng thái thanh toán trong hóa đơn'}
          </Text>
          <Text style={styles.secondary}>
            Hạn thanh toán:{' '}
            {invoice.dueDate ? displayContractDate(invoice.dueDate) : 'Chưa có dữ liệu'}
          </Text>
          {!!payment?.overdueDays && payment.paymentStatus === 'Unpaid' && (
            <Text style={styles.error}>Quá hạn {payment.overdueDays} ngày</Text>
          )}
          <Button
            mode="contained"
            buttonColor={s.blue}
            style={styles.invoiceButton}
            contentStyle={{ minHeight: 44 }}
            onPress={openInvoice}
          >
            {invoice.status === 'Final' &&
            payment?.paymentStatus === 'Unpaid' &&
            positiveAmount(payment.outstandingAmount)
              ? 'Thanh toán'
              : 'Xem hóa đơn'}
          </Button>
        </View>
      ) : (
        <View style={[styles.surface, styles.emptyPayment]}>
          <View style={styles.emptyInvoiceIcon}>
            <Icon source="receipt-text-outline" size={22} color={c.muted} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.cardTitle}>Hóa đơn tháng này</Text>
            {!invoiceState?.loading && !invoiceState?.error && (
              <Text style={styles.secondary}>Chưa có hóa đơn tháng này.</Text>
            )}
            <Status state={invoiceState} />
          </View>
          <TouchableRipple
            onPress={openInvoice}
            accessibilityRole="button"
            accessibilityLabel="Xem hóa đơn"
            style={styles.emptyInvoiceAction}
          >
            <Icon source="arrow-right" size={20} color={s.blue} />
          </TouchableRipple>
        </View>
      )}

      <Status state={alertsState} />
      {(!!debt || notices.length > 0 || expiryNotices.length > 0) && (
        <Section title="Cần chú ý">
          <View style={styles.surface}>
            {debt && (
              <LinkRow
                icon="receipt-text-clock-outline"
                title={`${debt.overdueDays > 0 ? `Quá hạn ${debt.overdueDays} ngày` : 'Hóa đơn còn phải trả'} · ${formatContractMoney(debt.outstandingAmount)}`}
                onPress={() => go('invoice', { invoiceId: debt.invoiceId })}
              />
            )}
            {expiryNotices.slice(0, 2).map((notice) => (
              <LinkRow
                key={notice.id}
                icon="calendar-clock"
                title={`Phòng ${notice.roomNumber} · ${notice.stage === 'Expired' ? 'Đã hết hạn' : 'Cần xem thông báo hết hạn'}`}
                onPress={() => go('contract', { contractId: notice.contractId })}
              />
            ))}
            {notices.slice(0, 2).map((notice) => (
              <LinkRow
                key={notice.id}
                icon="bell-outline"
                title={notice.title}
                onPress={() => go('notifications')}
              />
            ))}
          </View>
        </Section>
      )}

      <TenantFeatureDirectory contractId={contract?.id} />

      <Section title="ĐIỆN NƯỚC" detail={invoice ? `Kỳ ${period}` : undefined}>
        <View style={styles.gridRow}>
          {utilities.map((utility) => {
            const line = invoice?.lines?.find(
              (item) => item.category === utility.category && !!item.meterReadingId,
            );
            return (
              <View key={utility.label} style={[styles.surface, styles.utilityCard]}>
                <View style={styles.utilityHeading}>
                  <Icon source={utility.icon} size={20} color={c.muted} />
                  <Text style={styles.cardTitle}>{utility.label}</Text>
                </View>
                {line ? (
                  <Text style={styles.utilityValue}>
                    {formatBillingDecimal(line.quantity)} {utility.unit}
                  </Text>
                ) : (
                  <Text style={styles.secondary}>Chưa có dữ liệu</Text>
                )}
              </View>
            );
          })}
        </View>
      </Section>

      <View style={styles.surface}>
        <LinkRow icon="gauge" title="Xem lịch sử điện nước" onPress={() => go('tenant-meters')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20, width: '100%' },
  overview: { padding: 16, gap: 8 },
  greeting: { color: s.navy, fontFamily: 'Inter-SemiBold', fontSize: 21, lineHeight: 28 },
  secondary: { color: c.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  cardTitle: {
    color: s.navy,
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  surface: {
    backgroundColor: c.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  section: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sectionTitle: {
    color: s.navy,
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    lineHeight: 20,
    flexGrow: 1,
    flexShrink: 1,
  },
  paymentCard: { padding: 16, gap: 12 },
  paymentHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  amountBlock: { gap: 4 },
  amount: {
    color: s.navy,
    fontFamily: 'Inter-Bold',
    fontSize: 26,
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
  },
  paymentStatus: { fontSize: 12, lineHeight: 18 },
  invoiceButton: { borderRadius: 10 },
  emptyPayment: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  emptyInvoiceIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  emptyInvoiceAction: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  link: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  rowTitle: { flex: 1, color: s.navy, fontSize: 13, lineHeight: 20 },
  utilityCard: { flex: 1, minWidth: 0, padding: 12, gap: 8 },
  utilityHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  utilityValue: {
    color: s.navy,
    fontFamily: 'Inter-SemiBold',
    fontSize: 22,
    lineHeight: 30,
    fontVariant: ['tabular-nums'],
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  error: { color: c.red, fontSize: 12, lineHeight: 18 },
});
