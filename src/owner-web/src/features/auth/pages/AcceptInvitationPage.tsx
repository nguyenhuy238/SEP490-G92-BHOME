import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router';
import { readAuthenticationFragment } from '../../../../../../packages/client-core/src/authLinks';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../../packages/client-core/src/config';
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
  const api = useMemo(
    () =>
      internalSigningClient(
        createApiClient(getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV)),
      ),
    [],
  );
  const [email, setEmail] = useState(link.userName),
    [token, setToken] = useState(link.token),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 520, mx: 'auto' }}>
      <Paper sx={{ p: 3 }}>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(e) => {
            e.preventDefault();
            if (lock.current) return;
            if (password !== repeat || password.length < 12) {
              setError('Mật khẩu cần ít nhất 12 ký tự và khớp xác nhận.');
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
              .catch((e) => setError(signingMessage(e)))
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
              Đã thiết lập mật khẩu. Bạn có thể đăng nhập trên ứng dụng BHOME.
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
                disabled={busy}
              />
              <TextField
                required
                label="Mã lời mời trong email"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={busy}
              />
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
