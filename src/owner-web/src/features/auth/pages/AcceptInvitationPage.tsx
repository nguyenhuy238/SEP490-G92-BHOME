import { TextField } from '../../../components/common/ValidatedForm';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router';
import { readAuthenticationFragment } from '../../../../../../packages/client-core/src/authLinks';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import { internalSigningClient } from '../../../../../../packages/client-core/src/internalSigning';
import { apiBaseUrl } from '../../../services/config';
import { PasswordField } from '../components/PasswordField';

const invitationMessages: Record<string, string> = {
  Invalid: 'Liên kết lời mời không hợp lệ. Vui lòng mở lại liên kết trong email.',
  Expired: 'Lời mời đã hết hạn. Vui lòng liên hệ người quản lý để được gửi lại lời mời.',
  Used: 'Lời mời đã được sử dụng. Vui lòng đăng nhập hoặc liên hệ người quản lý.',
  AlreadyActivated: 'Tài khoản của bạn đã được kích hoạt. Vui lòng đăng nhập.',
  Revoked: 'Lời mời đã bị thu hồi. Vui lòng liên hệ người quản lý để được gửi lại lời mời.',
};
const passwordHelp = 'Ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.';

export default function AcceptInvitationPage() {
  const location = useLocation(),
    navigate = useNavigate();
  // Capture once before scrubbing; router replacement must not discard the token.
  const [link, setLink] = useState(() =>
    readAuthenticationFragment(location.hash || location.search),
  );
  useEffect(() => {
    if (location.hash || location.search) void navigate(location.pathname, { replace: true });
  }, [location.hash, location.search, location.pathname, navigate]);
  const api = useMemo(() => internalSigningClient(createApiClient(apiBaseUrl)), []);
  const [invitation, setInvitation] = useState<{ status: string; email?: string | null }>({
    status: link.token ? 'Loading' : 'Invalid',
  });
  const [revision, setRevision] = useState(0);
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [validation, setValidation] = useState({ password: '', repeat: '' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!link.token) return;
    let active = true;
    void api
      .validateAccountInvitation(link.token)
      .then((result) => {
        if (active)
          setInvitation(
            result.status === 'Valid' && !result.email ? { status: 'Invalid' } : result,
          );
      })
      .catch(() => {
        if (active) setInvitation({ status: 'Unavailable' });
      });
    return () => {
      active = false;
    };
  }, [api, link.token, revision]);
  const valid = invitation.status === 'Valid' && Boolean(invitation.email);
  return (
    <Box component="main" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 520, mx: 'auto' }}>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h5">
            Thiết lập tài khoản BHOME
          </Typography>
          {invitation.status === 'Loading' ? (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>Đang kiểm tra lời mời…</Typography>
            </Stack>
          ) : valid ? (
            <Stack
              component="form"
              spacing={2}
              noValidate
              aria-busy={busy}
              onSubmit={(event) => {
                event.preventDefault();
                if (lock.current || !valid) return;
                const fields = {
                  password:
                    password.length < 12 ||
                    password.length > 1024 ||
                    !/[A-Z]/.test(password) ||
                    !/[a-z]/.test(password) ||
                    !/[0-9]/.test(password) ||
                    !/[^a-zA-Z0-9]/.test(password)
                      ? passwordHelp
                      : '',
                  repeat:
                    repeat !== password
                      ? 'Hai mật khẩu không khớp.'
                      : !repeat
                        ? 'Vui lòng xác nhận mật khẩu.'
                        : '',
                };
                setValidation(fields);
                if (fields.password || fields.repeat) return;
                lock.current = true;
                setBusy(true);
                setError('');
                void api
                  .acceptAccount(null, link.token, password)
                  .then(() => {
                    setPassword('');
                    setRepeat('');
                    setLink({ userName: '', token: '' });
                    void navigate('/login', { replace: true, state: { invitationAccepted: true } });
                  })
                  .catch(async (failure: unknown) => {
                    if ((failure as { status?: number }).status === 400) {
                      try {
                        const result = await api.validateAccountInvitation(link.token);
                        setInvitation(result);
                        if (result.status === 'Valid')
                          setValidation((value) => ({
                            ...value,
                            password: 'Mật khẩu chưa đáp ứng yêu cầu bảo mật. ' + passwordHelp,
                          }));
                      } catch {
                        setError('Không thể kiểm tra lời mời. Vui lòng thử lại sau.');
                      }
                    } else
                      setError(
                        'Không thể thiết lập tài khoản. Vui lòng kiểm tra kết nối rồi thử lại.',
                      );
                  })
                  .finally(() => {
                    lock.current = false;
                    setBusy(false);
                  });
              }}
            >
              <Typography>Tạo mật khẩu để kích hoạt tài khoản của bạn.</Typography>
              <TextField
                label="Email nhận lời mời"
                value={invitation.email}
                autoComplete="username"
                slotProps={{ input: { readOnly: true } }}
              />
              {error && <Alert severity="error">{error}</Alert>}
              <PasswordField
                required
                label="Mật khẩu mới"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                error={Boolean(validation.password)}
                helperText={validation.password || passwordHelp}
              />
              <PasswordField
                required
                label="Xác nhận mật khẩu"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                disabled={busy}
                error={Boolean(validation.repeat)}
                helperText={validation.repeat}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={busy}
                startIcon={busy ? <CircularProgress size={18} /> : undefined}
              >
                {busy ? 'Đang thiết lập…' : 'Thiết lập mật khẩu'}
              </Button>
            </Stack>
          ) : (
            <>
              <Alert severity="warning">
                {invitationMessages[invitation.status] ||
                  'Không thể kết nối để kiểm tra lời mời. Vui lòng thử lại.'}
              </Alert>
              {invitation.status === 'Unavailable' && (
                <Button
                  onClick={() => {
                    setInvitation({ status: 'Loading' });
                    setRevision((value) => value + 1);
                  }}
                >
                  Thử lại
                </Button>
              )}
            </>
          )}
          <Button component={Link} to="/login">
            Đến đăng nhập
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
