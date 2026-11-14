import { useState } from 'react';
import { Alert, Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  formatContractMoney,
  displayContractDate,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import {
  paymentError,
  paymentText,
  type DebtInvoice,
} from '../../../../../packages/client-core/src/payments';
import { PaymentInvoicePicker } from './PaymentInvoicePicker';
import { SePayEventsPanel } from './SePayEventsPanel';
import { usePaymentApi } from './usePaymentApi';

export function SePayTestingPanel() {
  const api = usePaymentApi();
  const { session } = useAuth();
  const context = useQuery({
    queryKey: ['sepay-testing-context', session?.userId],
    queryFn: ({ signal }) =>
      api.request<{ mode: string }>('/api/v1/integrations/sepay/testing-context', { signal }),
    enabled: !!session?.userId,
    retry: false,
    staleTime: 0,
  });
  if (context.isPending) return <LinearProgress aria-label="Đang kiểm tra chế độ SePay" />;
  // Server authorizes the Owner and checks Enabled, Test mode and host environment.
  if (context.error || context.data?.mode !== 'Test') return null;
  return <SePayTestingWorkspace />;
}

function SePayTestingWorkspace() {
  const [choosing, setChoosing] = useState(false);
  const [invoice, setInvoice] = useState<DebtInvoice | null>(null);
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Kiểm thử SePay</Typography>
        <Alert severity="warning">QR thử nghiệm – Không chuyển tiền thật.</Alert>
        <Button onClick={() => setChoosing(true)}>Chọn hóa đơn kiểm thử</Button>
        {choosing && (
          <PaymentInvoicePicker
            open
            unpaidOnly
            close={() => setChoosing(false)}
            choose={(row) => {
              setInvoice(row);
              setChoosing(false);
            }}
          />
        )}
        {invoice && <TestingInvoice key={invoice.invoiceId} invoice={invoice} />}
      </Stack>
    </Paper>
  );
}

function TestingInvoice({ invoice }: { invoice: DebtInvoice }) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const [notice, setNotice] = useState('');
  const payment = useQuery({
    queryKey: ['invoice-payment', session?.userId, invoice.invoiceId],
    queryFn: ({ signal }) => api.payment(invoice.invoiceId, signal),
    refetchOnWindowFocus: 'always',
  });
  const instructions = useQuery({
    queryKey: ['transfer-instructions', session?.userId, invoice.invoiceId],
    queryFn: ({ signal }) => api.instructions(invoice.invoiceId, signal),
    refetchOnWindowFocus: 'always',
  });
  const state = payment.data;
  const transfer = instructions.data;
  const ready =
    !payment.isFetching &&
    !instructions.isFetching &&
    !payment.error &&
    !instructions.error &&
    state?.paymentStatus === 'Unpaid' &&
    transfer?.isDevelopmentDemo &&
    ['Available', 'InstructionsOnly'].includes(transfer.availability) &&
    transfer.accountNumber &&
    /^BH\d{8}$/.test(transfer.transferReference) &&
    state.outstandingAmount === transfer.outstandingAmount &&
    state.transferReference === transfer.transferReference;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Đã sao chép.');
    } catch {
      setNotice('Không sao chép được. Bạn có thể chọn thông tin trên màn hình.');
    }
  }
  return (
    <Stack spacing={2}>
      <Typography>
        {invoice.locationName} · Phòng {invoice.roomNumber} · Kỳ {invoice.billingPeriod.slice(0, 7)}
      </Typography>
      {(payment.isPending || instructions.isPending) && <LinearProgress />}
      {(payment.error || instructions.error) && (
        <Alert severity="error">{paymentError(payment.error || instructions.error)}</Alert>
      )}
      {state && (
        <>
          <Typography>
            {state.paymentStatus === 'Unpaid' && state.paidAmount !== '0'
              ? 'Đã thanh toán một phần'
              : paymentText(state.paymentStatus)}{' '}
            · Hạn {displayContractDate(state.dueDate)}
          </Typography>
          <Typography>
            Tổng phải trả: {formatContractMoney(state.payableAmount)} · Đã ghi nhận:{' '}
            {formatContractMoney(state.paidAmount)} · Còn phải trả:{' '}
            {formatContractMoney(state.outstandingAmount)}
          </Typography>
          {state.overdueDays > 0 && state.paymentStatus !== 'Paid' && (
            <Typography>Quá hạn {state.overdueDays} ngày</Typography>
          )}
          {state.pendingReview && (
            <Alert severity="info">
              Có giao dịch cần đối soát. Số dư chỉ thay đổi sau phân bổ được xác minh.
            </Alert>
          )}
          {state.history.map((item) => (
            <Typography key={item.id}>
              {formatInstant(item.paidAt)} · {formatContractMoney(item.amount)} ·{' '}
              {item.verificationSource}
            </Typography>
          ))}
        </>
      )}
      <Button
        disabled={payment.isFetching || instructions.isFetching}
        onClick={() => {
          void payment.refetch();
          void instructions.refetch();
        }}
      >
        Làm mới hóa đơn kiểm thử
      </Button>
      {transfer && !ready && state?.paymentStatus !== 'Paid' && (
        <Alert severity="info">
          Chưa có hướng dẫn Test Mode hợp lệ hoặc dữ liệu đang cập nhật. Kiểm tra tài khoản demo và
          mã BH của hóa đơn.
        </Alert>
      )}
      {ready && transfer && (
        <>
          <Typography>
            Ngân hàng BIN {transfer.bankIdentifier} · {transfer.accountHolder}
          </Typography>
          <Typography sx={{ userSelect: 'text' }}>Tài khoản: {transfer.accountNumber}</Typography>
          <Typography sx={{ userSelect: 'text' }}>
            Mã thanh toán: {transfer.transferReference}
          </Typography>
          <Typography sx={{ userSelect: 'text' }}>
            Nội dung: {transfer.transferDescription}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button onClick={() => void copy(transfer.accountNumber!)}>Sao chép tài khoản</Button>
            <Button onClick={() => void copy(transfer.outstandingAmount)}>Sao chép số tiền</Button>
            <Button onClick={() => void copy(transfer.transferReference)}>
              Sao chép mã thanh toán
            </Button>
            <Button onClick={() => void copy(transfer.transferDescription)}>
              Sao chép nội dung
            </Button>
          </Stack>
          {transfer.qrImageDataUri && (
            <Box
              component="img"
              src={transfer.qrImageDataUri}
              alt="QR thử nghiệm hóa đơn"
              sx={{ width: 240, maxWidth: '100%', bgcolor: 'white' }}
            />
          )}
          <Typography>
            Mở SePay Test Mode và mô phỏng tiền vào bằng đúng tài khoản, số tiền và nội dung ở trên.
            Mở liên kết chưa tạo giao dịch hoặc xác nhận thanh toán.
          </Typography>
          <Button
            component="a"
            href="https://my.sepay.vn/testmode/transaction/simulate"
            target="_blank"
            rel="noopener noreferrer"
          >
            Mở trình mô phỏng SePay
          </Button>
        </>
      )}
      {notice && <Alert severity="info">{notice}</Alert>}
      <Typography variant="body2">
        Nhận giao dịch → xác thực webhook hoặc polling → khớp nghĩa vụ → phân bổ → cập nhật số dư.
        HTTP 200 webhook chưa chứng minh hóa đơn đã được thanh toán đủ.
      </Typography>
      <SePayEventsPanel invoiceId={invoice.invoiceId} />
    </Stack>
  );
}
