import { useState } from 'react';
import {
  Alert,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  type FinanceTotals,
  type ReportFilter,
} from '../../../../../packages/client-core/src/finance';
import { formatDraftMoney } from '../../../../../packages/client-core/src/mainDrafts';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { PageHeader } from '../../components/common/PortalUI';
import { useFinanceApi } from '../expenses/useFinanceApi';

export function FinancialReportsApiPage() {
  const api = useFinanceApi();
  const { session } = useAuth();
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [location, setLocation] = useState('');
  const [filter, setFilter] = useState<ReportFilter | null>(null);
  const locations = useQuery({
    queryKey: ['finance-locations', session?.userId],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const report = useQuery({
    queryKey: ['financial-report', session?.userId, filter],
    enabled: !!filter,
    queryFn: ({ signal }) => api.report(filter!, signal),
  });
  const value = report.data;
  const occupancyReasons: Record<string, string> = {
    LocationRequired: 'Chọn một cơ sở để xem tỷ lệ lấp đầy theo kỳ.',
    RoomFilterUnsupported: 'Bỏ bộ lọc phòng để xem tỷ lệ lấp đầy của cơ sở.',
    PeriodUnsupported: 'Chọn kỳ có chênh lệch ngày không quá 366 ngày để xem lịch sử lấp đầy.',
    FuturePeriod: 'Kỳ có ngày tương lai; chưa thể xác định tỷ lệ lấp đầy lịch sử.',
    InsufficientData: 'Chưa đủ lịch sử trạng thái cơ sở/phòng để tính tỷ lệ lấp đầy trong kỳ.',
  };
  const reasons: Record<string, string> = {
    refund_classification_required:
      'Có khoản hoàn tiền cần phân loại trước khi tính dòng tiền và hoàn vốn.',
    initial_investment_required: 'Chưa có vốn đầu tư để tính tỷ lệ thu hồi.',
    full_month_baseline_required: 'Chọn khoảng gồm các tháng trọn vẹn để ước tính hoàn vốn.',
    positive_cash_flow_required: 'Dòng tiền chưa dương; chưa thể ước tính thời gian hoàn vốn.',
  };
  return (
    <>
      <PageHeader
        title="Báo cáo kinh doanh & Hoàn vốn"
        subtitle="Chỉ tiêu quản trị từ hóa đơn, phân bổ tiền đã xác minh và chi phí thực tế trên máy chủ."
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Đây là chỉ tiêu quản trị nội bộ. Doanh thu phát hành, tiền thực thu và tiền cọc được tách
        riêng. Nợ và số phòng đang ở phản ánh trạng thái tại lúc tải báo cáo.
      </Alert>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ from, to, locationId: location || undefined });
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ my: 2 }}>
          <TextField
            required
            label="Từ ngày"
            type="date"
            value={from}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            required
            label="Đến ngày"
            type="date"
            value={to}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: from } }}
            onChange={(e) => setTo(e.target.value)}
          />
          <TextField
            select
            label="Cơ sở"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <MenuItem value="">Toàn chuỗi</MenuItem>
            {locations.data?.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.label}
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={report.isFetching}>
            Xem báo cáo
          </Button>
        </Stack>
      </form>
      {(locations.isPending || report.isFetching) && <LinearProgress />}
      {(locations.error || report.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void locations.refetch();
                if (filter) void report.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {financeError(locations.error || report.error)}
        </Alert>
      )}
      {!report.error && value && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Toàn bộ phạm vi đã chọn</Typography>
            <Totals value={value.total} />
            <Typography>
              Hoàn gốc cọc đã xác minh trong kỳ:{' '}
              {value.verifiedDepositReturns == null
                ? 'Chưa có dữ liệu phân loại'
                : formatDraftMoney(value.verifiedDepositReturns)}
            </Typography>
            <Alert severity="info">
              Hoàn gốc cọc được theo dõi riêng, không phải chi phí vận hành hoặc giảm doanh thu hóa
              đơn. Báo cáo lợi nhuận và hoàn vốn dùng hóa đơn, khoản thu đã phân bổ và OPEX; khoản
              giữ cọc bồi thường thiệt hại chưa được cộng vào các chỉ số này.
            </Alert>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Lấp đầy theo kỳ</Typography>
            {value.historicalOccupancy?.from && value.historicalOccupancy.to && (
              <Typography>
                Kỳ lịch sử: {displayContractDate(value.historicalOccupancy.from)} –{' '}
                {displayContractDate(value.historicalOccupancy.to)}
              </Typography>
            )}
            {value.historicalOccupancy?.status === 'Complete' ? (
              <>
                <Typography>
                  Ngày-phòng có người ở: {value.historicalOccupancy.occupiedRoomDays}
                </Typography>
                <Typography>
                  Ngày-phòng có thể cho thuê: {value.historicalOccupancy.rentableRoomDays}
                </Typography>
                <Typography>
                  Tỷ lệ lấp đầy trong kỳ:{' '}
                  {value.historicalOccupancy.occupancyRate === null
                    ? 'Chưa xác định (không có ngày-phòng có thể cho thuê)'
                    : `${value.historicalOccupancy.occupancyRate.toLocaleString('vi-VN')}%`}
                </Typography>
              </>
            ) : (
              <Alert severity="info">
                {occupancyReasons[value.historicalOccupancy?.status ?? ''] ??
                  'Chưa có dữ liệu lấp đầy lịch sử từ máy chủ.'}
              </Alert>
            )}
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Vốn & Thu hồi</Typography>
            <Typography>
              Đầu tư đến cuối kỳ: {formatDraftMoney(value.capital.initialInvestment)}
            </Typography>
            <Typography>
              Tiền thu hồi lũy kế:{' '}
              {value.capital.netRecovery === null
                ? 'Chưa xác định'
                : formatDraftMoney(value.capital.netRecovery)}
            </Typography>
            <Typography>
              Vốn chưa thu hồi:{' '}
              {value.capital.remainingCapital === null
                ? 'Chưa xác định'
                : formatDraftMoney(value.capital.remainingCapital)}
            </Typography>
            <Typography>
              Tỷ lệ thu hồi:{' '}
              {value.capital.recoveryPercent === null
                ? 'Chưa xác định'
                : `${value.capital.recoveryPercent}%`}
            </Typography>
            <Typography>
              Ước tính số tháng còn lại: {value.capital.estimatedRemainingMonths ?? 'Chưa xác định'}
            </Typography>
            {value.capital.unavailableReason && (
              <Alert severity="info">
                {reasons[value.capital.unavailableReason] || 'Chưa đủ dữ liệu tính hoàn vốn.'}
              </Alert>
            )}
          </Paper>
          {value.locations.length === 0 && (
            <Alert severity="info">Chưa có cơ sở trong phạm vi.</Alert>
          )}
          {value.locations.map((l) => (
            <Paper key={l.locationId} sx={{ p: 2 }}>
              <Typography variant="h6">{l.locationName}</Typography>
              <Totals value={l.totals} />
            </Paper>
          ))}
          <Typography variant="caption">
            Số liệu theo ảnh chụp nhất quán trên máy chủ. Dòng tiền thu hồi không tính cọc, giao
            dịch chưa phân bổ hoặc chuyển khoản mô phỏng. Ước tính dùng dòng tiền bình quân các
            tháng đã chọn và giữ nguyên giả định đó.
          </Typography>
        </Stack>
      )}
    </>
  );
}
function Totals({ value }: { value: FinanceTotals }) {
  return (
    <Stack spacing={1}>
      <Typography>
        Phòng đang ở hiện tại: {value.occupiedRooms}/{value.totalRooms}
      </Typography>
      {(
        [
          ['Phát hành trong kỳ', value.issued],
          ['Điều chỉnh đã duyệt', value.approvedAdjustments],
          ['Tiền phân bổ đã xác minh trong kỳ', value.verifiedCollections],
          ['Chi phí vận hành', value.operatingExpenses],
          ['Lợi nhuận vận hành', value.operatingProfit],
          ['Nợ hiện tại của hóa đơn trong kỳ', value.outstandingNow],
          ['Dòng tiền vận hành', value.netOperatingCashFlow],
        ] as const
      ).map(([label, amount]) => (
        <Typography key={label}>
          {label}: {amount === null ? 'Chưa xác định' : formatDraftMoney(amount)}
        </Typography>
      ))}
    </Stack>
  );
}
