import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Apartment, LockOutlined, PhoneOutlined, VerifiedUserOutlined } from '@mui/icons-material';
import { LoginForm } from '../components/LoginForm';
import { useOwnerLogin } from '../hooks/useOwnerLogin';

export function LoginPage() {
  const auth = useOwnerLogin();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserName, setResetUserName] = useState('');
  const supportPhone = import.meta.env.VITE_SUPPORT_PHONE as string | undefined;
  const supportHref = supportPhone?.replace(/[^+\d]/g, '');

  function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetUserName.trim() && !auth.resetBusy) void auth.requestReset(resetUserName);
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
            Đăng nhập tài khoản
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, mb: 3 }}
          >
            Truy cập bảng điều khiển vận hành cơ sở lưu trú của bạn
          </Typography>
          {auth.authenticated ? (
            <Stack spacing={2}>
              <Alert severity="success">Đăng nhập thành công. Phiên Owner đã được xác thực.</Alert>
              <Typography variant="body2" color="text.secondary">
                Phiên đã sẵn sàng để truy cập không gian quản lý BHOME.
              </Typography>
              <Button disabled={auth.busy} variant="outlined" onClick={() => void auth.logout()}>
                Đăng xuất
              </Button>
            </Stack>
          ) : (
            <LoginForm
              busy={auth.busy}
              error={auth.error}
              onLogin={auth.login}
              onForgotPassword={(value) => {
                setResetUserName(value);
                setResetOpen(true);
              }}
            />
          )}

          <Stack
            direction="row"
            spacing={1.25}
            sx={{ mt: 3, p: 1.5, bgcolor: '#f2f3ff', borderRadius: '4px' }}
          >
            <VerifiedUserOutlined sx={{ color: 'primary.main', fontSize: 18, mt: 0.25 }} />
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                Cơ chế bảo vệ đa điểm
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.25 }}
              >
                Phiên đăng nhập được xác thực và có thời hạn. Truy cập được kiểm soát theo quyền tài
                khoản.
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Stack
          component="footer"
          spacing={1}
          sx={{ alignItems: 'center', textAlign: 'center', mt: 4 }}
        >
          <Chip
            icon={<LockOutlined sx={{ '&&': { fontSize: 15, color: 'success.main' } }} />}
            label="Bảo vệ phiên đăng nhập và quyền truy cập"
            size="small"
            sx={{ bgcolor: '#eaedff', fontSize: 12 }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Hỗ trợ kỹ thuật:
            </Typography>
            {supportHref ? (
              <Link
                href={`tel:${supportHref}`}
                color="text.primary"
                underline="hover"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <PhoneOutlined sx={{ fontSize: 16 }} />
                {supportPhone}
              </Link>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Chưa cấu hình liên hệ
              </Typography>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
            © 2025 BHOME Technology JSC. Bảo lưu mọi quyền.
          </Typography>
        </Stack>
      </Box>

      <Dialog
        open={resetOpen}
        onClose={() => {
          if (!auth.resetBusy) setResetOpen(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={submitReset}>
          <DialogTitle>Quên mật khẩu?</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Nhập tên đăng nhập của tài khoản đã được cấp để yêu cầu hướng dẫn khôi phục.
            </Typography>
            <TextField
              autoFocus
              fullWidth
              required
              label="Tên đăng nhập"
              autoComplete="username"
              value={resetUserName}
              disabled={auth.resetBusy}
              onChange={(event) => setResetUserName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 256 } }}
            />
            {auth.resetMessage && (
              <Alert severity={auth.resetError ? 'error' : 'info'} sx={{ mt: 2 }}>
                {auth.resetMessage}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={auth.resetBusy} onClick={() => setResetOpen(false)}>
              Đóng
            </Button>
            <Button
              type="submit"
              disabled={auth.resetBusy}
              endIcon={auth.resetBusy ? <CircularProgress size={16} /> : undefined}
            >
              Gửi hướng dẫn
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
