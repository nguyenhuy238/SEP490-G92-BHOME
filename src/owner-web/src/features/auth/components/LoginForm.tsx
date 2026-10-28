import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AlternateEmail,
  ArrowForward,
  LockOutlined,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';

interface LoginFormProps {
  busy: boolean;
  error: string;
  onLogin: (userName: string, password: string) => Promise<void>;
  onForgotPassword: (userName: string) => void;
}

export function LoginForm({ busy, error, onLogin, onForgotPassword }: LoginFormProps) {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userName.trim() || !password || busy) return;
    try {
      await onLogin(userName, password);
    } finally {
      setPassword('');
      setVisible(false);
    }
  }

  return (
    <Box component="form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <Stack spacing={2.5}>
        {error && <Alert severity="error">{error}</Alert>}
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.75 }}>
            <Typography
              component="label"
              htmlFor="login-identifier"
              variant="body2"
              sx={{ fontWeight: 500 }}
            >
              Email hoặc Số điện thoại
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              Bắt buộc
            </Typography>
          </Stack>
          <TextField
            id="login-identifier"
            fullWidth
            required
            disabled={busy}
            value={userName}
            autoComplete="username"
            placeholder="admin@bhome.vn hoặc 0908123456"
            onChange={(event) => setUserName(event.target.value)}
            helperText="Dùng tên đăng nhập đã được cấp cho tài khoản hiện có."
            slotProps={{
              htmlInput: { maxLength: 256 },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <AlternateEmail fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.75 }}>
            <Typography
              component="label"
              htmlFor="login-password"
              variant="body2"
              sx={{ fontWeight: 500 }}
            >
              Mật khẩu
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
              Bảo mật
            </Typography>
          </Stack>
          <TextField
            id="login-password"
            fullWidth
            required
            disabled={busy}
            value={password}
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Nhập mật khẩu truy cập"
            onChange={(event) => setPassword(event.target.value)}
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
                      aria-pressed={visible}
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
        </Box>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
        >
          <Tooltip title="Thời hạn phiên do máy chủ quản lý; chưa hỗ trợ tùy chọn ghi nhớ đăng nhập.">
            <span tabIndex={0}>
              <FormControlLabel
                sx={{ mr: 0 }}
                control={<Checkbox size="small" disabled />}
                label={<Typography variant="caption">Ghi nhớ đăng nhập</Typography>}
              />
            </span>
          </Tooltip>
          <Button
            type="button"
            disabled={busy}
            onClick={() => onForgotPassword(userName)}
            sx={{ fontSize: 12, p: 0 }}
          >
            Quên mật khẩu?
          </Button>
        </Stack>
        <Button
          fullWidth
          type="submit"
          variant="contained"
          disabled={busy}
          endIcon={
            busy ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <ArrowForward sx={{ fontSize: 18 }} />
            )
          }
          sx={{
            height: 44,
            bgcolor: '#283044',
            '&:hover': { bgcolor: '#131b2e' },
            borderRadius: '4px',
          }}
        >
          {busy ? 'Đang xác thực...' : 'Đăng nhập vào hệ thống'}
        </Button>
      </Stack>
    </Box>
  );
}
