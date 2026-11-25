import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import type {
  ContractExpiryNotice,
  ContractSummary,
} from '../../../../packages/client-core/src/contracts';
import {
  businessToday,
  displayContractDate,
  formatContractMoney,
} from '../../../../packages/client-core/src/contracts';
import type { Invoice, InvoiceLine } from '../../../../packages/client-core/src/invoices';
import { formatBillingDecimal } from '../../../../packages/client-core/src/invoices';
import type { DebtInvoice, InvoicePayment } from '../../../../packages/client-core/src/payments';
import type { TenantMeterReading } from '../../../../packages/client-core/src/tenantReadings';
import type { NotificationItem } from '../../../../packages/client-core/src/notifications';
import { TenantMeterReadingEvidence } from '../components/TenantMeterReadingEvidence';
import { positiveAmount, tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { colors as c, staffColors as s } from '../theme/theme';

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
  month?: string;
  invoice?: Invoice;
  payment?: InvoicePayment;
  meterReadings?: TenantMeterReading[];
  contractState?: LoadState;
  invoiceState?: LoadState;
  paymentState?: LoadState;
  meterState?: LoadState;
  debt?: DebtInvoice;
  notices?: NotificationItem[];
  expiryNotices?: ContractExpiryNotice[];
  alertsState?: LoadState;
}

function Feedback({ state }: { state?: LoadState }) {
  if (state?.loading && !state.updatedAt)
    return <ActivityIndicator size="small" accessibilityLabel="Đang tải dữ liệu" />;
  if (state?.error)
    return (
      <View style={styles.feedback}>
        <Text accessibilityRole="alert" style={styles.error}>
          {state.updatedAt ? 'Dữ liệu cũ, chưa cập nhật được.' : 'Không tải được thông tin.'}
        </Text>
        <Button compact onPress={state.reload}>
          Thử lại
        </Button>
      </View>
    );
  if (state?.updatedAt && (state.fetching || state.stale))
    return (
      <Text style={styles.footnote}>
        {state.fetching ? 'Đang cập nhật…' : 'Kéo xuống để cập nhật.'}
      </Text>
    );
  return null;
}

function Heading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {!!action && !!onPress && (
        <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={action}>
          <View style={styles.headingAction}>
            <Text style={styles.linkText}>{action}</Text>
            <Icon source="chevron-right" size={17} color={s.blue} />
          </View>
        </TouchableRipple>
      )}
    </View>
  );
}

