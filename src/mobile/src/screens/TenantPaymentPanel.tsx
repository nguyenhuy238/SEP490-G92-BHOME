import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { signedVnd } from '../../../../packages/client-core/src/adjustments';
import {
  paymentText,
  isSePayPaymentCode,
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
import { ToastHost } from '../components/ToastHost';

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
          {state.paymentMode === 'Test' && (
            <Text style={styles.warning}>Kênh nhận tiền: SePay Test</Text>
          )}
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
                      Xác minh lúc {formatInstant(item.verifiedAt)}
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

export function TenantPaymentModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} accessibilityViewIsModal>
          <View style={styles.modalHeader}>
            <Text style={[invoiceUi.heading, { flex: 1 }]}>Thanh toán hóa đơn</Text>
            <IconButton icon="close" accessibilityLabel="Đóng mã QR thanh toán" onPress={onClose} />
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            <TenantPaymentPanel invoiceId={invoiceId} embedded />
          </ScrollView>
        </View>
        <ToastHost modal />
      </View>
    </Modal>
  );
}

// Only the server supplies bank details, transfer references and QR.
export function TenantPaymentPanel({
  invoiceId,
  embedded = false,
}: {
  invoiceId: string;
  embedded?: boolean;
}) {
  const payment = useTenantInvoicePayment(invoiceId, true);
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
  // Keep the old QR hidden until the server returns a QR for the new balance.
  // Retry once for each distinct observed balance; avoid a tight request loop
  // if an instructions response is stale or the provider is unavailable.
  const attemptedBalance = useRef('');
  useEffect(() => {
    if (!canRequestTransfer || matches) {
      attemptedBalance.current = '';
      return;
    }
    if (!state || !transfer || payment.error || instructions.error || instructions.fetching) return;
    const balance = invoiceId + ':' + state.outstandingAmount;
    if (attemptedBalance.current === balance) return;
    attemptedBalance.current = balance;
    reloadInstructions();
  }, [
    canRequestTransfer,
    matches,
    state,
    transfer,
    payment.error,
    instructions.error,
    instructions.fetching,
    invoiceId,
    reloadInstructions,
  ]);
  // A SePay Test QR with a legacy invoice reference cannot be reconciled via
  // webhook. Do not offer it to the tenant as a payable QR.
  const unregisteredDemoMemo = Boolean(
    transfer?.isDevelopmentDemo && !isSePayPaymentCode(transfer.transferDescription ?? ''),
  );
  const usable =
    !payment.fetching &&
    !instructions.fetching &&
    !payment.error &&
    !instructions.error &&
    matches &&
    transfer &&
    !unregisteredDemoMemo &&
    ['Available', 'InstructionsOnly'].includes(transfer.availability) &&
    transfer.accountNumber;
  return (
    <View style={embedded ? styles.modalBody : invoiceUi.card}>
      {!embedded && <Text style={invoiceUi.heading}>Thanh toán hóa đơn</Text>}
      <InvoiceFeedback {...payment} />
      {state && (
        <>
          <Pill tone={state.paymentStatus === 'Paid' ? 'green' : 'blue'}>
            {tenantPaymentLabel(state)}
          </Pill>
          <Text style={invoiceUi.secondary}>Số còn phải thanh toán</Text>
          <Text style={invoiceUi.hero}>{formatContractMoney(state.outstandingAmount)}</Text>
          {positiveAmount(state.paidAmount) && (
            <Text style={invoiceUi.secondary}>
              Đã thanh toán: {formatContractMoney(state.paidAmount)}
            </Text>
          )}
        </>
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
              Kênh nhận tiền: SePay Test. Thông tin tài khoản của QR đã phát hành được giữ nguyên.
            </Text>
          )}
          {unregisteredDemoMemo && (
            <Text accessibilityRole="alert" style={styles.warning}>
              Chưa có mã BH để đối soát SePay Test. Vui lòng liên hệ Owner để cấu hình trước khi
              chuyển khoản.
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
              <CopyRow label="Ngân hàng" value={displayBankName(transfer.bankIdentifier)} />
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
          {transfer &&
            matches &&
            !usable &&
            !unregisteredDemoMemo &&
            !payment.fetching &&
            !instructions.fetching && (
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

// Display names only; keep the original BIN in the server's transfer instructions.
// Reference: https://developers.momo.vn/v3/docs/payment/api/result-handling/bankcode/
const bankNames: Readonly<Record<string, string>> = {
  '970400': 'SaigonBank',
  '970403': 'Sacombank',
  '970405': 'Agribank',
  '970406': 'Vikki Bank',
  '970407': 'Techcombank',
  '970408': 'GPBank',
  '970409': 'Bac A Bank',
  '970410': 'Standard Chartered',
  '970412': 'PVcomBank',
  '970414': 'MBV',
  '970415': 'VietinBank',
  '970416': 'ACB',
  '970418': 'BIDV',
  '970421': 'VRB',
  '970422': 'MBBank',
  '970423': 'TPBank',
  '970424': 'Shinhan Bank',
  '970425': 'ABBank',
  '970426': 'MSB',
  '970427': 'VietABank',
  '970428': 'Nam A Bank',
  '970429': 'SCB',
  '970430': 'PGBank',
  '970431': 'Eximbank',
  '970432': 'VPBank',
  '970433': 'VietBank',
  '970434': 'Indovina Bank',
  '970436': 'Vietcombank',
  '970437': 'HDBank',
  '970438': 'BaoViet Bank',
  '970439': 'Public Bank',
  '970440': 'SeABank',
  '970441': 'VIB',
  '970442': 'Hong Leong Bank',
  '970443': 'SHB',
  '970446': 'Co-opBank',
  '970448': 'OCB',
  '970449': 'LPBank',
  '970452': 'KienlongBank',
  '970457': 'Woori Bank',
  '970458': 'UOB',
  '422589': 'CIMB',
  '458761': 'HSBC',
  '546034': 'CAKE',
  '546035': 'Ubank',
};

function displayBankName(identifier?: string | null): string {
  const value = identifier?.trim();
  if (!value) return 'Chưa có thông tin';
  return /^\d{6}$/.test(value) ? (bankNames[value] ?? `Mã ngân hàng ${value}`) : value;
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,22,55,0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    backgroundColor: c.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    width: '100%',
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  modalScroll: {
    width: '100%',
    minHeight: 0,
    flexGrow: 0,
    flexShrink: 1,
    backgroundColor: c.white,
  },
  modalContent: { padding: 16 },
  modalBody: { gap: 10 },
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
