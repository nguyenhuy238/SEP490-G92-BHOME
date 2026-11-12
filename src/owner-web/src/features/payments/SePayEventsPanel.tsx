import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { paymentError } from '../../../../../packages/client-core/src/payments';
import { OwnerPagination } from '../../components/common/OwnerWorkspace';
import { usePaymentApi } from './usePaymentApi';

const statuses: Record<string, string> = {
  Pending: 'Chờ xử lý kỹ thuật',
  ManualReview: 'Cần Owner đối soát',
  Ignored: 'Đã bỏ qua',
  Completed: 'Đã đối soát',
  Duplicate: 'Giao dịch trùng',
};
const reasons: Record<string, string> = {
  outgoing_transaction: 'Giao dịch tiền ra.',
  receiving_account_not_configured: 'Tài khoản nhận hoặc tài khoản phụ chưa được cấu hình.',
  receiving_account_mismatch: 'Tài khoản nhận chưa khớp với cơ sở hoặc cấu hình hiện hành.',
  unknown_or_ambiguous_payment_code: 'Mã thanh toán chưa xác định hoặc nội dung có nhiều mã.',
  sepay_technical_retry_exhausted:
    'Xử lý kỹ thuật đã hết số lần thử lại. Cần kiểm tra lỗi trước khi gửi lại webhook.',
  invoice_already_settled: 'Hóa đơn đã được thanh toán đủ.',
  deposit_already_satisfied: 'Hợp đồng đã nhận đủ cọc.',
  verified_partial_payment: 'Đã phân bổ khoản thanh toán một phần.',
  verified_excess_payment_pending_review: 'Đã phân bổ nghĩa vụ, tiền thừa chờ xử lý riêng.',
  verified_full_payment: 'Đã phân bổ đủ nghĩa vụ.',
  bank_transaction_already_received: 'Giao dịch ngân hàng đã được ghi nhận trước đó.',
  legacy_bank_reference_requires_manual_review:
    'Bank reference đã có trong sao kê thủ công. Cần đối chiếu giao dịch hiện có.',
  sepay_environment_mismatch: 'Nguồn Test/Live chưa khớp với nghĩa vụ.',
  final_invoice_required: 'Hóa đơn chưa được phát hành.',
  deposit_not_payable: 'Trạng thái hợp đồng chưa cho phép nhận cọc.',
  holding_deposit_requires_manual_review: 'Cần đối chiếu phê duyệt hoặc hạn giữ chỗ.',
};

export function SePayEventsPanel() {
  const api = usePaymentApi();
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: ['sepay-events', session?.userId, page],
    queryFn: ({ signal }) => api.sepayEvents(page, signal),
    enabled: !!session?.userId,
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="body2">
          Trạng thái dưới đây ghi nhận kết quả xử lý webhook. Mở giao dịch liên kết để xem kết quả
          đối soát thủ công hiện tại.
        </Typography>
        <Button disabled={events.isFetching} onClick={() => void events.refetch()}>
          Làm mới webhook
        </Button>
        {events.isPending && <LinearProgress aria-label="Đang tải webhook" />}
        {events.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void events.refetch()}>Thử lại</Button>}
          >
            {paymentError(events.error)}
          </Alert>
        )}
        {events.data?.items.length === 0 && <Typography>Chưa nhận được webhook SePay.</Typography>}
        {events.data?.items.map((event) => (
          <Stack
            key={event.id}
            spacing={0.5}
            sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}
          >
            <Typography>
              {statuses[event.status] ?? 'Cần kiểm tra'} · {event.mode} ·{' '}
              {formatInstant(event.receivedAt)}
            </Typography>
            {event.reason && (
              <Typography variant="body2">
                {reasons[event.reason] ?? 'Mở giao dịch để xem căn cứ đối soát.'}
              </Typography>
            )}
            {event.transferId && (
              <Button
                component={Link}
                to={`/payments?transferId=${encodeURIComponent(event.transferId)}`}
              >
                Xem giao dịch và căn cứ xác minh
              </Button>
            )}
          </Stack>
        ))}
        <OwnerPagination
          page={page}
          total={events.data?.totalCount ?? 0}
          change={setPage}
          busy={events.isFetching}
        />
      </Stack>
    </Paper>
  );
}