function MonthlyInvoice({
  month,
  invoice,
  payment,
  invoiceState,
  paymentState,
}: Pick<TenantDashboardProps, 'invoice' | 'payment' | 'invoiceState' | 'paymentState'> & {
  month: string;
}) {
  const { go } = useWorkspace();
  const paid = invoice?.status === 'Final' && payment?.paymentStatus === 'Paid';
  const due =
    invoice?.status === 'Final' &&
    payment?.paymentStatus === 'Unpaid' &&
    positiveAmount(payment.outstandingAmount);
  const overdue = due && payment.overdueDays > 0;
  const periodLabel = month.slice(5, 7) + '/' + month.slice(0, 4);
  const open = () => (invoice ? go('invoice', { invoiceId: invoice.id }) : go('invoice'));

  return (
    <View style={styles.bill}>
      <View style={styles.billHeader}>
        <Text style={styles.billTitle}>Hóa đơn tháng {periodLabel}</Text>
        <Icon source="receipt-text-outline" size={23} color="#D5E6FF" />
      </View>
      {!invoice && !invoiceState?.loading && !invoiceState?.error ? (
        <>
          <Text style={styles.billEmpty}>Chưa có hóa đơn</Text>
          <Text style={styles.billSupporting}>
            Khi chủ nhà phát hành hóa đơn tháng này, số tiền và hạn thanh toán sẽ xuất hiện ở đây.
          </Text>
        </>
      ) : invoice ? (
        <>
          <Text style={styles.billLabel}>
            {invoice.status === 'Draft' ? 'Tổng tạm tính' : 'Tổng hóa đơn'}
          </Text>
          <Text
            style={styles.billAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            accessibilityLabel={`Tổng hóa đơn ${formatContractMoney(invoice.total)}`}
          >
            {formatContractMoney(invoice.total)}
          </Text>
          <View style={styles.billStatus}>
            <Icon
              source={
                paid
                  ? 'check-circle-outline'
                  : overdue
                    ? 'alert-circle-outline'
                    : 'information-outline'
              }
              size={18}
              color={paid ? '#B6F0CC' : overdue ? '#FFE0B8' : '#E0EEFF'}
            />
            <Text style={styles.billStatusText}>
              {invoice.status === 'Draft'
                ? 'Chưa phát hành, chưa cần thanh toán'
                : payment
                  ? overdue
                    ? `Quá hạn ${payment.overdueDays} ngày`
                    : tenantPaymentLabel(payment)
                  : 'Đã phát hành · Xem chi tiết để biết trạng thái'}
            </Text>
          </View>
          {invoice.status === 'Final' && !!payment && !paid && (
            <View style={styles.billSummary}>
              <Text style={styles.billSupporting}>Còn phải trả</Text>
              <Text style={styles.billRemaining}>
                {formatContractMoney(payment.outstandingAmount)}
              </Text>
            </View>
          )}
          {invoice.status === 'Final' && !!(payment?.dueDate ?? invoice.dueDate) && (
            <Text style={styles.billSupporting}>
              Hạn thanh toán: {displayContractDate(payment?.dueDate ?? invoice.dueDate)}
            </Text>
          )}
        </>
      ) : (
        <Feedback state={invoiceState} />
      )}
      {invoice && <Feedback state={invoiceState} />}
      {invoice?.status === 'Final' && <Feedback state={paymentState} />}
      <Button
        mode="contained"
        buttonColor={c.white}
        textColor={s.navy}
        contentStyle={{ minHeight: 48 }}
        style={styles.billButton}
        onPress={open}
        icon={due ? 'credit-card-outline' : 'arrow-right'}
      >
        {due ? 'Thanh toán hóa đơn' : invoice ? 'Xem chi tiết hóa đơn' : 'Xem hóa đơn của tôi'}
      </Button>
    </View>
  );
}

type UtilityKind = 'Electricity' | 'Water';
export function tenantMonthlyUtility(
  utility: UtilityKind,
  month: string,
  roomId: string | undefined,
  invoice?: Invoice,
  readings: TenantMeterReading[] = [],
) {
  const candidate = readings
    .filter(
      (reading) =>
        reading.utilityType === utility &&
        reading.purpose === 'Periodic' &&
        reading.billingPeriod?.slice(0, 7) === month &&
        reading.roomId === roomId,
    )
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))[0];
  const line = invoice?.lines.find((item) => item.category === utility);
  return {
    usage: candidate?.consumption ?? (line?.meterReadingId ? line.quantity : null),
    reading: candidate,
    evidenceId: candidate?.id ?? line?.meterReadingId ?? null,
    billed: line?.amount,
  };
}

function UtilityCard({
  kind,
  month,
  roomId,
  invoice,
  meterReadings = [],
  meterState,
}: {
  kind: UtilityKind;
  month: string;
  roomId?: string;
  invoice?: Invoice;
  meterReadings?: TenantMeterReading[];
  meterState?: LoadState;
}) {
  const electricity = kind === 'Electricity';
  const label = electricity ? 'Điện' : 'Nước';
  const unit = electricity ? 'kWh' : 'm³';
  const item = tenantMonthlyUtility(kind, month, roomId, invoice, meterReadings);
  return (
    <View style={styles.utility}>
      <View style={styles.utilityTop}>
        <View style={[styles.utilityIcon, !electricity && styles.utilityIconWater]}>
          <Icon
            source={electricity ? 'lightning-bolt-outline' : 'water-outline'}
            size={19}
            color={electricity ? '#9D550A' : '#1764AB'}
          />
        </View>
        <Text style={styles.utilityName}>{label}</Text>
      </View>
      {item.usage !== null && item.usage !== undefined ? (
        <Text style={styles.usage} numberOfLines={1} adjustsFontSizeToFit>
          {formatBillingDecimal(item.usage)} <Text style={styles.unit}>{unit}</Text>
        </Text>
      ) : (
        <Text style={styles.utilityEmpty}>
          {meterState?.loading && !invoice ? 'Đang tải…' : 'Chưa ghi số'}
        </Text>
      )}
      <Text style={styles.utilityCaption}>
        {item.usage === null || item.usage === undefined
          ? 'Chưa có chỉ số tiêu thụ được xác nhận'
          : 'Đã dùng trong kỳ'}
      </Text>
      {item.billed !== undefined && (
        <Text style={styles.utilityCost}>
          Tiền {label.toLocaleLowerCase('vi-VN')}: {formatContractMoney(item.billed)}
        </Text>
      )}
      {item.reading && (
        <Text style={styles.utilityCaption}>
          Chốt: {formatBillingDecimal(item.reading.confirmedValue)} {unit}
          {item.reading.previousValue !== null
            ? ` · Trước: ${formatBillingDecimal(item.reading.previousValue)} ${unit}`
            : ''}
        </Text>
      )}
      {!!item.evidenceId && (
        <TenantMeterReadingEvidence
          id={item.evidenceId}
          label={`Ảnh công tơ ${label.toLocaleLowerCase('vi-VN')}`}
          compact
        />
      )}
    </View>
  );
}

