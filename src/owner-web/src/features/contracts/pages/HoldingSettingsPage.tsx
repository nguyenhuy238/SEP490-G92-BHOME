import { TextField } from '../../../components/common/ValidatedForm';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  FileText,
  History,
  Info,
  Calculator,
  Save,
} from 'lucide-react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import {
  holdingSettingsClient,
  type HoldingSettings,
  type HoldingPreparation,
} from '../../../../../../packages/client-core/src/holdingSettings';
import {
  contractClient,
  contractError,
  formatContractMoney,
} from '../../../../../../packages/client-core/src/contracts';
import { apiBaseUrl, isMockMode } from '../../../services/config';
import { PageHeader } from '../../../components/common/PortalUI';

const surface = { borderColor: '#E2E8F0', borderRadius: '12px', backgroundColor: '#FFFFFF' };
const fields = {
  '& .MuiInputLabel-root': {
    position: 'static',
    transform: 'none',
    maxWidth: '100%',
    mb: 0.75,
    color: '#0F172A',
    fontSize: 14,
    fontWeight: 500,
  },
  '& .MuiOutlinedInput-root': {
    minHeight: 44,
    borderRadius: '8px',
    fontSize: 14,
    transition: 'box-shadow 160ms ease',
    '&.Mui-focused': { boxShadow: '0 0 0 3px #BFDBFE' },
  },
  '& .MuiOutlinedInput-notchedOutline': {
    top: 0,
    borderColor: '#E2E8F0',
    '& legend': { display: 'none' },
  },
  '& .MuiOutlinedInput-input:not(textarea)': { py: '10px' },
  '& .MuiFormHelperText-root': { mx: 0, fontSize: 12 },
};

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Building2;
  title: string;
  description?: string;
}) {
  return (
    <Box>
      <Typography
        component="h2"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 16, fontWeight: 650 }}
      >
        <Icon size={18} aria-hidden="true" />
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}
    </Box>
  );
}

export default function HoldingSettingsPage() {
  return isMockMode ? (
    <Stack spacing={3}>
      <PageHeader title="Cấu hình hợp đồng giữ chỗ" />
      <Alert severity="info">Cấu hình giữ chỗ theo cơ sở chỉ hoạt động ở chế độ API.</Alert>
    </Stack>
  ) : (
    <LiveHoldingSettingsPage />
  );
}

