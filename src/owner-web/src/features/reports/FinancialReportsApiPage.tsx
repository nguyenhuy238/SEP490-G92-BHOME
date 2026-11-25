import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Collapse,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  formatFinanceMoney,
  type FinanceTotals,
  type FinanceSourceKind,
  type ReportFilter,
  type SettlementFinanceSources,
} from '../../../../../packages/client-core/src/finance';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { FilterToolbar, KPIGrid, PageHeader } from '../../components/common/PortalUI';
import { OptionPicker } from '../../components/common/OptionPicker';
import { FinancialAmountChart } from './FinancialAmountChart';
import { FinancialTrendChart } from './FinancialTrendChart';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { downloadFinance, reportCsv } from '../../services/financeExport';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { financeMonthPeriod } from '../finance/monthPeriods';
import { useFinanceSearch } from '../finance/financeScope';
import { ManagementFinanceSummary } from './ManagementFinanceSummary';
import { managementMoney } from '../finance/managementMoney';
import { ExpenseSourceDetails } from './ExpenseSourceDetails';
import { DepreciationSourceDetails } from './DepreciationSourceDetails';
import { LocationPerformanceTable } from './LocationPerformanceTable';
import { FinanceLedgerDetails } from './FinanceLedgerDetails';
import { sourceLabels } from './financeSourceLabels';
import { BankReceiptSourceDetails, BankRefundSourceDetails } from './BankReceiptSourceDetails';

