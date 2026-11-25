import { useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  type FinanceSourceKind,
  type ReportFilter,
} from '../../../../../packages/client-core/src/finance';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { managementMoney } from '../finance/managementMoney';

import { sourceLabels } from './financeSourceLabels';
const kinds: Record<string, string> = {
  Invoice: 'Hóa đơn',
  InitialRent: 'Tiền thuê/phí ban đầu',
  Deposit: 'Cọc',
  TenantDamage: 'Bồi thường trả phòng',
  FinalUtility: 'Điện nước trả phòng',
  FinalFixed: 'Phí cố định trả phòng',
};

export function FinanceLedgerDetails({
  filter,
  kind,
  expected,
}: {
  filter: ReportFilter;
  kind: FinanceSourceKind;
  expected?: string | null;
}) {
  const [page, setPage] = useState(1);
  const api = useFinanceApi();
  const { session } = useAuth();
  const result = useQuery({
    queryKey: ['finance-ledger-sources', session?.userId, filter, kind, page],
    queryFn: ({ signal }) => api.reportSources(filter, kind, page, signal),
  });
  const data = result.data;
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">
        {sourceLabels[kind]} ·{' '}
        {kind === 'debt'
          ? 'Tất cả kỳ, số dư hiện tại'
          : displayContractDate(filter.from) + ' – ' + displayContractDate(filter.to)}
      </Typography>
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
            {data.total} bản ghi · Tổng nguồn: {managementMoney(data.totalAmount)}
          </Typography>
          {expected != null && expected !== data.totalAmount && (
            <Alert severity="warning">
              Nguồn hiện tại khác báo cáo ({managementMoney(expected)}). Tải lại báo cáo để đối
              chiếu.
            </Alert>
          )}
          {data.items.length === 0 && (
            <Typography color="text.secondary">Không có bản ghi trong phạm vi này.</Typography>
          )}
          {data.items.map((item) => (
            <Box
              key={item.id}
              sx={{ py: 1, borderBottom: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between' }}
                spacing={0.5}
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {kinds[item.kind] ?? item.kind} · Phòng {item.roomNumber}
                </Typography>
                <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {managementMoney(item.amount)}
                </Typography>
              </Stack>
              <Typography variant="body2">
                Kỳ ghi nhận: {displayContractDate(item.basisDate)}
                {item.receivedAt && ' · Nhận tiền: ' + formatInstant(item.receivedAt)}
              </Typography>
              {item.original != null && (
                <Typography variant="body2">
                  Gốc: {managementMoney(item.original)} · Điều chỉnh:{' '}
                  {managementMoney(item.adjustments)} · Đã phân bổ:{' '}
                  {managementMoney(item.allocated)}
                </Typography>
              )}
              {item.reference && <Typography variant="body2">{item.reference}</Typography>}
              <Typography variant="caption" color="text.secondary" component="div">
                Hợp đồng: {item.contractId}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {item.paymentId ? 'Giao dịch: ' + item.paymentId + ' · Phân bổ: ' : 'Mã nguồn: '}
                {item.id}
              </Typography>
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {item.paymentId && (
                  <Button
                    size="small"
                    component={Link}
                    to={`/payments?transferId=${encodeURIComponent(item.paymentId)}`}
                  >
                    Mở giao dịch
                  </Button>
                )}
                {item.kind === 'Invoice' && !item.paymentId && (
                  <Button
                    size="small"
                    component={Link}
                    to={`/invoices?invoiceId=${encodeURIComponent(item.id)}`}
                  >
                    Mở hóa đơn
                  </Button>
                )}
                <Button
                  size="small"
                  component={Link}
                  to={`/contracts?contractId=${encodeURIComponent(item.contractId)}&locationId=${encodeURIComponent(item.locationId)}`}
                >
                  Mở hợp đồng
                </Button>
              </Stack>
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
