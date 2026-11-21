import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  formatFinanceMoney,
  type ScenarioInput,
  type ScenarioView,
} from '../../../../../packages/client-core/src/finance';
import { PageHeader } from '../../components/common/PortalUI';
import { OptionPicker } from '../../components/common/OptionPicker';
import { MoneyField } from '../../components/common/MoneyField';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { OwnerTable } from '../../components/common/OwnerWorkspace';
import { downloadFinance } from '../../services/financeExport';
import { financeMonthPeriod } from '../finance/monthPeriods';

const initial: ScenarioInput = {
  name: '',
  baseline: financeMonthPeriod(-1),
  forecastMonths: 12,
  assumptions: {
    monthlyRent: '',
    occupancyPercent: '',
    collectionPercent: '',
    monthlyUtilityServiceCost: '',
    monthlyStaffCost: '',
    monthlyMaintenanceCost: '',
    monthlyOtherCost: '',
  },
};
export function FinancialScenariosApiPage() {
  const api = useFinanceApi(),
    cache = useQueryClient();
  const { session } = useAuth();
  const actor = session?.userId;
  const [input, setInput] = useState(initial),
    [page, setPage] = useState(1);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [view, setView] = useState<ScenarioView | null>(null),
    [comparison, setComparison] = useState<ScenarioView | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const key = useRef(crypto.randomUUID()),
    lock = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!view || !resultRef.current) return;
    resultRef.current.focus({ preventScroll: true });
    resultRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [view]);
  const locations = useQuery({
    queryKey: ['finance-locations', actor],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const saved = useQuery({
    queryKey: ['financial-scenarios', actor, page],
    queryFn: ({ signal }) => api.scenarios(page, signal),
  });
  function change(value: ScenarioInput) {
    setInput(value);
    setView(null);
    setSuccess('');
    key.current = crypto.randomUUID();
  }
  async function run(action: 'analyze' | 'save') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result =
        action === 'analyze'
          ? await api.analyzeScenario(input)
          : await api.saveScenario(input, key.current);
      setView(result);
      if (action === 'save') {
        await cache.invalidateQueries({ queryKey: ['financial-scenarios', actor] });
        setSuccess('Đã lưu kịch bản và ảnh chụp dữ liệu nền.');
      }
    } catch (e) {
      setError(financeError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function load(id: string, compare = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.scenario(id);
      if (compare) setComparison(result);
      else {
        setView(result);
        setInput(result.input);
        key.current = crypto.randomUUID();
      }
    } catch (e) {
      setError(financeError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const fields = [
    ['monthlyRent', 'Giá thuê giả định / phòng / tháng (VND)'],
    ['occupancyPercent', 'Tỷ lệ lấp đầy (%)'],
    ['collectionPercent', 'Tỷ lệ thu tiền dự kiến (%)'],
    ['monthlyUtilityServiceCost', 'Điện nước / dịch vụ mỗi tháng (VND)'],
    ['monthlyStaffCost', 'Chi phí Staff mỗi tháng (VND)'],
    ['monthlyMaintenanceCost', 'Bảo trì mỗi tháng (VND)'],
    ['monthlyOtherCost', 'Chi phí khác mỗi tháng (VND)'],
  ] as const;
  return (
    <>
      <PageHeader
        title="Thử kịch bản tài chính"
        subtitle="Thử các giả định và so sánh dự báo mà không thay đổi sổ tài chính thực tế."
      />
      {(busy || locations.isPending || saved.isPending) && <LinearProgress />}
      {(error || locations.error || saved.error) && (
        <Alert
          severity="error"
          action={
            (locations.error || saved.error) && (
              <Button
                onClick={() => {
                  void locations.refetch();
                  void saved.refetch();
                }}
              >
                Thử tải lại
              </Button>
            )
          }
        >
          {error || financeError(locations.error || saved.error)}
        </Alert>
      )}
      {success && <Alert severity="success">{success}</Alert>}
      <Paper variant="outlined" sx={{ p: 1.5, my: 1.5, minWidth: 0 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('analyze');
          }}
        >
          <Stack spacing={1.5}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 750 }}>
              Giả định & kỳ dữ liệu nền
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Kỳ dữ liệu nền dùng số liệu thực tế để đối chiếu; số tháng dự báo xác định khoảng thời
              gian ước tính. Các số tiền và tỷ lệ bên dưới là giả định bạn nhập.
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0,1fr)',
                  sm: 'repeat(2,minmax(0,1fr))',
                  lg: 'repeat(3,minmax(0,1fr))',
                },
                gap: 1.5,
              }}
            >
              <TextField
                required
                label="Tên kịch bản"
                disabled={busy}
                value={input.name}
                slotProps={{ htmlInput: { maxLength: 150 } }}
                onChange={(e) => change({ ...input, name: e.target.value })}
              />
              <OptionPicker
                label="Cơ sở"
                disabled={busy}
                value={input.baseline.locationId || ''}
                options={locations.data ?? []}
                loading={locations.isPending}
                error={!!locations.error}
                emptyLabel="Toàn chuỗi"
                change={(id) =>
                  change({
                    ...input,
                    baseline: { ...input.baseline, locationId: id || undefined },
                  })
                }
              />
              <TextField
                required
                type="number"
                label="Số tháng dự báo"
                disabled={busy}
                value={input.forecastMonths}
                slotProps={{ htmlInput: { min: 1, max: 32767, step: 1 } }}
                onChange={(e) => change({ ...input, forecastMonths: Number(e.target.value) })}
              />
            </Box>
            <Accordion
              variant="outlined"
              disableGutters
              expanded={baselineOpen}
              onChange={(_, open) => {
                if (!open && (!input.baseline.from || !input.baseline.to)) return;
                setBaselineOpen(open);
              }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>
                  Kỳ dữ liệu nền: {displayContractDate(input.baseline.from)} –{' '}
                  {displayContractDate(input.baseline.to)}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    required
                    type="date"
                    label="Dữ liệu nền từ ngày"
                    disabled={busy}
                    value={input.baseline.from}
                    slotProps={{ inputLabel: { shrink: true } }}
                    onChange={(e) =>
                      change({ ...input, baseline: { ...input.baseline, from: e.target.value } })
                    }
                  />
                  <TextField
                    required
                    type="date"
                    label="Dữ liệu nền đến ngày"
                    disabled={busy}
                    value={input.baseline.to}
                    slotProps={{
                      inputLabel: { shrink: true },
                      htmlInput: { min: input.baseline.from },
                    }}
                    onChange={(e) =>
                      change({ ...input, baseline: { ...input.baseline, to: e.target.value } })
                    }
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      const month = financeMonthPeriod(-1);
                      change({ ...input, baseline: { ...input.baseline, ...month } });
                    }}
                    sx={{ alignSelf: 'center', minHeight: { xs: 44, sm: 36 } }}
                  >
                    Chọn tháng trước
                  </Button>
                </Stack>
              </AccordionDetails>
            </Accordion>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0,1fr)',
                  sm: 'repeat(2,minmax(0,1fr))',
                  lg: 'repeat(3,minmax(0,1fr))',
                },
                gap: 1.5,
              }}
            >
              {fields.map(([field, label], index) => (
                <Fragment key={field}>
                  {index === 0 && (
                    <Box sx={{ gridColumn: '1 / -1' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                        Doanh thu và tỷ lệ thu tiền
                      </Typography>
                    </Box>
                  )}
                  {index === 3 && (
                    <Box sx={{ gridColumn: '1 / -1', pt: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                        Chi phí dự kiến
                      </Typography>
                    </Box>
                  )}
                  {!field.endsWith('Percent') ? (
                    <MoneyField
                      required
                      label={label}
                      disabled={busy}
                      value={input.assumptions[field]}
                      maxRawLength={24}
                      onValueChange={(raw) =>
                        change({
                          ...input,
                          assumptions: { ...input.assumptions, [field]: raw },
                        })
                      }
                    />
                  ) : (
                    <TextField
                      required
                      label={label}
                      disabled={busy}
                      value={input.assumptions[field]}
                      slotProps={{
                        htmlInput: {
                          inputMode: 'decimal',
                          pattern: field.endsWith('Percent') ? '[0-9]+([.][0-9]+)?' : '[0-9]+',
                          maxLength: 24,
                        },
                      }}
                      onChange={(e) =>
                        change({
                          ...input,
                          assumptions: { ...input.assumptions, [field]: e.target.value },
                        })
                      }
                    />
                  )}
                </Fragment>
              ))}
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button type="submit" variant="contained" disabled={busy}>
                Phân tích
              </Button>
              <Button
                disabled={busy || !view || !!view.id}
                onClick={() => void run('save')}
                variant="outlined"
              >
                Lưu kịch bản
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {!view
                ? 'Nhấn Phân tích để xem dự báo trước. Nút Lưu kịch bản chỉ dùng được khi đã có kết quả phân tích.'
                : view.id
                  ? 'Đây là kịch bản đã lưu. Nếu thay đổi giả định, hãy Phân tích lại trước khi lưu một kết quả mới.'
                  : 'Kết quả phân tích hiện chưa được lưu. Nhấn Lưu kịch bản để giữ lại giả định và ảnh chụp dữ liệu nền.'}
            </Typography>
          </Stack>
        </form>
      </Paper>
      {view && (
        <Box ref={resultRef} tabIndex={-1} sx={{ mt: 3, scrollMarginTop: 90, outline: 'none' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Kết quả dự kiến
          </Typography>
          <Result title={view.input.name} value={view} />
        </Box>
      )}
      {view && (
        <Button
          onClick={() =>
            downloadFinance(
              JSON.stringify({ current: view, comparison }, null, 2),
              'kich-ban-va-du-lieu-nen.json',
              'application/json',
            )
          }
        >
          Tải kịch bản và ảnh chụp dữ liệu nền
        </Button>
      )}
      {view && comparison && (
        <>
          <Typography variant="h6">So sánh các kết quả máy chủ</Typography>
          {JSON.stringify(view.input.baseline) !== JSON.stringify(comparison.input.baseline) && (
            <Alert severity="warning">
              Hai kịch bản dùng phạm vi hoặc kỳ dữ liệu nền khác nhau. Kiểm tra giả định trước khi
              so sánh.
            </Alert>
          )}
          <OwnerTable
            rows={[
              {
                label: 'Lợi nhuận tháng',
                current: view.result.monthlyProfit,
                other: comparison.result.monthlyProfit,
              },
              {
                label: 'Dòng tiền tháng',
                current: view.result.monthlyNetCashFlow,
                other: comparison.result.monthlyNetCashFlow,
              },
              {
                label: 'Vốn còn lại cuối dự báo',
                current: view.result.remainingCapitalAtEnd,
                other: comparison.result.remainingCapitalAtEnd,
              },
            ]}
            id={(r) => r.label}
            columns={[
              { label: 'Chỉ tiêu', render: (r) => r.label },
              {
                label: `Đang xem: ${view.input.name}`,
                render: (r) =>
                  r.current == null ? 'Chưa xác định' : formatFinanceMoney(r.current),
              },
              {
                label: `Đối chiếu: ${comparison.input.name}`,
                render: (r) => (r.other == null ? 'Chưa xác định' : formatFinanceMoney(r.other)),
              },
            ]}
          />
        </>
      )}
      {comparison && (
        <Box sx={{ my: 2 }}>
          <Button onClick={() => setComparison(null)}>Bỏ so sánh</Button>
          <Result title={`So sánh: ${comparison.input.name}`} value={comparison} />
        </Box>
      )}
      <Accordion variant="outlined" disableGutters sx={{ mt: 1.5 }}>
        <AccordionSummary expandIcon={<ChevronDown size={18} />}>
          <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
            Kịch bản đã lưu{saved.data ? ` (${saved.data.length})` : ''}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {!saved.error && !saved.isPending && saved.data?.length === 0 && (
            <Alert
              severity="info"
              action={
                page > 1 ? <Button onClick={() => setPage(1)}>Về trang đầu</Button> : undefined
              }
            >
              {page > 1
                ? 'Trang này không có kịch bản. Quay về trang đầu để xem các bản đã lưu.'
                : 'Chưa có kịch bản đã lưu. Nhập giả định ở trên, nhấn Phân tích rồi Lưu kịch bản để giữ kết quả.'}
            </Alert>
          )}
          {!saved.error &&
            saved.data?.map((s) => (
              <Paper key={s.id} variant="outlined" sx={{ p: 1.5, my: 1, minWidth: 0 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  useFlexGap
                  spacing={1}
                  sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Typography sx={{ fontWeight: 650 }}>{s.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {s.forecastMonths} tháng
                    </Typography>
                  </Box>
                  <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Button
                      disabled={busy}
                      aria-label={`Xem ${s.name}`}
                      onClick={() => void load(s.id)}
                    >
                      Xem
                    </Button>
                    <Button
                      disabled={busy || !view}
                      aria-label={`So sánh ${s.name}`}
                      onClick={() => void load(s.id, true)}
                    >
                      So sánh
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          <Stack
            direction="row"
            useFlexGap
            spacing={1}
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Button disabled={page === 1 || saved.isFetching} onClick={() => setPage((v) => v - 1)}>
              Trang trước
            </Button>
            <Typography>Trang {page}</Typography>
            <Button
              disabled={!saved.data || saved.data.length < 25 || saved.isFetching}
              onClick={() => setPage((v) => v + 1)}
            >
              Trang sau
            </Button>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </>
  );
}
function Result({ title, value }: { title: string; value: ScenarioView }) {
  const r = value.result;
  const mainFigures = [
    ['Tiền thu dự kiến / tháng', r.monthlyCollections],
    ['Lợi nhuận / tháng', r.monthlyProfit],
    ['Dòng tiền / tháng', r.monthlyNetCashFlow],
  ] as const;
  const otherFigures = [
    ['Doanh thu dự kiến / tháng', r.monthlyRevenue],
    ['OPEX / tháng', r.monthlyOperatingExpenses],
    ['Dòng tiền cả kỳ dự báo', r.forecastNetCashFlow],
    ['Vốn chưa thu hồi cuối dự báo', r.remainingCapitalAtEnd],
    ['Chênh lệch lợi nhuận tháng so với nền', r.monthlyProfitDifference],
  ] as const;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, my: 2, minWidth: 0, overflowWrap: 'anywhere' }}>
      <Typography variant="h2" component="h2">
        {title}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(3,minmax(0,1fr))' },
          gap: 1.5,
          my: 1.5,
        }}
      >
        {mainFigures.map(([label, amount]) => (
          <Typography
            key={label}
            sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', fontWeight: 650 }}
          >
            {label}: {amount === null ? 'Chưa xác định' : formatFinanceMoney(amount)}
          </Typography>
        ))}
      </Box>
      {r.unavailableReason && (
        <Alert severity="info">
          Chưa đủ căn cứ để ước tính hoàn vốn; xem báo cáo dữ liệu nền về vốn, dòng tiền và khoản
          hoàn tiền.
        </Alert>
      )}
      <Accordion variant="outlined" disableGutters sx={{ mt: 1.5 }}>
        <AccordionSummary expandIcon={<ChevronDown size={18} />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Xem đầy đủ kết quả và dữ liệu nền
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {value.baseline.total && (
            <Stack spacing={0.5} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2">
                Dữ liệu thực tế trong kỳ nền {displayContractDate(value.input.baseline.from)} –{' '}
                {displayContractDate(value.input.baseline.to)}
              </Typography>
              <Typography>
                Phát hành kỳ nền: {formatFinanceMoney(value.baseline.total.issued)}
              </Typography>
              <Typography>
                Thu đã xác minh kỳ nền:{' '}
                {formatFinanceMoney(value.baseline.total.verifiedCollections)}
              </Typography>
              <Typography>
                Lợi nhuận kỳ nền: {formatFinanceMoney(value.baseline.total.operatingProfit)}
              </Typography>
            </Stack>
          )}
          <Stack spacing={0.75}>
            {otherFigures.map(([label, amount]) => (
              <Typography key={label} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {label}: {amount === null ? 'Chưa xác định' : formatFinanceMoney(amount)}
              </Typography>
            ))}
            <Typography>
              Ước tính số tháng hoàn vốn còn lại: {r.estimatedRemainingMonths ?? 'Chưa xác định'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Ảnh chụp dữ liệu nền: {formatInstant(value.baseline.snapshotAt)} · Mô hình{' '}
              {value.calculationVersion}
            </Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
