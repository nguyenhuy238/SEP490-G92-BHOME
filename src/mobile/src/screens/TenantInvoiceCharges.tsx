import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import {
  displayContractDate,
  formatContractMoney,
} from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import {
  formatBillingDecimal,
  hasSettlementUsageCoverage,
  hasSettlementFixedCoverage,
  missingBillingInput,
  type Invoice,
  type InvoiceLine,
} from '../../../../packages/client-core/src/invoices';
import { Pill } from '../components/WorkspaceKit';
import { InvoiceDetailRow, InvoiceMoneyRow, invoiceUi } from '../components/InvoiceDetailUi';
import { positiveAmount, tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import type { InvoicePayment } from '../../../../packages/client-core/src/payments';
import { colors } from '../theme/theme';

export function TenantInvoiceSummary({
  invoice,
  payment,
  onPay,
}: {
  invoice: Invoice;
  payment?: InvoicePayment | null;
  onPay?: () => void;
}) {
  const period = invoice.billingPeriod.slice(0, 7).split('-').reverse().join('/');
  const state =
    invoice.status === 'Final' &&
    payment?.invoiceId === invoice.id &&
    payment.paymentStatus !== 'NotIssued'
      ? payment
      : null;
  const overdue =
    state?.paymentStatus === 'Unpaid' &&
    positiveAmount(state.outstandingAmount) &&
    state.overdueDays > 0;
  const canPay = state?.paymentStatus === 'Unpaid' && positiveAmount(state.outstandingAmount);
  return (
    <View style={invoiceUi.card}>
      <Text style={invoiceUi.heading}>Phòng {invoice.roomNumber}</Text>
      <Text style={invoiceUi.secondary}>
        Tháng {period} · {invoice.locationName}
      </Text>
      <View style={invoiceUi.row}>
        <Pill tone="neutral">{invoice.status === 'Final' ? 'Đã phát hành' : 'Bản nháp'}</Pill>
        {state && (
          <Pill tone={overdue ? 'red' : state.paymentStatus === 'Paid' ? 'green' : 'blue'}>
            {tenantPaymentLabel(state)}
          </Pill>
        )}
      </View>
      <View>
        <Text style={invoiceUi.secondary}>
          {state
            ? 'Còn phải thanh toán'
            : invoice.status === 'Draft'
              ? 'Tổng tạm tính'
              : 'Tổng hóa đơn'}
        </Text>
        <Text style={invoiceUi.hero}>
          {formatContractMoney(state?.outstandingAmount ?? invoice.total)}
        </Text>
      </View>
      <Text style={invoiceUi.secondary}>
        Hạn thanh toán: {displayContractDate(state?.dueDate ?? invoice.dueDate)}
      </Text>
      {overdue && <Text style={{ color: colors.red }}>Quá hạn {state.overdueDays} ngày</Text>}
      {state?.pendingReview && (
        <Text style={{ color: colors.amber }}>
          Đang chờ đối soát. Trạng thái sẽ cập nhật sau khi xác minh.
        </Text>
      )}
      {canPay && onPay && (
        <Button mode="contained" icon="qrcode" contentStyle={{ minHeight: 44 }} onPress={onPay}>
          Xem mã QR thanh toán
        </Button>
      )}
      {invoice.status === 'Draft' && (
        <Text style={invoiceUi.secondary}>
          Hóa đơn tạm tính — đang chờ phát hành. Dự kiến chốt{' '}
          {displayContractDate(invoice.scheduledFinalDate)}. Chưa thể thanh toán.
        </Text>
      )}
      {!!invoice.missingInputs.length && (
        <Text accessibilityRole="alert" style={invoiceUi.secondary}>
          Còn thiếu: {invoice.missingInputs.map(missingBillingInput).join(', ')}. Tổng hiện tại là
          tạm tính.
        </Text>
      )}
    </View>
  );
}
const categoryIcon: Record<string, string> = {
  Rent: 'home-outline',
  Electricity: 'lightning-bolt-outline',
  Water: 'water-outline',
  ServiceFee: 'receipt-text-outline',
  Other: 'cash-multiple',
};
const categoryLabel: Record<string, string> = {
  Rent: 'Tiền phòng',
  Electricity: 'Tiền điện',
  Water: 'Tiền nước',
  ServiceFee: 'Phí dịch vụ',
  Other: 'Khoản thu khác',
};

export function InvoiceChargeRow({ line, first }: { line: InvoiceLine; first: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const utility = line.category === 'Electricity' || line.category === 'Water';
  const name = line.name || categoryLabel[line.category];
  return (
    <View style={!first && invoiceUi.chargeBorder}>
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${expanded ? 'thu gọn' : 'xem chi tiết'}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={invoiceUi.charge}>
          {utility && (
            <Icon
              source={categoryIcon[line.category] ?? 'receipt-text-outline'}
              size={18}
              color={colors.muted}
            />
          )}
          <View style={invoiceUi.chargeText}>
            <Text style={invoiceUi.title} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <Text style={invoiceUi.chargeAmount}>{formatContractMoney(line.amount)}</Text>
          <Icon source={expanded ? 'chevron-up' : 'chevron-right'} size={16} color={colors.muted} />
        </View>
      </TouchableRipple>
      {expanded && <InvoiceChargeDetails line={line} />}
    </View>
  );
}
function InvoiceChargeDetails({ line }: { line: InvoiceLine }) {
  const utility = line.category === 'Electricity' || line.category === 'Water';
  const unit = line.category === 'Electricity' ? 'kWh' : 'm³';
  const reading = (v: string | null) => (v == null ? 'Chưa có' : formatBillingDecimal(v));
  const discrepancy =
    /(?:miễn phí|không thu tiền|\bfree\b)/i.test(line.name) &&
    !/(?:không miễn phí|not free)/i.test(line.name) &&
    positiveAmount(line.amount);
  return (
    <View style={invoiceUi.chargeDetails}>
      <InvoiceDetailRow label="Tên khoản thu" value={line.name} />
      {hasSettlementFixedCoverage(line) && (
        <Text style={invoiceUi.secondary}>
          Số tiền trên dòng này đã loại phần tiền thuê/phí ghi nhận trong khoản phải thu trả phòng.
          Khoản phải thu vẫn có số dư riêng do máy chủ xác nhận.
        </Text>
      )}
      {utility && hasSettlementUsageCoverage(line) ? (
        <Text style={invoiceUi.secondary}>
          Phần tiêu thụ này đã được ghi nhận trong khoản phải thu khi trả phòng, không cộng lại trên
          hóa đơn. Xem sổ phải thu để kiểm tra số còn nợ.
        </Text>
      ) : utility ? (
        <>
          <InvoiceDetailRow label="Chỉ số cũ" value={reading(line.previousReading)} />
          <InvoiceDetailRow label="Chỉ số mới" value={reading(line.confirmedReading)} />
          <InvoiceDetailRow
            label="Tiêu thụ"
            value={
              line.quantity == null
                ? 'Chưa có dữ liệu tiêu thụ'
                : `${formatBillingDecimal(line.quantity)} ${unit}`
            }
          />
        </>
      ) : line.category === 'Rent' ? (
        <InvoiceDetailRow
          label="Ngày tính tiền"
          value={
            line.periodDays > 0 ? `${line.occupiedDays}/${line.periodDays} ngày` : 'Chưa có dữ liệu'
          }
        />
      ) : (
        <InvoiceDetailRow
          label="Số lượng"
          value={line.quantity == null ? 'Chưa có dữ liệu' : formatBillingDecimal(line.quantity)}
        />
      )}
      <InvoiceDetailRow
        label="Đơn giá"
        value={`${formatBillingDecimal(line.rate)} đ${utility ? `/${unit}` : ''}`}
      />
      <InvoiceMoneyRow label="Thành tiền" value={line.amount} />
      {line.calculatedAmount != null && (
        <InvoiceMoneyRow label="Trước điều chỉnh" value={line.calculatedAmount} />
      )}
      <InvoiceDetailRow label="Áp dụng từ" value={displayContractDate(line.rateDate)} />
      {line.policyVersion != null && (
        <InvoiceDetailRow label="Phiên bản đơn giá" value={String(line.policyVersion)} />
      )}
      {line.correctionRequestId && (
        <Text style={invoiceUi.secondary}>Có yêu cầu điều chỉnh liên quan.</Text>
      )}
      {discrepancy && (
        <Text accessibilityRole="alert" style={invoiceUi.secondary}>
          Tên khoản thu gợi ý không thu tiền nhưng số tiền trả về lớn hơn 0. Vui lòng yêu cầu kiểm
          tra.
        </Text>
      )}
    </View>
  );
}
export function TenantInvoiceCharges({ invoice }: { invoice: Invoice }) {
  const [info, setInfo] = useState(false);
  return (
    <View style={invoiceUi.card}>
      <Text style={invoiceUi.heading}>Các khoản thu</Text>
      <View>
        {invoice.lines.map((line, index) => (
          <InvoiceChargeRow key={line.id} line={line} first={index === 0} />
        ))}
        {!invoice.lines.length && <Text style={invoiceUi.secondary}>Chưa có khoản thu.</Text>}
        <View style={invoiceUi.total}>
          <Text style={[invoiceUi.title, { flex: 1 }]}>
            {invoice.status === 'Final' ? 'Tổng hóa đơn' : 'Tổng tạm tính'}
          </Text>
          <Text style={invoiceUi.totalAmount}>{formatContractMoney(invoice.total)}</Text>
        </View>
      </View>
      {invoice.finalizedAt && (
        <>
          <Button
            compact
            style={invoiceUi.inlineAction}
            onPress={() => setInfo(!info)}
            accessibilityState={{ expanded: info }}
          >
            Thông tin phát hành
          </Button>
          {info && (
            <InvoiceDetailRow label="Phát hành lúc" value={formatInstant(invoice.finalizedAt)} />
          )}
        </>
      )}
    </View>
  );
}
