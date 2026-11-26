import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import ExpandMore from '@mui/icons-material/ExpandMore';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PersonOutlined from '@mui/icons-material/PersonOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../services/config';
import {
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import {
  contactPhoneError,
  normalizeContactPhone,
} from '../../../../../packages/client-core/src/contactPhone';
import {
  mainDraftClient,
  type MainContractSettings,
} from '../../../../../packages/client-core/src/mainDrafts';
import { ContractConfigurationPanel } from './ContractWorkflowPanel';
import { useContractsApi } from './useContractsApi';

const fieldGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 2,
  alignItems: 'start',
  '@media (max-width: 767px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
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
    <Paper
      component="section"
      variant="outlined"
      sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2, bgcolor: 'background.paper' }}
    >
      <Typography
        component="h2"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 2,
          fontSize: 16,
          fontWeight: 700,
          '& svg': { fontSize: 20, color: 'primary.main' },
        }}
      >
        {icon}
        {title}
      </Typography>
      <Box sx={fieldGrid}>{children}</Box>
    </Paper>
  );
}
function blankSettings(ownerSignerId: string): MainContractSettings {
  return {
    ownerSignerId,
    effectiveFrom: '',
    effectiveTo: null,
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
}
export function MainDraftSettingsPanel() {
  const { client, session } = useAuth();
  const navigate = useNavigate();
  const api = useContractsApi() as ContractClient;
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
  const [value, setValue] = useState<MainContractSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsOwnerConfiguration, setNeedsOwnerConfiguration] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    request
      .settings(c.signal)
      .then((result) => {
        setNeedsOwnerConfiguration(!result);
        setValue(result ?? blankSettings(session?.userId ?? ''));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [request, session?.userId]);
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
      const { version, ...settings } = value;
      await request.setSettings({
        ...settings,
        owner: { ...value.owner, phone: normalizeContactPhone(value.owner.phone)! },
        ownerSignerId: session?.userId ?? '',
        expectedVersion: version,
      });
      setValue(await request.settings());
      setNeedsOwnerConfiguration(false);
      setSuccess(true);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const ownerFields = [
    ['fullName', 'Họ tên bên cho thuê', 'text'],
    ['dateOfBirth', 'Ngày sinh bên cho thuê', 'date'],
    ['citizenNumber', 'CCCD bên cho thuê', 'text'],
    ['dateOfIssue', 'Ngày cấp CCCD Owner', 'date'],
    ['placeOfIssue', 'Nơi cấp', 'text'],
    ['address', 'Địa chỉ thường trú', 'text'],
    ['phone', 'Điện thoại', 'tel'],
  ] as const;
  const dateValue = (value: string | null | undefined): Dayjs | null => {
    if (!value) return null;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  };
  const updateDate = (key: 'effectiveFrom' | 'effectiveTo', date: Dayjs | null) =>
    setValue(
      (current) =>
        current && {
          ...current,
          [key]: date?.isValid() ? date.format('YYYY-MM-DD') : key === 'effectiveFrom' ? '' : null,
        },
    );
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 1180,
        mx: 'auto',
        bgcolor: 'background.default',
        boxSizing: 'border-box',
      }}
    >
      <Stack spacing={2.5}>
        <Box sx={{ px: { xs: 0, sm: 0.5 } }}>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 750 }}>
            Cấu hình hợp đồng
          </Typography>
          <Alert severity="info" sx={{ mt: 1.5, py: 0, '& .MuiAlert-message': { py: 0.75 } }}>
            Cấu hình này dùng cho hợp đồng tạo mới tại tất cả cơ sở, kể cả cơ sở được thêm sau này.
          </Alert>
        </Box>
        <ValidatedForm
          id="main-contract-settings"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && (
              <Alert severity="success">Đã lưu cấu hình dùng chung cho tất cả cơ sở.</Alert>
            )}
            {needsOwnerConfiguration && (
              <Alert severity="info" variant="outlined">
                Chưa có cấu hình chung. Cấu hình theo cơ sở đã lưu trước đây vẫn được giữ nguyên;
                cấu hình này áp dụng cho hợp đồng tạo mới sau khi lưu.
              </Alert>
            )}
            {loading && <Alert severity="info">Đang tải cấu hình…</Alert>}
            <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="vi">
              <SettingsSection title="Thông tin bên cho thuê" icon={<PersonOutlined />}>
                {ownerFields.map(([key, label, type]) =>
                  type === 'date' ? (
                    <DatePicker
                      key={key}
                      label={label}
                      format="DD/MM/YYYY"
                      value={dateValue(value?.owner[key])}
                      disabled={busy || loading}
                      onChange={(date) =>
                        setValue(
                          (current) =>
                            current && {
                              ...current,
                              owner: {
                                ...current.owner,
                                [key]: date?.isValid() ? date.format('YYYY-MM-DD') : '',
                              },
                            },
                        )
                      }
                      slotProps={{
                        textField: {
                          required: true,
                          fullWidth: true,
                          size: 'small',
                          sx: { '& .MuiInputBase-root': { minHeight: 46 } },
                          slotProps: { inputLabel: { shrink: true } },
                        },
                      }}
                    />
                  ) : (
                    <TextField
                      key={key}
                      label={label}
                      type={type}
                      value={value?.owner[key] ?? ''}
                      disabled={busy || loading}
                      required
                      sx={{
                        ...(key === 'address' ? { gridColumn: '1 / -1' } : {}),
                        '& .MuiInputBase-root:not(.MuiInputBase-multiline)': { minHeight: 46 },
                      }}
                      error={
                        key === 'phone' &&
                        phoneTouched &&
                        !!value &&
                        !!contactPhoneError(value.owner.phone, true)
                      }
                      helperText={
                        key === 'phone' && phoneTouched && value
                          ? contactPhoneError(value.owner.phone, true)
                          : undefined
                      }
                      onBlur={() => {
                        if (key === 'phone') setPhoneTouched(true);
                      }}
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={(e) =>
                        setValue((v) => v && { ...v, owner: { ...v.owner, [key]: e.target.value } })
                      }
                    />
                  ),
                )}
              </SettingsSection>
              <SettingsSection title="Thông tin hợp đồng" icon={<ArticleOutlined />}>
                <DatePicker
                  label="Hiệu lực từ"
                  format="DD/MM/YYYY"
                  value={dateValue(value?.effectiveFrom)}
                  disabled={busy || loading}
                  onChange={(date) => updateDate('effectiveFrom', date)}
                  slotProps={{
                    textField: {
                      required: true,
                      fullWidth: true,
                      size: 'small',
                      sx: { '& .MuiInputBase-root': { minHeight: 46 } },
                      slotProps: { inputLabel: { shrink: true } },
                    },
                  }}
                />
                <DatePicker
                  label="Hiệu lực đến (nếu có)"
                  format="DD/MM/YYYY"
                  value={dateValue(value?.effectiveTo)}
                  disabled={busy || loading}
                  onChange={(date) => updateDate('effectiveTo', date)}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      size: 'small',
                      sx: { '& .MuiInputBase-root': { minHeight: 46 } },
                      slotProps: { inputLabel: { shrink: true } },
                    },
                  }}
                />
                <Box
                  sx={{
                    gridColumn: '1 / -1',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    p: 2,
                    bgcolor: 'primary.light',
                    border: '1px solid',
                    borderColor: 'primary.light',
                    borderRadius: 1.5,
                  }}
                >
                  <LockOutlined sx={{ mt: 0.25, color: 'primary.main' }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Tiền cọc đảm bảo
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 650, mt: 0.25 }}>
                      01 tháng tiền thuê phòng
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Hệ thống tự động tính theo giá thuê của phòng được chọn. Không cho phép chỉnh
                      sửa giá trị này.
                    </Typography>
                  </Box>
                </Box>
              </SettingsSection>
              <SettingsSection title="Điều khoản và thanh toán" icon={<CreditCardOutlined />}>
                <TextField
                  label="Hình thức / chính sách thanh toán"
                  value={value?.paymentTerms ?? ''}
                  disabled={busy || loading}
                  required
                  multiline
                  minRows={3}
                  sx={{ gridColumn: '1 / -1' }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(e) => setValue((v) => v && { ...v, paymentTerms: e.target.value })}
                />
                <TextField
                  label="Điều khoản bổ sung của bên cho thuê"
                  value={value?.additionalTerms ?? ''}
                  disabled={busy || loading}
                  multiline
                  minRows={3}
                  sx={{ gridColumn: '1 / -1' }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(e) => setValue((v) => v && { ...v, additionalTerms: e.target.value })}
                />
              </SettingsSection>
            </LocalizationProvider>
            <Stack
              direction={{ xs: 'column-reverse', sm: 'row' }}
              sx={{
                justifyContent: 'flex-end',
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: 1,
                pt: 0.5,
              }}
            >
              <Button variant="outlined" onClick={() => navigate('/contracts')}>
                Quay lại
              </Button>
              <Button
                variant="contained"
                type="submit"
                disabled={busy || loading || !value}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <SaveOutlined />}
              >
                {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
              </Button>
            </Stack>
          </Stack>
        </ValidatedForm>
        <Accordion
          disableGutters
          elevation={0}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px !important',
            '&:before': { display: 'none' },
            overflow: 'hidden',
          }}
        >
          <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 2.5 }}>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Thông tin mẫu hợp đồng và chế độ ký</Typography>
              <Typography variant="body2" color="text.secondary">
                Chi tiết kỹ thuật và trạng thái cấu hình
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <ContractConfigurationPanel api={api} />
          </AccordionDetails>
        </Accordion>
      </Stack>
    </Box>
  );
}
