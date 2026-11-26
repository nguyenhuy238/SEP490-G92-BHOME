import { useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Copy, Link2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  paymentError,
  type PaymentMode,
  type SePayConnectionView,
} from '../../../../../packages/client-core/src/payments';
import banks from '../../../../../packages/client-core/src/banks.json';
import { usePaymentApi } from './usePaymentApi';
import { usePaymentMode } from './usePaymentMode';
import { PaymentModeSwitch } from './PaymentModeSwitch';

export function OwnerReceivingAccountPanel() {
  const api = usePaymentApi();
  const { session } = useAuth();
  const mode = usePaymentMode();
  const [feedback, setFeedback] = useState<{
    mode: PaymentMode;
    severity: 'success' | 'error';
    text: string;
  } | null>(null);
  const connection = useQuery({
    queryKey: ['owner-sepay-connection', session?.userId, mode.data?.mode],
    enabled: !!mode.data,
    queryFn: ({ signal }) =>
      api.request<SePayConnectionView>(
        `/api/v1/receiving-bank-accounts/owner/sepay/${mode.data!.mode}`,
        { signal },
      ),
  });
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 780, width: '100%' }}>
      <Stack spacing={2.5}>
        <Typography variant="h6">Tài khoản nhận tiền</Typography>
        <PaymentModeSwitch />
        <Divider />
        {connection.isPending && !!mode.data && (
          <LinearProgress aria-label="Đang tải cấu hình nhận tiền" />
        )}
        {connection.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void connection.refetch()}>Thử lại</Button>}
          >
            {paymentError(connection.error)}
          </Alert>
        )}
        {feedback && feedback.mode === mode.data?.mode && (
          <Alert severity={feedback.severity}>{feedback.text}</Alert>
        )}
        {connection.data && !connection.error && (
          <ConnectionEditor
            key={`${connection.data.mode}:${connection.data.version}:${connection.data.account?.version ?? 0}`}
            value={connection.data}
            notify={(severity, text) => setFeedback({ mode: connection.data.mode, severity, text })}
          />
        )}
      </Stack>
    </Paper>
  );
}

