import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router';
import { readAuthenticationFragment } from '../../../../../../packages/client-core/src/authLinks';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../../services/config';
import {
  internalSigningClient,
  signingMessage,
} from '../../../../../../packages/client-core/src/internalSigning';

export default function AcceptInvitationPage() {
  const location = useLocation(),
    navigate = useNavigate();
  const [link] = useState(() => readAuthenticationFragment(location.hash));
  useEffect(() => {
    if (location.hash) void navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);
  const api = useMemo(() => internalSigningClient(createApiClient(apiBaseUrl)), []);
  const [email, setEmail] = useState(link.userName),
    [token, setToken] = useState(link.token),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const [recognized, setRecognized] = useState(Boolean(link.userName && link.token));
  function updateInvitation(value: string) {
    try {
      const url = new URL(value.trim());
      const parsed = readAuthenticationFragment(url.hash || url.search);
      if (parsed.userName && parsed.token) {
        setEmail(parsed.userName);
        setToken(parsed.token);
        setRecognized(true);
        setError('');
        return;
      }
    } catch {
      /* A raw invitation token is also supported. */
    }
    setToken(value);
  }
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 520, mx: 'auto' }}>
      <Paper sx={{ p: 3 }}>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(e) => {
            e.preventDefault();
            if (lock.current) return;
            if (
              password !== repeat ||
              password.length < 12 ||
              !/[A-Z]/.test(password) ||
              !/[a-z]/.test(password) ||
              !/[0-9]/.test(password) ||
              !/[^a-zA-Z0-9]/.test(password)
            ) {
              setError(
                'Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số, ký tự đặc biệt và khớp xác nhận.',
              );
              return;
            }
            lock.current = true;
            setBusy(true);
            setError('');
            void api
              .acceptAccount(email, token, password)
              .then(() => {
                setDone(true);
                setPassword('');
                setRepeat('');
                setToken('');
              })
              .catch((e) =>
                setError(
                  (e as { status?: number }).status === 400
                    ? 'Liên kết chưa hợp lệ, đã hết hạn hoặc đã sử dụng. Vui lòng yêu cầu Owner gửi lời mời mới.'
                    : signingMessage(e),
                ),
              )
              .finally(() => {
                lock.current = false;
                setBusy(false);
              });
          }}
        >
          <Typography component="h1" variant="h5">
            Thiết lập tài khoản BHOME
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {done ? (
            <Alert severity="success">
              Đã thiết lập mật khẩu. Nhân viên có thể đăng nhập trên ứng dụng BHOME dành cho Staff
              bằng email và mật khẩu mới.
            </Alert>
          ) : (
            <>
              <TextField
                required
                label="Email nhận lời mời"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                slotProps={{ input: { readOnly: recognized } }}
                disabled={busy}
              />
              {recognized ? (
                <Alert severity="info">Đã nhận diện liên kết lời mời.</Alert>
              ) : (
                <TextField
                  required
                  label="Mã lời mời hoặc liên kết trong email"
                  helperText="Dán toàn bộ liên kết từ email hoặc nhập mã lời mời."
                  value={token}
                  onChange={(e) => updateInvitation(e.target.value)}
                  disabled={busy}
                />
              )}
              <TextField
                required
                label="Mật khẩu mới"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                helperText="Ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt."
              />
              <TextField
                required
                label="Xác nhận mật khẩu"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                disabled={busy}
              />
              <Button type="submit" variant="contained" disabled={busy}>
                Thiết lập mật khẩu
              </Button>
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