function MoneyRow({ line }: { line: InvoiceLine }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={styles.moneyName} numberOfLines={2}>
        {line.name || line.chargeCode}
      </Text>
      <Text
        style={styles.moneyValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {formatContractMoney(line.amount)}
      </Text>
    </View>
  );
}

function Attention({
  invoice,
  debt,
  notices,
  expiryNotices,
  state,
}: {
  invoice?: Invoice;
  debt?: DebtInvoice;
  notices: NotificationItem[];
  expiryNotices: ContractExpiryNotice[];
  state?: LoadState;
}) {
  const { go } = useWorkspace();
  const otherDebt = debt && debt.invoiceId !== invoice?.id ? debt : undefined;
  const important = notices.filter(
    (notice) =>
      !(notice.relatedObjectId === invoice?.id && ['Invoice', 'Payment'].includes(notice.category)),
  );
  if (!otherDebt && !expiryNotices.length && !important.length) return null;
  return (
    <View style={styles.section}>
      <Heading title="Cần chú ý" />
      <View style={styles.whiteSurface}>
        {otherDebt && (
          <TouchableRipple
            accessibilityRole="button"
            onPress={() => go('invoice', { invoiceId: otherDebt.invoiceId })}
          >
            <View style={styles.alertRow}>
              <Icon source="alert-circle-outline" size={20} color={c.red} />
              <View style={styles.grow}>
                <Text style={styles.alertTitle}>Còn hóa đơn kỳ khác cần thanh toán</Text>
                <Text style={styles.secondary}>
                  {formatContractMoney(otherDebt.outstandingAmount)}
                  {otherDebt.overdueDays > 0 ? ` · Quá hạn ${otherDebt.overdueDays} ngày` : ''}
                </Text>
              </View>
              <Icon source="chevron-right" size={18} color={s.blue} />
            </View>
          </TouchableRipple>
        )}
        {expiryNotices.slice(0, 1).map((notice) => (
          <TouchableRipple
            key={notice.id}
            accessibilityRole="button"
            onPress={() => go('contract', { contractId: notice.contractId })}
          >
            <View style={styles.alertRow}>
              <Icon source="calendar-clock-outline" size={20} color={c.amber} />
              <View style={styles.grow}>
                <Text style={styles.alertTitle}>Cần xem hạn hợp đồng</Text>
                <Text style={styles.secondary}>{displayContractDate(notice.endDate)}</Text>
              </View>
              <Icon source="chevron-right" size={18} color={s.blue} />
            </View>
          </TouchableRipple>
        ))}
        {important.slice(0, 1).map((notice) => (
          <TouchableRipple
            key={notice.id}
            accessibilityRole="button"
            onPress={() => go('notifications')}
          >
            <View style={styles.alertRow}>
              <Icon source="bell-outline" size={20} color={s.blue} />
              <View style={styles.grow}>
                <Text style={styles.alertTitle} numberOfLines={2}>
                  {notice.title}
                </Text>
                <Text style={styles.secondary}>Xem thông báo</Text>
              </View>
              <Icon source="chevron-right" size={18} color={s.blue} />
            </View>
          </TouchableRipple>
        ))}
      </View>
      <Feedback state={state} />
    </View>
  );
}