export function FinancialReportsApiPage() {
  const api = useFinanceApi();
  const { session } = useAuth();
  const initialLocation = useFinanceSearch().get('locationId') ?? '';
  const [from, setFrom] = useState(() => financeMonthPeriod(-1).from),
    [to, setTo] = useState(() => financeMonthPeriod(-1).to),
    [location, setLocation] = useState(initialLocation);
  // Open with the latest completed month so owners can read the report immediately.
  // Query values still come from the API, never from page-local estimates.
  const [filter, setFilter] = useState<ReportFilter | null>(() => ({
    from: financeMonthPeriod(-1).from,
    to: financeMonthPeriod(-1).to,
    locationId: initialLocation || undefined,
    includeComparison: true,
  }));
  const [reportScope, setReportScope] = useState(initialLocation ? 'Cơ sở đã chọn' : 'Toàn chuỗi');
  const [room, setRoom] = useState('');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [dateError, setDateError] = useState(false);
  const [expenseDetailsOpen, setExpenseDetailsOpen] = useState(false);
  const [categoryDetails, setCategoryDetails] = useState<string | null>(null);
  const [ledgerKind, setLedgerKind] = useState<FinanceSourceKind | null>(null);
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
  function loadReport(fromValue: string, toValue: string) {
    if (!fromValue || !toValue || fromValue > toValue) {
      setDateError(true);
      return;
    }
    setDateError(false);
    setExpenseDetailsOpen(false);
    setCategoryDetails(null);
    setLedgerKind(null);
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
      from: fromValue,
      to: toValue,
      locationId: location || undefined,
      includeComparison: true,
      ...(room ? { roomId: room } : {}),
    });
  }
  const value = report.data;
  const cashCapital = value?.total.management?.cashCapital;
  const filtersChanged =
    filter !== null &&
    (from !== filter.from ||
      to !== filter.to ||
      location !== (filter.locationId ?? '') ||
      room !== (filter.roomId ?? ''));
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
    investment_basis_required:
      'Chưa đủ nguyên giá tài sản để tính vốn còn lại và tiến độ thu hồi. Bổ sung giá mua tại cơ sở.',
    full_month_baseline_required: 'Chọn khoảng gồm các tháng đã kết thúc để ước tính hoàn vốn.',
    positive_cash_flow_required: 'Dòng tiền chưa dương; chưa thể ước tính thời gian hoàn vốn.',
  };
  return (
    <>
      <PageHeader
        title="Báo cáo kinh doanh"
        subtitle="Kết quả thu chi và hoàn vốn theo kỳ. Chỉ hiển thị số liệu do máy chủ tổng hợp."
      />
      <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
            Chọn kỳ và phạm vi cần xem
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Trang tự tải tháng đã hoàn tất gần nhất. Khi đổi bộ lọc, nhấn Xem báo cáo để lấy số liệu
            cho lựa chọn mới.
          </Typography>
        </Box>
        <ValidatedForm
          onSubmit={(e) => {
            e.preventDefault();
            loadReport(from, to);
          }}
        >
          <FilterToolbar>
            <Button
              size="small"
              variant={
                from === financeMonthPeriod(-1).from && to === financeMonthPeriod(-1).to
                  ? 'contained'
                  : 'outlined'
              }
              onClick={() => {
                const period = financeMonthPeriod(-1);
                setFrom(period.from);
                setTo(period.to);
                setDateError(false);
              }}
            >
              Tháng trước
            </Button>
            <Button
              size="small"
              variant={
                from === financeMonthPeriod(0).from && to === financeMonthPeriod(0).to
                  ? 'contained'
                  : 'outlined'
              }
              onClick={() => {
                const period = financeMonthPeriod(0);
                setFrom(period.from);
                setTo(period.to);
                setDateError(false);
              }}
            >
              Tháng này
            </Button>
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
            <Button
              size="small"
              color="inherit"
              aria-expanded={advancedFiltersOpen}
              aria-controls="report-advanced-filters"
              onClick={() => setAdvancedFiltersOpen((open) => !open)}
              sx={{ flexShrink: 0, minHeight: { xs: 44, sm: 36 } }}
            >
              {advancedFiltersOpen ? 'Ẩn bộ lọc chi tiết' : 'Bộ lọc chi tiết'}
              {!advancedFiltersOpen && room ? ' • Đang lọc phòng' : ''}
            </Button>
            <Button type="submit" variant="contained" disabled={report.isFetching}>
              Xem báo cáo
            </Button>
          </FilterToolbar>
          <Collapse in={advancedFiltersOpen} unmountOnExit>
            <Stack
              id="report-advanced-filters"
              direction={{ xs: 'column', sm: 'row' }}
              useFlexGap
              sx={{ gap: 1, flexWrap: 'wrap', mt: 1.5 }}
            >
              <TextField
                required
                size="small"
                label="Từ ngày"
                type="date"
                value={from}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(e) => setFrom(e.target.value)}
              />
              <TextField
                required
                size="small"
                label="Đến ngày"
                type="date"
                value={to}
                error={dateError}
                helperText={dateError ? 'Chọn khoảng ngày hợp lệ.' : undefined}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: from } }}
                onChange={(e) => setTo(e.target.value)}
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
            </Stack>
          </Collapse>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} aria-live="polite">
            Bộ lọc đang chọn: {displayContractDate(from)} – {displayContractDate(to)} ·{' '}
            {location
              ? (locations.data?.find((item) => item.id === location)?.label ?? location)
              : 'Toàn chuỗi'}
            {room && ` · ${rooms.data?.find((item) => item.id === room)?.label ?? room}`}
            {filtersChanged
              ? ' · Chưa áp dụng'
              : report.isError
                ? ' · Tải thất bại'
                : report.isPending || report.isFetching
                  ? ' · Đang tải'
                  : value
                    ? ' · Đã tải'
                    : ' · Chưa có kết quả'}
          </Typography>
        </ValidatedForm>
      </Paper>
      {filtersChanged && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Bộ lọc đã thay đổi. Nhấn <strong>Xem báo cáo</strong> để cập nhật; số liệu đang hiển thị
          vẫn thuộc kỳ trước đó.
        </Alert>
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
                Kỳ báo cáo đã tải: {filter && displayContractDate(filter.from)} –{' '}
                {filter && displayContractDate(filter.to)}
              </Typography>
              <Typography variant="body2">
                Phạm vi:{' '}
                {filter?.locationId && !filter.roomId
                  ? (locations.data?.find((item) => item.id === filter.locationId)?.label ??
                    reportScope)
                  : reportScope}
              </Typography>
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
            items={
              value.total.management
                ? [
                    {
                      label: 'Doanh thu trong kỳ',
                      value: managementMoney(value.total.management.revenue),
                    },
                    {
                      label: 'Tiền kinh doanh thực thu',
                      value: managementMoney(value.total.management.actualBusinessCollections),
                    },
                    {
                      label: 'Công nợ hiện tại',
                      value: managementMoney(value.total.management.currentOutstanding),
                    },
                    {
                      label: 'Dòng tiền vận hành',
                      value: managementMoney(value.total.management.operatingCashFlow),
                    },
                  ]
                : [
                    {
                      label: 'Hóa đơn / khoản phải thu',
                      value: formatFinanceMoney(value.total.issued),
                    },
                    {
                      label: 'Tiền phân bổ xác minh (dữ liệu cũ)',
                      value: formatFinanceMoney(value.total.verifiedCollections),
                    },
                    {
                      label: 'Nợ hiện tại trong kỳ',
                      value: formatFinanceMoney(value.total.outstandingNow),
                    },
                    {
                      label: 'OPEX trong kỳ',
                      value: formatFinanceMoney(value.total.operatingExpenses),
                    },
                  ]
            }
          />
          <ManagementFinanceSummary value={value.total.management} />
          {value.comparison && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h3">Biến động so với kỳ trước</Typography>
              <Typography variant="caption" color="text.secondary">
                {displayContractDate(value.comparison.currentFrom)} –{' '}
                {displayContractDate(value.comparison.currentTo)}
                {' so với '}
                {displayContractDate(value.comparison.previousFrom)} –{' '}
                {displayContractDate(value.comparison.previousTo)}
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {[
                  { label: 'Doanh thu', ...value.comparison.revenue },
                  { label: 'Chi phí vận hành', ...value.comparison.operatingExpenses },
                  { label: 'Lợi nhuận vận hành', ...value.comparison.operatingProfit },
                  ...value.comparison.expenseCategories.map((row) => ({
                    label: row.category,
                    ...row,
                  })),
                ].map((row, index) => (
                  <Stack
                    key={index}
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ justifyContent: 'space-between' }}
                    spacing={0.5}
                  >
                    <Typography>{row.label}</Typography>
                    <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {managementMoney(row.previous)} → {managementMoney(row.current)} ·{' '}
                      {managementMoney(row.change)}
                      {' ('}
                      {row.changePercent == null
                        ? 'Không có tỷ lệ so sánh'
                        : row.changePercent + '%'}
                      {')'}
                    </Typography>
                    {index >= 3 && (
                      <Button
                        size="small"
                        onClick={() =>
                          setCategoryDetails(categoryDetails === row.label ? null : row.label)
                        }
                      >
                        {categoryDetails === row.label ? 'Ẩn nguồn' : 'Xem nguồn'}
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
              {categoryDetails && filter && (
                <Stack spacing={2} sx={{ mt: 2 }}>
                  <ExpenseSourceDetails
                    key={categoryDetails + '-current'}
                    filter={{
                      ...filter,
                      from: value.comparison.currentFrom,
                      to: value.comparison.currentTo,
                    }}
                    category={categoryDetails}
                    expected={
                      value.comparison.expenseCategories.find(
                        (row) => row.category === categoryDetails,
                      )?.current
                    }
                  />
                  <ExpenseSourceDetails
                    key={categoryDetails + '-previous'}
                    filter={{
                      ...filter,
                      from: value.comparison.previousFrom,
                      to: value.comparison.previousTo,
                    }}
                    category={categoryDetails}
                    expected={
                      value.comparison.expenseCategories.find(
                        (row) => row.category === categoryDetails,
                      )?.previous
                    }
                  />
                </Stack>
              )}
            </Paper>
          )}
          <Accordion variant="outlined" disableGutters>
            <AccordionSummary expandIcon={<ChevronDown size={18} />}>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                Biểu đồ các khoản thu chi
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <FinancialTrendChart
                points={value.trend}
                unavailableReason={value.trendUnavailableReason}
              />
              <Box sx={{ mt: 2 }}>
                <FinancialAmountChart totals={value.total} />
              </Box>
            </AccordionDetails>
          </Accordion>
          <Accordion
            variant="outlined"
            disableGutters
            sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
          >
            <AccordionSummary expandIcon={<ChevronDown size={18} />}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                  Đối chiếu chi tiết số liệu
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Xem từng khoản phải thu, tiền đã xác minh và cấn trừ cọc khi cần kiểm tra.
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                Toàn bộ phạm vi đã chọn
              </Typography>
              <Totals value={value.total} />
              {filter && value.total.management && (
                <Stack spacing={1} sx={{ my: 1.5 }}>
                  <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {(Object.keys(sourceLabels) as FinanceSourceKind[]).map((kind) => (
                      <Button
                        key={kind}
                        size="small"
                        variant={ledgerKind === kind ? 'contained' : 'outlined'}
                        aria-pressed={ledgerKind === kind}
                        onClick={() => setLedgerKind(ledgerKind === kind ? null : kind)}
                      >
                        {sourceLabels[kind]}
                      </Button>
                    ))}
                  </Stack>
                  {ledgerKind && (
                    <FinanceLedgerDetails
                      key={JSON.stringify(filter) + ledgerKind}
                      filter={filter}
                      kind={ledgerKind}
                      expected={
                        {
                          revenue: value.total.management.revenue,
                          cash: value.total.management.actualBusinessCollections,
                          debt: value.total.management.currentOutstanding,
                          'period-debt': value.total.management.periodOutstanding,
                          deposit: value.total.management.depositReceipts,
                        }[ledgerKind]
                      }
                    />
                  )}
                </Stack>
              )}
              {filter && (
                <Box sx={{ my: 1.5 }}>
                  <Button
                    size="small"
                    aria-expanded={expenseDetailsOpen}
                    onClick={() => setExpenseDetailsOpen(!expenseDetailsOpen)}
                  >
                    {expenseDetailsOpen ? 'Ẩn danh sách chi phí' : 'Xem danh sách chi phí vận hành'}
                  </Button>
                  {expenseDetailsOpen && (
                    <ExpenseSourceDetails
                      key={JSON.stringify(filter)}
                      filter={filter}
                      expected={value.total.operatingExpenses}
                    />
                  )}
                </Box>
              )}
              {filter && value.total.management && (
                <Accordion
                  variant="outlined"
                  disableGutters
                  slotProps={{ transition: { unmountOnExit: true } }}
                >
                  <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                    Xem nguồn khấu hao
                  </AccordionSummary>
                  <AccordionDetails>
                    <DepreciationSourceDetails
                      key={JSON.stringify(filter)}
                      filter={filter}
                      expected={value.total.management.depreciation}
                    />
                  </AccordionDetails>
                </Accordion>
              )}
              <SettlementSources value={value.settlementSources} />
              {value.receiptReconciliation && (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">Đối chiếu ngân hàng toàn chuỗi</Typography>
                  <Typography>
                    Tổng tiền ngân hàng xác minh:{' '}
                    {managementMoney(value.receiptReconciliation.verifiedBankReceipts)}
                  </Typography>
                  <Typography>
                    Phần chưa phân bổ (trước khi trừ hoàn tiền):{' '}
                    {managementMoney(value.receiptReconciliation.unallocatedAtReview)}
                  </Typography>
                  <Typography>
                    Hoàn tiền thừa đã xác minh trong kỳ:{' '}
                    {managementMoney(value.receiptReconciliation.excessRefundedInPeriod)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Tiền chưa phân bổ không phải doanh thu hoặc số dư được dùng về sau. Khoản thu
                    thừa chỉ được hoàn cho người thực tế thanh toán sau khi kiểm tra hồ sơ.
                  </Typography>
                  {filter && !filter.locationId && !filter.roomId && (
                    <Accordion
                      variant="outlined"
                      disableGutters
                      slotProps={{ transition: { unmountOnExit: true } }}
                    >
                      <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                        Xem nguồn giao dịch ngân hàng
                      </AccordionSummary>
                      <AccordionDetails>
                        <BankReceiptSourceDetails
                          key={JSON.stringify(filter)}
                          filter={filter}
                          expectedReceived={value.receiptReconciliation.verifiedBankReceipts}
                          expectedUnallocated={value.receiptReconciliation.unallocatedAtReview}
                        />
                      </AccordionDetails>
                    </Accordion>
                  )}
                  {filter && !filter.locationId && !filter.roomId && (
                    <Accordion
                      variant="outlined"
                      disableGutters
                      slotProps={{ transition: { unmountOnExit: true } }}
                    >
                      <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                        Xem khoản hoàn tiền trong kỳ
                      </AccordionSummary>
                      <AccordionDetails>
                        <BankRefundSourceDetails
                          key={JSON.stringify(filter)}
                          filter={filter}
                          expected={value.receiptReconciliation.excessRefundedInPeriod}
                        />
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Stack>
              )}
              <Typography>
                Hoàn gốc cọc đã xác minh trong kỳ:{' '}
                {value.verifiedDepositReturns == null
                  ? 'Chưa có dữ liệu phân loại'
                  : formatFinanceMoney(value.verifiedDepositReturns)}
              </Typography>
              <Alert severity="info">
                Hoàn gốc cọc được theo dõi riêng, không phải chi phí vận hành hoặc giảm doanh thu
                hóa đơn. Khoản phải thu trả phòng đã duyệt được cộng vào giá trị phải thu và nợ; cấn
                trừ cọc làm giảm nợ và được trình bày riêng, không ghi thành tiền chuyển khoản mới.
              </Alert>
            </AccordionDetails>
          </Accordion>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            <Accordion
              variant="outlined"
              disableGutters
              sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                    Tỷ lệ lấp đầy
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Xem lịch sử ngày-phòng đã thuê trong kỳ đã chọn.
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
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
              </AccordionDetails>
            </Accordion>
            <Accordion
              variant="outlined"
              disableGutters
              sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                    Tiến độ thu hồi vốn
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Xem số vốn, tiền đã thu hồi và ước tính thời gian còn lại.
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="h2" component="h2" sx={{ mb: 1 }}>
                  Vốn & Thu hồi
                </Typography>
                {value.total.management && (
                  <Stack spacing={0.5} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2">Theo dòng tiền thực tế</Typography>
                    <Typography>
                      Vốn đầu tư: {managementMoney(cashCapital?.initialInvestment)}
                    </Typography>
                    <Typography>
                      Vốn đã thu hồi: {managementMoney(cashCapital?.netRecovery)}
                    </Typography>
                    <Typography>
                      Vốn còn lại: {managementMoney(cashCapital?.remainingCapital)}
                    </Typography>
                    <Typography>
                      Tỷ lệ thu hồi:{' '}
                      {cashCapital?.recoveryPercent == null
                        ? 'Chưa xác định'
                        : cashCapital.recoveryPercent + '%'}
                    </Typography>
                    <Typography>
                      Thời gian dự kiến:{' '}
                      {cashCapital?.estimatedRemainingMonths == null
                        ? 'Chưa xác định'
                        : cashCapital.estimatedRemainingMonths + ' tháng'}
                    </Typography>
                    {cashCapital?.unavailableReason && (
                      <Alert severity="info">
                        {reasons[cashCapital.unavailableReason] ||
                          'Chưa đủ lịch sử thực thu và thực chi để ước tính hoàn vốn.'}
                      </Alert>
                    )}
                    <Typography variant="subtitle2" color="text.secondary">
                      Chỉ tiêu đối chiếu cũ (tiền phân bổ trừ chi phí phát sinh)
                    </Typography>
                  </Stack>
                )}
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
              </AccordionDetails>
            </Accordion>
          </Box>
          <Accordion variant="outlined" disableGutters>
            <AccordionSummary expandIcon={<ChevronDown size={18} />}>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                Theo từng cơ sở ({value.locations.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ display: 'grid', gap: 1.5 }}>
              {value.locations.length > 0 && <LocationPerformanceTable report={value} />}
              {value.locations.length === 0 && (
                <Alert severity="info">
                  Không có dòng theo từng cơ sở trong kết quả này. Kiểm tra phạm vi đang xem; nếu đã
                  chọn một phòng hoặc cơ sở, thử bỏ lựa chọn đó và nhấn Xem báo cáo.
                </Alert>
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
                  {l.totals.management && (
                    <ManagementFinanceSummary value={l.totals.management} compact />
                  )}
                  <SettlementSources value={l.settlementSources} />
                </Paper>
              ))}
            </AccordionDetails>
          </Accordion>
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
          ['Tiền phân bổ đã xác minh trừ OPEX (chỉ tiêu đối chiếu)', value.netOperatingCashFlow],
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
