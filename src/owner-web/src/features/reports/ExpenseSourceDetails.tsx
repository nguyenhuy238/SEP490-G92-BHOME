import { useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { financeError, type ReportFilter } from '../../../../../packages/client-core/src/finance';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { managementMoney } from '../finance/managementMoney';

export function ExpenseSourceDetails({
  filter,
  category,
  expected,
}: {
  filter: ReportFilter;
  category?: string;
  expected?: string | null;
}) {
  const api = useFinanceApi();
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const scope = {
    from: filter.from,
    to: filter.to,
    locationId: filter.locationId,
    roomId: filter.roomId,
    expenseType: 'OPERATING',
    category,
    page,
    includeTotalAmount: true,
  };
  const result = useQuery({
    queryKey: ['finance-expense-sources', session?.userId, scope],
    queryFn: ({ signal }) => api.expenses(scope, signal),
  });
  const value = result.data;
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">
        {category ?? 'Chi phí vận hành'} · {displayContractDate(filter.from)} –{' '}
        {displayContractDate(filter.to)}
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
      {!result.isError && value && (
        <>
          <Typography variant="body2">
            {value.total} khoản chi · Tổng nguồn hiện tại: {managementMoney(value.totalAmount)}
          </Typography>
          {expected != null && value.totalAmount != null && expected !== value.totalAmount && (
            <Alert severity="warning">
              Nguồn hiện tại khác ảnh chụp báo cáo ({managementMoney(expected)}). Tải lại báo cáo để
              đối chiếu cùng dữ liệu.
            </Alert>
          )}
          {value.items.length === 0 && (
            <Typography color="text.secondary">Không có khoản chi trong phạm vi này.</Typography>
          )}
          {value.items.map((item) => (
            <Box key={item.id} sx={{ borderBottom: 1, borderColor: 'divider', py: 1 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between' }}
                spacing={0.5}
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {item.category} · {displayContractDate(item.occurredOn)}
                </Typography>
                <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {managementMoney(item.amount)}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {item.note}
              </Typography>
              {(item.taskTitle || item.assetName) && (
                <Typography variant="body2" color="text.secondary">
                  {[item.taskTitle, item.assetName].filter(Boolean).join(' · ')}
                </Typography>
              )}
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere' }}
              >
                Mã khoản chi: {item.id}
              </Typography>
            </Box>
          ))}
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Button disabled={page <= 1 || result.isFetching} onClick={() => setPage(page - 1)}>
              Trang trước
            </Button>
            <Typography variant="caption">Trang {page}</Typography>
            <Button
              disabled={page * value.pageSize >= value.total || result.isFetching}
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