function LiveHoldingSettingsPage() {
  const { client } = useAuth();
  const request = useMemo(
    () =>
      createApiClient(apiBaseUrl, () => client.session?.accessToken, client.clear, client.refresh),
    [client],
  );
  const api = useMemo(() => holdingSettingsClient(request), [request]);
  const contracts = useMemo(() => contractClient(request), [request]);
  const [locations, setLocations] = useState<{ id: string; label: string }[]>([]);
  const [location, setLocation] = useState('');
  const [rooms, setRooms] = useState<{ id: string; label: string }[]>([]);
  const [room, setRoom] = useState('');
  const [settings, setSettings] = useState<HoldingSettings | null>(null);
  const [months, setMonths] = useState('');
  const [factor, setFactor] = useState('1');
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [preview, setPreview] = useState<HoldingPreparation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HoldingSettings[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  const [validate, setValidate] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const fieldErrors = {
    months:
      !Number.isInteger(Number(months)) || Number(months) < 1 || Number(months) > 120
        ? 'Nhập số nguyên từ 1 đến 120.'
        : '',
    factor:
      !/^\d+(\.\d{1,2})?$/.test(factor) || Number(factor) <= 0 || Number(factor) > 120
        ? 'Nhập hệ số lớn hơn 0, tối đa 120 và có tối đa hai chữ số thập phân.'
        : '',
    terms: !terms.trim() ? 'Nhập điều khoản giữ chỗ.' : '',
  };
  const [baseline, setBaseline] = useState({ months: '', factor: '1', terms: '' });
  const dirty =
    !!location &&
    (months !== baseline.months || factor !== baseline.factor || terms !== baseline.terms);
  const locationLabel = locations.find((item) => item.id === location)?.label;
  const status = loading
    ? 'Đang tải'
    : loadFailed
      ? 'Không tải được'
      : dirty
        ? 'Chưa lưu thay đổi'
        : settings || success
          ? 'Đã lưu'
          : location
            ? 'Chưa có cấu hình'
            : 'Chưa chọn cơ sở';
  const lock = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    void contracts
      .locations(abort.signal)
      .then(setLocations)
      .catch((e) => {
        if (!abort.signal.aborted) setError(contractError(e));
      });
    return () => abort.abort();
  }, [contracts]);
  function changeLocation(next: string) {
    setBaseline({ months: '', factor: '1', terms: '' });
    setValidate(false);
    setLoadFailed(false);
    setSettings(null);
    setMonths('');
    setFactor('1');
    setTerms('');
    setRooms([]);
    setRoom('');
    setPreview(null);
    setPreviewOpen(false);
    setPreviewError('');
    setSuccess('');
    setError('');
    setHistoryOpen(false);
    setHistory(null);
    setLoading(!!next);
    setLocation(next);
  }
  useEffect(() => {
    if (!location) return;
    const abort = new AbortController();
    void Promise.all([api.get(location, abort.signal), contracts.rooms(location, abort.signal)])
      .then(([value, items]) => {
        if (abort.signal.aborted) return;
        setSettings(value);
        setRooms(items);
        if (value) {
          setBaseline({
            months: String(value.holdingMonths),
            factor: value.depositRentMonths,
            terms: value.terms,
          });
          setMonths(String(value.holdingMonths));
          setFactor(value.depositRentMonths);
          setTerms(value.terms);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(contractError(e));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [api, contracts, location]);
  useEffect(() => {
    if (!room || !settings || !previewOpen) return;
    const abort = new AbortController();
    void api
      .prepare(room, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setPreview(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setPreviewError(contractError(e));
      });
    return () => abort.abort();
  }, [api, room, settings, previewOpen]);
  useEffect(() => {
    if (!historyOpen || !location) return;
    const abort = new AbortController();
    void api
      .versions(location, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setHistory(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setHistoryError(contractError(e));
      });
    return () => abort.abort();
  }, [api, historyOpen, location, settings?.version]);
  async function save() {
    if (lock.current || !location || loading || loadFailed) return;
    setValidate(true);
    if (fieldErrors.months || fieldErrors.factor || fieldErrors.terms) {
      return;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    setPreview(null);
    setPreviewError('');
    try {
      await api.save(location, {
        holdingMonths: Number(months),
        depositRentMonths: factor,
        terms: terms.trim(),
        expectedVersion: settings?.version ?? 0,
      });
      const persisted = await api.get(location);
      const nextBaseline = persisted
        ? {
            months: String(persisted.holdingMonths),
            factor: persisted.depositRentMonths,
            terms: persisted.terms,
          }
        : { months, factor, terms };
      setBaseline(nextBaseline);
      setMonths(nextBaseline.months);
      setFactor(nextBaseline.factor);
      setTerms(nextBaseline.terms);
      setSettings(persisted);
      setValidate(false);
      setSuccess(
        'Đã lưu cấu hình giữ chỗ cho cơ sở đang chọn. Các hợp đồng đã tạo được giữ nguyên.',
      );
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Stack spacing={3} sx={{ maxWidth: 1360, mx: 'auto', minWidth: 0, color: '#0F172A' }}>
      <Box component="header">
        <Typography
          component="nav"
          aria-label="Đường dẫn"
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1 }}
        >
          Cấu hình / <span aria-current="page">Hợp đồng giữ chỗ</span>
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{
            justifyContent: 'space-between',
            alignItems: { xs: 'flex-start', md: 'center' },
            gap: 2,
          }}
        >
          <Box>
            <Typography
              component="h1"
              sx={{ fontSize: { xs: 23, md: 28 }, fontWeight: 700, letterSpacing: '-0.025em' }}
            >
              Cấu hình hợp đồng giữ chỗ
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Thiết lập thời hạn, mức tiền giữ chỗ và điều khoản áp dụng cho từng cơ sở.
            </Typography>
          </Box>
          <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <Chip
              size="small"
              label={status}
              color={status === 'Đã lưu' ? 'success' : dirty ? 'warning' : 'default'}
            />
            <Button
              variant="outlined"
              startIcon={<History size={16} />}
              disabled={!settings || loading || saving}
              onClick={() => {
                setHistory(null);
                setHistoryError('');
                setHistoryOpen(true);
              }}
            >
              Lịch sử phiên bản
            </Button>
          </Stack>
        </Stack>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          '@media (min-width: 1024px)': {
            gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          },
          alignItems: 'start',
          gap: 3,
        }}
      >
        <Paper
          variant="outlined"
          component="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          sx={{ ...surface, ...fields, p: { xs: 2, sm: 3 } }}
        >
          <Stack spacing={3}>
            <Stack component="section" spacing={2}>
              <SectionHeading
                icon={Building2}
                title="Cơ sở áp dụng"
                description="Mỗi cơ sở có cấu hình giữ chỗ riêng."
              />
              <TextField
                select
                fullWidth
                label="Cơ sở áp dụng"
                value={location}
                disabled={saving}
                sx={{ maxWidth: 400 }}
                onChange={(e) => {
                  if (dirty) setPendingLocation(e.target.value);
                  else changeLocation(e.target.value);
                }}
              >
                <MenuItem value="">Chọn cơ sở</MenuItem>
                {locations.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            {loading && (
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }} role="status">
                <CircularProgress size={18} />
                Đang tải cấu hình…
              </Stack>
            )}
            {!!error && (
              <Alert severity="error" sx={{ py: 0.25 }}>
                {error}
              </Alert>
            )}
            {location && !loading && !loadFailed && (
              <>
                <Stack
                  component="section"
                  spacing={2}
                  sx={{ borderTop: '1px solid #E2E8F0', pt: 3 }}
                >
                  <SectionHeading
                    icon={CalendarClock}
                    title="Thiết lập giữ chỗ"
                    description="Quy định thời hạn và cách tính tiền giữ chỗ."
                  />
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'minmax(0, 1fr)',
                        sm: 'repeat(2, minmax(0, 1fr))',
                      },
                      gap: 2,
                    }}
                  >
                    <TextField
                      label="Thời hạn giữ chỗ"
                      type="number"
                      required
                      value={months}
                      disabled={saving}
                      onChange={(e) => setMonths(e.target.value)}
                      error={validate && !!fieldErrors.months}
                      helperText={
                        (validate && fieldErrors.months) || 'Tính từ ngày bắt đầu giữ chỗ.'
                      }
                      slotProps={{
                        htmlInput: { min: 1, max: 120, step: 1 },
                        input: {
                          endAdornment: <InputAdornment position="end">tháng</InputAdornment>,
                        },
                      }}
                    />
                    <TextField
                      label="Hệ số tiền giữ chỗ"
                      type="number"
                      required
                      value={factor}
                      disabled={saving}
                      onChange={(e) => setFactor(e.target.value)}
                      error={validate && !!fieldErrors.factor}
                      helperText={
                        (validate && fieldErrors.factor) ||
                        'Ví dụ: 1 tương đương một tháng tiền thuê.'
                      }
                      slotProps={{
                        htmlInput: { min: 0.01, max: 120, step: 0.01 },
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">tháng tiền thuê</InputAdornment>
                          ),
                        },
                      }}
                    />
                  </Box>
                </Stack>
                <Stack
                  component="section"
                  spacing={2}
                  sx={{ borderTop: '1px solid #E2E8F0', pt: 3 }}
                >
                  <SectionHeading
                    icon={FileText}
                    title="Điều khoản giữ chỗ"
                    description="Nội dung được đưa vào hợp đồng giữ chỗ."
                  />
                  <TextField
                    label="Điều khoản giữ chỗ"
                    multiline
                    minRows={5}
                    required
                    value={terms}
                    disabled={saving}
                    onChange={(e) => setTerms(e.target.value)}
                    error={validate && !!fieldErrors.terms}
                    helperText={
                      (validate && fieldErrors.terms) ||
                      'Điều khoản riêng cho giữ chỗ, tách biệt với điều khoản cọc thuê chính thức.'
                    }
                    sx={{ '& textarea': { lineHeight: 1.55 } }}
                  />
                </Stack>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 1.5,
                    borderTop: '1px solid #E2E8F0',
                    pt: 2,
                  }}
                >
                  <Typography role="status" variant="body2" color="success.main">
                    {success && !dirty ? 'Đã lưu cấu hình.' : ''}
                  </Typography>
                  <Button
                    variant="contained"
                    type="submit"
                    disabled={saving}
                    startIcon={
                      saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />
                    }
                    sx={{
                      minHeight: 44,
                      ml: 'auto',
                      bgcolor: '#2563EB',
                      borderRadius: '8px',
                      '&:hover': { bgcolor: '#1D4ED8' },
                    }}
                  >
                    {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Paper>
        <Stack component="aside" spacing={2}>
          <Paper variant="outlined" sx={{ ...surface, p: { xs: 2, sm: 3 } }}>
            <SectionHeading
              icon={ClipboardList}
              title="Tổng quan cấu hình"
              description="Thông tin của phiên bản đã lưu."
            />
            <Box
              component="dl"
              sx={{
                mb: 0,
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                gap: 1.25,
                fontSize: 14,
              }}
            >
              {[
                ['Cơ sở', locationLabel ?? '—'],
                ['Thời hạn giữ chỗ', settings ? settings.holdingMonths + ' tháng' : '—'],
                ['Hệ số giữ chỗ', settings ? settings.depositRentMonths + ' tháng tiền thuê' : '—'],
                ['Phiên bản hiện tại', settings?.version ?? '—'],
                ['Trạng thái', status],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                  <Box component="dt" sx={{ color: 'text.secondary' }}>
                    {label}
                  </Box>
                  <Box
                    component="dd"
                    sx={{ m: 0, textAlign: 'right', overflowWrap: 'anywhere', fontWeight: 550 }}
                  >
                    {value}
                  </Box>
                </Box>
              ))}
            </Box>
          </Paper>
          <Paper variant="outlined" sx={{ ...surface, p: { xs: 2, sm: 3 } }}>
            <SectionHeading icon={Calculator} title="Cách tính tiền giữ chỗ" />
            <Typography
              variant="body2"
              sx={{ mt: 1.5, p: 1.5, bgcolor: '#F8FAFC', borderRadius: '8px', lineHeight: 1.6 }}
            >
              <strong>Tiền giữ chỗ</strong> = Giá thuê phòng hiện tại × Hệ số tiền giữ chỗ
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Thời hạn giữ chỗ độc lập với hệ số tiền giữ chỗ.
            </Typography>
          </Paper>
          <Paper variant="outlined" sx={{ ...surface, p: { xs: 2, sm: 3 } }}>
            <SectionHeading icon={Info} title="Lưu ý khi áp dụng" />
            <Box
              component="ul"
              sx={{
                pl: 2.25,
                mb: 0,
                mt: 1,
                color: 'text.secondary',
                fontSize: 13,
                lineHeight: 1.6,
                '& li + li': { mt: 0.5 },
              }}
            >
              <li>Cấu hình chỉ áp dụng cho cơ sở đang chọn. Các hợp đồng đã tạo giữ nguyên.</li>
              <li>Phòng chưa có giá thuê sẽ bị chặn tạo hợp đồng giữ chỗ.</li>
              {location && !loading && !loadFailed && !settings && (
                <li>Lưu cấu hình trước khi Staff tạo hợp đồng giữ chỗ.</li>
              )}
            </Box>
          </Paper>
        </Stack>
      </Box>
      <Paper
        variant="outlined"
        component="section"
        sx={{ ...surface, ...fields, p: { xs: 2, sm: 3 } }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            justifyContent: 'space-between',
            alignItems: { xs: 'flex-start', sm: 'center' },
            gap: 1,
          }}
        >
          <SectionHeading
            icon={Building2}
            title="Mức tiền giữ chỗ theo phòng"
            description="Xem mức tiền giữ chỗ được tính từ giá thuê của từng phòng."
          />
          <Button
            aria-expanded={previewOpen}
            aria-controls="holding-room-preview"
            onClick={() => setPreviewOpen((open) => !open)}
            endIcon={
              <ChevronDown
                size={16}
                style={{ transform: previewOpen ? 'rotate(180deg)' : undefined }}
              />
            }
            sx={{ flexShrink: 0, minHeight: 44 }}
          >
            {previewOpen ? 'Thu gọn' : 'Xem theo phòng'}
          </Button>
        </Stack>
        <Collapse in={previewOpen}>
          <Stack id="holding-room-preview" spacing={2} sx={{ mt: 2 }}>
            {!settings ? (
              <Typography variant="body2" color="text.secondary">
                Chọn cơ sở đã có cấu hình để xem mức tiền theo phòng.
              </Typography>
            ) : (
              <>
                <TextField
                  select
                  label="Phòng"
                  value={room}
                  sx={{ maxWidth: 400 }}
                  onChange={(e) => {
                    setPreview(null);
                    setPreviewError('');
                    setRoom(e.target.value);
                  }}
                >
                  <MenuItem value="">Chọn phòng</MenuItem>
                  {rooms.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                {!rooms.length && (
                  <Typography variant="body2" color="text.secondary">
                    Cơ sở chưa có phòng khả dụng để xem mức tiền giữ chỗ.
                  </Typography>
                )}
                {!!room && !preview && !previewError && (
                  <Typography role="status" variant="body2">
                    Đang tính mức tiền giữ chỗ…
                  </Typography>
                )}
                {!!previewError && (
                  <Alert severity="error" sx={{ py: 0.25 }}>
                    {previewError}
                  </Alert>
                )}
                {preview && (
                  <TableContainer>
                    <Table size="small" aria-label="Tiền giữ chỗ theo phòng">
                      <TableHead>
                        <TableRow>
                          <TableCell>Phòng</TableCell>
                          <TableCell align="right">Giá thuê hiện tại</TableCell>
                          <TableCell align="right">Hệ số giữ chỗ</TableCell>
                          <TableCell align="right">Tiền giữ chỗ dự kiến</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell component="th" scope="row">
                            {preview.roomNumber}
                          </TableCell>
                          <TableCell align="right">
                            {formatContractMoney(preview.monthlyRent)}/tháng
                          </TableCell>
                          <TableCell align="right">
                            {preview.settingsVersion === settings.version
                              ? settings.depositRentMonths
                              : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>
                            {formatContractMoney(preview.holdingDeposit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                {preview && (
                  <Typography variant="body2" color="text.secondary">
                    Thời hạn giữ chỗ đã lưu: {preview.holdingMonths} tháng.
                  </Typography>
                )}
              </>
            )}
          </Stack>
        </Collapse>
      </Paper>
      <Dialog
        open={pendingLocation !== null}
        onClose={() => setPendingLocation(null)}
        aria-labelledby="holding-discard-title"
      >
        <DialogTitle id="holding-discard-title">Bỏ thay đổi chưa lưu?</DialogTitle>
        <DialogContent>Đổi cơ sở sẽ bỏ các chỉnh sửa chưa lưu ở cơ sở hiện tại.</DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setPendingLocation(null)}>
            Tiếp tục chỉnh sửa
          </Button>
          <Button
            color="error"
            onClick={() => {
              if (pendingLocation !== null) changeLocation(pendingLocation);
              setPendingLocation(null);
            }}
          >
            Bỏ thay đổi và đổi cơ sở
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Lịch sử cấu hình giữ chỗ</DialogTitle>
        <DialogContent>
          {historyError ? (
            <Alert severity="error">{historyError}</Alert>
          ) : history === null ? (
            <CircularProgress size={24} />
          ) : (
            <Stack spacing={2}>
              {history.length === 0 && (
                <Typography color="text.secondary">Chưa có lịch sử.</Typography>
              )}
              {history.map((revision) => (
                <Stack
                  key={revision.version}
                  spacing={0.5}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}
                >
                  <Typography sx={{ fontWeight: 700 }}>Phiên bản {revision.version}</Typography>
                  <Typography variant="body2">
                    {revision.holdingMonths} tháng · Tiền giữ chỗ bằng {revision.depositRentMonths}{' '}
                    tháng tiền thuê
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {revision.terms}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
