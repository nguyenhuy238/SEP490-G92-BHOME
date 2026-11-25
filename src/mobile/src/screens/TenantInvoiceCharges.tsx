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
  invoicePersonMonths,
  missingBillingInput,
  type Invoice,
  type InvoiceLine,
} from '../../../../packages/client-core/src/invoices';
import { Pill } from '../components/WorkspaceKit';
import { InvoiceDetailRow, InvoiceMoneyRow, invoiceUi } from '../components/InvoiceDetailUi';
import { positiveAmount, tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import type { InvoicePayment } from '../../../../packages/client-core/src/payments';
import { colors } from '../theme/theme';
import { TenantMeterReadingEvidence } from '../components/TenantMeterReadingEvidence';

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
      <Text style={invoiceUi.heading}>Hóa đơn tháng {period}</Text>
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
      {state && (
        <View style={invoiceUi.row}>
          <Text style={invoiceUi.secondary}>
            Đã thanh toán: {formatContractMoney(state.paidAmount)}
          </Text>
          <Text style={invoiceUi.secondary}>
            Tổng phải thu: {formatContractMoney(state.payableAmount)}
          </Text>
        </View>
      )}
      <Text style={invoiceUi.secondary}>
        Hạn thanh toán: {displayContractDate(state?.dueDate ?? invoice.dueDate)}
      </Text>
      {overdue && <Text style={{ color: colors.red }}>Quá hạn {state.overdueDays} ngày</Text>}
      {state?.pendingReview && <Text style={{ color: colors.amber }}>Đang chờ đối soát</Text>}
      {canPay && onPay && (
        <Button mode="contained" icon="qrcode" contentStyle={{ minHeight: 44 }} onPress={onPay}>
          Xem mã QR thanh toán
        </Button>
      )}
      {invoice.status === 'Draft' && (
        <Text style={invoiceUi.secondary}>
          Dự kiến phát hành: {displayContractDate(invoice.scheduledFinalDate)}
        </Text>
      )}
    </View>
  );
}
const categoryLabel: Record<string, string> = {
  Rent: 'Tiền phòng',
  Electricity: 'Tiền điện',
  Water: 'Tiền nước',
  ServiceFee: 'Phí dịch vụ',
  Other: 'Khoản thu khác',
};

