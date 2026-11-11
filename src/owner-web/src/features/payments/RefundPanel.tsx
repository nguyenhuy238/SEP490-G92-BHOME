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
import { settlementBlocker } from '../../../../../packages/client-core/src/useContractLifecycle';
type RefundPanelProps = {
  sourceId: string;
  sourceKind?: 'Receipt' | 'SecurityDeposit' | 'HoldingDeposit';
  onChanged?: () => void;
};
export function RefundPanel(props: RefundPanelProps) {
  return (
    <RefundPanelContent key={`${props.sourceKind ?? 'Receipt'}:${props.sourceId}`} {...props} />
  );
}
function RefundPanelContent({ sourceId, sourceKind = 'Receipt', onChanged }: RefundPanelProps) {
  const api = useRefundApi(),
    { session } = useAuth(),
    cache = useQueryClient();
  const source = useQuery({
    queryKey: ['refund-source', session?.userId, sourceKind, sourceId],
    queryFn: ({ signal }) =>
      sourceKind !== 'Receipt' ? api.depositSource(sourceId, signal) : api.source(sourceId, signal),
  });
  const [person, setPerson] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState('');
  const [reviewedSource, setReviewedSource] = useState<string | null>(null),
    [beneficiarySource, setBeneficiarySource] = useState<string | null>(null),
    [zeroDeductionSource, setZeroDeductionSource] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const signature = source.data
    ? JSON.stringify([
        sourceId,
        sourceKind,
        source.data.financialReference,
        source.data.availableAmount,
        source.data.refundedAmount,
        source.data.reservedAmount,
        source.data.depositDeductions?.id,
        source.data.approvedDepositOffsets,
        source.data.beneficiaries.map((p) => p.id),
        source.data.requests.map((r) => [r.id, r.version, r.executionIntent?.key]),
      ])
    : '';
  const checked = !!signature && reviewedSource === signature;
  const hasOffsets =
    !!source.data?.approvedDepositOffsets &&
    !/^0(?:\.0+)?$/.test(source.data.approvedDepositOffsets);
  const depositConfirmed =
    sourceKind === 'Receipt' ||
    (beneficiarySource === signature && zeroDeductionSource === signature);
  const blocked = (source.data?.blockers?.length ?? 0) > 0;
  const key = useRef({ signature: '', value: crypto.randomUUID() }),
    lock = useRef(false);
  const changed = () => {
    key.current = { signature, value: crypto.randomUUID() };
    setReviewedSource(null);
    setBeneficiarySource(null);
    setZeroDeductionSource(null);
  };
  async function reload() {
    await Promise.all(
      [['refund-source'], ['invoice-payment'], ['financial-report']].map((queryKey) =>
        cache.invalidateQueries({ queryKey }),
      ),
    );
    onChanged?.();
  }
  async function create() {
    if (lock.current || !checked || !depositConfirmed || blocked || source.isFetching) return;
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
      if (key.current.signature !== signature)
        key.current = { signature, value: crypto.randomUUID() };
      const body = {
        beneficiaryResidentId: person,
        amount: value,
        reason,
        humanConfirmed: checked,
      };
      if (sourceKind !== 'Receipt') {
        if (!source.data?.financialReference) throw { code: 'refund_source_changed' };
        await api.createDeposit(
          sourceId,
          {
            refund: body,
            expectedFinancialReference: source.data.financialReference,
            beneficiaryVerified: beneficiarySource === signature,
            noDeductionsConfirmed:
              !source.data.depositDeductions && !hasOffsets && zeroDeductionSource === signature,
            ...(source.data.depositDeductions
              ? {
                  expectedDeductionPlanId: source.data.depositDeductions.id,
                  deductionsConfirmed: zeroDeductionSource === signature,
                }
              : hasOffsets
                ? { deductionsConfirmed: zeroDeductionSource === signature }
                : {}),
          },
          key.current.value,
        );
      } else await api.create(sourceId, body, key.current.value);
      changed();
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
      <Typography variant="h6">
        {sourceKind === 'HoldingDeposit'
          ? 'Hoàn cọc giữ chỗ do không cung cấp được phòng'
          : sourceKind === 'SecurityDeposit'
            ? hasOffsets
              ? 'Hoàn phần cọc còn lại sau cấn trừ'
              : source.data?.depositDeductions
                ? 'Hoàn cọc theo quyết định khấu trừ'
                : 'Hoàn cọc không khấu trừ'
            : 'Hoàn tiền thừa từ giao dịch'}
      </Typography>
      <Alert severity="info">
        Owner tự thực hiện chuyển khoản hoàn bên ngoài. BHOME chỉ ghi nhận sau khi Owner đối chiếu
        sao kê; không tự chuyển tiền.
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
            {sourceKind !== 'Receipt' ? 'Cọc đã xác minh' : 'Tiền thừa ban đầu'}:{' '}
            {sourceKind !== 'Receipt'
              ? source.data.verifiedDepositAmount == null
                ? 'Chờ đối chiếu'
                : formatContractMoney(source.data.verifiedDepositAmount)
              : formatContractMoney(source.data.excessAmount)}{' '}
            · Đã hoàn: {formatContractMoney(source.data.refundedAmount)} · Đang giữ chỗ:{' '}
            {formatContractMoney(source.data.reservedAmount)}
          </Typography>
          <Typography>
            Còn có thể lập yêu cầu:{' '}
            {source.data.availableAmount === null
              ? 'Chờ đối chiếu'
              : formatContractMoney(source.data.availableAmount)}
          </Typography>
          {source.data.blockers?.map((b) => (
            <Alert severity="warning" key={b}>
              {settlementBlocker(b)}
            </Alert>
          ))}
          {source.data.depositDeductions && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography>
                Khấu trừ đã duyệt phiên bản {source.data.depositDeductions.version}:{' '}
                {formatContractMoney(source.data.depositDeductions.total)}
              </Typography>
              {source.data.depositDeductions.items.map((item, index) => (
                <Typography key={index}>
                  {item.description}: {formatContractMoney(item.amount)}
                </Typography>
              ))}
            </Paper>
          )}
          {sourceKind !== 'Receipt' && (
            <Alert severity="info">
              Danh sách là người ở đủ điều kiện, không xác định ai đã nộp cọc. Owner phải đối chiếu
              bằng chứng nộp cọc trước khi chọn người nhận.
            </Alert>
          )}
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
                    onChange={(e) => setReviewedSource(e.target.checked ? signature : null)}
                  />
                }
                label="Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn"
              />
              {sourceKind !== 'Receipt' && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={beneficiarySource === signature}
                        disabled={busy}
                        onChange={(e) => setBeneficiarySource(e.target.checked ? signature : null)}
                      />
                    }
                    label="Tôi đã đối chiếu bằng chứng nộp cọc và xác minh người nhận là người nộp"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={zeroDeductionSource === signature}
                        disabled={busy}
                        onChange={(e) =>
                          setZeroDeductionSource(e.target.checked ? signature : null)
                        }
                      />
                    }
                    label={
                      hasOffsets
                        ? `Tôi đã đối chiếu ${formatContractMoney(source.data.approvedDepositOffsets ?? '0')} cấn trừ đã duyệt và chỉ hoàn phần cọc còn lại`
                        : source.data.depositDeductions
                          ? 'Tôi đã đọc quyết định khấu trừ đã duyệt và xác nhận chỉ hoàn phần còn lại'
                          : 'Tôi xác nhận hoàn cọc không khấu trừ, không còn phí hoặc nghĩa vụ chờ xử lý'
                    }
                  />
                </>
              )}
              <Button
                disabled={
                  busy ||
                  source.isFetching ||
                  !checked ||
                  !depositConfirmed ||
                  blocked ||
                  !source.data.beneficiaries.some((p) => p.id === person) ||
                  !amount ||
                  !reason.trim() ||
                  source.data.availableAmount === null ||
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
              key={`${row.id}:${row.version}:${row.executionIntent?.key ?? ''}:${source.data.financialReference ?? ''}`}
              row={row}
              saved={reload}
              blocked={blocked}
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
function RefundItem({
  row,
  saved,
  blocked,
}: {
  row: Refund;
  saved: () => Promise<void>;
  blocked: boolean;
}) {
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
    if (lock.current || !checked || (blocked && approve !== false)) return;
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
                  disabled={busy || blocked || !checked || !reason.trim()}
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
                  blocked ||
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
