import { useState } from 'react';
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { financeError } from '../../../../../packages/client-core/src/finance';
import { MoneyField } from '../../components/common/MoneyField';
import { managementMoney } from '../finance/managementMoney';
import { useFinanceApi } from './useFinanceApi';

const reasons: Record<string, string> = {
  repeated_repairs: 'Tài sản đã được sửa chữa nhiều lần. Nên kiểm tra nguyên nhân lặp lại.',
  depreciation_unknown: 'Chưa đủ dữ liệu khấu hao để đối chiếu giá trị còn lại.',
  lot_disposed: 'Lô đầu tư đã thanh lý.',
};

export function AssetReplacementPanel({ expenseId }: { expenseId: string }) {
  const api = useFinanceApi();
  const { session } = useAuth();
  const [cost, setCost] = useState('');
  const [submitted, setSubmitted] = useState('');
  const result = useQuery({
    queryKey: ['asset-replacement-review', session?.userId, expenseId, submitted],
    queryFn: ({ signal }) => api.replacementReview(expenseId, submitted, signal),
  });
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">Cân nhắc sửa chữa hoặc thay thế</Typography>
      <Typography variant="caption" color="text.secondary">
        Lịch sử BF-07 theo nhóm tài sản từ ngày mua lô, không phân bổ chi phí riêng cho từng chiếc
        trong nhóm. Các số liệu chỉ hỗ trợ quyết định, không tự động thanh lý.
      </Typography>
      <MoneyField
        label="Giá mua mới tham khảo (đ)"
        value={cost}
        onValueChange={setCost}
        maxRawLength={18}
      />
      <Button
        disabled={result.isFetching || (cost !== '' && (!/^\d+$/.test(cost) || BigInt(cost) <= 0n))}
        onClick={() => setSubmitted(cost)}
      >
        Đối chiếu
      </Button>
      {result.isFetching && <LinearProgress />}
      {result.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void result.refetch()}>Thử lại</Button>}
        >
          {financeError(result.error)}
        </Alert>
      )}
      {result.data && !result.isError && (
        <>
          <Typography>
            Số lần nghiệm thu sửa chữa: {result.data.repairCount} · Tuổi lô: {result.data.ageMonths}{' '}
            tháng
          </Typography>
          <Typography>Chi phí sửa chữa: {managementMoney(result.data.repairCost)}</Typography>
          <Typography>
            Lần gần nhất:{' '}
            {result.data.latestRepairAt
              ? new Date(result.data.latestRepairAt).toLocaleDateString('vi-VN', {
                  timeZone: 'Asia/Ho_Chi_Minh',
                })
              : 'Chưa có lịch sử'}
          </Typography>
          <Typography>Giá trị còn lại: {managementMoney(result.data.carryingValue)}</Typography>
          <Typography>
            Giá mua mới đã đối chiếu: {managementMoney(result.data.replacementCost)} · Tỷ lệ chi phí
            sửa chữa:{' '}
            {result.data.repairCostPercent == null
              ? 'Chưa xác định'
              : result.data.repairCostPercent + '%'}
          </Typography>
          {cost !== submitted && (
            <Typography color="text.secondary">
              Giá tham khảo đang chỉnh sửa, chưa áp dụng.
            </Typography>
          )}
          {result.data.reasons.map((reason) => (
            <Alert key={reason} severity="info">
              {reasons[reason] ?? reason}
            </Alert>
          ))}
        </>
      )}
    </Stack>
  );
}