function ConnectionEditor({
  value,
  notify,
}: {
  value: SePayConnectionView;
  notify: (severity: 'success' | 'error', text: string) => void;
}) {
  const api = usePaymentApi();
  const cache = useQueryClient();
  const { session } = useAuth();
  const [bank, setBank] = useState(value.account?.bankIdentifier ?? '');
  const [gateway, setGateway] = useState(
    value.gateway ?? banks.find((b) => b.bin === bank)?.code ?? '',
  );
  const [number, setNumber] = useState(value.account?.accountNumber ?? '');
  const [holder, setHolder] = useState(value.account?.accountHolder ?? '');
  const [apiToken, setApiToken] = useState('');
  const [secret, setSecret] = useState('');
  const [expanded, setExpanded] = useState(
    value.status !== 'Connected' && value.status !== 'ServerConfigured',
  );
  const [enabled, setEnabled] = useState(value.account?.enabled ?? true);
  const [confirmed, setConfirmed] = useState(!!value.account);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dirty =
    bank !== (value.account?.bankIdentifier ?? '') ||
    number !== (value.account?.accountNumber ?? '') ||
    holder !== (value.account?.accountHolder ?? '') ||
    enabled !== (value.account?.enabled ?? true) ||
    gateway !== (value.gateway ?? banks.find((b) => b.bin === bank)?.code ?? '') ||
    !!apiToken ||
    !!secret;
  const edit = () => setConfirmed(false);
  const cleanHolder = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase();
  async function save(check: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const saved = await api.request<SePayConnectionView>(
        `/api/v1/receiving-bank-accounts/owner/sepay/${value.mode}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            bankIdentifier: bank,
            gateway,
            accountNumber: number,
            accountHolder: holder.trim(),
            enabled,
            humanVerified: confirmed,
            expectedAccountVersion: value.account?.version ?? 0,
            expectedVersion: value.version,
            apiToken: apiToken || null,
            webhookSecret: secret || null,
          }),
        },
      );
      // Keys are write-only. Never seed the query cache or inputs with a returned secret.
      setApiToken('');
      setSecret('');
      let message = `Đã lưu cấu hình ${value.mode}.`;
      if (check) {
        const result = await api.request<{ connected: boolean; code: string }>(
          `/api/v1/receiving-bank-accounts/owner/sepay/${value.mode}/check`,
          { method: 'POST' },
        );
        if (!result.connected) throw { code: result.code };
        message = `Đã kết nối SePay ${value.mode} và xác minh tài khoản nhận tiền.`;
      }
      cache.setQueryData(['owner-sepay-connection', session?.userId, value.mode], saved);
      notify('success', message);
    } catch (e) {
      notify('error', paymentError(e));
    } finally {
      await cache.invalidateQueries({ queryKey: ['owner-sepay-connection'] });
      await cache.invalidateQueries({ queryKey: ['receiving-account'] });
      await cache.invalidateQueries({ queryKey: ['sepay-payment-mode'] });
      lock.current = false;
      setBusy(false);
    }
  }
  const modeLabel: Record<PaymentMode, string> = { Test: 'Test', Live: 'Live' };
  return (
    <Stack
      component={ValidatedForm}
      spacing={2}
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        void save(submitter?.getAttribute('value') === 'check');
      }}
    >
      <Autocomplete
        options={banks}
        value={banks.find((b) => b.bin === bank) ?? null}
        getOptionLabel={(b) => `${b.name} (${b.code})`}
        disabled={busy}
        onChange={(_, selected) => {
          edit();
          setBank(selected?.bin ?? '');
          setGateway(selected?.code ?? '');
        }}
        renderInput={(params) => (
          <TextField {...params} label="Ngân hàng" placeholder="Chọn ngân hàng" />
        )}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="BIN ngân hàng (6 số)"
          value={bank}
          required
          fullWidth
          disabled={busy}
          onChange={(e) => {
            edit();
            setBank(e.target.value);
            setGateway(banks.find((b) => b.bin === e.target.value)?.code ?? '');
          }}
          slotProps={{ htmlInput: { pattern: '[0-9]{6}', inputMode: 'numeric', maxLength: 6 } }}
        />
        <TextField
          label="Số tài khoản nhận tiền"
          value={number}
          required
          fullWidth
          disabled={busy}
          onChange={(e) => {
            edit();
            setNumber(e.target.value.replace(/\s/g, ''));
          }}
          slotProps={{ htmlInput: { pattern: '[0-9]{6,19}', inputMode: 'numeric', maxLength: 19 } }}
        />
      </Stack>
      {!banks.some((b) => b.bin === bank) && (
        <TextField
          label="Mã ngân hàng trên SePay"
          value={gateway}
          required
          disabled={busy}
          onChange={(e) => {
            edit();
            setGateway(e.target.value);
          }}
          helperText="Dùng tên ngắn ngân hàng của tài khoản đã liên kết SePay."
        />
      )}
      <TextField
        label="Chủ tài khoản"
        value={holder}
        required
        disabled={busy}
        onChange={(e) => {
          edit();
          setHolder(cleanHolder(e.target.value));
        }}
        placeholder="TEN CHU TAI KHOAN"
        slotProps={{ htmlInput: { pattern: '[A-Z0-9 ]{5,50}', maxLength: 50 } }}
      />
      <Divider />
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Kết nối SePay
        </Typography>
        <Chip
          size="small"
          color={
            value.status === 'Connected' || value.status === 'ServerConfigured'
              ? 'success'
              : 'warning'
          }
          label={
            value.status === 'Connected' || value.status === 'ServerConfigured'
              ? 'Đã kết nối'
              : value.status === 'Configured'
                ? 'Chờ kiểm tra'
                : 'Chưa kết nối'
          }
        />
      </Stack>
      <Button
        variant="outlined"
        startIcon={<Link2 size={16} />}
        disabled={busy}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        Cấu hình kết nối SePay
      </Button>
      <Collapse in={expanded}>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {value.status === 'KeyUnavailable' && (
            <Alert severity="error">
              Không đọc được khóa đã lưu. Hãy nhập lại cả API Token và HMAC Secret hoặc khôi phục
              keyring của máy chủ.
            </Alert>
          )}
          <TextField
            label={`API Token ${modeLabel[value.mode]}`}
            type="password"
            value={apiToken}
            disabled={busy}
            onChange={(e) => {
              edit();
              setApiToken(e.target.value);
            }}
            placeholder={value.hasApiToken ? 'Đã lưu — để trống để giữ nguyên' : 'Nhập API Token'}
            autoComplete="new-password"
          />
          <TextField
            label={`Webhook Secret ${modeLabel[value.mode]}`}
            type="password"
            value={secret}
            disabled={busy}
            onChange={(e) => {
              edit();
              setSecret(e.target.value);
            }}
            placeholder={
              value.hasWebhookSecret ? 'Đã lưu — để trống để giữ nguyên' : 'Nhập HMAC Secret'
            }
            autoComplete="new-password"
            slotProps={{ htmlInput: { minLength: 32 } }}
            helperText="Tối thiểu 32 ký tự. Dùng cùng secret trong cấu hình Webhook trên SePay."
          />
          <Typography variant="caption" color="text.secondary">
            API Token và HMAC Secret được lưu mã hóa trên máy chủ; để trống để giữ khóa đã lưu.
          </Typography>
          <TextField
            label="Đường dẫn Webhook"
            value={value.webhookPath}
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <Button
                    size="small"
                    aria-label="Sao chép đường dẫn Webhook"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(value.webhookPath)
                        .then(() => notify('success', 'Đã sao chép đường dẫn Webhook.'))
                        .catch(() =>
                          notify('error', 'Không sao chép được. Hãy chọn và sao chép đường dẫn.'),
                        );
                    }}
                  >
                    <Copy size={16} />
                  </Button>
                ),
              },
            }}
            helperText="Dùng đường dẫn này trên địa chỉ HTTPS công khai của API khi cấu hình Webhook SePay."
          />
          <Button type="submit" value="check" variant="outlined" disabled={busy || !confirmed}>
            Kiểm tra kết nối
          </Button>
        </Stack>
      </Collapse>
      <FormControlLabel
        control={
          <Checkbox
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              edit();
              setEnabled(e.target.checked);
            }}
          />
        }
        label="Bật hướng dẫn nhận tiền"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
        }
        label="Tôi đã kiểm tra thông tin tài khoản nhận"
      />
      {busy && (
        <Typography variant="body2" role="status">
          Đang lưu cấu hình…
        </Typography>
      )}
      <Button
        type="submit"
        value="save"
        variant="contained"
        disabled={busy || !confirmed || !dirty}
      >
        Lưu cấu hình
      </Button>
    </Stack>
  );
}
