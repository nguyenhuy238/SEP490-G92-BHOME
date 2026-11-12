import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { readAuthenticationFragment } from '../../../../../../packages/client-core/src/authLinks';

export default function ConfirmEmailPage() {
  const { client } = useAuth();
  const location = useLocation(),
    navigate = useNavigate();
  const [link] = useState(() => readAuthenticationFragment(location.hash));
  const [email, setEmail] = useState(link.userName),
    [token, setToken] = useState(link.token);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (location.hash) void navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);
  async function submit(confirm: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (confirm) {
        await client.confirmEmail(email.trim(), token.trim());
        setDone(true);
        setToken('');
      } else {
        await client.requestEmailVerification(email.trim());
        setMessage(
          'Nếu tài khoản đủ điều kiện, liên kết xác nhận sẽ được gửi đến email đã đăng ký. Tài khoản đang chờ lời mời cần hoàn tất thiết lập từ lời mời của Owner.',
        );
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
          : confirm
            ? 'Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.'
            : 'Chưa thể tiếp nhận yêu cầu xác nhận email. Vui lòng thử lại sau.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Box component="main" sx={{ p: 3, maxWidth: 520, mx: 'auto' }}>
      <Paper sx={{ p: 3 }}>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(e) => {
            e.preventDefault();
            void submit(!!token);
          }}
        >
          <Typography component="h1" variant="h5">
            Xác nhận email BHOME
          </Typography>
          {done ? (
            <Alert severity="success">
              Email đã được xác nhận. Bạn có thể quay lại đăng nhập và yêu cầu đặt lại mật khẩu.
            </Alert>
          ) : (
            <>
              <Typography>
                Nhập email đã đăng ký để nhận liên kết xác nhận. Sau khi xác nhận, bạn có thể sử
                dụng chức năng quên mật khẩu.
              </Typography>
              <TextField
                required
                label={token ? 'Tài khoản' : 'Email'}
                type={token ? 'text' : 'email'}
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 256 } }}
              />
              {!!token && (
                <TextField
                  required
                  label="Mã xác nhận"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 4096 } }}
                />
              )}
              <Button type="submit" variant="contained" disabled={busy}>
                {token ? 'Xác nhận email' : 'Gửi liên kết xác nhận'}
              </Button>
              {!!token && (
                <Button disabled={busy} onClick={() => void submit(false)}>
                  Gửi lại liên kết
                </Button>
              )}
            </>
          )}
          {!!message && <Alert severity="info">{message}</Alert>}
          {!!error && <Alert severity="error">{error}</Alert>}
          <Button component={Link} to="/login" disabled={busy}>
            Quay lại đăng nhập
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
