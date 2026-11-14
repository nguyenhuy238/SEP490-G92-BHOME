import { useEffect, useRef, useState } from 'react';
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
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { OwnerTable } from '../../components/common/OwnerWorkspace';
import { downloadFinance } from '../../services/financeExport';
import { financeMonthPeriod } from '../finance/monthPeriods';

const initial: ScenarioInput = {
  name: '',
  baseline: { from: '', to: '' },
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
    const result = resultRef.current;
    result.focus({ preventScroll: true });
    if (typeof result.scrollIntoView === 'function') {
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
        title="Phân tích tài chính What-if"
        subtitle="Thử các giả định tài chính, xem kết quả dự kiến rồi lưu kịch bản để so sánh."
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Ước tính quản trị, giữ nguyên giả định hàng tháng trong kỳ dự báo. Kịch bản không thay đổi
        giá, hợp đồng, hóa đơn, thanh toán hoặc chi phí thực tế. Chọn các tháng trọn vẹn cho dữ liệu
        nền.
      </Alert>
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
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2.5 }, my: 2, borderRadius: 2 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('analyze');
          }}
        >
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                1. Thông tin & kỳ dữ liệu nền
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Chọn thời gian thực tế để làm cơ sở ước tính. Kết quả được tính trên máy chủ.
              </Typography>
            </Box>
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
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                disabled={busy}
                onClick={() => {
                  const month = financeMonthPeriod(-1);
                  change({ ...input, baseline: { ...input.baseline, ...month } });
                }}
              >
                Dùng tháng trước làm kỳ nền
              </Button>
              <Typography variant="caption" color="text.secondary">
                Chọn nhanh một tháng đã hoàn tất hoặc tự nhập thời gian bên dưới.
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
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
              <TextField
                required
                type="number"
                label="Số tháng dự báo"
                disabled={busy}
                value={input.forecastMonths}
                slotProps={{ htmlInput: { min: 1, max: 32767, step: 1 } }}
                onChange={(e) => change({ ...input, forecastMonths: Number(e.target.value) })}
              />
            </Stack>
            <Box sx={{ pt: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                2. Dự kiến tiền thu hàng tháng
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Nhập giá thuê trung bình và tỷ lệ phòng có người ở, tỷ lệ thu được tiền.
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              {fields.slice(0, 3).map(([field, label]) => (
                <TextField
                  key={field}
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
              ))}
            </Box>
            <Box sx={{ pt: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                3. Chi phí dự kiến mỗi tháng
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Nhập 0 nếu khoản chi không phát sinh. Các số liệu này chỉ dùng để tính thử kịch bản.
              </Typography>
            </Box>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}
            >
              {fields.slice(3).map(([field, label]) => (
                <TextField
                  key={field}
                  required
                  label={label}
                  disabled={busy}
                  value={input.assumptions[field]}
                  slotProps={{
                    htmlInput: { inputMode: 'numeric', pattern: '[0-9]+', maxLength: 24 },
                  }}
                  onChange={(e) =>
                    change({
                      ...input,
                      assumptions: { ...input.assumptions, [field]: e.target.value },
                    })
                  }
                />
              ))}
            </Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ pt: 1, alignItems: { sm: 'center' } }}
            >
              <Button type="submit" variant="contained" disabled={busy}>
                Phân tích
              </Button>
              <Button
                variant="outlined"
                disabled={busy || !view || !!view.id}
                onClick={() => void run('save')}
              >
                Lưu kịch bản
              </Button>
              <Typography variant="caption" color="text.secondary">
                Phân tích trước, sau đó lưu kết quả khi đã kiểm tra.
              </Typography>
            </Stack>
          </Stack>
        </form>
      </Paper>
      {view && (
        <Box ref={resultRef} tabIndex={-1} sx={{ mt: 3, scrollMarginTop: 92, outline: 'none' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            4. Kết quả dự kiến
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
        <Paper sx={{ p: 2, my: 2 }}>
          <Button onClick={() => setComparison(null)}>Bỏ so sánh</Button>
          <Result title={`So sánh: ${comparison.input.name}`} value={comparison} />
        </Paper>
      )}
      <Typography variant="h6" sx={{ mt: 3 }}>
        Kịch bản đã lưu
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Mở kịch bản để xem lại hoặc chọn so sánh với kết quả đang hiển thị.
      </Typography>
      {!saved.error && !saved.isPending && saved.data?.length === 0 && (
        <Alert severity="info">Chưa có kịch bản ở trang này.</Alert>
      )}
      {!saved.error &&
        saved.data?.map((s) => (
          <Paper key={s.id} variant="outlined" sx={{ p: 2, my: 1, borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {s.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Dự báo {s.forecastMonths} tháng
                </Typography>
              </Box>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={busy}
                  onClick={() => void load(s.id)}
                >
                  Xem {s.name}
                </Button>
                <Button size="small" disabled={busy || !view} onClick={() => void load(s.id, true)}>
                  So sánh {s.name}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'center', mt: 1.5 }}
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
    </>
  );
}
function Result({ title, value }: { title: string; value: ScenarioView }) {
  const r = value.result;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, my: 2, borderRadius: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 750 }}>
        {title}
      </Typography>
      {value.baseline.total && (
        <Stack spacing={0.5} sx={{ my: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
          <Typography variant="subtitle2">
            Dữ liệu thực tế trong kỳ nền {displayContractDate(value.input.baseline.from)} –{' '}
            {displayContractDate(value.input.baseline.to)}
          </Typography>
          <Typography>
            Phát hành kỳ nền: {formatFinanceMoney(value.baseline.total.issued)}
          </Typography>
          <Typography>
            Thu đã xác minh kỳ nền: {formatFinanceMoney(value.baseline.total.verifiedCollections)}
          </Typography>
          <Typography>
            Lợi nhuận kỳ nền: {formatFinanceMoney(value.baseline.total.operatingProfit)}
          </Typography>
        </Stack>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
          gap: 1.5,
          my: 2,
        }}
      >
        {(
          [
            ['Doanh thu dự kiến / tháng', r.monthlyRevenue],
            ['Tiền thu dự kiến / tháng', r.monthlyCollections],
            ['OPEX / tháng', r.monthlyOperatingExpenses],
            ['Lợi nhuận / tháng', r.monthlyProfit],
            ['Dòng tiền / tháng', r.monthlyNetCashFlow],
            ['Dòng tiền cả kỳ dự báo', r.forecastNetCashFlow],
            ['Vốn chưa thu hồi cuối dự báo', r.remainingCapitalAtEnd],
            ['Chênh lệch lợi nhuận tháng so với nền', r.monthlyProfitDifference],
          ] as const
        ).map(([label, amount]) => (
          <Box key={label} sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {label}: {amount === null ? 'Chưa xác định' : formatFinanceMoney(amount)}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography>
        Ước tính số tháng hoàn vốn còn lại: {r.estimatedRemainingMonths ?? 'Chưa xác định'}
      </Typography>
      {r.unavailableReason && (
        <Alert severity="info">
          Chưa đủ căn cứ để ước tính hoàn vốn; xem báo cáo dữ liệu nền về vốn, dòng tiền và khoản
          hoàn tiền.
        </Alert>
      )}
      <Typography variant="caption">
        Ảnh chụp dữ liệu nền: {formatInstant(value.baseline.snapshotAt)} · Mô hình{' '}
        {value.calculationVersion}
      </Typography>
    </Paper>
  );
}
