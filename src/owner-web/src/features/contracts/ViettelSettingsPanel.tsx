import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Chip, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import {
  signingError,
  type SettingSource,
  type SigningClient,
} from '../../../../../packages/client-core/src/signing';
import { formatInstant } from '../../../../../packages/client-core/src/localization';

const source = (s: SettingSource) =>
  s === 'DATABASE' ? 'đã lưu' : s === 'CONFIGURATION' ? 'cấu hình máy chủ' : 'chưa có';

// "Tài khoản ký số Viettel MySign" (Owner only): the Client ID / Client Secret Viettel issued for BHOME. The secret
// is encrypted on the server and never shown again, only its last four characters.
export function ViettelSettingsPanel({ signing }: { signing: SigningClient }) {
  const queries = useQueryClient();
  const view = useQuery({
    staleTime: 0,
    queryKey: ['viettel-settings'],
    queryFn: ({ signal }) => signing.viettel(signal),
  });
  const [edits, setEdits] = useState<
    Partial<Record<'baseUrl' | 'clientId' | 'profileId' | 'clientSecret', string>>
  >({});
  const [subscriber, setSubscriber] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');

  // Typed changes over what the server returned; cleared after each save so the saved values show again.
  const shown = (k: keyof typeof edits) =>
    edits[k] ?? (k === 'clientSecret' ? '' : (view.data?.[k] ?? ''));
  const form = {
    baseUrl: shown('baseUrl'),
    clientId: shown('clientId'),
    profileId: shown('profileId'),
    clientSecret: shown('clientSecret'),
  };

  async function run(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
      void queries.invalidateQueries({ queryKey: ['viettel-settings'] });
    }
  }
  const v = view.data;
  const field = (name: keyof typeof edits, label: string, extra?: string) => (
    <TextField
      size="small"
      label={label}
      value={form[name]}
      disabled={busy}
      helperText={extra}
      type={name === 'clientSecret' ? 'password' : 'text'}
      autoComplete="off"
      slotProps={{ htmlInput: { maxLength: name === 'clientSecret' ? 500 : 300 } }}
      onChange={(e) => setEdits((f) => ({ ...f, [name]: e.target.value }))}
    />
  );

  return (
    <Stack spacing={1.25}>
      <Typography variant="subtitle2">Tài khoản ký số Viettel MySign</Typography>
      <Typography variant="body2" color="text.secondary">
        Client ID và Client Secret do Viettel cấp cho phần mềm BHOME. Không gửi secret qua nhóm
        chat; secret được mã hóa trên máy chủ và chỉ hiện 4 ký tự cuối.
      </Typography>
      {view.isLoading && <LinearProgress />}
      {view.error && <Alert severity="error">{signingError(view.error)}</Alert>}
      {v && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip
            size="small"
            color={v.secretSet && v.clientId ? 'success' : 'warning'}
            label={
              v.secretSet && v.clientId ? 'Đã có tài khoản Viettel' : 'Chưa đủ tài khoản Viettel'
            }
          />
          <Chip size="small" label={`Client ID: ${source(v.clientIdSource)}`} />
          <Chip
            size="small"
            label={`Secret: ${v.secretSet ? '••••' + v.secretHint : 'chưa có'} (${source(v.secretSource)})`}
          />
          {v.updatedAt && <Chip size="small" label={`Lưu lúc ${formatInstant(v.updatedAt)}`} />}
        </Stack>
      )}
      {v?.secretUnreadable && (
        <Alert severity="warning">
          Secret đã lưu không giải mã được (khóa DigitalSigning__SecretKey đã đổi). Nhập lại secret.
        </Alert>
      )}
      {field('baseUrl', 'Địa chỉ cổng ký số', 'Mặc định https://remotesigning.viettel.vn')}
      {field('clientId', 'Client ID')}
      {field('clientSecret', 'Client Secret', 'Để trống để giữ secret đang lưu')}
      {field('profileId', 'Profile ID (nếu Viettel cấp)')}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await signing.saveViettel({
                baseUrl: form.baseUrl.trim() || null,
                clientId: form.clientId.trim() || null,
                profileId: form.profileId.trim() || null,
                clientSecret: form.clientSecret.trim() || null,
                clearSecret: false,
              });
              setEdits({});
              return 'Đã lưu tài khoản Viettel MySign.';
            })
          }
        >
          Lưu tài khoản
        </Button>
        <Button
          disabled={busy || v?.secretSource !== 'DATABASE'}
          onClick={() =>
            void run(async () => {
              await signing.saveViettel({
                baseUrl: form.baseUrl.trim() || null,
                clientId: form.clientId.trim() || null,
                profileId: form.profileId.trim() || null,
                clientSecret: null,
                clearSecret: true,
              });
              return 'Đã xóa client secret đã lưu.';
            })
          }
        >
          Xóa secret đã lưu
        </Button>
        <Button
          color="warning"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await signing.resetViettel();
              return 'Đã bỏ tài khoản đã lưu, dùng lại cấu hình của máy chủ.';
            })
          }
        >
          Dùng cấu hình máy chủ
        </Button>
      </Stack>
      <Typography variant="subtitle2" sx={{ pt: 1 }}>
        Kiểm tra kết nối
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Chỉ đăng nhập Viettel bằng mã thuê bao của một người ký (thường là số CCCD). Không ký gì,
        không gửi gì tới điện thoại.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          size="small"
          label="Mã thuê bao MySign"
          value={subscriber}
          disabled={busy}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          onChange={(e) => setSubscriber(e.target.value)}
        />
        <Button
          disabled={busy || !subscriber.trim()}
          onClick={() =>
            void run(async () => {
              const r = await signing.testViettel(subscriber);
              if (!r.ok) throw new Error(`Viettel từ chối: ${r.message}`);
              return `Kết nối Viettel thành công (${r.milliseconds} ms).`;
            })
          }
        >
          Kiểm tra kết nối
        </Button>
      </Stack>
      {busy && <LinearProgress />}
      {!!error && <Alert severity="error">{error}</Alert>}
      {!!notice && <Alert severity="success">{notice}</Alert>}
    </Stack>
  );
}
