import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Apartment, LockOutlined, Visibility, VisibilityOff } from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';

const passwordRule = /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\p{Nd})(?=.*[^\p{L}\p{N}]).{12,1024}$/u;

export default function ResetPasswordPage() {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Email không đúng định dạng.');
      return;
    }
    if (!token.trim()) {
      setError('Vui lòng nhập mã đặt lại mật khẩu.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('Mật khẩu mới và phần xác nhận không khớp.');
      return;
    }
    if (!passwordRule.test(newPassword)) {
      setError(
        'Mật khẩu mới phải có ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.',
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      await client.resetPassword(email.trim(), token.trim(), newPassword);
      navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 400) {
        setError('Mã đặt lại không hợp lệ, đã hết hạn hoặc mật khẩu mới chưa đạt yêu cầu.');
      } else if (failure instanceof ApiError && failure.status === 429) {
        setError('Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.');
      } else {
        setError('Chưa thể đặt lại mật khẩu. Vui lòng kiểm tra kết nối và thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100svh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 5,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 440 }}>
        <Stack component="header" sx={{ alignItems: 'center', textAlign: 'center', mb: 4 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              display: 'grid',
              placeItems: 'center',
              color: 'white',
              bgcolor: '#2563eb',
              borderRadius: 1,
              mb: 2,
              boxShadow: '0 1px 2px #131b2e20',
            }}
          >
            <Apartment sx={{ fontSize: 28 }} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>
              BHOME
            </Typography>
            <Chip
              label="Owner Portal"
              size="small"
              sx={{ height: 22, bgcolor: '#eaedff', color: 'primary.main', fontSize: 12 }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
            Nền tảng quản lý &amp; vận hành chuỗi nhà trọ thông minh
          </Typography>
        </Stack>

        <Paper sx={{ p: { xs: 3, sm: 4 }, boxShadow: '0 1px 2px #131b2e0d' }}>
          <Typography component="h1" variant="h1">
            Đặt lại mật khẩu
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, mb: 3 }}
          >
            Dùng mã một lần được cấp cho tài khoản Owner của bạn
          </Typography>

          <Box component="form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
            <Stack spacing={2.5}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                fullWidth
                required
                disabled={busy}
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 256 } }}
              />
              <TextField
                fullWidth
                required
                disabled={busy}
                label="Mã đặt lại mật khẩu"
                autoComplete="one-time-code"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 4096 } }}
              />
              <TextField
                fullWidth
                required
                disabled={busy}
                label="Mật khẩu mới"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                helperText="Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt."
                slotProps={{
                  htmlInput: { maxLength: 1024 },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockOutlined fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          disabled={busy}
                          size="small"
                          type="button"
                          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          onClick={() => setVisible(!visible)}
                        >
                          {visible ? (
                            <VisibilityOff fontSize="small" />
                          ) : (
                            <Visibility fontSize="small" />
                          )}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField
                fullWidth
                required
                disabled={busy}
                label="Xác nhận mật khẩu mới"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 1024 } }}
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={busy}
                endIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
                sx={{ height: 44, bgcolor: '#283044', '&:hover': { bgcolor: '#131b2e' } }}
              >
                {busy ? 'Đang đặt lại...' : 'Đặt lại mật khẩu'}
              </Button>
              <Link
                component={RouterLink}
                to="/login"
                underline="hover"
                sx={{ textAlign: 'center' }}
              >
                Quay lại đăng nhập
              </Link>
            </Stack>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