function Shortcut({ icon, title, onPress }: { icon: string; title: string; onPress: () => void }) {
  return (
    <TouchableRipple
      style={styles.shortcut}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
    >
      <View style={styles.shortcutBody}>
        <Icon source={icon} size={20} color={s.blue} />
        <Text style={styles.shortcutTitle}>{title}</Text>
        <Icon source="chevron-right" size={17} color={c.muted} />
      </View>
    </TouchableRipple>
  );
}

export function TenantDashboard({
  contracts = [],
  month = businessToday().slice(0, 7),
  invoice,
  payment,
  meterReadings = [],
  contractState,
  invoiceState,
  paymentState,
  meterState,
  debt,
  notices = [],
  expiryNotices = [],
  alertsState,
}: TenantDashboardProps) {
  const { go } = useWorkspace();
  const contract = contracts.find((item) => item.status === 'Active' && item.kind !== 'Holding');
  const rent = invoice?.lines.filter((line) => line.category === 'Rent') ?? [];
  const serviceFees = invoice?.lines.filter((line) => line.category === 'ServiceFee') ?? [];
  // A recently returned room can still have a current-period Final invoice.
  // The invoice itself supplies its room, while the Tenant endpoint continues
  // to enforce which historical invoice/readings this account may see.
  const roomId = contract?.roomId ?? invoice?.roomId;
  return (
    <View style={styles.page}>
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel="Xem phòng và hợp đồng"
        style={styles.roomBanner}
        onPress={() => (contract ? go('tenant-room') : go('contract'))}
      >
        <View style={styles.roomBannerRow}>
          <View style={styles.grow}>
            <Text style={styles.roomKicker}>Phòng của tôi</Text>
            <Text style={styles.roomTitle} numberOfLines={1}>
              {contract ? `Phòng ${contract.roomNumber}` : 'Thông tin phòng thuê'}
            </Text>
            <Text style={styles.secondary} numberOfLines={1}>
              {contract?.locationName ??
                (contractState?.loading ? 'Đang tải thông tin…' : 'Chưa có hợp đồng đang hiệu lực')}
            </Text>
          </View>
          <Icon source="chevron-right" size={22} color={s.blue} />
        </View>
      </TouchableRipple>
      <Feedback state={contractState} />

      <MonthlyInvoice
        month={month}
        invoice={invoice}
        payment={payment}
        invoiceState={invoiceState}
        paymentState={paymentState}
      />

      <View style={styles.section}>
        <Heading
          title={`Điện & nước tháng ${month.slice(5)}/${month.slice(0, 4)}`}
          action="Xem lịch sử"
          onPress={() => go('tenant-meters', roomId ? { roomId } : undefined)}
        />
        <View style={styles.utilityRow}>
          <UtilityCard
            kind="Electricity"
            month={month}
            roomId={roomId}
            invoice={invoice}
            meterReadings={meterReadings}
            meterState={meterState}
          />
          <UtilityCard
            kind="Water"
            month={month}
            roomId={roomId}
            invoice={invoice}
            meterReadings={meterReadings}
            meterState={meterState}
          />
        </View>
        <Feedback state={meterState} />
        <Text style={styles.footnote}>
          Chỉ số do nhân viên xác nhận; ảnh công tơ chỉ xem được trong tài khoản của bạn.
        </Text>
      </View>

      <View style={styles.section}>
        <Heading
          title="Tiền thuê & dịch vụ"
          action="Chi tiết hóa đơn"
          onPress={() => go('invoice', invoice ? { invoiceId: invoice.id } : undefined)}
        />
        <View style={styles.whiteSurface}>
          {invoice ? (
            <View style={styles.moneyList}>
              {rent.map((line) => (
                <MoneyRow key={line.id} line={line} />
              ))}
              {serviceFees.map((line) => (
                <MoneyRow key={line.id} line={line} />
              ))}
              {!rent.length && !serviceFees.length && (
                <Text style={styles.secondary}>
                  Hóa đơn này không có khoản tiền thuê hoặc phí dịch vụ.
                </Text>
              )}
              {invoice.status === 'Draft' && (
                <Text style={styles.footnote}>Số tiền đang tạm tính, chưa phát hành.</Text>
              )}
            </View>
          ) : (
            <View style={styles.emptyFees}>
              <Text style={styles.secondary}>
                {invoiceState?.loading
                  ? 'Đang kiểm tra hóa đơn…'
                  : 'Chưa có phí dịch vụ của kỳ này trên hóa đơn. Không phải số tiền 0đ.'}
              </Text>
            </View>
          )}
        </View>
      </View>

      <Attention
        invoice={invoice}
        debt={debt}
        notices={notices}
        expiryNotices={expiryNotices}
        state={alertsState}
      />

      <View style={styles.section}>
        <Heading
          title="Bạn cần làm gì khác?"
          action="Tất cả tiện ích"
          onPress={() => go('tenant-features', contract ? { contractId: contract.id } : undefined)}
        />
        <Shortcut icon="wrench-outline" title="Báo sự cố" onPress={() => go('incidents')} />
        <Shortcut
          icon="clipboard-text-outline"
          title="Yêu cầu của tôi"
          onPress={() => go('tenant-requests')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', minWidth: 0, gap: 18, paddingBottom: 18 },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  secondary: { color: c.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  feedback: { flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  error: { color: c.red, fontSize: 12, flexShrink: 1 },
  footnote: { color: c.muted, fontSize: 11, lineHeight: 16 },
  roomBanner: { backgroundColor: c.white, borderRadius: 14 },
  roomBannerRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roomKicker: { color: c.muted, fontSize: 11, fontWeight: '500' },
  roomTitle: { color: s.navy, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  bill: { padding: 18, borderRadius: 16, backgroundColor: s.navy, gap: 9, minWidth: 0 },
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  billTitle: { color: '#E2EFFF', fontWeight: '600', fontSize: 14 },
  billLabel: { color: '#CFDEF4', fontSize: 12, marginTop: 3 },
  billAmount: { fontSize: 33, lineHeight: 43, color: c.white, fontWeight: '800', flexShrink: 1 },
  billEmpty: { color: c.white, fontSize: 22, fontWeight: '700', marginTop: 8 },
  billSupporting: { color: '#E4EEFF', fontSize: 12, lineHeight: 18, flexShrink: 1 },
  billStatus: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  billStatusText: { color: '#EDF4FF', fontSize: 13, lineHeight: 19, flexShrink: 1 },
  billSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#49617A',
    paddingTop: 9,
    flexWrap: 'wrap',
  },
  billRemaining: { fontSize: 15, fontWeight: '700', color: c.white },
  billButton: { borderRadius: 10, marginTop: 5 },
  section: { gap: 10, minWidth: 0 },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: s.navy, flexShrink: 1 },
  headingAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 40 },
  linkText: { color: s.blue, fontSize: 12, fontWeight: '600' },
  utilityRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, minWidth: 0 },
  utility: {
    backgroundColor: c.white,
    borderRadius: 14,
    padding: 13,
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  utilityTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  utilityIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    backgroundColor: '#FFF0D5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityIconWater: { backgroundColor: '#E8F3FF' },
  utilityName: { color: s.navy, fontSize: 13, fontWeight: '700' },
  usage: { color: s.navy, fontSize: 23, lineHeight: 30, fontWeight: '800' },
  unit: { fontSize: 12, fontWeight: '500', color: c.muted },
  utilityEmpty: {
    color: c.muted,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 30,
    textAlignVertical: 'center',
  },
  utilityCaption: { color: c.muted, fontSize: 11, lineHeight: 16 },
  utilityCost: { fontSize: 12, lineHeight: 18, color: s.navy, fontWeight: '600' },
  whiteSurface: { borderRadius: 14, backgroundColor: c.white, overflow: 'hidden' },
  moneyList: { paddingHorizontal: 14, paddingVertical: 4 },
  moneyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F3F8',
  },
  moneyName: { color: c.ink, fontSize: 13, flex: 1, flexShrink: 1 },
  moneyValue: { color: s.navy, fontSize: 13, fontWeight: '700' },
  emptyFees: { padding: 15 },
  alertRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 62,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F3F8',
  },
  alertTitle: { color: s.navy, fontSize: 13, fontWeight: '600' },
  shortcut: { minHeight: 52, borderRadius: 12, backgroundColor: c.white },
  shortcutBody: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  shortcutTitle: { flex: 1, color: s.navy, fontSize: 13, fontWeight: '600' },
});
