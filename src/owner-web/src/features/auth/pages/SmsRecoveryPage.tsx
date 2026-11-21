import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { useSmsRecovery } from '../../../../../../packages/client-core/src/useSmsRecovery';

export default function SmsRecoveryPage() {
  const { client } = useAuth();
  const flow = useSmsRecovery(client);
  const [visible, setVisible] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    void (flow.step === 'request'
      ? flow.request()
      : flow.step === 'verify'
        ? flow.verify()
        : flow.reset());
  }
  return (
    <Box component="main" sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', p: 3 }}>
      <Paper sx={{ p: 4, width: '100%', maxWidth: 440 }}>
        <Stack component="form" onSubmit={submit} spacing={2}>
          <Typography variant="overline" color="primary">
            BHOME
          </Typography>
          <Typography variant="h5">
            {flow.step === 'success'
              ? 'Đã đặt lại mật khẩu'
              : flow.step === 'reset'
                ? 'Mật khẩu mới'
                : flow.step === 'verify'
                  ? 'Xác minh mã SMS'
                  : 'Quên mật khẩu qua SMS'}
          </Typography>
          {flow.step === 'request' && (
            <TextField
              label="Tài khoản hoặc số điện thoại"
              value={flow.identifier}
              onChange={(e) => flow.setIdentifier(e.target.value)}
              autoComplete="username"
              disabled={flow.busy}
              slotProps={{ htmlInput: { maxLength: 256 } }}
            />
          )}
          {flow.step === 'verify' && (
            <>
              <Typography variant="body2" color="text.secondary">
                Nếu tài khoản đủ điều kiện, mã sẽ được gửi đến số điện thoại đã xác minh.
              </Typography>
              <TextField
                label="Mã xác minh"
                value={flow.otp}
                onChange={(e) => flow.setOtp(e.target.value)}
                autoComplete="one-time-code"
                disabled={flow.busy}
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
              />
              <Button
                type="button"
                disabled={flow.busy || flow.seconds > 0}
                onClick={() => void flow.request()}
              >
                {flow.seconds > 0 ? `Gửi lại sau ${flow.seconds}s` : 'Gửi lại mã'}
              </Button>
            </>
          )}
          {flow.step === 'reset' && (
            <>
              <TextField
                label="Mật khẩu mới"
                value={flow.password}
                onChange={(e) => flow.setPassword(e.target.value)}
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={flow.busy}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          onClick={() => setVisible((v) => !v)}
                          edge="end"
                        >
                          {visible ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                  htmlInput: { maxLength: 1024 },
                }}
              />
              <TextField
                label="Xác nhận mật khẩu"
                value={flow.confirmation}
                onChange={(e) => flow.setConfirmation(e.target.value)}
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={flow.busy}
                slotProps={{ htmlInput: { maxLength: 1024 } }}
              />
            </>
          )}
          {flow.error && <Alert severity="error">{flow.error}</Alert>}
          {flow.step === 'success' ? (
            <Alert severity="success">Bạn có thể đăng nhập bằng mật khẩu mới.</Alert>
          ) : (
            <Button variant="contained" type="submit" disabled={flow.busy}>
              {flow.busy
                ? 'Đang xử lý…'
                : flow.step === 'request'
                  ? 'Gửi mã xác minh'
                  : flow.step === 'verify'
                    ? 'Xác minh'
                    : 'Đặt lại mật khẩu'}
            </Button>
          )}
          {flow.step === 'verify' && (
            <Button disabled={flow.busy} onClick={flow.restart}>
              Nhập lại tài khoản
            </Button>
          )}
          <Button component={RouterLink} to="/login" disabled={flow.busy}>
            Quay lại đăng nhập
          </Button>
          {flow.step === 'request' && (
            <Button component={RouterLink} to="/login" state={{ emailRecovery: true }}>
              Khôi phục qua email
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
