import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
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
import {
  financeError,
  type DepreciationInput,
  type Expense,
} from '../../../../../packages/client-core/src/finance';
import { MoneyField } from '../../components/common/MoneyField';
import { todayVietnam } from '../staff/staffContracts';
import { invalidateFinance } from '../finance/invalidateFinance';
import { managementMoney } from '../finance/managementMoney';
import { useFinanceApi } from './useFinanceApi';
import { AssetReplacementPanel } from './AssetReplacementPanel';

const paymentStatus = {
  Unknown: 'Chưa rõ tình trạng',
  Paid: 'Đã thanh toán',
  Unpaid: 'Chưa thanh toán',
  PartiallyPaid: 'Thanh toán một phần',
};

export function ExpenseFinanceActions({
  expense,
  onChanged,
  disabled = false,
  onBusyChange,
}: {
  expense: Expense;
  onChanged: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const api = useFinanceApi();
  const client = useQueryClient();
  const { session } = useAuth();
  const actor = session?.userId;
  const payments = useQuery({
    queryKey: ['expense-payments', actor, expense.id],
    queryFn: ({ signal }) => api.expensePayments(expense.id, signal),
  });
  const depreciation = useQuery({
    queryKey: ['expense-depreciation', actor, expense.id],
    queryFn: ({ signal }) => api.depreciation(expense.id, signal),
    enabled: expense.expenseType === 'INITIAL_INVESTMENT',
  });
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayVietnam);
  const [note, setNote] = useState('');
  const [confirmedPayment, setConfirmedPayment] = useState<string | null>(null);
  const [writing, setBusy] = useState(false);
  const busy = writing || disabled;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dueDraft, setDueDraft] = useState<{
    date: string;
    note: string;
    confirmed: boolean;
    version: number;
  } | null>(null);
  const [plan, setPlan] = useState<DepreciationInput | null>(null);
  const [disposalOpen, setDisposalOpen] = useState(false);
  const [disposalQuantity, setDisposalQuantity] = useState('');
  const [receiptSaleKey, setReceiptSaleKey] = useState<string | null>(null);
  const [disposalAmount, setDisposalAmount] = useState('');
  const [disposalDate, setDisposalDate] = useState(todayVietnam);
  const [disposalNote, setDisposalNote] = useState('');
  const [confirmedDisposal, setConfirmedDisposal] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function write(fingerprint: string, action: (key: string) => Promise<unknown>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setConflict(false);
    setNotice('');
    try {
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      await action(attempt.current.key);
      attempt.current = null;
      setConfirmedPayment(null);
      setAmount('');
      setNote('');
      setPlan(null);
      setDueDraft(null);
      setDisposalOpen(false);
      setDisposalQuantity('');
      setReceiptSaleKey(null);
      setDisposalAmount('');
      setDisposalNote('');
      setDisposalConfirmed(false);
      await Promise.all([
        invalidateFinance(client, actor, expense.locationId),
        payments.refetch(),
        ...(expense.expenseType === 'INITIAL_INVESTMENT' ? [depreciation.refetch()] : []),
      ]);
      setNotice('Đã ghi nhận thông tin tài chính.');
      onChanged();
    } catch (e) {
      setError(financeError(e));
      setConflict((e as { status?: number })?.status === 409);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  const payment = payments.data;
  const paymentFingerprint = JSON.stringify([payment?.version, amount, paidOn, note]);
  const confirmed = confirmedPayment === paymentFingerprint;
  const lot = depreciation.data;
  const disposalFingerprint = JSON.stringify([
    lot?.version,
    disposalQuantity,
    receiptSaleKey,
    disposalAmount,
    disposalDate,
    disposalNote,
  ]);
  const disposalConfirmed = confirmedDisposal === disposalFingerprint;
  function setDisposalConfirmed(value: boolean) {
    setConfirmedDisposal(value ? disposalFingerprint : null);
  }
  const partialSale = lot?.partialDisposals?.find((s) => s.sale.key === receiptSaleKey);
  const receiptSale = receiptSaleKey ? partialSale?.sale : lot?.disposal;
  const receiptOutstanding = receiptSaleKey ? partialSale?.outstanding : lot?.disposalOutstanding;
  const remainingQuantity = lot?.remainingQuantity ?? (lot?.disposal ? 0 : lot?.quantity);
  function confirmPayment(unpaid = false) {
    if (!payment || !confirmed || !note.trim() || conflict) return;
    const input = {
      amount: unpaid ? '0' : amount,
      paidOn: unpaid ? null : paidOn,
      expectedVersion: payment.version,
      note: note.trim(),
    };
    if (
      !unpaid &&
      (!/^\d+$/.test(amount) ||
        BigInt(amount) <= 0n ||
        BigInt(amount) > BigInt(payment.remainingAmount ?? payment.amount) ||
        !paidOn ||
        paidOn > todayVietnam())
    ) {
      setError('Kiểm tra số tiền còn phải trả và ngày thanh toán.');
      return;
    }
    void write(JSON.stringify(input), (key) => api.recordExpensePayment(expense.id, input, key));
  }
  return (
    <Stack spacing={1.5} sx={{ mt: 2 }}>
      <Divider />
      <Typography variant="h6">Thanh toán khoản chi</Typography>
      {payments.isPending && <LinearProgress />}
      {payments.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void payments.refetch()}>Thử lại</Button>}
        >
          {financeError(payments.error)}
        </Alert>
      )}
      {payment && !payments.isError && (
        <>
          <Typography>
            {paymentStatus[payment.status]} · Đã chi: {managementMoney(payment.paidAmount)} · Còn
            phải trả: {managementMoney(payment.remainingAmount)}
          </Typography>
          <Typography variant="body2">
            Hạn thanh toán: {payment.dueOn ?? 'Chưa xác định'} ·{' '}
            {
              {
                Unknown: 'Chưa xác định tình trạng đến hạn',
                Paid: 'Đã thanh toán',
                Overdue: 'Quá hạn',
                DueToday: 'Đến hạn hôm nay',
                NotDue: 'Chưa đến hạn',
              }[payment.dueStatus ?? 'Unknown']
            }
          </Typography>
          {(payment.dueHistory ?? []).map((event) => (
            <Typography key={event.key} variant="caption" color="text.secondary">
              {event.recordedAt} · Hạn: {event.input.dueOn ?? 'Bỏ hạn đã ghi nhận'} ·{' '}
              {event.input.note}
            </Typography>
          ))}
          {!dueDraft ? (
            <Button
              size="small"
              disabled={busy || payments.isFetching}
              onClick={() =>
                setDueDraft({
                  date: payment.dueOn ?? '',
                  note: '',
                  confirmed: false,
                  version: payment.version,
                })
              }
            >
              Cập nhật hạn thanh toán
            </Button>
          ) : (
            <Stack spacing={1}>
              <TextField
                label="Hạn thanh toán"
                type="date"
                value={dueDraft.date}
                disabled={busy}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: expense.occurredOn } }}
                onChange={(e) =>
                  setDueDraft({ ...dueDraft, date: e.target.value, confirmed: false })
                }
              />
              <TextField
                label="Lý do cập nhật hạn"
                value={dueDraft.note}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
                onChange={(e) =>
                  setDueDraft({ ...dueDraft, note: e.target.value, confirmed: false })
                }
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={dueDraft.confirmed}
                    disabled={busy}
                    onChange={(e) => setDueDraft({ ...dueDraft, confirmed: e.target.checked })}
                  />
                }
                label="Xác nhận thay đổi hạn thanh toán (để trống nếu chưa xác định)."
              />
              <Stack direction="row" spacing={1}>
                <Button disabled={busy} onClick={() => setDueDraft(null)}>
                  Hủy
                </Button>
                <Button
                  variant="contained"
                  disabled={
                    busy ||
                    payments.isFetching ||
                    !dueDraft.confirmed ||
                    !dueDraft.note.trim() ||
                    (!!dueDraft.date && dueDraft.date < expense.occurredOn)
                  }
                  onClick={() => {
                    const input = {
                      dueOn: dueDraft.date || null,
                      expectedVersion: dueDraft.version,
                      note: dueDraft.note.trim(),
                    };
                    void write('due:' + JSON.stringify(input), (key) =>
                      api.setExpenseDueDate(expense.id, input, key),
                    );
                  }}
                >
                  Lưu hạn thanh toán
                </Button>
              </Stack>
            </Stack>
          )}
          {payment.events.map((event) => (
            <Typography key={event.key} variant="body2" color="text.secondary">
              {event.paidOn ?? 'Xác nhận chưa chi'} · {managementMoney(event.amount)} · {event.note}
            </Typography>
          ))}
          {payment.status !== 'Paid' && (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <MoneyField
                  label="Số tiền đã chuyển (đ)"
                  value={amount}
                  onValueChange={setAmount}
                  disabled={busy}
                  maxRawLength={18}
                  fullWidth
                />
                <TextField
                  label="Ngày thực chi"
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayVietnam() } }}
                  disabled={busy}
                  fullWidth
                />
              </Stack>
              <Button
                size="small"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => setAmount(payment.remainingAmount ?? payment.amount)}
                disabled={busy}
              >
                Điền toàn bộ số còn phải trả
              </Button>
              <TextField
                label="Ghi chú xác nhận / chứng từ"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={confirmed}
                    onChange={(e) =>
                      setConfirmedPayment(e.target.checked ? paymentFingerprint : null)
                    }
                    disabled={busy}
                  />
                }
                label="Tôi xác nhận thông tin thanh toán đúng thực tế."
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  disabled={
                    busy || conflict || !confirmed || !note.trim() || !amount || payments.isFetching
                  }
                  onClick={() => confirmPayment()}
                >
                  Ghi nhận thực chi
                </Button>
                {payment.status === 'Unknown' && (
                  <Button
                    variant="outlined"
                    disabled={busy || conflict || !confirmed || !note.trim() || payments.isFetching}
                    onClick={() => confirmPayment(true)}
                  >
                    Xác nhận chưa thanh toán
                  </Button>
                )}
              </Stack>
            </>
          )}
        </>
      )}
      {expense.expenseType === 'INITIAL_INVESTMENT' && (
        <>
          <Divider />
          <Typography variant="h6">Khấu hao lô đầu tư</Typography>
          {depreciation.isPending && <LinearProgress />}
          {depreciation.isError && (
            <Alert
              severity="error"
              action={<Button onClick={() => void depreciation.refetch()}>Thử lại</Button>}
            >
              {financeError(depreciation.error)}
            </Alert>
          )}
          {lot && !depreciation.isError && (
            <>
              <Typography variant="body2">
                Nguyên giá: {managementMoney(lot.cost)} · Khấu hao tháng:{' '}
                {managementMoney(lot.amounts?.monthly)} · Lũy kế:{' '}
                {managementMoney(lot.amounts?.accumulated)} · Còn lại:{' '}
                {managementMoney(lot.amounts?.carryingValue)}
              </Typography>
              {lot.revisions.map((revision) => (
                <Typography key={revision.key} variant="body2" color="text.secondary">
                  Hiệu lực {revision.effectiveFrom} ·{' '}
                  {revision.plan.usefulLifeMonths ?? 'Không khấu hao'}{' '}
                  {revision.plan.usefulLifeMonths ? 'tháng' : ''} · {revision.plan.note}
                </Typography>
              ))}
              {!plan && !lot.disposal && !disposalOpen && (
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => {
                    const previous = lot.revisions.at(-1)?.plan;
                    setPlan(
                      previous
                        ? {
                            ...previous,
                            effectiveFrom: null,
                            expectedVersion: lot.version,
                            note: '',
                          }
                        : {
                            kind: 'Equipment',
                            inServiceOn: lot.purchasedOn,
                            usefulLifeMonths: null,
                            salvageValue: '0',
                            effectiveFrom: null,
                            retiredOn: null,
                            expectedVersion: lot.version,
                            note: '',
                          },
                    );
                  }}
                >
                  {lot.revisions.length ? 'Điều chỉnh cho kỳ sau' : 'Thiết lập khấu hao'}
                </Button>
              )}
              {plan && !lot.disposal && (
                <>
                  <TextField
                    select
                    label="Loại khoản đầu tư"
                    value={plan.kind}
                    disabled={busy || lot.revisions.length > 0}
                    onChange={(e) => {
                      const kind = e.target.value as DepreciationInput['kind'];
                      setPlan({ ...plan, kind, usefulLifeMonths: null, salvageValue: '0' });
                    }}
                  >
                    <MenuItem value="Equipment">Thiết bị / nội thất</MenuItem>
                    <MenuItem value="Building">Công trình</MenuItem>
                    <MenuItem value="Land">Đất (không khấu hao)</MenuItem>
                    <MenuItem value="NonDepreciable">Khoản không khấu hao</MenuItem>
                  </TextField>
                  <TextField
                    label="Ngày đưa vào sử dụng"
                    type="date"
                    value={plan.inServiceOn}
                    disabled={busy || lot.revisions.length > 0}
                    onChange={(e) => setPlan({ ...plan, inServiceOn: e.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  {(plan.kind === 'Building' || plan.kind === 'Equipment') && (
                    <>
                      <TextField
                        label="Thời gian sử dụng dự kiến (tháng)"
                        type="number"
                        value={plan.usefulLifeMonths ?? ''}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            usefulLifeMonths: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={busy}
                        slotProps={{ htmlInput: { min: 1, max: 1200, step: 1 } }}
                      />
                      <MoneyField
                        label="Giá trị thu hồi dự kiến (đ)"
                        value={plan.salvageValue}
                        onValueChange={(value) => setPlan({ ...plan, salvageValue: value })}
                        disabled={busy}
                        maxRawLength={18}
                      />
                    </>
                  )}
                  {lot.revisions.length > 0 && (
                    <TextField
                      label="Hiệu lực điều chỉnh (ngày 1 của tháng tương lai)"
                      type="date"
                      value={plan.effectiveFrom ?? ''}
                      onChange={(e) => setPlan({ ...plan, effectiveFrom: e.target.value || null })}
                      slotProps={{ inputLabel: { shrink: true } }}
                      disabled={busy}
                    />
                  )}
                  <TextField
                    label="Ngày ngừng sử dụng (nếu có)"
                    type="date"
                    value={plan.retiredOn ?? ''}
                    onChange={(e) => setPlan({ ...plan, retiredOn: e.target.value || null })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    disabled={busy}
                  />
                  <TextField
                    label="Lý do / căn cứ"
                    value={plan.note}
                    onChange={(e) => setPlan({ ...plan, note: e.target.value })}
                    disabled={busy}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button disabled={busy} onClick={() => setPlan(null)}>
                      Hủy
                    </Button>
                    <Button
                      variant="contained"
                      disabled={
                        busy ||
                        !plan.note.trim() ||
                        !plan.inServiceOn ||
                        (lot.revisions.length > 0 && !plan.effectiveFrom) ||
                        ((plan.kind === 'Building' || plan.kind === 'Equipment') &&
                          (!plan.usefulLifeMonths || !plan.salvageValue))
                      }
                      onClick={() =>
                        void write(JSON.stringify(plan), (key) =>
                          api.recordDepreciation(expense.id, plan, key),
                        )
                      }
                    >
                      Xác nhận cấu hình
                    </Button>
                  </Stack>
                </>
              )}
              <Divider />
              <Typography variant="h6">Thanh lý lô đầu tư</Typography>
              <Typography variant="body2">
                Số lượng ban đầu: {lot.quantity ?? 'Chưa xác định'} · Còn lại trong sổ vốn:{' '}
                {remainingQuantity ?? 'Chưa xác định'}
              </Typography>
              {lot.assetId && (
                <Alert severity="info">
                  Số lượng trong sổ vốn không thay thế kết quả kiểm kê vật lý. Thanh lý tại đây
                  không sửa số lượng bàn giao, hợp đồng hoặc kiểm kê.
                  <Button
                    component={Link}
                    to={`/locations/${lot.locationId}/assets?tab=review`}
                    size="small"
                  >
                    Đối chiếu kiểm kê cơ sở
                  </Button>
                </Alert>
              )}
              {lot.assetId && <AssetReplacementPanel expenseId={expense.id} />}
              {(lot.partialDisposals ?? []).map((sale) => (
                <Stack
                  key={sale.sale.key}
                  spacing={0.5}
                  sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}
                >
                  <Typography variant="body2">
                    Thanh lý {sale.sale.input.quantity} đơn vị ngày {sale.sale.input.disposedOn} ·
                    Giá bán: {managementMoney(sale.sale.input.saleAmount)}
                  </Typography>
                  {sale.sale.recognizedOn &&
                    sale.sale.recognizedOn !== sale.sale.input.disposedOn && (
                      <Typography variant="caption">
                        Ghi nhận vào sổ vốn từ {sale.sale.recognizedOn}; không sửa khấu hao kỳ
                        trước.
                      </Typography>
                    )}
                  <Typography variant="body2">
                    Đã thực thu: {managementMoney(sale.received)} · Còn phải thu:{' '}
                    {managementMoney(sale.outstanding)}
                  </Typography>
                  {(lot.receipts ?? [])
                    .filter((r) => r.input.disposalKey === sale.sale.key)
                    .map((receipt) => (
                      <Typography key={receipt.key} variant="caption">
                        {receipt.input.receivedOn} · {managementMoney(receipt.input.amount)} ·{' '}
                        {receipt.input.note}
                      </Typography>
                    ))}
                  {!plan && !disposalOpen && BigInt(sale.outstanding) > 0n && (
                    <Button
                      size="small"
                      disabled={busy || depreciation.isFetching}
                      onClick={() => {
                        setReceiptSaleKey(sale.sale.key);
                        setDisposalConfirmed(false);
                        setDisposalNote('');
                        setDisposalDate(todayVietnam());
                        setDisposalAmount(sale.outstanding);
                        setDisposalOpen(true);
                      }}
                    >
                      Xác nhận thực thu lần thanh lý {sale.sale.input.disposedOn} (
                      {sale.sale.input.quantity} đơn vị)
                    </Button>
                  )}
                </Stack>
              ))}
              {lot.disposal && (
                <>
                  <Typography>
                    Đã thanh lý ngày {lot.disposal.input.disposedOn} · Giá bán:{' '}
                    {managementMoney(lot.disposal.input.saleAmount)}
                  </Typography>
                  {lot.disposal.recognizedOn &&
                    lot.disposal.recognizedOn !== lot.disposal.input.disposedOn && (
                      <Typography variant="caption">
                        Ghi nhận vào sổ vốn từ {lot.disposal.recognizedOn}; không sửa khấu hao kỳ
                        trước.
                      </Typography>
                    )}
                  <Typography>
                    Đã thực thu: {managementMoney(lot.disposalReceived)} · Còn phải thu:{' '}
                    {managementMoney(lot.disposalOutstanding)}
                  </Typography>
                  {(lot.receipts ?? [])
                    .filter((r) => !r.input.disposalKey)
                    .map((receipt) => (
                      <Typography key={receipt.key} variant="body2">
                        {receipt.input.receivedOn} · {managementMoney(receipt.input.amount)} ·{' '}
                        {receipt.input.note}
                      </Typography>
                    ))}
                </>
              )}
              {!plan &&
                !disposalOpen &&
                (lot.disposal
                  ? lot.disposalOutstanding != null && BigInt(lot.disposalOutstanding) > 0n
                  : lot.revisions.length > 0) && (
                  <Button
                    variant="outlined"
                    disabled={busy || depreciation.isFetching}
                    onClick={() => {
                      setReceiptSaleKey(null);
                      setDisposalConfirmed(false);
                      setDisposalNote('');
                      setDisposalQuantity(
                        remainingQuantity == null ? '' : String(remainingQuantity),
                      );
                      setDisposalDate(todayVietnam());
                      setDisposalAmount(lot.disposalOutstanding ?? '');
                      setDisposalOpen(true);
                    }}
                  >
                    {lot.disposal ? 'Xác nhận thực thu bán tài sản' : 'Ghi nhận thanh lý'}
                  </Button>
                )}
              {disposalOpen && (
                <>
                  <Alert severity="info">
                    {receiptSale
                      ? 'Chỉ ghi nhận số tiền thực tế đã nhận.'
                      : 'Khấu hao dừng đối với số lượng thanh lý từ tháng thanh lý. Giá bán chưa phải tiền thực thu. Sổ vốn và kiểm kê vật lý cần được đối chiếu.'}
                  </Alert>
                  {!receiptSale && remainingQuantity != null && (
                    <TextField
                      label="Số lượng thanh lý"
                      type="number"
                      value={disposalQuantity}
                      disabled={busy}
                      onChange={(e) => {
                        setDisposalQuantity(e.target.value);
                        setDisposalConfirmed(false);
                      }}
                      slotProps={{ htmlInput: { min: 1, max: remainingQuantity, step: 1 } }}
                    />
                  )}
                  <MoneyField
                    label={receiptSale ? 'Tiền thực thu (đ)' : 'Giá bán (đ)'}
                    value={disposalAmount}
                    onValueChange={(value) => {
                      setDisposalAmount(value);
                      setDisposalConfirmed(false);
                    }}
                    disabled={busy}
                    maxRawLength={18}
                  />
                  <TextField
                    label={receiptSale ? 'Ngày nhận tiền' : 'Ngày thanh lý'}
                    type="date"
                    value={disposalDate}
                    onChange={(e) => {
                      setDisposalDate(e.target.value);
                      setDisposalConfirmed(false);
                    }}
                    disabled={busy}
                    slotProps={{
                      inputLabel: { shrink: true },
                      htmlInput: {
                        max: todayVietnam(),
                        min: receiptSale?.input.disposedOn ?? lot.purchasedOn,
                      },
                    }}
                  />
                  {!receiptSale &&
                    disposalDate &&
                    disposalDate < todayVietnam().slice(0, 7) + '-01' && (
                      <Alert severity="warning">
                        Ngày thanh lý thuộc kỳ đã qua. Khi xác nhận, hệ thống lưu ngày thực tế và lý
                        do, nhưng dừng khấu hao từ đầu tháng hiện tại; không tính lại kỳ đã qua.
                      </Alert>
                    )}
                  <TextField
                    label="Lý do / chứng từ thanh lý"
                    value={disposalNote}
                    onChange={(e) => {
                      setDisposalNote(e.target.value);
                      setDisposalConfirmed(false);
                    }}
                    disabled={busy}
                    slotProps={{ htmlInput: { maxLength: 1000 } }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={disposalConfirmed}
                        onChange={(e) => setDisposalConfirmed(e.target.checked)}
                        disabled={busy}
                      />
                    }
                    label="Tôi xác nhận thông tin đúng thực tế."
                  />
                  <Stack direction="row" spacing={1}>
                    <Button disabled={busy} onClick={() => setDisposalOpen(false)}>
                      Hủy
                    </Button>
                    <Button
                      variant="contained"
                      disabled={
                        busy ||
                        conflict ||
                        (!!receiptSaleKey && !partialSale) ||
                        depreciation.isFetching ||
                        !disposalConfirmed ||
                        !disposalNote.trim() ||
                        !disposalDate ||
                        disposalDate > todayVietnam() ||
                        !/^\d+$/.test(disposalAmount) ||
                        (receiptSale
                          ? disposalDate < receiptSale.input.disposedOn ||
                            BigInt(disposalAmount || '0') <= 0n ||
                            BigInt(disposalAmount || '0') > BigInt(receiptOutstanding ?? '0')
                          : disposalDate < lot.purchasedOn ||
                            (remainingQuantity != null &&
                              (!/^\d+$/.test(disposalQuantity) ||
                                Number(disposalQuantity) < 1 ||
                                Number(disposalQuantity) > remainingQuantity)))
                      }
                      onClick={() => {
                        const common = { expectedVersion: lot.version, note: disposalNote.trim() };
                        if (receiptSale) {
                          const input = {
                            ...common,
                            amount: disposalAmount,
                            receivedOn: disposalDate,
                            ...(receiptSaleKey ? { disposalKey: receiptSaleKey } : {}),
                          };
                          void write('receipt:' + JSON.stringify(input), (key) =>
                            api.receiveInvestmentDisposal(expense.id, input, key),
                          );
                        } else {
                          const input = {
                            ...common,
                            saleAmount: disposalAmount,
                            disposedOn: disposalDate,
                            ...(disposalDate < todayVietnam().slice(0, 7) + '-01'
                              ? { recognizeInOpenPeriod: true }
                              : {}),
                            ...(remainingQuantity != null
                              ? { quantity: Number(disposalQuantity) }
                              : {}),
                          };
                          void write('disposal:' + JSON.stringify(input), (key) =>
                            api.disposeInvestment(expense.id, input, key),
                          );
                        }
                      }}
                    >
                      Xác nhận
                    </Button>
                  </Stack>
                </>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <Alert
          severity="error"
          action={
            conflict ? (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  onBusyChange?.(true);
                  try {
                    const results = await Promise.all([
                      payments.refetch(),
                      ...(expense.expenseType === 'INITIAL_INVESTMENT'
                        ? [depreciation.refetch()]
                        : []),
                    ]);
                    if (results.some((result) => result.isError)) return;
                    attempt.current = null;
                    setConfirmedPayment(null);
                    setDisposalConfirmed(false);
                    setDueDraft(null);
                    setPlan(null);
                    setDisposalOpen(false);
                    setConflict(false);
                    setError('');
                  } finally {
                    setBusy(false);
                    onBusyChange?.(false);
                  }
                }}
              >
                Tải lại dữ liệu
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}
      {notice && <Alert severity="success">{notice}</Alert>}
    </Stack>
  );
}
