import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image } from 'react-native';
import { Text } from 'react-native-paper';
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
  type PaymentHistory,
  type DebtInvoice,
} from '../../../../packages/client-core/src/payments';
import type { Page } from '../../../../packages/client-core/src/invoices';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { QueryState, Pagination } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { ChoiceField } from '../components/WorkflowControls';
import {
  positiveAmount,
  sameAmount,
  tenantPaymentLabel,
} from '../features/tenant/paymentPresentation';

export function TenantPaymentPanel({ invoiceId }: { invoiceId: string }) {
  const payment = useWorkspaceQuery<InvoicePayment>(
    `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment`,
  );
  const instructions = useWorkspaceQuery<TransferInstructions>(
    `/api/v1/invoices/${encodeURIComponent(invoiceId)}/transfer-instructions`,
  );
  const [notice, setNotice] = useFeedbackState('info');
  const reloadPayment = payment.reload,
    reloadInstructions = instructions.reload;
  const refresh = useCallback(() => {
    reloadPayment();
    reloadInstructions();
  }, [reloadPayment, reloadInstructions]);
  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(refresh, 30000);
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
  const state = payment.data;
  const transfer = instructions.data;
  const canTransfer =
    state?.paymentStatus === 'Unpaid' &&
    positiveAmount(state.outstandingAmount) &&
    !!transfer &&
    sameAmount(state.outstandingAmount, transfer.outstandingAmount);
  return (
    <>
      <Box>
        <Heading title="Thanh toán hóa đơn" />
        <QueryState
          loading={payment.loading || instructions.loading}
          error={payment.error || instructions.error}
          reload={() => {
            payment.reload();
            instructions.reload();
          }}
        />
        {state && (
          <>
            <Pill tone={state.paymentStatus === 'Paid' ? 'green' : 'blue'}>
              {tenantPaymentLabel(state)}
            </Pill>
            <Text>Còn phải trả: {formatContractMoney(state.outstandingAmount)}</Text>
            <Text>Đã ghi nhận: {formatContractMoney(state.paidAmount)}</Text>
            {state.originalIssuedAmount !== undefined && (
              <>
                <Text>Tiền hóa đơn gốc: {formatContractMoney(state.originalIssuedAmount)}</Text>
                <Text>
                  Điều chỉnh sau phát hành: {signedVnd(state.approvedAdjustmentTotal ?? '0')}
                </Text>
                <Text>Nghĩa vụ hiện hành: {formatContractMoney(state.payableAmount)}</Text>
              </>
            )}
            {state.reviewStatus === 'PendingReview' && (
              <Text style={ui.red}>
                Tiền thừa chờ xem xét: {formatContractMoney(state.potentialExcessAmount ?? '0')}.
                Chưa hoàn tiền hoặc chuyển credit.
              </Text>
            )}
            <Text>
              Hạn thanh toán: {displayContractDate(state.dueDate)} · Quá hạn: {state.overdueDays}{' '}
              ngày
            </Text>
            {state.pendingReview && state.reviewStatus !== 'PendingReview' && (
              <Text>
                Owner đang đối soát giao dịch. Trạng thái chỉ thay đổi sau khi tiền được xác minh.
              </Text>
            )}
            {state.history.map((item) => (
              <Box key={item.id}>
                <Text>
                  {formatInstant(item.paidAt)} · {formatContractMoney(item.amount)}
                </Text>
                <Text>Người trả: {item.paidBy}</Text>
                <Text>Owner xác minh sao kê lúc {formatInstant(item.verifiedAt)}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
      <Action secondary onPress={refresh}>
        Cập nhật trạng thái thanh toán
      </Action>
      {state?.paymentStatus === 'Unpaid' &&
        transfer &&
        !sameAmount(state.outstandingAmount, transfer.outstandingAmount) && (
          <Text>
            Thông tin chuyển khoản đang thay đổi. Hãy cập nhật trạng thái trước khi chuyển tiền.
          </Text>
        )}
      {canTransfer && transfer?.accountNumber && (
        <Box>
          <Heading title="Chuyển khoản ngân hàng" />
          {transfer.isDevelopmentDemo && (
            <Text accessibilityRole="alert" style={ui.red}>
              Tài khoản tổng hợp demo. Không chuyển tiền thật.
            </Text>
          )}
          <Text selectable>Ngân hàng BIN: {transfer.bankIdentifier}</Text>
          <Text selectable>Chủ tài khoản: {transfer.accountHolder}</Text>
          <Text selectable>Số tài khoản: {transfer.accountNumber}</Text>
          <Text selectable>Nội dung: {transfer.transferDescription}</Text>
          <Text>Số tiền: {formatContractMoney(transfer.outstandingAmount)}</Text>
          {transfer.qrImageDataUri && (
            <Image
              source={{ uri: transfer.qrImageDataUri }}
              style={{ width: 240, height: 240, alignSelf: 'center' }}
              accessibilityLabel="QR chuyển khoản hóa đơn"
            />
          )}
          <Action onPress={() => void copy(transfer.outstandingAmount)}>Sao chép số tiền</Action>
          <Action onPress={() => void copy(transfer.accountNumber!)}>Sao chép tài khoản</Action>
          <Action onPress={() => void copy(transfer.bankIdentifier!)}>Sao chép mã ngân hàng</Action>
          <Action onPress={() => void copy(transfer.transferDescription)}>Sao chép nội dung</Action>
          {!!notice && <Text accessibilityRole="status">{notice}</Text>}
          <Text>
            Quét QR hoặc chuyển khoản chưa xác nhận thanh toán. Tải lại trạng thái sau khi Owner đối
            soát.
          </Text>
        </Box>
      )}
      {canTransfer && transfer && !transfer.accountNumber && (
        <Box>
          <Text>
            {paymentText(
              transfer.availability === 'NotIssued'
                ? 'NotIssuedInstructions'
                : transfer.availability,
            )}
          </Text>
        </Box>
      )}
    </>
  );
}
export function TenantPaymentHistoryScreen() {
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const [view, setView] = useState('verified');
  const history = useWorkspaceQuery<Page<PaymentHistory>>(
    view === 'verified' ? `/api/v1/payment-history?page=${page}&pageSize=20` : null,
  );
  const debts = useWorkspaceQuery<Page<DebtInvoice>>(
    view === 'outstanding' ? `/api/v1/debts?page=${page}&pageSize=20` : null,
  );
  const query = view === 'verified' ? history : debts;
  const reloadHistory = history.reload,
    reloadDebts = debts.reload;
  useFocusEffect(
    useCallback(() => {
      reloadHistory();
      reloadDebts();
    }, [reloadHistory, reloadDebts]),
  );
  return (
    <>
      <Heading
        title="Lịch sử thanh toán"
        detail="Khoản đã xác minh và số tiền còn nợ theo hóa đơn được cấp quyền"
      />
      <ChoiceField
        label="Thông tin thanh toán"
        value={view}
        options={[
          { id: 'verified', label: 'Khoản đã xác minh' },
          { id: 'outstanding', label: 'Hóa đơn còn nợ' },
        ]}
        onChange={(value) => {
          setView(value);
          setPage(1);
        }}
      />
      <QueryState {...query} />
      {view === 'verified' && history.data?.items.length === 0 && (
        <Box>
          <Text>Chưa có thanh toán đã xác minh.</Text>
        </Box>
      )}
      {view === 'verified' &&
        history.data?.items.map((item) => (
          <Box key={item.id}>
            <Heading
              title={`Phòng ${item.roomNumber} · ${item.billingPeriod.slice(0, 7)}`}
              detail={item.locationName}
            />
            <Text style={ui.money}>{formatContractMoney(item.amount)}</Text>
            <Text>
              {formatInstant(item.paidAt)} · Người trả: {item.paidBy}
            </Text>
            {item.bankReference && <Text>Mã giao dịch: {item.bankReference}</Text>}
            <Action secondary onPress={() => go('invoice', { invoiceId: item.invoiceId })}>
              Xem hóa đơn liên quan
            </Action>
          </Box>
        ))}
      {view === 'outstanding' && debts.data?.items.length === 0 && (
        <Box>
          <Text>Không có hóa đơn còn nợ trong dữ liệu máy chủ trả về.</Text>
        </Box>
      )}
      {view === 'outstanding' &&
        debts.data?.items.map((item) => (
          <Box key={item.invoiceId}>
            <Heading
              title={`Phòng ${item.roomNumber} · ${item.billingPeriod.slice(0, 7)}`}
              detail={item.locationName}
            />
            <Text>Còn phải trả: {formatContractMoney(item.outstandingAmount)}</Text>
            {item.paidAmount !== null && (
              <Text>Đã ghi nhận: {formatContractMoney(item.paidAmount)}</Text>
            )}
            <Text>
              Hạn: {displayContractDate(item.dueDate)} · Quá hạn: {item.overdueDays} ngày
            </Text>
            <Action onPress={() => go('invoice', { invoiceId: item.invoiceId })}>
              Mở hóa đơn và thanh toán
            </Action>
          </Box>
        ))}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          loading={query.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
