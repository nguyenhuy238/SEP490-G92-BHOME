import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useContractDetail } from '../../../../../packages/client-core/src/useContractDetail';
import {
  contractActions,
  contractError,
  dateOnly,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractAction,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ChartCard, StatusChip } from '../../components/common/PortalUI';
import { ContractActionDialog } from './ContractActionDialog';

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ContractDetailPanel({
  api,
  id,
  actorId,
  locationId,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  actorId: string;
  locationId: string;
  onChanged: (id?: string) => void;
}) {
  const detail = useContractDetail(api, id, 'Owner');
  const [action, setAction] = useState<ContractAction | null>(null);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [declare, setDeclare] = useState(false),
    [subscriber, setSubscriber] = useState(''),
    [serial, setSerial] = useState('');
  const lock = useRef(false);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (detail.loading) return <LinearProgress aria-label="Đang tải hợp đồng" />;
  if (detail.error)
    return (
      <Alert severity="error">
        {detail.error}
        <Button onClick={detail.reload}>Tải lại</Button>
      </Alert>
    );
  if (!detail.data) return null;
  const { contract: c, moveOut: m, readiness: r, history } = detail.data;
  const actions = contractActions(c, m, 'Owner', actorId);
  const signer = c.ownerSignerId === actorId;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusChip label={text(c.status)} />
        <Chip size="small" label={text(c.kind)} />
        <Button disabled={busy} onClick={detail.reload}>
          Tải lại trạng thái
        </Button>
      </Stack>
      {!!error && <Alert severity="error">{error}</Alert>}
      {!!notice && <Alert severity="success">{notice}</Alert>}
      <ChartCard title="Thông tin hợp đồng" subtitle={c.id}>
        <Stack spacing={1}>
          <Typography>
            Kỳ thuê: {displayContractDate(c.startDate)} – {displayContractDate(c.endDate)}
          </Typography>
          <Typography>
            Tiền thuê: <strong>{formatContractMoney(c.monthlyRent)}</strong> / tháng
          </Typography>
          <Typography>
            Cọc yêu cầu: {formatContractMoney(c.requiredDeposit)} · Cọc giữ chỗ áp dụng:{' '}
            {formatContractMoney(c.appliedHoldingDeposit)}
          </Typography>
          <Typography>
            {c.residentIds.length} người ở · Đại diện: {c.representativeResidentId}
          </Typography>
          {c.previousContractId && (
            <Button onClick={() => onChanged(c.previousContractId!)}>Xem hợp đồng trước</Button>
          )}
          {c.activatedAt && <Typography>Đã kích hoạt: {formatInstant(c.activatedAt)}</Typography>}
          <Divider />
          <Typography variant="subtitle2">Điều khoản đưa đi ký</Typography>
          <Box
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 300,
              overflowY: 'auto',
            }}
          >
            {c.terms}
          </Box>
        </Stack>
      </ChartCard>
      <ChartCard
        title="Chữ ký và tài liệu"
        subtitle="Owner và Tenant ký bằng chứng thư của chính mình"
      >
        <Stack spacing={1}>
          {[
            { id: c.ownerSignerId, label: 'Owner' },
            { id: c.tenantUserId, label: 'Tenant' },
          ].map((s) => (
            <Paper variant="outlined" key={s.id} sx={{ p: 1.5 }}>
              <Typography sx={{ fontWeight: 600 }}>
                {s.label}
                {s.id === actorId ? ' (bạn)' : ''}
              </Typography>
              {c.signatures
                .filter((a) => a.signerUserId === s.id)
                .map((a) => (
                  <Typography key={a.id} variant="body2">
                    {text(a.status)}
                    {a.signedAt ? ` · ${formatInstant(a.signedAt)}` : ''}
                  </Typography>
                ))}
              {!c.signatures.some((a) => a.signerUserId === s.id) && (
                <Typography variant="body2" color="text.secondary">
                  Chưa có yêu cầu ký
                </Typography>
              )}
            </Paper>
          ))}
          <Button
            disabled={busy || !c.signatures.some((s) => s.status === 'Signed')}
            onClick={() =>
              void run(async () => downloadBlob(await api.document(id), 'hop-dong.pdf'))
            }
          >
            Tải tài liệu ký
          </Button>
          {signer && (
            <Button disabled={busy} onClick={() => setDeclare((v) => !v)}>
              Khai báo chứng thư MySign của bạn
            </Button>
          )}
          {declare && signer && (
            <Stack spacing={1}>
              <TextField
                label="Mã thuê bao MySign của bạn"
                value={subscriber}
                disabled={busy}
                onChange={(e) => setSubscriber(e.target.value)}
              />
              <TextField
                label="Số serial (tùy chọn)"
                value={serial}
                disabled={busy}
                onChange={(e) => setSerial(e.target.value)}
              />
              <Button
                disabled={
                  busy || !subscriber.trim() || subscriber.length > 100 || serial.length > 100
                }
                onClick={() =>
                  void run(async () => {
                    await api.declareCertificate(subscriber.trim(), serial.trim());
                    setNotice('Đã truy vấn và lưu chứng thư từ nhà cung cấp.');
                    setDeclare(false);
                  })
                }
              >
                Tra cứu và lưu chứng thư
              </Button>
            </Stack>
          )}
        </Stack>
      </ChartCard>
      {r && (
        <ChartCard
          title="Điều kiện kích hoạt"
          subtitle="Kết quả kiểm tra tại máy chủ; được kiểm tra lại khi kích hoạt"
        >
          <Stack spacing={1}>
            <Typography>Cọc đã xác minh: {formatContractMoney(r.verifiedDeposit)}</Typography>
            <Typography>Cọc còn thiếu: {formatContractMoney(r.remainingDeposit)}</Typography>
            {r.ready ? (
              <Alert severity="success">Đủ điều kiện để Owner xác nhận kích hoạt.</Alert>
            ) : (
              r.blockers.map((b) => (
                <Alert key={b} severity="warning">
                  {text(b)}
                </Alert>
              ))
            )}
          </Stack>
        </ChartCard>
      )}
      {m && (
        <ChartCard title="Trả phòng và quyết toán" subtitle={text(m.status)}>
          <Stack spacing={1}>
            <Typography>Ngày đề nghị: {displayContractDate(m.proposedDate)}</Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              Lý do: {m.reason}
            </Typography>
            {m.inspectionScheduledAt && (
              <Typography>
                Lịch kiểm tra: {formatInstant(m.inspectionScheduledAt)} (giờ Việt Nam)
              </Typography>
            )}
            {!!m.pendingReason && <Alert severity="warning">{text(m.pendingReason)}</Alert>}
            {m.inspectedAt && (
              <>
                <Typography>Biên bản: {formatInstant(m.inspectedAt)}</Typography>
                <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {m.inspectionNotes}
                </Typography>
                <Typography>Mã chỉ số điện: {m.electricityReadingId}</Typography>
                <Typography>Mã chỉ số nước: {m.waterReadingId}</Typography>
              </>
            )}
            {(m.evidenceIds ?? []).map((e, i) => (
              <Button
                key={e}
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    downloadBlob(await api.evidence(id, e), `hien-trang-${i + 1}.jpg`),
                  )
                }
              >
                Tải ảnh hiện trạng {i + 1}
              </Button>
            ))}
            {m.status === 'Approved' && (
              <FinalMeterTask
                api={api}
                id={id}
                roomId={c.roomId}
                locationId={c.locationId || locationId}
                proposedDate={m.proposedDate}
              />
            )}
            {!!history.length && (
              <>
                <Divider />
                <Typography variant="subtitle2">Lịch sử xem xét quyết toán</Typography>
                {history.map((h) => (
                  <Paper variant="outlined" key={h.id} sx={{ p: 1.5 }}>
                    <Typography variant="caption">
                      {formatInstant(h.reviewedAt)} ·{' '}
                      {h.settled ? 'Đã xác minh quyết toán' : 'Còn chờ đối chiếu'}
                    </Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {h.decision}
                    </Typography>
                  </Paper>
                ))}
              </>
            )}
          </Stack>
        </ChartCard>
      )}
      <ChartCard title="Thao tác theo trạng thái">
        <Stack spacing={1}>
          {actions.map((a) => (
            <Button
              key={a.operation}
              variant={a.operation === 'activate' ? 'contained' : 'outlined'}
              disabled={busy || (a.operation === 'activate' && !r?.ready)}
              onClick={() => {
                setAction(a);
                setNotice('');
                setError('');
              }}
            >
              {a.label}
            </Button>
          ))}
          {!actions.length && (
            <Typography color="text.secondary">
              Không có thao tác phù hợp với trạng thái hiện tại.
            </Typography>
          )}
        </Stack>
      </ChartCard>
      {action && (
        <ContractActionDialog
          api={api}
          contract={c}
          action={action}
          keys={keys}
          actorId={actorId}
          onClose={() => {
            setAction(null);
            detail.reload();
          }}
          onSuccess={(next) => {
            setAction(null);
            setNotice('Máy chủ đã ghi nhận thao tác. Trạng thái đang được tải lại.');
            detail.reload();
            onChanged(next);
          }}
        />
      )}
    </Stack>
  );
}

