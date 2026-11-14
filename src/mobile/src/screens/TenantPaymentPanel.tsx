import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { signedVnd } from '../../../../packages/client-core/src/adjustments';
import {
  paymentText,
  type InvoicePayment,
  type TransferInstructions,
} from '../../../../packages/client-core/src/payments';
import { InvoiceFeedback, InvoiceMoneyRow, invoiceUi } from '../components/InvoiceDetailUi';
import { colors as c } from '../theme/theme';
import { Pill } from '../components/WorkspaceKit';
import { useFeedbackState } from '../lib/useFeedbackState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useTenantInvoicePayment } from '../features/tenant/useTenantInvoicePayment';
import {
  positiveAmount,
  sameAmount,
  tenantPaymentLabel,
} from '../features/tenant/paymentPresentation';
import { loadInvoiceTransfer } from '../services/tenantInvoices';
import { queryPolicies } from '../lib/queryPolicies';

export function TenantPaymentDetails({ state }: { state: InvoicePayment }) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <View style={invoiceUi.card}>
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel="Chi tiết thanh toán"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.disclosure}>
          <Text style={invoiceUi.heading}>Chi tiết thanh toán</Text>
          <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={c.muted} />
        </View>
      </TouchableRipple>
      {expanded && (
        <View style={invoiceUi.detail}>
          {state.originalIssuedAmount !== undefined && (
            <InvoiceMoneyRow label="Tiền hóa đơn gốc" value={state.originalIssuedAmount} />
          )}
          {state.approvedAdjustmentTotal !== undefined && (
            <View style={invoiceUi.row}>
              <Text style={invoiceUi.detailLabel}>Điều chỉnh đã duyệt</Text>
              <Text style={invoiceUi.amount}>{signedVnd(state.approvedAdjustmentTotal)}</Text>
            </View>
          )}
          <InvoiceMoneyRow label="Số tiền phải thanh toán" value={state.payableAmount} />
          <InvoiceMoneyRow label="Đã ghi nhận" value={state.paidAmount} />
          <InvoiceMoneyRow label="Còn phải thanh toán" value={state.outstandingAmount} />
          {state.potentialExcessAmount !== undefined &&
            positiveAmount(state.potentialExcessAmount) && (
              <InvoiceMoneyRow label="Tiền thừa cần xem xét" value={state.potentialExcessAmount} />
            )}
          {state.reviewStatus === 'PendingReview' && (
            <Text style={invoiceUi.secondary}>
              Tiền thừa chờ xem xét. Chưa hoàn tiền hoặc chuyển credit.
            </Text>
          )}
          {!!state.history.length && (
            <>
              <Button
                accessibilityState={{ expanded: historyOpen }}
                contentStyle={styles.touch}
                onPress={() => setHistoryOpen(!historyOpen)}
              >
                Khoản thanh toán đã xác minh ({state.history.length})
              </Button>
              {historyOpen &&
                state.history.map((item) => (
                  <View key={item.id} style={invoiceUi.divider}>
                    <InvoiceMoneyRow label={formatInstant(item.paidAt)} value={item.amount} />
                    <Text style={invoiceUi.secondary}>
                      Người trả: {item.paidBy} · Xác minh {formatInstant(item.verifiedAt)}
                    </Text>
                  </View>
                ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// Dedicated invoice payment view: only the server supplies bank details, transfer references and QR.
export function TenantPaymentPanel({ invoiceId }: { invoiceId: string }) {
  const payment = useTenantInvoicePayment(invoiceId);
  const state = payment.data;
  const canRequestTransfer =
    state?.paymentStatus === 'Unpaid' && positiveAmount(state.outstandingAmount);
  const instructions = useWorkspaceQuery<TransferInstructions>(
    canRequestTransfer
      ? `/api/v1/invoices/${encodeURIComponent(invoiceId)}/transfer-instructions`
      : null,
    { load: loadInvoiceTransfer, notifyError: false, cache: queryPolicies.payments },
  );
  const [notice, setNotice] = useFeedbackState('info');
  const reloadPayment = payment.reload,
    reloadInstructions = instructions.reload;
  const refresh = useCallback(() => {
    reloadPayment();
    reloadInstructions();
  }, [reloadPayment, reloadInstructions]);
  async function copy(value: string) {
    try {
      await Clipboard.setStringAsync(value, { android: { isSensitive: true } });
      setNotice('Đã sao chép.');
    } catch {
      setNotice('Không sao chép được. Bạn có thể chọn thông tin trên màn hình.');
    }
  }
  const transfer = instructions.data;
  const matches =
    state && transfer && sameAmount(state.outstandingAmount, transfer.outstandingAmount);
  const usable =
    !payment.fetching &&
    !instructions.fetching &&
    !payment.error &&
    !instructions.error &&
    matches &&
    transfer &&
    ['Available', 'InstructionsOnly'].includes(transfer.availability) &&
    transfer.accountNumber;
  return (
    <View style={invoiceUi.card}>
      <InvoiceFeedback {...payment} />
      {state && (
        <Pill tone={state.paymentStatus === 'Paid' ? 'green' : 'blue'}>
          {tenantPaymentLabel(state)}
        </Pill>
      )}
      {state && !canRequestTransfer && (
        <Text style={invoiceUi.secondary}>
          {state.paymentStatus === 'NotIssued'
            ? 'Hóa đơn chưa phát hành, chưa thể thanh toán.'
            : 'Hóa đơn này không còn số dư cần thanh toán.'}
        </Text>
      )}
      {canRequestTransfer && (
        <>
          <InvoiceFeedback {...instructions} />
          {(payment.fetching || instructions.fetching) && (
            <Text style={invoiceUi.secondary}>Đang cập nhật thông tin chuyển khoản...</Text>
          )}
          {transfer?.isDevelopmentDemo && (
            <Text accessibilityRole="alert" style={styles.warning}>
              QR thử nghiệm – Không chuyển tiền thật.
            </Text>
          )}
          {transfer && !matches && (
            <Text style={invoiceUi.secondary}>
              Thông tin chuyển khoản đang thay đổi. Hãy cập nhật trạng thái trước khi chuyển tiền.
            </Text>
          )}
          {usable && (
            <>
              <CopyRow
                label="Số tiền"
                value={formatContractMoney(transfer.outstandingAmount)}
                copy={() => void copy(transfer.outstandingAmount)}
              />
              {transfer.qrImageDataUri && (
                <View style={styles.quietZone}>
                  <Image
                    source={{ uri: transfer.qrImageDataUri }}
                    style={styles.qr}
                    accessibilityLabel="QR chuyển khoản hóa đơn"
                  />
                </View>
              )}
              {!transfer.qrImageDataUri && (
                <Text style={invoiceUi.secondary}>
                  Chưa có ảnh QR. Bạn có thể sử dụng thông tin chuyển khoản bên dưới.
                </Text>
              )}
              <CopyRow
                label="Ngân hàng (BIN)"
                value={transfer.bankIdentifier ?? 'Chưa có thông tin'}
              />
              {transfer.accountHolder && (
                <CopyRow label="Chủ tài khoản" value={transfer.accountHolder} />
              )}
              <CopyRow
                label="Số tài khoản"
                value={transfer.accountNumber!}
                copy={() => void copy(transfer.accountNumber!)}
              />
              <CopyRow
                label="Nội dung chuyển khoản"
                value={transfer.transferDescription}
                copy={() => void copy(transfer.transferDescription)}
              />
            </>
          )}
          {transfer && matches && !usable && !payment.fetching && !instructions.fetching && (
            <Text style={invoiceUi.secondary}>
              {paymentText(
                transfer.availability === 'NotIssued'
                  ? 'NotIssuedInstructions'
                  : transfer.availability,
              )}
            </Text>
          )}
        </>
      )}
      {!!notice && <Text accessibilityRole="status">{notice}</Text>}
      <Text style={invoiceUi.secondary}>
        Thanh toán chỉ được ghi nhận sau khi hệ thống xác nhận đối soát.
      </Text>
      <Button
        mode="outlined"
        contentStyle={styles.touch}
        disabled={payment.fetching || instructions.fetching}
        onPress={refresh}
      >
        Cập nhật trạng thái
      </Button>
    </View>
  );
}

function CopyRow({ label, value, copy }: { label: string; value: string; copy?: () => void }) {
  return (
    <View style={styles.copyRow}>
      <View style={styles.value}>
        <Text style={invoiceUi.secondary}>{label}</Text>
        <Text selectable style={styles.body}>
          {value}
        </Text>
      </View>
      {copy && (
        <IconButton
          icon="content-copy"
          accessibilityLabel={`Sao chép ${label.toLocaleLowerCase('vi-VN')}`}
          onPress={copy}
          style={styles.copy}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: 8,
  },
  touch: { minHeight: 44 },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingVertical: 4,
  },
  value: { flex: 1, minWidth: 0, gap: 3 },
  body: { color: c.ink, fontSize: 14, lineHeight: 21 },
  copy: { margin: 0, minWidth: 44, minHeight: 44 },
  quietZone: { alignItems: 'center', padding: 16, backgroundColor: c.white },
  qr: { width: '100%', maxWidth: 224, aspectRatio: 1 },
  warning: {
    color: c.red,
    backgroundColor: c.redSoft,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 21,
  },
});
