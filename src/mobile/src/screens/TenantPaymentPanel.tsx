import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useState } from 'react';
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
} from '../../../../packages/client-core/src/payments';
import type { Page } from '../../../../packages/client-core/src/invoices';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { QueryState, Pagination } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';

export function TenantPaymentPanel({ invoiceId }: { invoiceId: string }) {
  const payment = useWorkspaceQuery<InvoicePayment>(
    `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment`,
  );
  const instructions = useWorkspaceQuery<TransferInstructions>(
    `/api/v1/invoices/${encodeURIComponent(invoiceId)}/transfer-instructions`,
  );
  const [notice, setNotice] = useFeedbackState('info');
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
              {paymentText(state.paymentStatus)}
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
      {state && state.paymentStatus === 'Unpaid' && transfer?.accountNumber && (
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
      {state?.paymentStatus === 'Unpaid' && transfer && !transfer.accountNumber && (
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
  const [page, setPage] = useState(1);
  const history = useWorkspaceQuery<Page<PaymentHistory>>(
    `/api/v1/payment-history?page=${page}&pageSize=20`,
  );
  return (
    <>
      <Heading
        title="Lịch sử thanh toán"
        detail="Các khoản đã được xác minh trên hóa đơn bạn có quyền xem"
      />
      <QueryState {...history} />
      {history.data?.items.length === 0 && (
        <Box>
          <Text>Chưa có thanh toán đã xác minh.</Text>
        </Box>
      )}
      {history.data?.items.map((item) => (
        <Box key={item.id}>
          <Heading
            title={`Phòng ${item.roomNumber} · ${item.billingPeriod.slice(0, 7)}`}
            detail={item.locationName}
          />
          <Text style={ui.money}>{formatContractMoney(item.amount)}</Text>
          <Text>
            {formatInstant(item.paidAt)} · Người trả: {item.paidBy}
          </Text>
        </Box>
      ))}
      {history.data && (
        <Pagination
          page={page}
          total={history.data.totalCount}
          loading={history.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