function FinalMeterTask({
  api,
  id,
  roomId,
  locationId,
  proposedDate,
}: {
  api: ContractClient;
  id: string;
  roomId: string;
  locationId: string;
  proposedDate: string;
}) {
  const [meterId, setMeterId] = useState(''),
    [date, setDate] = useState(proposedDate),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const meters = useQuery({
    queryKey: ['contract-final-meters', id, locationId],
    enabled: !!locationId,
    queryFn: async ({ signal }) => api.meters(locationId, signal),
  });
  return (
    <Stack spacing={1}>
      <Divider />
      <Typography variant="subtitle2">Tạo tác vụ ghi chỉ số chốt cho Staff</Typography>
      <Typography variant="caption">
        Tạo riêng tác vụ cho đồng hồ điện và nước của phòng. Staff chụp ảnh và xác nhận trên mobile.
      </Typography>
      {meters.error && <Alert severity="error">{contractError(meters.error)}</Alert>}
      <TextField
        select
        label="Đồng hồ chốt"
        value={meterId}
        disabled={busy}
        onChange={(e) => setMeterId(e.target.value)}
      >
        {(meters.data ?? [])
          .filter((o) => o.parentId === roomId)
          .map((o) => (
            <MenuItem key={o.id} value={o.id}>
              {o.label}
            </MenuItem>
          ))}
      </TextField>
      <TextField
        label="Ngày ghi chỉ số chốt"
        type="date"
        value={date}
        slotProps={{ inputLabel: { shrink: true } }}
        disabled={busy}
        onChange={(e) => setDate(e.target.value)}
      />
      <Button
        disabled={busy || !meterId}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const result = await api.finalTask(id, meterId, dateOnly(date));
            setMessage('Đã tạo tác vụ: ' + result.id);
          } catch (e) {
            setMessage(contractError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Tạo tác vụ chốt
      </Button>
      {!!message && <Typography role="status">{message}</Typography>}
    </Stack>
  );
}