export function InvoiceChargeRow({
  line,
  first,
  missingMessage,
}: {
  line: InvoiceLine;
  first: boolean;
  missingMessage?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const utility = line.category === 'Electricity' || line.category === 'Water';
  const covered = utility && hasSettlementUsageCoverage(line);
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
          <View style={invoiceUi.chargeText}>
            <Text style={invoiceUi.title}>{name}</Text>
            {utility && !missingMessage && (
              <Text style={invoiceUi.secondary}>
                {covered
                  ? 'Đã tính trong quyết toán trả phòng'
                  : line.quantity == null
                    ? 'Chưa có số tiêu thụ'
                    : `Đã dùng ${formatBillingDecimal(line.quantity)} ${line.category === 'Electricity' ? 'kWh' : 'm³'}`}
              </Text>
            )}
            {missingMessage && (
              <Text
                accessibilityRole="alert"
                style={[invoiceUi.secondary, { color: colors.amber }]}
              >
                {missingMessage}
              </Text>
            )}
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
  const people = invoicePersonMonths(line);
  const unit = line.category === 'Electricity' ? 'kWh' : 'm³';
  const reading = (v: string | null) =>
    v == null ? 'Chưa có' : `${formatBillingDecimal(v)} ${unit}`;
  const discrepancy =
    /(?:miễn phí|không thu tiền|\bfree\b)/i.test(line.name) &&
    !/(?:không miễn phí|not free)/i.test(line.name) &&
    positiveAmount(line.amount);
  return (
    <View style={invoiceUi.chargeDetails}>
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
          {!!line.meterReadingId && (
            <TenantMeterReadingEvidence id={line.meterReadingId} label="Ảnh công tơ đã xác nhận" />
          )}
        </>
      ) : line.category === 'Rent' ? null : people ? (
        <>
          <InvoiceDetailRow label="Số người tính phí" value={`${people.residentCount} người`} />
          {people.prorated && (
            <InvoiceDetailRow
              label="Ngày cư trú"
              value={`${people.personDays} người-ngày / ${line.periodDays} ngày trong tháng`}
            />
          )}
        </>
      ) : (
        <InvoiceDetailRow
          label="Số lượng"
          value={line.quantity == null ? 'Chưa có dữ liệu' : formatBillingDecimal(line.quantity)}
        />
      )}
      <InvoiceDetailRow
        label="Đơn giá"
        value={`${formatBillingDecimal(line.rate)} đ${utility ? `/${unit}` : people ? '/người/tháng' : ''}`}
      />
      <InvoiceMoneyRow label="Thành tiền" value={line.amount} />
      {line.calculatedAmount != null && (
        <InvoiceMoneyRow label="Trước điều chỉnh" value={line.calculatedAmount} />
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
  const utilityLines = invoice.lines.filter(
    (line) => line.category === 'Electricity' || line.category === 'Water',
  );
  const otherLines = invoice.lines.filter(
    (line) => line.category !== 'Electricity' && line.category !== 'Water',
  );
  const missingUtilities = (['Electricity', 'Water'] as const).flatMap((category) => {
    const codes = invoice.missingInputs.filter((code) =>
      [`confirmed_reading_${category}`, `baseline_${category}`, `rate_${category}`].includes(code),
    );
    if (!codes.length) return [];
    const details = [
      codes.includes(`confirmed_reading_${category}`) && 'Chưa có chỉ số đã xác nhận',
      codes.includes(`baseline_${category}`) && 'Chưa có chỉ số trước',
      codes.includes(`rate_${category}`) && 'Chưa có đơn giá',
    ].filter(Boolean);
    return [{ category, codes, message: details.join(' · ') }];
  });
  const otherMissing = [
    ...new Set(
      invoice.missingInputs.filter(
        (code) => !missingUtilities.some((item) => item.codes.includes(code)),
      ),
    ),
  ];
  const missingRows = missingUtilities.filter(
    (item) => !utilityLines.some((line) => line.category === item.category),
  );
  return (
    <View style={invoiceUi.card}>
      <Text style={invoiceUi.heading}>Điện, nước và các khoản phí</Text>
      <View>
        {(!!utilityLines.length || !!missingUtilities.length) && (
          <>
            {utilityLines.map((line, index) => (
              <InvoiceChargeRow
                key={line.id}
                line={line}
                first={index === 0}
                missingMessage={
                  missingUtilities.find((item) => item.category === line.category)?.message
                }
              />
            ))}
            {missingRows.map(({ category, message }, index) => (
              <View
                key={category}
                style={(utilityLines.length > 0 || index > 0) && invoiceUi.chargeBorder}
              >
                <View style={invoiceUi.charge}>
                  <View style={invoiceUi.chargeText}>
                    <Text style={invoiceUi.title}>{categoryLabel[category]}</Text>
                    <Text
                      accessibilityRole="alert"
                      style={[invoiceUi.secondary, { color: colors.amber }]}
                    >
                      {message}
                    </Text>
                  </View>
                  <Text style={invoiceUi.secondary}>Chưa tính</Text>
                </View>
              </View>
            ))}
          </>
        )}
        {!!otherLines.length && (
          <>
            {otherLines.map((line, index) => (
              <InvoiceChargeRow
                key={line.id}
                line={line}
                first={index === 0 && !utilityLines.length && !missingUtilities.length}
              />
            ))}
          </>
        )}
        {!invoice.lines.length && !missingUtilities.length && (
          <Text style={invoiceUi.secondary}>Chưa có khoản thu.</Text>
        )}
        {otherMissing.map((code) => (
          <Text
            key={code}
            accessibilityRole="alert"
            style={[invoiceUi.secondary, { color: colors.amber }]}
          >
            {missingBillingInput(code)}
          </Text>
        ))}
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
