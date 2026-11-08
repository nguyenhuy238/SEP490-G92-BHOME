import { InvoiceFeedback, InvoiceMoneyRow, invoiceUi } from '../components/InvoiceDetailUi';
import { loadInvoicePayment, loadInvoiceTransfer } from '../services/tenantInvoices';
import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Image, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import {
  formatContractMoney,
  displayContractDate,
} from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { signedVnd } from '../../../../packages/client-core/src/adjustments';
import {
  paymentText,
  type InvoicePayment,
  type TransferInstructions,
} from '../../../../packages/client-core/src/payments';
import { Pill, ui } from '../components/WorkspaceKit';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import {
  positiveAmount,
  sameAmount,
  tenantPaymentLabel,
} from '../features/tenant/paymentPresentation';

export function TenantPaymentPanel({ invoiceId }: { invoiceId: string }) {
  const [financialOpen, setFinancialOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const payment = useWorkspaceQuery<InvoicePayment>(
    `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment`,
    { load: loadInvoicePayment, notifyError: false },
  );
  const state = payment.data;
  const canRequestTransfer =
    state?.paymentStatus === 'Unpaid' && positiveAmount(state.outstandingAmount);
  const instructions = useWorkspaceQuery<TransferInstructions>(
    transferOpen && canRequestTransfer
      ? `/api/v1/invoices/${encodeURIComponent(invoiceId)}/transfer-instructions`
      : null,
    { load: loadInvoiceTransfer, notifyError: false },
  );
  const [notice, setNotice] = useFeedbackState('info');
  const reloadPayment = payment.reload,
    reloadInstructions = instructions.reload;
  const refresh = useCallback(() => {
    reloadPayment();
    reloadInstructions();
  }, [reloadPayment, reloadInstructions]);
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (visited.current) refresh();
      visited.current = true;
      const timer = setInterval(() => {
        if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
          refresh();
      }, 30000);
      return () => clearInterval(timer);
    }, [refresh]),
  );
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
  return (
    <View style={invoiceUi.section}>
      <InvoiceFeedback {...payment} />
      {state && (
        <>
          {state.paymentStatus === 'NotIssued' ? (
            <Text style={ui.muted}>Chưa có thông tin thanh toán chính thức cho hóa đơn này.</Text>
          ) : (
            <>
              <Text style={invoiceUi.secondary}>Còn phải thanh toán</Text>
              <Text style={invoiceUi.hero}>{formatContractMoney(state.outstandingAmount)}</Text>
              <View style={invoiceUi.row}>
                <Pill tone="neutral">{tenantPaymentLabel(state)}</Pill>
                {canRequestTransfer && (
                  <Button
                    compact
                    icon="qrcode"
                    style={invoiceUi.inlineAction}
                    onPress={() => setTransferOpen(!transferOpen)}
                  >
                    {transferOpen ? 'Ẩn QR' : 'Xem QR thanh toán'}
                  </Button>
                )}
              </View>
              <InvoiceMoneyRow label="Đã ghi nhận" value={state.paidAmount} />
              <InvoiceMoneyRow label="Số tiền phải thanh toán" value={state.payableAmount} />
            </>
          )}
          {state.overdueDays > 0 && (
            <Text variant="bodySmall" style={ui.red}>
              Quá hạn {state.overdueDays} ngày · Hạn {displayContractDate(state.dueDate)}
            </Text>
          )}
          {state.reviewStatus === 'PendingReview' && (
            <Text variant="bodySmall" accessibilityRole="alert" style={ui.muted}>
              Tiền thừa chờ xem xét
              {state.potentialExcessAmount !== undefined
                ? `: ${formatContractMoney(state.potentialExcessAmount)}`
                : ''}
              . Chưa hoàn tiền hoặc chuyển credit.
            </Text>
          )}
          {state.pendingReview && state.reviewStatus !== 'PendingReview' && (
            <Text variant="bodySmall" style={ui.muted}>
              Owner đang đối soát. Trạng thái chỉ đổi sau khi giao dịch được xác minh.
            </Text>
          )}
          <Button
            compact
            style={invoiceUi.inlineAction}
            icon={financialOpen ? 'chevron-up' : 'chevron-down'}
            accessibilityState={{ expanded: financialOpen }}
            onPress={() => setFinancialOpen(!financialOpen)}
          >
            Chi tiết tài chính
          </Button>
          {financialOpen && (
            <View style={invoiceUi.detail}>
              <View style={invoiceUi.row}>
                <Text style={invoiceUi.secondary}>Số liệu thanh toán</Text>
              </View>
              {state.originalIssuedAmount !== undefined && (
                <InvoiceMoneyRow label="Tiền hóa đơn gốc" value={state.originalIssuedAmount} />
              )}
              {state.approvedAdjustmentTotal !== undefined && (
                <View style={invoiceUi.row}>
                  <Text style={ui.muted}>Điều chỉnh đã duyệt</Text>
                  <Text style={invoiceUi.amount}>{signedVnd(state.approvedAdjustmentTotal)}</Text>
                </View>
              )}
              {state.potentialExcessAmount !== undefined && (
                <InvoiceMoneyRow
                  label="Tiền thừa cần xem xét"
                  value={state.potentialExcessAmount}
                />
              )}
              <Text variant="bodySmall" style={ui.muted}>
                Hạn thanh toán: {displayContractDate(state.dueDate)}
              </Text>
            </View>
          )}
          {!!state.history.length && (
            <>
              <Button
                compact
                style={invoiceUi.inlineAction}
                onPress={() => setHistoryOpen(!historyOpen)}
                icon={historyOpen ? 'chevron-up' : 'chevron-down'}
              >
                Khoản thanh toán đã xác minh ({state.history.length})
              </Button>
              {historyOpen &&
                state.history.map((item) => (
                  <View key={item.id} style={invoiceUi.divider}>
                    <InvoiceMoneyRow label={formatInstant(item.paidAt)} value={item.amount} />
                    <Text variant="bodySmall" style={ui.muted}>
                      Người trả: {item.paidBy} · Xác minh {formatInstant(item.verifiedAt)}
                    </Text>
                  </View>
                ))}
            </>
          )}
        </>
      )}
      {transferOpen && canRequestTransfer && (
        <View style={invoiceUi.divider}>
          <InvoiceFeedback {...instructions} />
          {transfer && !matches && (
            <View style={invoiceUi.detail}>
              <Text style={ui.muted}>
                Thông tin chuyển khoản đang thay đổi. Hãy cập nhật trạng thái trước khi chuyển tiền.
              </Text>
              <Button compact onPress={refresh}>
                Cập nhật trạng thái
              </Button>
            </View>
          )}
          {transfer && matches && transfer.accountNumber && (
            <>
              {transfer.isDevelopmentDemo && (
                <Text accessibilityRole="alert" style={ui.red}>
                  Tài khoản tổng hợp demo. Không chuyển tiền thật.
                </Text>
              )}
              <Text selectable>Ngân hàng BIN: {transfer.bankIdentifier}</Text>
              <Text selectable>Chủ tài khoản: {transfer.accountHolder}</Text>
              <Text selectable>Số tài khoản: {transfer.accountNumber}</Text>
              <Text selectable>Nội dung: {transfer.transferDescription}</Text>
              <InvoiceMoneyRow label="Số tiền chuyển khoản" value={transfer.outstandingAmount} />
              {transfer.qrImageDataUri && (
                <Image
                  source={{ uri: transfer.qrImageDataUri }}
                  style={{ width: '100%', maxWidth: 224, aspectRatio: 1, alignSelf: 'center' }}
                  accessibilityLabel="QR chuyển khoản hóa đơn"
                />
              )}
              <View style={invoiceUi.row}>
                <Button compact onPress={() => void copy(transfer.outstandingAmount)}>
                  Sao chép số tiền
                </Button>
                <Button compact onPress={() => void copy(transfer.accountNumber!)}>
                  Sao chép tài khoản
                </Button>
                {transfer.bankIdentifier && (
                  <Button compact onPress={() => void copy(transfer.bankIdentifier!)}>
                    Sao chép mã ngân hàng
                  </Button>
                )}
                <Button compact onPress={() => void copy(transfer.transferDescription)}>
                  Sao chép nội dung
                </Button>
              </View>
              {!!notice && <Text accessibilityRole="status">{notice}</Text>}
              <Text variant="bodySmall" style={ui.muted}>
                Quét QR hoặc chuyển khoản chưa xác nhận thanh toán. Trạng thái dựa trên giao dịch đã
                đối soát.
              </Text>
            </>
          )}
          {transfer && matches && !transfer.accountNumber && (
            <Text style={ui.muted}>
              {paymentText(
                transfer.availability === 'NotIssued'
                  ? 'NotIssuedInstructions'
                  : transfer.availability,
              )}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
