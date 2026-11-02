import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftClient,
  type MainContractSettings,
} from '../../../../../packages/client-core/src/mainDrafts';

export function MainDraftSettingsPanel({ api }: { api: ContractClient }) {
  const { client, session } = useAuth();
  const request = useMemo(
    () =>
      mainDraftClient(
        createApiClient(
          getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
          () => client.session?.accessToken,
          client.clear,
          client.refresh,
        ),
      ),
    [client],
  );
  const [open, setOpen] = useState(false),
    [location, setLocation] = useState('');
  const [locations, setLocations] = useState<{ id: string; label: string }[]>([]);
  const [value, setValue] = useState<MainContractSettings | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    void api
      .preparation('', c.signal)
      .then((result) => {
        if (!c.signal.aborted) setLocations(result.locations);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      });
    return () => c.abort();
  }, [api, open]);
  useEffect(() => {
    if (!open || !location) return;
    const c = new AbortController();
    request
      .settings(location, c.signal)
      .then((result) => {
        if (!c.signal.aborted)
          setValue(
            result ?? {
              ownerSignerId: session!.userId,
              effectiveFrom: '',
              effectiveTo: null,
              securityDeposit: '',
              paymentTerms: '',
              additionalTerms: '',
              version: 0,
              owner: {
                fullName: '',
                dateOfBirth: '',
                citizenNumber: '',
                dateOfIssue: '',
                placeOfIssue: '',
                address: '',
                phone: '',
              },
            },
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      });
    return () => c.abort();
  }, [location, open, request, session]);
  async function save() {
    if (!value || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      await request.setSettings(location, {
        ...value,
        ownerSignerId: session!.userId,
        expectedVersion: value.version,
      });
      setValue(await request.settings(location));
      setSuccess(true);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const ownerFields = [
    ['fullName', 'Họ tên Owner', 'text'],
    ['dateOfBirth', 'Ngày sinh Owner', 'date'],
    ['citizenNumber', 'CCCD Owner', 'text'],
    ['dateOfIssue', 'Ngày cấp CCCD Owner', 'date'],
    ['placeOfIssue', 'Nơi cấp', 'text'],
    ['address', 'Địa chỉ thường trú', 'text'],
    ['phone', 'Điện thoại', 'tel'],
  ] as const;
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        Cấu hình bên cho thuê & tiền cọc
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) {
            setOpen(false);
            setValue(null);
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Cấu hình hợp đồng nháp theo cơ sở</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              Chỉ Owner cập nhật thông tin của mình. Staff đọc thông tin áp dụng khi lập nháp; không
              cấp tài khoản hoặc kích hoạt hợp đồng.
            </Alert>
            {!!error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">Đã lưu cấu hình.</Alert>}
            <TextField
              select
              label="Cơ sở"
              value={location}
              disabled={busy}
              onChange={(e) => {
                setLocation(e.target.value);
                setValue(null);
                setSuccess(false);
                setError('');
              }}
            >
              {locations.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.label}
                </MenuItem>
              ))}
            </TextField>
            {value && (
              <>
                {ownerFields.map(([key, label, type]) => (
                  <TextField
                    key={key}
                    label={label}
                    type={type}
                    value={value.owner[key]}
                    disabled={busy}
                    required
                    slotProps={{ inputLabel: { shrink: true } }}
                    onChange={(e) =>
                      setValue((v) => v && { ...v, owner: { ...v.owner, [key]: e.target.value } })
                    }
                  />
                ))}
                <TextField
                  label="Hiệu lực từ"
                  type="date"
                  value={value.effectiveFrom}
                  required
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(e) => setValue((v) => v && { ...v, effectiveFrom: e.target.value })}
                />
                <TextField
                  label="Hiệu lực đến (nếu có)"
                  type="date"
                  value={value.effectiveTo ?? ''}
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(e) =>
                    setValue((v) => v && { ...v, effectiveTo: e.target.value || null })
                  }
                />
                <TextField
                  label="Tiền cọc đảm bảo (VND)"
                  value={value.securityDeposit}
                  required
                  onChange={(e) => setValue((v) => v && { ...v, securityDeposit: e.target.value })}
                />
                <TextField
                  label="Hình thức / chính sách thanh toán"
                  value={value.paymentTerms}
                  required
                  multiline
                  onChange={(e) => setValue((v) => v && { ...v, paymentTerms: e.target.value })}
                />
                <TextField
                  label="Điều khoản bổ sung của Owner"
                  value={value.additionalTerms}
                  multiline
                  onChange={(e) => setValue((v) => v && { ...v, additionalTerms: e.target.value })}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setValue(null);
            }}
          >
            Đóng
          </Button>
          <Button variant="contained" disabled={busy || !value} onClick={() => void save()}>
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
