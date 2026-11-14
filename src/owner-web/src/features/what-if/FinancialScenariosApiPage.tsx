import { useRef, useState } from 'react';
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
import { MoneyField } from '../../components/common/MoneyField';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useFinanceApi } from '../expenses/useFinanceApi';
import { OwnerTable } from '../../components/common/OwnerWorkspace';
import { downloadFinance } from '../../services/financeExport';

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
      <PageHeader title="Phân tích tài chính What-if" />
      <Alert severity="info" sx={{ mb: 2 }}>
        Ước tính quản trị từ giả định hàng tháng. Kịch bản không thay đổi dữ liệu thực tế. Chọn các
        tháng trọn vẹn cho dữ liệu nền.
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
      <Paper variant="outlined" sx={{ p: 1.5, my: 2, minWidth: 0 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('analyze');
          }}
        >
          <Stack spacing={1.5}>
            <Typography variant="h2" component="h2">
              Thiết lập kịch bản
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
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
            </Box>
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
            <Typography variant="h6">Giả định hàng tháng</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
                gap: 1.5,
              }}
            >
              {fields.map(([field, label]) =>
                !field.endsWith('Percent') ? (
                  <MoneyField
                    key={field}
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
                ),
              )}
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button type="submit" variant="contained" disabled={busy}>
                Phân tích
              </Button>
              <Button disabled={busy || !view || !!view.id} onClick={() => void run('save')}>
                Lưu kịch bản
              </Button>
            </Stack>
          </Stack>
        </form>
      </Paper>
      {view && <Result title={view.input.name} value={view} />}
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
      <Typography variant="h6">Kịch bản đã lưu</Typography>
      {!saved.error && !saved.isPending && saved.data?.length === 0 && (
        <Alert severity="info">Chưa có kịch bản ở trang này.</Alert>
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
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
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
    <Paper variant="outlined" sx={{ p: 1.5, my: 2, minWidth: 0, overflowWrap: 'anywhere' }}>
      <Typography variant="h2" component="h2">
        {title}
      </Typography>
      {value.baseline.total && (
        <Stack
          spacing={0.5}
          sx={{ my: 1.5, p: 1.5, bgcolor: 'background.default', borderRadius: 1 }}
        >
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
          gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
          gap: 1,
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
          <Typography
            key={label}
            sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
          >
            {label}: {amount === null ? 'Chưa xác định' : formatFinanceMoney(amount)}
          </Typography>
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
