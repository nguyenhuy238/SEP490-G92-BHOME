import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { financeError } from '../../../../../packages/client-core/src/finance';
import { MoneyField } from '../../components/common/MoneyField';
import { todayVietnam, salaryTypeLabel, salaryRateUnit } from '../staff/staffContracts';
import { invalidateFinance } from '../finance/invalidateFinance';
import { managementMoney } from '../finance/managementMoney';
import { useFinanceApi } from './useFinanceApi';

export function StaffCostDialog({ close }: { close: () => void }) {
  const api = useFinanceApi();
  const client = useQueryClient();
  const { session } = useAuth();
  const [month, setMonth] = useState(() => todayVietnam().slice(0, 7));
  const [employmentId, setEmploymentId] = useState('');
  const [category, setCategory] = useState('Lương');
  const [total, setTotal] = useState('');
  const [shares, setShares] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string[] | null>(null);
  const lock = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const period = month + '-01';
  const validPeriod =
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
    month <= todayVietnam().slice(0, 7) &&
    month >= '0001-01';
  const candidates = useQuery({
    queryKey: ['staff-costs', session?.userId, period],
    queryFn: ({ signal }) => api.staffCosts(period, signal),
    enabled: validPeriod,
  });
  const candidate = candidates.data?.find((item) => item.employmentId === employmentId);
  const allocated =
    candidate?.locations.reduce(
      (sum, location) => sum + BigInt(shares[location.locationId] || '0'),
      0n,
    ) ?? 0n;
  const valid =
    !!candidate &&
    validPeriod &&
    !candidates.isError &&
    !created &&
    !!total &&
    BigInt(total) > 0n &&
    allocated === BigInt(total) &&
    !!note.trim() &&
    confirmed &&
    !(category === 'Lương' && candidate.recorded);
  async function save() {
    if (!valid || lock.current || !candidate) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const input = {
      employmentId,
      period,
      category,
      total,
      note: note.trim(),
      shares: candidate.locations
        .filter((l) => BigInt(shares[l.locationId] || '0') > 0n)
        .map((l) => ({ locationId: l.locationId, amount: shares[l.locationId] })),
    };
    try {
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      const ids = await api.recordStaffCost(input, attempt.current.key);
      setCreated(ids);
      await Promise.all([
        invalidateFinance(client, session?.userId),
        client.invalidateQueries({ queryKey: ['staff-costs', session?.userId] }),
      ]);
    } catch (e) {
      setError(financeError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) close();
      }}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Ghi nhận và phân bổ chi phí nhân viên</DialogTitle>
      <DialogContent>
        {created ? (
          <Stack spacing={1} sx={{ pt: 1 }}>
            <Alert severity="success">
              Đã ghi nhận {created.length} khoản chi theo phân bổ. Trạng thái thanh toán chưa được
              xác nhận.
            </Alert>
            <Typography variant="body2">
              Mở từng khoản chi để bổ sung chứng từ, hạn thanh toán và xác nhận thực chi.
            </Typography>
            {created.map((id, index) => (
              <Button
                key={id}
                component={Link}
                to={`/expenses?expenseId=${encodeURIComponent(id)}`}
                variant="outlined"
              >
                Mở khoản chi {index + 1}
              </Button>
            ))}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              type="month"
              label="Kỳ chi phí"
              value={month}
              disabled={busy}
              onChange={(e) => {
                setMonth(e.target.value);
                setEmploymentId('');
                setShares({});
                setTotal('');
                setConfirmed(false);
              }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: todayVietnam().slice(0, 7) },
              }}
            />
            {!validPeriod && (
              <Alert severity="warning">Chọn kỳ chi phí hợp lệ, không ở tương lai.</Alert>
            )}
            {validPeriod && candidates.isPending && <LinearProgress />}
            {candidates.isError && (
              <Alert
                severity="error"
                action={<Button onClick={() => void candidates.refetch()}>Thử lại</Button>}
              >
                {financeError(candidates.error)}
              </Alert>
            )}
            {!candidates.isPending && !candidates.isError && !candidates.data?.length && (
              <Alert severity="info">Không có hợp đồng nhân viên phù hợp trong kỳ.</Alert>
            )}
            <TextField
              select
              label="Nhân viên / hợp đồng"
              value={employmentId}
              disabled={busy || !validPeriod || candidates.isPending || candidates.isError}
              onChange={(e) => {
                const chosen = candidates.data?.find(
                  (item) => item.employmentId === e.target.value,
                );
                setEmploymentId(e.target.value);
                const rate =
                  category === 'Lương' &&
                  chosen?.salaryType === 'Monthly' &&
                  /^\d{1,18}$/.test(chosen?.baseRate ?? '')
                    ? chosen!.baseRate!
                    : '';
                setTotal(rate);
                setShares(
                  chosen?.locations.length === 1 && rate
                    ? { [chosen.locations[0].locationId]: rate }
                    : {},
                );
                setConfirmed(false);
              }}
            >
              <MenuItem value="">Chọn nhân viên</MenuItem>
              {candidates.data?.map((item) => (
                <MenuItem key={item.employmentId} value={item.employmentId}>
                  {item.staffName} · {item.startDate}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Loại chi phí"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setTotal('');
                setShares({});
                setConfirmed(false);
              }}
              disabled={busy}
            >
              {['Lương', 'Thưởng', 'Phụ cấp', 'Chi phí nhân sự khác'].map((item) => (
                <MenuItem key={item} value={item}>
                  {item}
                </MenuItem>
              ))}
            </TextField>
            {candidate && (
              <>
                <Typography variant="body2">
                  Mức lương hợp đồng: {managementMoney(candidate.baseRate)}
                  {salaryRateUnit(candidate.salaryType).replace('VND', '')} ·{' '}
                  {salaryTypeLabel(candidate.salaryType)}. Xác nhận số thực tế của kỳ trước khi phân
                  bổ.
                </Typography>
                {candidate.recorded && category === 'Lương' && (
                  <Alert severity="info">Đã ghi nhận lương của nhân viên trong kỳ.</Alert>
                )}
                {!candidate.locations.length && (
                  <Alert severity="warning">Nhân viên chưa có cơ sở được phân công trong kỳ.</Alert>
                )}
                <MoneyField
                  label="Tổng chi phí (đ)"
                  value={total}
                  onValueChange={(value) => {
                    setTotal(value);
                    setConfirmed(false);
                  }}
                  disabled={busy}
                  maxRawLength={18}
                />
                {candidate.locations.map((location) => (
                  <MoneyField
                    key={location.locationId}
                    label={location.locationName + ' (đ)'}
                    value={shares[location.locationId] ?? ''}
                    onValueChange={(value) => {
                      setShares((previous) => ({ ...previous, [location.locationId]: value }));
                      setConfirmed(false);
                    }}
                    disabled={busy}
                    maxRawLength={18}
                  />
                ))}
                <Typography>Đã phân bổ: {managementMoney(allocated.toString())}</Typography>
                {total && allocated !== BigInt(total) && (
                  <Alert severity="warning">Tổng phân bổ phải bằng tổng chi phí.</Alert>
                )}
                <TextField
                  label="Căn cứ ghi nhận"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setConfirmed(false);
                  }}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 1000 } }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={busy}
                    />
                  }
                  label="Tôi xác nhận tổng chi phí và phân bổ trên."
                />
              </>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          Đóng
        </Button>
        {!created && (
          <Button
            variant="contained"
            disabled={busy || !valid || candidates.isFetching}
            onClick={() => void save()}
          >
            Ghi nhận chi phí
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
