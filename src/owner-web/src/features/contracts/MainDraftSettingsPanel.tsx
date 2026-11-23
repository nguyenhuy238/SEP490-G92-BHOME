import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { MoneyField } from '../../components/common/MoneyField';
import {
  contactPhoneError,
  normalizeContactPhone,
} from '../../../../../packages/client-core/src/contactPhone';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import Close from '@mui/icons-material/Close';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../services/config';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftClient,
  type MainContractSettings,
} from '../../../../../packages/client-core/src/mainDrafts';

const compact = '@media (max-width: 767px)';
const fieldGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 2,
  alignItems: 'start',
  [compact]: { gridTemplateColumns: 'minmax(0, 1fr)' },
};

function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box component="section">
      <Typography
        component="h3"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 2,
          fontSize: 15,
          fontWeight: 600,
          '& svg': { fontSize: 19, color: '#475569' },
        }}
      >
        {icon}
        {title}
      </Typography>
      <Box sx={fieldGrid}>{children}</Box>
    </Box>
  );
}

export function MainDraftSettingsPanel({ api }: { api: ContractClient }) {
  const { client, session } = useAuth();
  const request = useMemo(
    () =>
      mainDraftClient(
        createApiClient(
          apiBaseUrl,
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
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false);
  const lock = useRef(false);
  const saved = useRef<MainContractSettings | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  function close() {
    setConfirmClose(false);
    setOpen(false);
    setValue(null);
  }
  function requestClose() {
    if (lock.current) return;
    if (value && JSON.stringify(value) !== JSON.stringify(saved.current)) setConfirmClose(true);
    else close();
  }
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
        if (!c.signal.aborted) {
          saved.current = result ?? {
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
          };
          setValue(saved.current);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [location, open, request, session]);
  async function save() {
    if (!value || lock.current) return;
    const phoneError = contactPhoneError(value.owner.phone, true);
    if (phoneError) {
      setError(phoneError);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      await request.setSettings(location, {
        ...value,
        owner: { ...value.owner, phone: normalizeContactPhone(value.owner.phone)! },
        ownerSignerId: session!.userId,
        expectedVersion: value.version,
      });
      saved.current = await request.settings(location);
      setValue(saved.current);
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
      <Button
        variant="outlined"
        onClick={() => {
          setError('');
          setSuccess(false);
          setLoading(!!location);
          setOpen(true);
        }}
      >
        Cấu hình bên cho thuê & tiền cọc
      </Button>
      <Dialog
        open={open}
        onClose={requestClose}
        aria-labelledby="main-contract-settings-title"
        aria-describedby="main-contract-settings-description"
        maxWidth={false}
        slotProps={{
          paper: {
            sx: {
              width: 'min(900px, 90vw)',
              maxWidth: 'none',
              maxHeight: '88dvh',
              m: 0,
              borderRadius: '12px',
              color: '#0F172A',
              fontFamily: 'Inter, Roboto, Arial, sans-serif',
              boxShadow: '0 16px 48px rgba(15, 23, 42, 0.14)',
              [compact]: { width: '100%', height: '100dvh', maxHeight: '100dvh', borderRadius: 0 },
            },
          },
        }}
      >
        <Box
          component="header"
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 2,
            px: { xs: 2, sm: 4 },
            py: 2,
            borderBottom: '1px solid #E2E8F0',
          }}
        >
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: '10px',
              bgcolor: '#EFF6FF',
              color: '#2563EB',
            }}
          >
            <ArticleOutlined />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <DialogTitle
              id="main-contract-settings-title"
              sx={{ p: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600 }}
            >
              Cấu hình hợp đồng
            </DialogTitle>
            <Typography
              id="main-contract-settings-description"
              sx={{ color: '#64748B', mt: 0.5, fontSize: 14 }}
            >
              Thiết lập thông tin chủ sở hữu và điều khoản hợp đồng
            </Typography>
          </Box>
          <IconButton
            aria-label="Đóng cấu hình"
            disabled={busy}
            onClick={requestClose}
            sx={{ width: 44, height: 44 }}
          >
            <Close />
          </IconButton>
        </Box>
        <DialogContent
          sx={{
            px: { xs: 2, sm: 4 },
            py: 3,
            bgcolor: '#F8FAFC',
            overscrollBehavior: 'contain',
            '& .MuiFormControl-root': { minWidth: 0 },
            '& .MuiInputLabel-root': {
              position: 'static',
              transform: 'none',
              maxWidth: '100%',
              whiteSpace: 'normal',
              mb: 0.75,
              fontSize: 13,
              fontWeight: 500,
              color: '#0F172A',
            },
            '& .MuiFormLabel-asterisk': { color: 'error.main' },
            '& .MuiOutlinedInput-root': {
              bgcolor: '#FFFFFF',
              borderRadius: '8px',
              fontSize: 14,
              minHeight: 44,
              transition: 'box-shadow 160ms ease',
              '&.Mui-focused': { boxShadow: '0 0 0 3px #BFDBFE' },
              '&.Mui-focused:not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
                borderColor: '#2563EB',
                borderWidth: 1,
              },
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: '#E2E8F0',
              top: 0,
              '& legend': { display: 'none' },
            },
            '& .MuiOutlinedInput-input:not(textarea)': { py: '11px', lineHeight: '22px' },
            '& .MuiOutlinedInput-root.MuiInputBase-multiline': {
              py: 1.25,
              lineHeight: 1.55,
              alignItems: 'start',
            },
            '& .MuiFormHelperText-root': { mx: 0 },
            '@media (prefers-reduced-motion: reduce)': {
              '& .MuiOutlinedInput-root': { transition: 'none' },
            },
          }}
        >
          <ValidatedForm
            id="main-contract-settings"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Stack spacing={3} sx={{ pt: 1 }}>
              {!!error && <Alert severity="error">{error}</Alert>}
              {success && <Alert severity="success">Đã lưu cấu hình.</Alert>}
              {loading && <Alert severity="info">Đang tải cấu hình…</Alert>}
              <SettingsSection title="Cơ sở áp dụng" icon={<ApartmentOutlined />}>
                <TextField
                  select
                  label="Cơ sở"
                  value={location}
                  disabled={busy}
                  required
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setValue(null);
                    setLoading(true);
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
              </SettingsSection>
              {value && (
                <>
                  <SettingsSection title="Thông tin chủ sở hữu" icon={<PersonOutlined />}>
                    {ownerFields.map(([key, label, type]) => (
                      <TextField
                        key={key}
                        label={label}
                        type={type}
                        value={value.owner[key]}
                        disabled={busy}
                        required
                        sx={
                          key === 'placeOfIssue' || key === 'address'
                            ? { gridColumn: '1 / -1' }
                            : undefined
                        }
                        error={key === 'phone' && !!contactPhoneError(value.owner.phone, true)}
                        helperText={
                          key === 'phone' ? contactPhoneError(value.owner.phone, true) : undefined
                        }
                        slotProps={{ inputLabel: { shrink: true } }}
                        onChange={(e) =>
                          setValue(
                            (v) => v && { ...v, owner: { ...v.owner, [key]: e.target.value } },
                          )
                        }
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection title="Thông tin hợp đồng" icon={<ArticleOutlined />}>
                    <TextField
                      label="Hiệu lực từ"
                      type="date"
                      value={value.effectiveFrom}
                      disabled={busy}
                      required
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={(e) =>
                        setValue((v) => v && { ...v, effectiveFrom: e.target.value })
                      }
                    />
                    <TextField
                      label="Hiệu lực đến (nếu có)"
                      type="date"
                      value={value.effectiveTo ?? ''}
                      disabled={busy}
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={(e) =>
                        setValue((v) => v && { ...v, effectiveTo: e.target.value || null })
                      }
                    />
                    <MoneyField
                      maxRawLength={18}
                      label="Tiền cọc đảm bảo (VND)"
                      value={value.securityDeposit}
                      disabled={busy}
                      required
                      onValueChange={(raw) => setValue((v) => v && { ...v, securityDeposit: raw })}
                    />
                  </SettingsSection>
                  <SettingsSection title="Điều khoản và thanh toán" icon={<CreditCardOutlined />}>
                    <TextField
                      label="Hình thức / chính sách thanh toán"
                      value={value.paymentTerms}
                      disabled={busy}
                      required
                      multiline
                      minRows={3}
                      sx={{ gridColumn: '1 / -1' }}
                      onChange={(e) => setValue((v) => v && { ...v, paymentTerms: e.target.value })}
                    />
                    <TextField
                      label="Điều khoản bổ sung của Owner"
                      value={value.additionalTerms}
                      disabled={busy}
                      multiline
                      minRows={3}
                      sx={{ gridColumn: '1 / -1' }}
                      onChange={(e) =>
                        setValue((v) => v && { ...v, additionalTerms: e.target.value })
                      }
                    />
                  </SettingsSection>
                </>
              )}
            </Stack>
          </ValidatedForm>
        </DialogContent>
        <DialogActions
          sx={{
            borderTop: '1px solid #E2E8F0',
            px: { xs: 2, sm: 4 },
            py: 2,
            pb: 'max(16px, env(safe-area-inset-bottom))',
            gap: 1,
          }}
          disableSpacing
        >
          <Button disabled={busy} onClick={requestClose} sx={{ minHeight: 44, color: '#475569' }}>
            Hủy
          </Button>
          <Button
            variant="contained"
            type="submit"
            form="main-contract-settings"
            disabled={busy || loading || !value}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <SaveOutlined />}
            sx={{
              minHeight: 44,
              borderRadius: '8px',
              bgcolor: '#2563EB',
              '&:hover': { bgcolor: '#1D4ED8' },
            }}
          >
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        aria-labelledby="discard-contract-settings-title"
        aria-describedby="discard-contract-settings-description"
      >
        <DialogTitle id="discard-contract-settings-title">Bỏ thay đổi chưa lưu?</DialogTitle>
        <DialogContent>
          <DialogContentText id="discard-contract-settings-description">
            Các chỉnh sửa cho cơ sở này sẽ bị mất khi đóng.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setConfirmClose(false)}>
            Tiếp tục chỉnh sửa
          </Button>
          <Button color="error" onClick={close}>
            Bỏ thay đổi
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
