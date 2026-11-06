import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatContractMoney, vnd } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { refundError, type Refund } from '../../../../../packages/client-core/src/refunds';
import { useRefundApi } from './useRefundApi';
export function RefundPanel({ sourceId }: { sourceId: string }) {
  const api = useRefundApi(),
    { session } = useAuth(),
    cache = useQueryClient();
  const source = useQuery({
    queryKey: ['refund-source', session?.userId, sourceId],
    queryFn: ({ signal }) => api.source(sourceId, signal),
  });
  const [person, setPerson] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef(crypto.randomUUID()),
    lock = useRef(false);
  const changed = () => {
    key.current = crypto.randomUUID();
    setChecked(false);
  };
  async function reload() {
    await Promise.all(
      [['refund-source'], ['invoice-payment'], ['financial-report']].map((queryKey) =>
        cache.invalidateQueries({ queryKey }),
      ),
    );
  }
  async function create() {
    if (lock.current || !checked) return;
    let value: string;
    try {
      value = vnd(amount, true);
    } catch {
      setError('Nhập số nguyên VND dương.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.create(
        sourceId,
        { beneficiaryResidentId: person, amount: value, reason, humanConfirmed: checked },
        key.current,
      );
      key.current = crypto.randomUUID();
      setChecked(false);
      setAmount('');
      setReason('');
      await reload();
    } catch (e) {
      setError(refundError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Hoàn tiền thừa từ giao dịch</Typography>
      <Alert severity="info">
        Owner tự thực hiện chuyển khoản hoàn bên ngoài. BHOME chỉ ghi nhận sau khi Owner đối chiếu
        sao kê; không tự chuyển tiền hoặc khấu trừ cọc.
      </Alert>
      {source.isFetching && <LinearProgress />}
      {(error || source.error) && (
        <Alert severity="error">{error || refundError(source.error)}</Alert>
      )}
      <Button onClick={() => void source.refetch()}>Tải lại nguồn hoàn tiền</Button>
      {source.data && !source.error && (
        <>
          {source.data.isDevelopmentDemo && (
            <Alert severity="warning">
              Dữ liệu tổng hợp Development/Testing. Không chuyển tiền thật.
            </Alert>
          )}
          <Typography>
            Tiền thừa ban đầu: {formatContractMoney(source.data.excessAmount)} · Đã hoàn:{' '}
            {formatContractMoney(source.data.refundedAmount)} · Đang giữ chỗ:{' '}
            {formatContractMoney(source.data.reservedAmount)}
          </Typography>
          <Typography>
            Còn có thể lập yêu cầu: {formatContractMoney(source.data.availableAmount)}
          </Typography>
          {source.data.beneficiaries.length === 0 ? (
            <Alert severity="warning">
              Chưa có hồ sơ người thực trả đã xác minh. Owner cần làm rõ nguồn trước khi hoàn.
            </Alert>
          ) : (
            <>
              <TextField
                select
                label="Người nhận hoàn đã xác minh"
                value={person}
                disabled={busy}
                onChange={(e) => {
                  setPerson(e.target.value);
                  changed();
                }}
              >
                <MenuItem value="">Chọn đúng người thực trả</MenuItem>
                {source.data.beneficiaries.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Số tiền yêu cầu hoàn (VND)"
                value={amount}
                disabled={busy}
                onChange={(e) => {
                  setAmount(e.target.value);
                  changed();
                }}
              />
              <TextField
                label="Lý do yêu cầu hoàn"
                value={reason}
                disabled={busy}
                onChange={(e) => {
                  setReason(e.target.value);
                  changed();
                }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                }
                label="Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn"
              />
              <Button
                disabled={
                  busy ||
                  source.isFetching ||
                  !checked ||
                  !person ||
                  !amount ||
                  !reason.trim() ||
                  /^0(?:\.0+)?$/.test(source.data.availableAmount)
                }
                onClick={() => void create()}
              >
                Lập yêu cầu hoàn tiền
              </Button>
            </>
          )}
          {source.data.requests.map((row) => (
            <RefundItem
              key={`${row.id}:${row.version}:${row.executionIntent?.key ?? ''}`}
              row={row}
              saved={reload}
            />
          ))}
        </>
      )}
    </Stack>
  );
}
const status: Record<string, string> = {
  REQUESTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt, chờ ghi nhận hoàn',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Đã ghi nhận hoàn',
};
function RefundItem({ row, saved }: { row: Refund; saved: () => Promise<void> }) {
  const api = useRefundApi();
  const [reason, setReason] = useState(row.executionIntent?.reason ?? ''),
    [checked, setChecked] = useState(false);
  const [reference, setReference] = useState(row.executionIntent?.externalReference ?? ''),
    [date, setDate] = useState('');
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    key = useRef(row.executionIntent?.key ?? crypto.randomUUID());
  const changed = () => {
    if (!row.executionIntent) key.current = crypto.randomUUID();
    setChecked(false);
  };
  async function perform(approve?: boolean) {
    if (lock.current || !checked) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (row.status === 'REQUESTED')
        await api.decide(
          row.id,
          {
            expectedVersion: row.version,
            approve: approve === true,
            reason,
            humanConfirmed: checked,
          },
          key.current,
        );
      else {
        if (
          !file ||
          !['image/png', 'image/jpeg'].includes(file.type) ||
          file.size === 0 ||
          file.size > 5 * 1024 * 1024
        )
          throw new Error('file');
        if (row.executionIntent) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          try {
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase();
            if (
              hash !== row.executionIntent.sha256 ||
              file.size !== row.executionIntent.length ||
              file.type !== row.executionIntent.contentType
            )
              throw new Error('file');
          } finally {
            bytes.fill(0);
          }
        }
        await api.execute(
          row.id,
          {
            expectedVersion: row.version,
            executedAt: row.executionIntent?.executedAt ?? new Date(date + '+07:00').toISOString(),
            externalReference: reference,
            reason,
            humanConfirmed: checked,
          },
          file,
          key.current,
        );
      }
      setChecked(false);
      await saved();
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'file'
          ? 'Chọn đúng ảnh PNG/JPEG tối đa 5 MB; khi phục hồi phải dùng ảnh đã gửi.'
          : refundError(e),
      );
      await saved();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const blob = await api.evidence(row.id),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = blob.type === 'image/png' ? 'chung-tu-hoan.png' : 'chung-tu-hoan.jpg';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(refundError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography>
          {status[row.status]} · {formatContractMoney(row.amount)} · {row.beneficiaryLabel}
        </Typography>
        <Typography>Lý do yêu cầu: {row.reason}</Typography>
        {row.history.map((event, index) => (
          <Typography key={index} variant="body2">
            {formatInstant(event.at)} · {event.reason}
          </Typography>
        ))}
        {row.externalReference && <Typography>Tham chiếu hoàn: {row.externalReference}</Typography>}
        {row.status === 'COMPLETED' && (
          <Button disabled={busy} onClick={() => void download()}>
            Tải chứng từ hoàn tiền
          </Button>
        )}
        {row.executionIntent && (
          <Alert severity="warning">
            Chưa hoàn tất lưu chứng từ. Dùng đúng ảnh đã gửi và thông tin đang chờ để phục hồi.
          </Alert>
        )}
        {(row.status === 'REQUESTED' || row.status === 'APPROVED') && (
          <>
            <TextField
              label="Lý do quyết định / xác minh hoàn"
              disabled={busy || !!row.executionIntent}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                changed();
              }}
            />
            {row.status === 'APPROVED' && (
              <>
                <TextField
                  label="Tham chiếu giao dịch hoàn trên sao kê"
                  disabled={busy || !!row.executionIntent}
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    changed();
                  }}
                />
                {row.executionIntent ? (
                  <Typography>
                    Giao dịch đã khai: {formatInstant(row.executionIntent.executedAt)}
                  </Typography>
                ) : (
                  <TextField
                    label="Thời gian hoàn thực tế (giờ Việt Nam)"
                    type="datetime-local"
                    value={date}
                    disabled={busy}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 0.001 } }}
                    onChange={(e) => {
                      setDate(e.target.value);
                      changed();
                    }}
                  />
                )}
                <Typography variant="body2">
                  Chứng từ PNG/JPEG tối đa 5 MB. Không tải giấy tờ tùy thân hoặc thông tin đăng
                  nhập.
                </Typography>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="Chứng từ giao dịch hoàn"
                  disabled={busy}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    changed();
                  }}
                />
              </>
            )}
            <FormControlLabel
              control={
                <Checkbox
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => setChecked(e.target.checked)}
                />
              }
              label={
                row.status === 'REQUESTED'
                  ? 'Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định'
                  : 'Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận'
              }
            />
            {row.status === 'REQUESTED' ? (
              <Stack direction="row" spacing={1}>
                <Button
                  disabled={busy || !checked || !reason.trim()}
                  onClick={() => void perform(true)}
                >
                  Duyệt yêu cầu hoàn
                </Button>
                <Button
                  disabled={busy || !checked || !reason.trim()}
                  onClick={() => void perform(false)}
                >
                  Từ chối hoàn
                </Button>
              </Stack>
            ) : (
              <Button
                disabled={
                  busy ||
                  !checked ||
                  !reason.trim() ||
                  !reference ||
                  !file ||
                  (!date && !row.executionIntent)
                }
                onClick={() => void perform()}
              >
                Ghi nhận giao dịch hoàn đã thực hiện
              </Button>
            )}
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
