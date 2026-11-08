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
  missingBillingInput,
  type Invoice,
  type InvoiceLine,
} from '../../../../packages/client-core/src/invoices';
import { Pill } from '../components/WorkspaceKit';
import { InvoiceDetailRow, InvoiceMoneyRow, invoiceUi } from '../components/InvoiceDetailUi';
import { positiveAmount } from '../features/tenant/paymentPresentation';
import { colors } from '../theme/theme';

export function TenantInvoiceSummary({ invoice }: { invoice: Invoice }) {
  const period = invoice.billingPeriod.slice(0, 7).split('-').reverse().join('/');
  return (
    <View style={invoiceUi.section}>
      <Text style={invoiceUi.heading}>{`Phòng ${invoice.roomNumber} · Tháng ${period}`}</Text>
      <Text style={invoiceUi.secondary}>{invoice.locationName}</Text>
      <View style={invoiceUi.row}>
        <Pill tone="neutral">{invoice.status === 'Final' ? 'Đã phát hành' : 'Bản nháp'}</Pill>
        <Text style={invoiceUi.secondary}>Hạn {displayContractDate(invoice.dueDate)}</Text>
      </View>
      {invoice.status === 'Draft' && (
        <Text style={invoiceUi.secondary}>
          Dự kiến chốt {displayContractDate(invoice.scheduledFinalDate)}. Chưa thể thanh toán.
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
};
const categoryLabel: Record<string, string> = {
  Rent: 'Tiền phòng',
  Electricity: 'Tiền điện',
  Water: 'Tiền nước',
  ServiceFee: 'Phí dịch vụ',
};

export function InvoiceChargeRow({ line, first }: { line: InvoiceLine; first: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const utility = line.category === 'Electricity' || line.category === 'Water';
  const days =
    line.periodDays > 0 ? `${line.occupiedDays}/${line.periodDays} ngày` : 'Chi tiết tiền phòng';
  const secondary = utility
    ? 'Chi tiết chỉ số'
    : line.category === 'Rent'
      ? days
      : 'Đơn giá & số lượng';
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
          <Icon
            source={categoryIcon[line.category] ?? 'receipt-text-outline'}
            size={18}
            color={colors.muted}
          />
          <View style={invoiceUi.chargeText}>
            <Text style={invoiceUi.title} numberOfLines={1}>
              {name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={invoiceUi.secondary} numberOfLines={1}>
                {secondary}
              </Text>
              <Icon
                source={expanded ? 'chevron-up' : 'chevron-right'}
                size={14}
                color={colors.muted}
              />
            </View>
          </View>
          <Text style={invoiceUi.chargeAmount}>{formatContractMoney(line.amount)}</Text>
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
      {utility ? (
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
    <View style={invoiceUi.section}>
      <Text style={invoiceUi.heading}>Chi tiết các khoản thu</Text>
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
