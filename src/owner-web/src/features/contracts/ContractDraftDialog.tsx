import { MoneyField } from '../../components/common/MoneyField';
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
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import {
  contractError,
  draftPayload,
  holdingDraftPayload,
  mutationKeys,
  text,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useContractPreparation } from '../../../../../packages/client-core/src/useContractPreparation';

export function ContractDraftDialog({
  api,
  ownerId,
  onClose,
  onCreated,
  kind = 'Main',
}: {
  api: ContractClient;
  ownerId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  kind?: 'Main' | 'Holding';
}) {
  const [values, setValues] = useState<Record<string, string>>({ ownerSignerId: ownerId });
  const [location, setLocation] = useState(''),
    [residents, setResidents] = useState<string[]>([]);
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [account, setAccount] = useState('');
  const lock = useRef(false),
    [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const query = useContractPreparation(api, location, true);
  const p = query.data?.preparation,
    template = query.data?.configuration.template;
  const eligible = (p?.residents ?? []).filter((r) => r.roomId === values.roomId && r.verified);
  const representative = eligible.find((r) => r.id === values.representativeResidentId);
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function next() {
    setError('');
    if (
      step === 1 &&
      (!representative?.tenantUserId ||
        !residents.includes(representative.id) ||
        !values.ownerSignerId)
    ) {
      setError('Chọn phòng, người ở và đại diện đã liên kết tài khoản Tenant.');
      return;
    }
    setStep((v) => v + 1);
  }
  const chooseRepresentative = (id: string) => {
    set('representativeResidentId', id);
    setAccount('');
  };
  return (
    <Dialog open fullWidth maxWidth="md" onClose={() => !busy && onClose()}>
      <DialogTitle>
        {kind === 'Holding' ? 'Tạo hợp đồng giữ chỗ' : 'Tạo nháp hợp đồng thuê'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stepper activeStep={step}>
            {['Cấu hình', 'Phòng & Người ở', 'Điều khoản'].map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          {query.loading && <Typography role="status">Đang tải lựa chọn…</Typography>}
          {!!query.error && (
            <Alert severity="error">
              {query.error}
              <Button onClick={query.reload}>Tải lại</Button>
            </Alert>
          )}
          {step === 0 && template && (
            <>
              <TextField select label="Mẫu được cấu hình tại máy chủ" value={template.id}>
                <MenuItem value={template.id}>
                  {template.title} · v{template.version}
                </MenuItem>
              </TextField>
              <Alert severity={template.developmentOnly ? 'warning' : 'info'}>
                {template.notice}
              </Alert>
              <Typography>Trường ánh xạ: {template.fields.join(', ')}</Typography>
              <Typography>
                Ký:{' '}
                {query.data?.configuration.signingMode === 'Simulated'
                  ? 'SIMULATED SIGNING — không có giá trị pháp lý'
                  : 'Nhà cung cấp điện tử'}
              </Typography>
              {!template.available && (
                <Alert severity="warning">{text(template.blocker ?? '')}</Alert>
              )}
              <Alert severity="info">
                Bản nháp chưa giữ chỗ hoặc kích hoạt phòng.{' '}
                {text(query.data?.configuration.holdingBlocker ?? '')}
              </Alert>
            </>
          )}
          {step === 1 && (
            <>
              <TextField
                select
                label="Cơ sở"
                value={location}
                disabled={busy || query.loading}
                onChange={(e) => {
                  setLocation(e.target.value);
                  set('roomId', '');
                  chooseRepresentative('');
                  setResidents([]);
                }}
              >
                {(p?.locations ?? []).map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Phòng sẵn sàng"
                value={values.roomId ?? ''}
                disabled={busy || query.loading || !location}
                onChange={(e) => {
                  set('roomId', e.target.value);
                  chooseRepresentative('');
                  setResidents([]);
                }}
              >
                {(p?.rooms ?? []).map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              <Typography>Người ở đã xác minh</Typography>
              {eligible.map((r) => (
                <FormControlLabel
                  key={r.id}
                  label={r.label}
                  control={
                    <Checkbox
                      checked={residents.includes(r.id)}
                      disabled={busy}
                      onChange={(_, checked) => {
                        setResidents((ids) =>
                          checked ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                        );
                        if (!checked && representative?.id === r.id) chooseRepresentative('');
                      }}
                    />
                  }
                />
              ))}
              {!!values.roomId && !eligible.length && (
                <Alert severity="warning">
                  Chưa có người ở đã xác minh tại phòng này. Hoàn tất tiếp nhận trên Mobile.
                </Alert>
              )}
              <TextField
                select
                label="Người đại diện"
                value={values.representativeResidentId ?? ''}
                onChange={(e) => chooseRepresentative(e.target.value)}
                disabled={busy}
              >
                {eligible
                  .filter((r) => residents.includes(r.id))
                  .map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.label}
                    </MenuItem>
                  ))}
              </TextField>
              {representative && !representative.tenantUserId && (
                <>
                  <Alert severity="warning">
                    Hồ sơ chưa liên kết tài khoản Tenant. Owner xác nhận liên kết trước khi tạo hợp
                    đồng.
                  </Alert>
                  <TextField
                    select
                    label="Tài khoản Tenant của người đại diện"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    disabled={busy}
                  >
                    {(query.data?.accounts ?? []).map((a) => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    disabled={busy || !account}
                    onClick={() =>
                      void run(async () => {
                        await api.linkTenant(representative.id, account);
                        query.reload();
                      })
                    }
                  >
                    Xác nhận liên kết tài khoản
                  </Button>
                </>
              )}
              {representative?.tenantUserId && (
                <Alert severity="success">
                  Người đại diện đã liên kết tài khoản Tenant ký hợp đồng.
                </Alert>
              )}
              <TextField
                select
                label="Owner ký hợp đồng"
                value={values.ownerSignerId ?? ''}
                onChange={(e) => set('ownerSignerId', e.target.value)}
                disabled={busy}
              >
                {(p?.ownerSigners ?? []).map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
          {step === 2 && (
            <>
              <Alert severity="info">
                {kind === 'Holding' ? 'Hợp đồng giữ chỗ' : 'Hợp đồng thuê chính'} ·{' '}
                {p?.rooms.find((r) => r.id === values.roomId)?.label} · {representative?.label} ·{' '}
                {residents.length} người ở. Giá thuê và cọc do hai bên thống nhất; máy chủ kiểm tra
                lại toàn bộ điều kiện.
              </Alert>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {['startDate', 'endDate'].map((key, i) => (
                  <TextField
                    fullWidth
                    key={key}
                    label={i ? 'Ngày hết hạn' : 'Ngày bắt đầu'}
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={values[key] ?? ''}
                    disabled={busy}
                    onChange={(e) => set(key, e.target.value)}
                  />
                ))}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {(kind === 'Holding'
                  ? ['requiredDeposit']
                  : ['monthlyRent', 'requiredDeposit']
                ).map((key) => (
                  <MoneyField
                    maxRawLength={18}
                    fullWidth
                    key={key}
                    label={
                      key === 'requiredDeposit' ? 'Cọc yêu cầu (VND)' : 'Tiền thuê tháng (VND)'
                    }
                    value={values[key] ?? ''}
                    disabled={busy}
                    onValueChange={(raw) => set(key, raw)}
                  />
                ))}
              </Stack>
              {kind === 'Holding' && (
                <>
                  <TextField
                    label="Hết hạn giữ chỗ (giờ Việt Nam)"
                    type="datetime-local"
                    value={values.expiresAt ?? ''}
                    onChange={(e) => set('expiresAt', e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    label="Số chỗ giữ"
                    type="number"
                    value={values.reservedCapacity ?? residents.length}
                    onChange={(e) => set('reservedCapacity', e.target.value)}
                    slotProps={{ htmlInput: { min: residents.length, max: 32767 } }}
                  />
                  <Alert severity="info">
                    Giá thuê được máy chủ lấy từ chính sách có hiệu lực của phòng; tiền cọc chưa xác
                    minh không giữ phòng.
                  </Alert>
                </>
              )}
              <TextField
                multiline
                minRows={4}
                label="Điều khoản đã thống nhất"
                value={values.terms ?? ''}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 12000 } }}
                onChange={(e) => set('terms', e.target.value)}
              />
            </>
          )}
          {!!error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Đóng
        </Button>
        {step > 0 && (
          <Button disabled={busy} onClick={() => setStep((v) => v - 1)}>
            Quay lại
          </Button>
        )}
        {step < 2 ? (
          <Button
            variant="contained"
            disabled={busy || query.loading || !!query.error || !template?.available}
            onClick={next}
          >
            Tiếp theo
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || query.loading || !!query.error}
            onClick={() =>
              void run(async () => {
                const input = { ...values, tenantUserId: representative?.tenantUserId ?? '' };
                const body =
                  kind === 'Holding'
                    ? holdingDraftPayload(input, residents)
                    : draftPayload(input, residents);
                const scope = kind === 'Holding' ? 'holding' : 'draft';
                const result =
                  kind === 'Holding'
                    ? await api.transport<{ id: string }>('/api/v1/contracts/holdings', {
                        method: 'POST',
                        headers: { 'Idempotency-Key': keys.get(scope, body) },
                        body: JSON.stringify(body),
                      })
                    : await api.mutate<{ id: string }>(null, '', body, keys.get('draft', body));
                keys.confirmed(scope, body);
                onCreated(result.id);
              })
            }
          >
            {busy ? 'Đang lưu…' : 'Lưu bản nháp'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
