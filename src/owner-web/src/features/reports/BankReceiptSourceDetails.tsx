import { useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { financeError, type ReportFilter } from '../../../../../packages/client-core/src/finance';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { managementMoney } from '../finance/managementMoney';

function RefundDetail({ id }: { id: string }) {
  const api = useFinanceApi();
  const { session } = useAuth();
  const result = useQuery({
    queryKey: ['finance-ledger-sources', session?.userId, 'bank-refund', id],
    queryFn: ({ signal }) => api.bankReceiptRefund(id, signal),
  });
  const source = result.data;
  const payers = source
    ? [
        ...source.beneficiaries.map((p) => p.label),
        ...(source.externalBeneficiary ? [source.externalBeneficiary.label] : []),
      ]
    : [];
  return (
    <Stack spacing={0.5} sx={{ pl: 1, borderLeft: 1, borderColor: 'divider' }}>
      {result.isFetching && <LinearProgress />}
      {result.isError && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void result.refetch()}>Thử lại</Button>}
        >
          Không xác định được điều kiện hoàn tiền. {financeError(result.error)}
        </Alert>
      )}
      {!result.isError && source && (
        <>
          <Typography variant="body2">
            Người thanh toán đã xác minh: {payers.join(', ') || 'Chưa xác định'}
          </Typography>
          <Typography variant="body2">
            Khoản đủ điều kiện hoàn theo nguồn hiện tại:{' '}
            {source.eligibleReceiptRefundAmount == null
              ? 'Chưa xác định hoặc chưa đủ điều kiện'
              : managementMoney(source.eligibleReceiptRefundAmount)}
          </Typography>
          <Typography variant="body2">
            Đang giữ cho yêu cầu hoàn: {managementMoney(source.reservedAmount)} · Đã hoàn theo hồ
            sơ: {managementMoney(source.refundedAmount)}
          </Typography>
          {source.requests.map((row) => (
            <Typography key={row.id} variant="caption" component="div">
              {
                {
                  REQUESTED: 'Chờ duyệt',
                  APPROVED: 'Đã duyệt',
                  REJECTED: 'Từ chối',
                  COMPLETED: 'Đã hoàn',
                }[row.status]
              }{' '}
              · {managementMoney(row.amount)}
              {row.executedAt ? ' · ' + formatInstant(row.executedAt) : ''}
            </Typography>
          ))}
          <Typography variant="caption" color="text.secondary">
            Trạng thái hiện tại của giao dịch, không phải tổng hoàn tiền riêng trong kỳ. Chủ trọ
            kiểm tra người trả và chứng từ tại màn đối soát trước khi hoàn.
          </Typography>
        </>
      )}
    </Stack>
  );
}

export function BankReceiptSourceDetails({
  filter,
  expectedReceived,
  expectedUnallocated,
}: {
  filter: ReportFilter;
  expectedReceived: string;
  expectedUnallocated: string;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { session } = useAuth();
  const api = useFinanceApi();
  const result = useQuery({
    queryKey: ['finance-ledger-sources', session?.userId, 'bank-receipts', filter, page],
    queryFn: ({ signal }) => api.bankReceiptSources(filter, page, signal),
  });
  const data = result.data;
  return (
    <Stack spacing={1} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {result.isFetching && <LinearProgress />}
      {result.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void result.refetch()}>Thử lại</Button>}
        >
          {financeError(result.error)}
        </Alert>
      )}
      {!result.isError && data && (
        <>
          <Typography variant="body2">
            {data.total} giao dịch · Tổng nhận {managementMoney(data.totalReceived)} · Chưa phân bổ{' '}
            {managementMoney(data.totalGrossUnallocated)}
          </Typography>
          {(data.totalReceived !== expectedReceived ||
            data.totalGrossUnallocated !== expectedUnallocated) && (
            <Alert severity="warning">
              Số liệu nguồn đã thay đổi. Tải lại báo cáo để đối chiếu.
            </Alert>
          )}
          {data.items.length === 0 && (
            <Typography color="text.secondary">
              Không có giao dịch ngân hàng đã xác minh trong kỳ.
            </Typography>
          )}
          {data.items.map((item) => (
            <Box key={item.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={0.5}
                sx={{ justifyContent: 'space-between' }}
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {item.reference || 'Giao dịch ngân hàng'} · {formatInstant(item.receivedAt)}
                </Typography>
                <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {managementMoney(item.amount)}
                </Typography>
              </Stack>
              <Typography variant="body2">
                Đã phân bổ: {managementMoney(item.allocated)} · Chưa phân bổ:{' '}
                {managementMoney(item.grossUnallocated)}
              </Typography>
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Button
                  component={Link}
                  to={`/payments?transferId=${encodeURIComponent(item.id)}`}
                  size="small"
                >
                  Mở giao dịch
                </Button>
                <Button
                  size="small"
                  aria-expanded={selected === item.id}
                  onClick={() => setSelected(selected === item.id ? null : item.id)}
                >
                  {selected === item.id ? 'Ẩn hồ sơ hoàn tiền' : 'Xem hồ sơ hoàn tiền'}
                </Button>
              </Stack>
              {selected === item.id && <RefundDetail key={item.id} id={item.id} />}
            </Box>
          ))}
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              disabled={page <= 1 || result.isFetching}
              onClick={() => {
                setSelected(null);
                setPage(page - 1);
              }}
            >
              Trang trước
            </Button>
            <Typography variant="caption">Trang {page}</Typography>
            <Button
              disabled={page * data.pageSize >= data.total || result.isFetching}
              onClick={() => {
                setSelected(null);
                setPage(page + 1);
              }}
            >
              Trang sau
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}

export function BankRefundSourceDetails({
  filter,
  expected,
}: {
  filter: ReportFilter;
  expected: string;
}) {
  const [page, setPage] = useState(1);
  const api = useFinanceApi();
  const { session } = useAuth();
  const result = useQuery({
    queryKey: ['finance-ledger-sources', session?.userId, 'bank-refunds', filter, page],
    queryFn: ({ signal }) => api.bankRefundSources(filter, page, signal),
  });
  const data = result.data;
  return (
    <Stack spacing={1} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {result.isFetching && <LinearProgress />}
      {result.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void result.refetch()}>Thử lại</Button>}
        >
          {financeError(result.error)}
        </Alert>
      )}
      {!result.isError && data && (
        <>
          <Typography variant="body2">
            {data.total} khoản hoàn · Tổng nguồn: {managementMoney(data.totalAmount)}
          </Typography>
          {data.totalAmount !== expected && (
            <Alert severity="warning">
              Số liệu nguồn đã thay đổi. Tải lại báo cáo để đối chiếu.
            </Alert>
          )}
          {data.items.length === 0 && (
            <Typography color="text.secondary">
              Không có khoản hoàn tiền thừa đã xác minh trong kỳ.
            </Typography>
          )}
          {data.items.map((row) => (
            <Box key={row.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between' }}
              >
                <Typography variant="body2">
                  {row.reference || 'Khoản hoàn tiền'} · {formatInstant(row.executedAt)}
                </Typography>
                <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {managementMoney(row.amount)}
                </Typography>
              </Stack>
              <Button
                component={Link}
                to={`/payments?transferId=${encodeURIComponent(row.paymentId)}`}
                size="small"
              >
                Mở giao dịch gốc
              </Button>
            </Box>
          ))}
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Button disabled={page <= 1 || result.isFetching} onClick={() => setPage(page - 1)}>
              Trang trước
            </Button>
            <Typography variant="caption">Trang {page}</Typography>
            <Button
              disabled={page * data.pageSize >= data.total || result.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Trang sau
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}
