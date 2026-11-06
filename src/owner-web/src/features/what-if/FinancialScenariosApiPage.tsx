import { useRef, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  type ScenarioInput,
  type ScenarioView,
} from '../../../../../packages/client-core/src/finance';
import { formatDraftMoney } from '../../../../../packages/client-core/src/mainDrafts';
import { PageHeader } from '../../components/common/PortalUI';
import { useFinanceApi } from '../expenses/useFinanceApi';

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
      <PageHeader
        title="Phân tích tài chính What-if"
        subtitle="Giả định do Owner nhập; tính toán và lưu kịch bản độc lập với sổ thực tế."
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Ước tính quản trị, giữ nguyên giả định hàng tháng trong kỳ dự báo. Kịch bản không thay đổi
        giá, hợp đồng, hóa đơn, thanh toán hoặc chi phí thực tế. Chọn các tháng trọn vẹn cho dữ liệu
        nền.
      </Alert>
      {(busy || locations.isPending || saved.isPending) && <LinearProgress />}
      {(error || locations.error || saved.error) && (
        <Alert severity="error">{error || financeError(locations.error || saved.error)}</Alert>
      )}
      {success && <Alert severity="success">{success}</Alert>}
      <Paper sx={{ p: 2, my: 2 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('analyze');
          }}
        >
          <Stack spacing={2}>
            <TextField
              required
              label="Tên kịch bản"
              disabled={busy}
              value={input.name}
              slotProps={{ htmlInput: { maxLength: 150 } }}
              onChange={(e) => change({ ...input, name: e.target.value })}
            />
            <TextField
              select
              label="Cơ sở"
              disabled={busy}
              value={input.baseline.locationId || ''}
              onChange={(e) =>
                change({
                  ...input,
                  baseline: { ...input.baseline, locationId: e.target.value || undefined },
                })
              }
            >
              <MenuItem value="">Toàn chuỗi</MenuItem>
              {locations.data?.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.label}
                </MenuItem>
              ))}
            </TextField>
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
            {fields.map(([field, label]) => (
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
            <Stack direction="row" spacing={2}>
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
      {comparison && (
        <Paper sx={{ p: 2, my: 2 }}>
          <Button onClick={() => setComparison(null)}>Bỏ so sánh</Button>
          <Result title={`So sánh: ${comparison.input.name}`} value={comparison} />
        </Paper>
      )}
      <Typography variant="h6">Kịch bản đã lưu</Typography>
      {saved.data?.length === 0 && <Alert severity="info">Chưa có kịch bản ở trang này.</Alert>}
      {saved.data?.map((s) => (
        <Paper key={s.id} sx={{ p: 2, my: 1 }}>
          <Typography>
            {s.name} · {s.forecastMonths} tháng
          </Typography>
          <Button disabled={busy} onClick={() => void load(s.id)}>
            Xem {s.name}
          </Button>
          <Button disabled={busy || !view} onClick={() => void load(s.id, true)}>
            So sánh {s.name}
          </Button>
        </Paper>
      ))}
      <Stack direction="row" spacing={2}>
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
    <Paper sx={{ p: 2, my: 2 }}>
      <Typography variant="h6">{title}</Typography>
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
        <Typography key={label}>
          {label}: {amount === null ? 'Chưa xác định' : formatDraftMoney(amount)}
        </Typography>
      ))}
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
        Dữ liệu nền: {value.baseline.snapshotAt} · Mô hình {value.calculationVersion}
      </Typography>
    </Paper>
  );
}
