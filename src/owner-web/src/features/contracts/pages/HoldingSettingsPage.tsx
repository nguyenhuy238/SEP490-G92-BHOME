import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { History, Save } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import {
  holdingSettingsClient,
  type HoldingSettings,
} from '../../../../../../packages/client-core/src/holdingSettings';
import { contractError } from '../../../../../../packages/client-core/src/contracts';
import { apiBaseUrl, isMockMode } from '../../../services/config';
import { PageHeader } from '../../../components/common/PortalUI';

const panelSx = { borderColor: '#E2E8F0', borderRadius: '12px', p: { xs: 2, md: 3 } };

export default function HoldingSettingsPage() {
  return isMockMode ? (
    <Stack spacing={3}>
      <PageHeader title="Chính sách hợp đồng giữ chỗ" />
      <Alert severity="info">Chính sách giữ chỗ chỉ hoạt động ở chế độ API.</Alert>
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
  const [settings, setSettings] = useState<HoldingSettings | null>(null);
  const [terms, setTerms] = useState('');
  const [baseline, setBaseline] = useState('');
  const [history, setHistory] = useState<HoldingSettings[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const lock = useRef(false);
  const dirty = terms !== baseline;

  useEffect(() => {
    const abort = new AbortController();
    void api
      .get(abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        setSettings(value);
        setTerms(value?.terms ?? '');
        setBaseline(value?.terms ?? '');
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(contractError(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [api]);

  useEffect(() => {
    if (!historyOpen) return;
    const abort = new AbortController();
    void api
      .versions(abort.signal)
      .then(setHistory)
      .catch((e) => {
        if (!abort.signal.aborted) setError(contractError(e));
      });
    return () => abort.abort();
  }, [api, historyOpen, settings?.version]);

  async function save() {
    if (lock.current || !terms.trim()) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await api.save({ terms: terms.trim(), expectedVersion: settings?.version ?? 0 });
      const persisted = await api.get();
      setSettings(persisted);
      setTerms(persisted?.terms ?? '');
      setBaseline(persisted?.terms ?? '');
      setSuccess('Đã lưu chính sách giữ chỗ toàn hệ thống.');
      setConfirmOpen(false);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1120, mx: 'auto', minWidth: 0 }}>
      <PageHeader title="Chính sách hợp đồng giữ chỗ" />
      <Alert severity="info" sx={{ borderRadius: 2 }}>
        Áp dụng thống nhất cho tất cả cơ sở hiện tại và cơ sở tạo mới thuộc Owner này.
      </Alert>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <Paper variant="outlined" sx={panelSx}>
          <Typography variant="body2" color="text.secondary">
            Thời hạn giữ chỗ
          </Typography>
          <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 700 }}>
            1 tháng dương lịch
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={panelSx}>
          <Typography variant="body2" color="text.secondary">
            Tiền giữ chỗ
          </Typography>
          <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 700 }}>
            Bằng 1 tháng tiền thuê
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Tính theo giá thuê hiệu lực của từng phòng.
          </Typography>
        </Paper>
      </Box>
      <Paper
        variant="outlined"
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmOpen(true);
        }}
        sx={panelSx}
      >
        <Stack spacing={2}>
          <Box>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 700 }}>
              Điều khoản giữ chỗ
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Chỉnh sửa nội dung áp dụng cho các hợp đồng giữ chỗ tạo sau khi lưu.
            </Typography>
          </Box>
          {loading && <CircularProgress size={22} aria-label="Đang tải chính sách" />}
          {error && <Alert severity="error">{error}</Alert>}
          {success && !dirty && <Alert severity="success">{success}</Alert>}
          {!loading && !settings && !terms && (
            <Alert severity="warning">
              Chưa có chính sách toàn cục. Nhập điều khoản và lưu để bật tạo hợp đồng giữ chỗ.
            </Alert>
          )}
          <TextField
            label="Điều khoản giữ chỗ"
            multiline
            minRows={7}
            maxRows={18}
            required
            value={terms}
            disabled={loading || saving}
            onChange={(e) => setTerms(e.target.value)}
            helperText="Thời hạn và tiền giữ chỗ được cố định theo chính sách toàn cục."
          />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' } }}
          >
            <Button
              startIcon={<History size={17} />}
              onClick={() => {
                setHistory(null);
                setHistoryOpen(true);
              }}
              disabled={loading}
            >
              Lịch sử phiên bản
            </Button>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button
                disabled={!dirty || saving}
                onClick={() => {
                  setTerms(baseline);
                  setError('');
                  setSuccess('');
                }}
              >
                Hủy thay đổi
              </Button>
              <Button
                variant="contained"
                type="submit"
                disabled={loading || saving || !dirty || !terms.trim()}
                startIcon={
                  saving ? <CircularProgress size={16} color="inherit" /> : <Save size={17} />
                }
              >
                {saving ? 'Đang lưu…' : 'Lưu chính sách'}
              </Button>
            </Stack>
          </Stack>
          {settings && (
            <Typography variant="caption" color="text.secondary">
              Phiên bản {settings.version} · Cập nhật{' '}
              {new Date(settings.updatedAt).toLocaleString('vi-VN')}
            </Typography>
          )}
        </Stack>
      </Paper>
      <Dialog open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)}>
        <DialogTitle>Xác nhận cập nhật chính sách?</DialogTitle>
        <DialogContent>
          Chính sách mới áp dụng cho hợp đồng giữ chỗ được tạo sau khi lưu. Hợp đồng và cấu hình
          lịch sử hiện có được giữ nguyên.
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setConfirmOpen(false)}>
            Quay lại
          </Button>
          <Button
            variant="contained"
            disabled={saving || !terms.trim()}
            onClick={() => void save()}
          >
            Xác nhận lưu
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Lịch sử chính sách giữ chỗ</DialogTitle>
        <DialogContent>
          {history === null ? (
            <CircularProgress size={22} />
          ) : history.length === 0 ? (
            <Typography color="text.secondary">Chưa có lịch sử chính sách.</Typography>
          ) : (
            <Stack spacing={2}>
              {history.map((revision) => (
                <Box
                  key={revision.version}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}
                >
                  <Typography sx={{ fontWeight: 700 }}>
                    Phiên bản {revision.version}
                    {revision.version === settings?.version ? ' · Hiện tại' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(revision.updatedAt).toLocaleString('vi-VN')} · Thời hạn 1 tháng · Tiền
                    giữ chỗ bằng 1 tháng tiền thuê
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {revision.terms}
                  </Typography>
                </Box>
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
