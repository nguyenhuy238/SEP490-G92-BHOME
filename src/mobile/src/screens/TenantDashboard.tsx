import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { dashboardStyles } from '../components/DashboardKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { colors as c, staffColors as s } from '../theme/theme';
import type { ContractSummary } from '../../../../packages/client-core/src/contracts';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import type { Invoice } from '../../../../packages/client-core/src/invoices';
import { formatBillingDecimal } from '../../../../packages/client-core/src/invoices';
import type { InvoicePayment } from '../../../../packages/client-core/src/payments';
import { paymentText } from '../../../../packages/client-core/src/payments';

type LoadState = { loading: boolean; error: string; reload: () => void };
export interface TenantDashboardProps {
  contracts?: ContractSummary[];
  invoice?: Invoice;
  payment?: InvoicePayment;
  contractState?: LoadState;
  invoiceState?: LoadState;
  paymentState?: LoadState;
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

function QuickAction({
  title,
  subtitle,
  icon,
  tint,
  background,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: string;
  tint: string;
  background: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      style={styles.quickCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    >
      <View style={styles.quickContent}>
        <View style={[styles.quickIcon, { backgroundColor: background }]}>
          <Icon source={icon} size={20} color={tint} />
        </View>
        <Text style={styles.quickTitle}>{title}</Text>
        <Text style={styles.quickSubtitle}>{subtitle}</Text>
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
}: TenantDashboardProps) {
  const { go, unavailable } = useWorkspace();
  const contract = contracts.find((item) => item.status === 'Active') ?? contracts[0];
  const openInvoice = () => (invoice ? go('invoice', { invoiceId: invoice.id }) : go('invoice'));
  const period = invoice?.billingPeriod.slice(0, 7).split('-').reverse().join('/');
  const utilities = [
    { label: 'Điện', category: 'Electricity', unit: 'kWh', icon: 'lightning-bolt-outline' },
    { label: 'Nước', category: 'Water', unit: 'm³', icon: 'water-outline' },
  ];
  return (
    <View style={styles.page}>
      <View style={styles.introduction}>
        <Text style={styles.greeting}>Xin chào bạn!</Text>
        <Text style={styles.secondary}>
          {contract
            ? `Phòng ${contract.roomNumber} · ${contract.locationName}`
            : 'Thông tin thuê của bạn'}
        </Text>
      </View>

      {invoice ? (
        <View style={[styles.surface, styles.paymentCard]}>
          <View style={styles.paymentHeading}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.cardTitle}>Hóa đơn tháng này</Text>
              <Text style={styles.secondary}>Kỳ {period}</Text>
            </View>
            <Icon source="receipt-text-outline" size={22} color={s.navy} />
          </View>
          <View style={styles.amountBlock}>
            <Text style={styles.secondary}>{payment ? 'Còn phải trả' : 'Tổng hóa đơn'}</Text>
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
                ? paymentText(payment.paymentStatus)
                : 'Xem trạng thái thanh toán trong hóa đơn'}
          </Text>
          <Button
            mode="contained"
            buttonColor={s.blue}
            style={styles.invoiceButton}
            contentStyle={{ minHeight: 44 }}
            onPress={openInvoice}
          >
            Xem hóa đơn
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

      <Section title="TIỆN ÍCH CƯ DÂN">
        <View style={styles.gridRow}>
          <QuickAction
            title="Báo sự cố"
            subtitle="Gửi yêu cầu hỗ trợ"
            icon="wrench-outline"
            tint={s.blue}
            background={s.blueSoft}
            onPress={() => go('incidents')}
          />
          <QuickAction
            title="Thanh toán VietQR"
            subtitle="Xem hóa đơn & QR"
            icon="qrcode-scan"
            tint={s.purple}
            background={s.purpleSoft}
            onPress={openInvoice}
          />
        </View>
        <View style={styles.gridRow}>
          <QuickAction
            title="Gia hạn hợp đồng"
            subtitle="Hợp đồng & phụ lục"
            icon="file-document-outline"
            tint={s.green}
            background={s.greenSoft}
            onPress={() => go('contract-request')}
          />
          <QuickAction
            title="Tạm trú VNeID"
            subtitle="Hướng dẫn đăng ký"
            icon="card-account-details-outline"
            tint={s.orange}
            background={s.orangeSoft}
            onPress={() => go('residence')}
          />
        </View>
      </Section>

      <Section title="HỢP ĐỒNG & THANH TOÁN">
        <View style={styles.surface}>
          <View style={styles.contractContext}>
            <View style={styles.contractHeading}>
              <Text style={styles.cardTitle}>Hợp đồng của bạn</Text>
              <Button compact textColor={s.blue} onPress={() => go('contract')}>
                Xem tất cả
              </Button>
            </View>
            <Status state={contractState} />
            {!contracts.length && !contractState?.loading && !contractState?.error && (
              <Text style={styles.secondary}>Chưa có hợp đồng gắn với tài khoản của bạn.</Text>
            )}
          </View>
          {contracts.map((item) => (
            <View key={item.id}>
              <LinkRow
                icon="home-outline"
                title={`Phòng ${item.roomNumber}`}
                label="Xem hợp đồng & trạng thái ký"
                onPress={() => go('contract', { contractId: item.id })}
              />
            </View>
          ))}
          <View style={styles.divider} />
          <LinkRow
            icon="history"
            title="Lịch sử hóa đơn & thanh toán"
            onPress={() => go('billing-history')}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="receipt-text-edit-outline"
            title="Yêu cầu điều chỉnh hóa đơn"
            onPress={() => go('adjustment')}
          />
          <View style={styles.divider} />
          <LinkRow icon="file-sign" title="Trạng thái ký hợp đồng" onPress={() => go('signing')} />
        </View>
      </Section>

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
        <LinkRow
          icon="headset"
          title="Liên hệ Ban quản lý"
          onPress={() => unavailable('Liên hệ Ban quản lý')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20, width: '100%' },
  introduction: { gap: 4 },
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
  quickCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  quickContent: { flexGrow: 1, minHeight: 112, padding: 12, gap: 4 },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  quickTitle: { color: s.navy, fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: 20 },
  quickSubtitle: { color: c.muted, fontSize: 12, lineHeight: 17 },
  link: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  rowTitle: { flex: 1, color: s.navy, fontSize: 13, lineHeight: 20 },
  divider: { height: 1, backgroundColor: c.border, marginHorizontal: 12 },
  contractContext: { paddingHorizontal: 12, paddingBottom: 12 },
  contractHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
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
