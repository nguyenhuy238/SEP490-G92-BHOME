import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  formatFinanceMoney,
  type FinanceTotals,
  type ReportFilter,
  type SettlementFinanceSources,
} from '../../../../../packages/client-core/src/finance';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { FilterToolbar, KPIGrid, PageHeader } from '../../components/common/PortalUI';
import { OptionPicker } from '../../components/common/OptionPicker';
import { FinancialAmountChart } from './FinancialAmountChart';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { downloadFinance, reportCsv } from '../../services/financeExport';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { financeMonthPeriod } from '../finance/monthPeriods';

export function FinancialReportsApiPage() {
  const api = useFinanceApi();
  const { session } = useAuth();
  const [from, setFrom] = useState(() => financeMonthPeriod(-1).from),
    [to, setTo] = useState(() => financeMonthPeriod(-1).to),
    [location, setLocation] = useState('');
  const [filter, setFilter] = useState<ReportFilter | null>(null);
  const [reportScope, setReportScope] = useState('');
  const [room, setRoom] = useState('');
  const [dateError, setDateError] = useState(false);
  const locations = useQuery({
    queryKey: ['finance-locations', session?.userId],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const report = useQuery({
    queryKey: ['financial-report', session?.userId, filter],
    enabled: !!filter,
    queryFn: ({ signal }) => api.report(filter!, signal),
  });
  const rooms = useQuery({
    queryKey: ['finance-rooms', session?.userId, location],
    enabled: !!location,
    queryFn: ({ signal }) => api.rooms(location, signal),
  });
  const value = report.data;
  const filtersChanged =
    !!filter &&
    (filter.from !== from ||
      filter.to !== to ||
      (filter.locationId || '') !== location ||
      (filter.roomId || '') !== room);
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
      <PageHeader title="Báo cáo kinh doanh & Hoàn vốn" />
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Stack direction="row" useFlexGap spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          {([-1, 0] as const).map((offset) => (
            <Button
              key={offset}
              type="button"
              onClick={() => {
                const period = financeMonthPeriod(offset);
                setFrom(period.from);
                setTo(period.to);
                setDateError(false);
              }}
            >
              {offset === -1 ? 'Tháng trước' : 'Tháng này'}
            </Button>
          ))}
        </Stack>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!from || !to || from > to) {
              setDateError(true);
              return;
            }
            setDateError(false);
            setReportScope(
              [
                location
                  ? (locations.data?.find((item) => item.id === location)?.label ?? location)
                  : 'Toàn chuỗi',
                room ? (rooms.data?.find((item) => item.id === room)?.label ?? room) : '',
              ]
                .filter(Boolean)
                .join(' · '),
            );
            setFilter({
              from,
              to,
              locationId: location || undefined,
              ...(room ? { roomId: room } : {}),
            });
          }}
        >
          <FilterToolbar>
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
              error={dateError}
              helperText={dateError ? 'Chọn khoảng ngày hợp lệ.' : undefined}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: from } }}
              onChange={(e) => setTo(e.target.value)}
            />
            <OptionPicker
              label="Cơ sở"
              value={location}
              options={locations.data ?? []}
              loading={locations.isPending}
              error={!!locations.error}
              emptyLabel="Toàn chuỗi"
              change={(id) => {
                setLocation(id);
                setRoom('');
              }}
            />
            <OptionPicker
              label="Phòng"
              value={room}
              options={rooms.data ?? []}
              disabled={!location}
              loading={!!location && rooms.isPending}
              error={!!rooms.error}
              emptyLabel={location ? 'Tất cả phòng' : 'Chọn cơ sở trước'}
              change={setRoom}
            />
            <Button type="submit" variant="contained" disabled={report.isFetching}>
              Xem báo cáo
            </Button>
          </FilterToolbar>
        </form>
      </Paper>
      {filtersChanged && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Bạn vừa thay đổi phạm vi. Nhấn <strong>Xem báo cáo</strong> để tải kết quả theo bộ lọc
          mới; số liệu đang hiển thị vẫn thuộc kỳ trước đó.
        </Alert>
      )}
      {!filter && !locations.error && (
        <Typography color="text.secondary" variant="body2">
          Chọn kỳ và phạm vi để xem báo cáo từ máy chủ.
        </Typography>
      )}
      {(locations.isPending || report.isFetching) && <LinearProgress />}
      {(locations.error || rooms.error || report.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void locations.refetch();
                if (location) void rooms.refetch();
                if (filter) void report.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {financeError(locations.error || rooms.error || report.error)}
        </Alert>
      )}
      {!report.error && value && (
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            spacing={1}
            sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h2" component="h2">
                Kỳ báo cáo: {filter && displayContractDate(filter.from)} –{' '}
                {filter && displayContractDate(filter.to)}
              </Typography>
              <Typography variant="body2">Phạm vi: {reportScope}</Typography>
              <Typography color="text.secondary" variant="caption">
                Ảnh chụp dữ liệu:{' '}
                {value.snapshotAt ? formatInstant(value.snapshotAt) : 'Chưa có thời điểm'}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              sx={{ flexShrink: 0 }}
              onClick={() =>
                downloadFinance(
                  reportCsv(value),
                  'bao-cao-kinh-doanh.csv',
                  'text/csv;charset=utf-8',
                )
              }
            >
              Tải CSV số liệu máy chủ
            </Button>
          </Stack>
          <KPIGrid
            items={[
              { label: 'Hóa đơn / khoản phải thu', value: formatFinanceMoney(value.total.issued) },
              {
                label: 'Thu đã xác minh',
                value: formatFinanceMoney(value.total.verifiedCollections),
              },
              {
                label: 'Nợ hiện tại trong kỳ',
                value: formatFinanceMoney(value.total.outstandingNow),
              },
              { label: 'OPEX trong kỳ', value: formatFinanceMoney(value.total.operatingExpenses) },
            ]}
          />
          <FinancialAmountChart totals={value.total} />
          <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
              Toàn bộ phạm vi đã chọn
            </Typography>
            <Totals value={value.total} />
            <SettlementSources value={value.settlementSources} />
            <Typography>
              Hoàn gốc cọc đã xác minh trong kỳ:{' '}
              {value.verifiedDepositReturns == null
                ? 'Chưa có dữ liệu phân loại'
                : formatFinanceMoney(value.verifiedDepositReturns)}
            </Typography>
            <Alert severity="info">
              Hoàn gốc cọc được theo dõi riêng, không phải chi phí vận hành hoặc giảm doanh thu hóa
              đơn. Khoản phải thu trả phòng đã duyệt được cộng vào giá trị phải thu và nợ; cấn trừ
              cọc làm giảm nợ và được trình bày riêng, không ghi thành tiền chuyển khoản mới.
            </Alert>
          </Paper>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                Lấp đầy theo kỳ
              </Typography>
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
            <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                Vốn & Thu hồi
              </Typography>
              <Typography>
                Đầu tư đến cuối kỳ: {formatFinanceMoney(value.capital.initialInvestment)}
              </Typography>
              <Typography>
                Tiền thu hồi lũy kế:{' '}
                {value.capital.netRecovery === null
                  ? 'Chưa xác định'
                  : formatFinanceMoney(value.capital.netRecovery)}
              </Typography>
              <Typography>
                Vốn chưa thu hồi:{' '}
                {value.capital.remainingCapital === null
                  ? 'Chưa xác định'
                  : formatFinanceMoney(value.capital.remainingCapital)}
              </Typography>
              <Typography>
                Tỷ lệ thu hồi:{' '}
                {value.capital.recoveryPercent === null
                  ? 'Chưa xác định'
                  : `${value.capital.recoveryPercent}%`}
              </Typography>
              <Typography>
                Ước tính số tháng còn lại:{' '}
                {value.capital.estimatedRemainingMonths ?? 'Chưa xác định'}
              </Typography>
              {value.capital.unavailableReason && (
                <Alert severity="info">
                  {reasons[value.capital.unavailableReason] || 'Chưa đủ dữ liệu tính hoàn vốn.'}
                </Alert>
              )}
            </Paper>
          </Box>
          {value.locations.length === 0 && (
            <Alert severity="info">Chưa có cơ sở trong phạm vi.</Alert>
          )}
          {value.locations.map((l) => (
            <Paper
              key={l.locationId}
              variant="outlined"
              sx={{ p: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}
            >
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                {l.locationName}
              </Typography>
              <Totals value={l.totals} />
              <SettlementSources value={l.settlementSources} />
            </Paper>
          ))}
          <Typography variant="caption">
            Chỉ tiêu quản trị nội bộ. Nợ và số phòng đang ở phản ánh trạng thái lúc tải báo cáo.
            Dòng tiền thu hồi không tính cọc, giao dịch chưa phân bổ hoặc chuyển khoản mô phỏng. Ước
            tính dùng dòng tiền bình quân các tháng đã chọn và giữ nguyên giả định đó.
          </Typography>
        </Stack>
      )}
    </>
  );
}
function Totals({ value }: { value: FinanceTotals }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
        gap: 0.75,
      }}
    >
      <Typography>
        Phòng đang ở hiện tại: {value.occupiedRooms}/{value.totalRooms}
      </Typography>
      {(
        [
          ['Hóa đơn và khoản phải thu đã duyệt trong kỳ', value.issued],
          ['Điều chỉnh đã duyệt', value.approvedAdjustments],
          ['Tiền phân bổ đã xác minh trong kỳ', value.verifiedCollections],
          ['Chi phí vận hành', value.operatingExpenses],
          ['Lợi nhuận vận hành', value.operatingProfit],
          ['Nợ hiện tại của hóa đơn và khoản phải thu trong kỳ', value.outstandingNow],
          ['Dòng tiền vận hành', value.netOperatingCashFlow],
        ] as const
      ).map(([label, amount]) => (
        <Typography
          key={label}
          sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
        >
          {label}: {amount === null ? 'Chưa xác định' : formatFinanceMoney(amount)}
        </Typography>
      ))}
    </Box>
  );
}
function SettlementSources({ value }: { value?: SettlementFinanceSources | null }) {
  if (!value) return null;
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Đối chiếu khoản phải thu trả phòng và cọc</Typography>
      {(
        [
          ['Khoản phải thu trả phòng đã duyệt', value.approvedCharges],
          ['Nợ khoản phải thu trả phòng hiện tại', value.outstandingNow],
          ['Tiền ngân hàng phân bổ vào khoản phải thu', value.verifiedBankCollections],
          ['Cọc cấn trừ được duyệt trong kỳ', value.depositOffsetsApplied],
          ['Cọc Holding không hoàn theo quyết định hủy', value.holdingForfeitures],
        ] as const
      ).map(([label, amount]) => (
        <Typography key={label}>
          {label}: {formatFinanceMoney(amount)}
        </Typography>
      ))}
      <Typography variant="caption">
        Điện/nước và phí cố định theo kỳ đã chốt; thiệt hại theo ngày Owner duyệt. Tiền thu/cấn trừ
        theo thời điểm phân bổ ở Việt Nam. Cọc Holding không hoàn hiển thị riêng, chưa cộng vào công
        thức lợi nhuận hoặc dòng tiền hiện có.
      </Typography>
    </Stack>
  );
}
