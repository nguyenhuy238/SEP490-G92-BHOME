import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { financeError, type ReportFilter } from '../../../../../packages/client-core/src/finance';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { ExpenseFinanceActions } from '../expenses/ExpenseFinanceActions';
import { managementMoney } from '../finance/managementMoney';

export function DepreciationSourceDetails({
  filter,
  expected,
}: {
  filter: ReportFilter;
  expected?: string | null;
}) {
  const api = useFinanceApi();
  const { session } = useAuth();
  const actor = session?.userId;
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const scope = {
    from: filter.from,
    to: filter.to,
    locationId: filter.locationId,
    roomId: filter.roomId,
  };
  const result = useQuery({
    queryKey: ['finance-depreciation-sources', actor, scope, page],
    queryFn: ({ signal }) => api.depreciationSources(scope, page, signal),
  });
  const detail = useQuery({
    queryKey: ['expenses', actor, 'lot', selected],
    queryFn: ({ signal }) => api.expense(selected!, signal),
    enabled: selected !== null,
  });
  const value = result.data;
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">
        Khấu hao theo lô đầu tư · {displayContractDate(filter.from)} –{' '}
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
          <Typography>
            {value.total} lô · Tổng khấu hao: {managementMoney(value.totalAmount)}
          </Typography>
          {value.totalAmount === null && (
            <Alert severity="warning">
              Chưa đủ dữ liệu khấu hao. Phần xác định được: {managementMoney(value.knownAmount)};{' '}
              {value.unknownLots} lô chưa xác định. Có thể còn tài sản chưa ghi nhận vốn.
            </Alert>
          )}
          {expected !== undefined && expected !== value.totalAmount && (
            <Alert severity="warning">
              Nguồn hiện tại khác báo cáo ({managementMoney(expected)}). Tải lại báo cáo để đối
              chiếu.
            </Alert>
          )}
          {!value.items.length && (
            <Typography color="text.secondary">Không có lô đầu tư trong phạm vi này.</Typography>
          )}
          {value.items.map((lot) => (
            <Box
              key={lot.expenseId}
              sx={{ borderBottom: 1, borderColor: 'divider', py: 1, overflowWrap: 'anywhere' }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between' }}
              >
                <Typography sx={{ fontWeight: 600 }}>{lot.name}</Typography>
                <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {managementMoney(lot.amounts?.period)}
                </Typography>
              </Stack>
              <Typography variant="body2">
                Ngày mua: {displayContractDate(lot.purchasedOn)} · Số lượng:{' '}
                {lot.quantity ?? 'Chưa xác định'} · Còn lại trong sổ vốn cuối kỳ:{' '}
                {lot.remainingQuantity ?? 'Chưa xác định'} · Nguyên giá: {managementMoney(lot.cost)}
              </Typography>
              <Typography variant="body2">
                Khấu hao tháng: {managementMoney(lot.amounts?.monthly)} · Lũy kế đến cuối kỳ:{' '}
                {managementMoney(lot.amounts?.accumulated)} · Giá trị còn lại:{' '}
                {managementMoney(lot.amounts?.carryingValue)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Mã lô: {lot.expenseId} · Cơ sở: {lot.locationId}
                {lot.roomId ? ' · Phòng: ' + lot.roomId : ''}
                {lot.assetId ? ' · Tài sản: ' + lot.assetId : ''}
              </Typography>
              <Box>
                <Button size="small" onClick={() => setSelected(lot.expenseId)}>
                  Mở lô đầu tư
                </Button>
              </Box>
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
      <Dialog open={selected !== null} onClose={() => setSelected(null)} fullWidth maxWidth="md">
        <DialogTitle>Hồ sơ lô đầu tư</DialogTitle>
        <DialogContent dividers>
          {detail.isFetching && <LinearProgress />}
          {detail.isError && (
            <Alert
              severity="error"
              action={<Button onClick={() => void detail.refetch()}>Thử lại</Button>}
            >
              {financeError(detail.error)}
            </Alert>
          )}
          {selected && !detail.isError && detail.data?.id === selected && (
            <Stack spacing={2}>
              <Typography>
                {detail.data.category} · {managementMoney(detail.data.amount)}
              </Typography>
              <Typography variant="body2">
                Thông tin và lịch sử hiện tại của lô; số liệu kỳ báo cáo nằm ở danh sách nguồn.
              </Typography>
              <ExpenseFinanceActions
                key={selected}
                expense={detail.data}
                onChanged={() => {
                  void detail.refetch();
                  void result.refetch();
                }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
