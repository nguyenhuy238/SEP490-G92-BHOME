import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { KeyRound, LogOut, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';
import { useAccountProfileApi, type AccountProfile } from '../hooks/useAccountProfileApi';
import { normalizeLoginPhone } from '../../../../../../packages/client-core/src/loginValidation';

interface ProfileForm {
  fullName: string;
  email: string;
  phone: string;
}

const emptyForm: ProfileForm = { fullName: '', email: '', phone: '' };

function formFrom(profile: AccountProfile): ProfileForm {
  return {
    fullName: profile.fullName,
    email: profile.email ?? '',
    phone: profile.phone ?? '',
  };
}

export default function AccountProfilePage() {
  const api = useAccountProfileApi();
  const { client, session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [logoutError, setLogoutError] = useState(false);
  const [formError, setFormError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const queryKey = ['account-profile', session?.userId] as const;
  const profile = useQuery({
    queryKey,
    enabled: Boolean(session),
    queryFn: ({ signal }) => api.get(signal),
  });

  const activeForm = profile.data ? (form ?? formFrom(profile.data)) : emptyForm;

  const update = useMutation({
    mutationFn: async () => {
      const current = profile.data!;
      return api.update({
        fullName: activeForm.fullName.trim(),
        email: activeForm.email.trim(),
        phone: normalizeLoginPhone(activeForm.phone) ?? null,
        version: current.version,
        ...(contactChanged ? { currentPassword: reauthPassword } : {}),
      });
    },
    onSuccess: async (updated) => {
      const emailChanged = updated.email?.toUpperCase() !== profile.data?.email?.toUpperCase();
      queryClient.setQueryData(queryKey, updated);
      setForm(null);
      setFormError('');
      setReauthPassword('');
      setSaved(true);
      setVerificationMessage('');
      if (emailChanged) {
        try {
          await client.requestEmailVerification(updated.email!);
          setVerificationMessage(
            'Đã lưu hồ sơ và tiếp nhận yêu cầu xác nhận email mới. Kiểm tra hộp thư để xác nhận trước khi dùng quên mật khẩu.',
          );
        } catch {
          setVerificationMessage(
            'Đã lưu hồ sơ. Chưa thể gửi liên kết xác nhận email mới; bạn có thể yêu cầu lại ở trang Xác nhận email.',
          );
        }
      }
    },
    onError: async (failure) => {
      if (failure instanceof ApiError && failure.problem?.code === 'current_password_invalid') {
        setReauthPassword('');
        // Identity may update only its concurrency stamp after a failed attempt.
        // Rebase that version only when every displayed profile field is unchanged.
        try {
          const latest = await api.get();
          if (
            JSON.stringify(formFrom(profile.data!)) === JSON.stringify(formFrom(latest)) &&
            latest.userId === profile.data!.userId &&
            latest.isActive === profile.data!.isActive &&
            JSON.stringify(latest.roles) === JSON.stringify(profile.data!.roles)
          )
            queryClient.setQueryData(queryKey, latest);
        } catch {
          /* The original safe field error remains; a revoked session is handled by the API client. */
        }
      }
      if (failure instanceof ApiError && failure.status === 401) {
        setFormError('Mật khẩu hiện tại không đúng hoặc phiên đăng nhập đã hết hạn.');
      } else if (failure instanceof ApiError && failure.status === 409) {
        setFormError(
          failure.problem?.code === 'email_already_used'
            ? 'Email này đã được sử dụng bởi tài khoản khác.'
            : 'Hồ sơ đã thay đổi ở nơi khác. Vui lòng tải lại trước khi lưu.',
        );
      } else if (failure instanceof ApiError && failure.status === 400) {
        setFormError(
          failure.problem?.code === 'current_password_invalid'
            ? 'Mật khẩu hiện tại không đúng.'
            : 'Thông tin hồ sơ chưa hợp lệ. Vui lòng kiểm tra lại các trường.',
        );
      } else {
        setFormError('Không thể cập nhật hồ sơ lúc này. Vui lòng thử lại.');
      }
    },
  });

  if (profile.isPending) return <LoadingState />;
  if (profile.isError)
    return <ErrorState error={profile.error} retry={() => void profile.refetch()} />;

  const current = profile.data;
  const changed = JSON.stringify(activeForm) !== JSON.stringify(formFrom(current));
  const contactChanged =
    activeForm.email.trim().toUpperCase() !== current.email?.toUpperCase() ||
    normalizeLoginPhone(activeForm.phone) !== normalizeLoginPhone(current.phone ?? '');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending || !changed) return;
    if (activeForm.fullName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(activeForm.email.trim())) {
      setFormError('Họ tên phải có ít nhất 2 ký tự và Email phải đúng định dạng.');
      return;
    }
    if (activeForm.phone.trim() && !normalizeLoginPhone(activeForm.phone)) {
      setFormError('Số điện thoại không đúng định dạng.');
      return;
    }
    if (contactChanged && !reauthPassword) {
      setFormError('Vui lòng nhập mật khẩu hiện tại để xác nhận thay đổi thông tin liên hệ.');
      return;
    }
    setFormError('');
    update.mutate();
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await client.logout();
      setLogoutError(false);
      navigate('/login', { replace: true });
    } catch {
      setLogoutError(true);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Hồ sơ tài khoản"
        group="TÀI KHOẢN OWNER"
        actions={
          <Button
            variant="outlined"
            startIcon={<KeyRound size={16} />}
            onClick={() => setPasswordOpen(true)}
          >
            Đổi mật khẩu
          </Button>
        }
      />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(280px, 1fr)' },
          gap: 2,
          minWidth: 0,
        }}
      >
        <Paper
          component="form"
          onSubmit={submit}
          sx={{ p: { xs: 2, md: 3 }, border: '1px solid', borderColor: 'divider' }}
        >
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', mb: 3 }}>
            <Avatar sx={{ width: 52, height: 52, bgcolor: 'primary.main' }}>
              <UserRound size={24} />
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" sx={{ fontWeight: 800, fontSize: 18 }}>
                {current.fullName || 'Tài khoản Owner'}
              </Typography>
              <Stack direction="row" sx={{ gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
                {current.roles.map((role) => (
                  <Chip key={role} size="small" color="primary" label={role} />
                ))}
                <Chip
                  size="small"
                  color={current.isActive ? 'success' : 'default'}
                  label={current.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                />
              </Stack>
            </Box>
          </Stack>
          <Divider sx={{ mb: 3 }} />
          {verificationMessage && (
            <Alert severity="info" action={<Button href="/confirm-email">Xác nhận email</Button>}>
              {verificationMessage}
            </Alert>
          )}
          {formError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          )}
          <Stack spacing={2.25}>
            <TextField
              required
              label="Họ và tên"
              value={activeForm.fullName}
              onChange={(event) => setForm({ ...activeForm, fullName: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />
            <TextField
              required
              type="email"
              label="Email"
              value={activeForm.email}
              onChange={(event) => setForm({ ...activeForm, email: event.target.value })}
              helperText="Email mới cần được xác nhận; phiên đăng nhập được giữ."
              slotProps={{ htmlInput: { maxLength: 256 } }}
            />
            <TextField
              label="Số điện thoại"
              value={activeForm.phone}
              onChange={(event) => setForm({ ...activeForm, phone: event.target.value })}
              helperText="Số điện thoại mới chưa được xác minh qua SMS."
              slotProps={{ htmlInput: { maxLength: 30 } }}
            />
            {contactChanged && (
              <TextField
                required
                type="password"
                autoComplete="current-password"
                label="Mật khẩu hiện tại để xác nhận"
                value={reauthPassword}
                onChange={(event) => setReauthPassword(event.target.value)}
                helperText="Xác nhận thay đổi liên hệ; phiên đăng nhập được giữ. Số điện thoại mới chưa được xác minh qua SMS."
                slotProps={{ htmlInput: { maxLength: 1024 } }}
              />
            )}
            <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
              <Button
                disabled={!changed || update.isPending}
                onClick={() => {
                  setForm(null);
                  setReauthPassword('');
                  setFormError('');
                }}
              >
                Hoàn tác
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={!changed || update.isPending}
                startIcon={
                  update.isPending ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Save size={16} />
                  )
                }
              >
                {update.isPending ? 'Đang lưu...' : 'Lưu thay đổi'}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Stack spacing={2.5}>
          <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: 1 }}>
              <ShieldCheck size={20} color="#255dde" />
              <Typography component="h2" sx={{ fontWeight: 750 }}>
                Bảo mật tài khoản
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.6 }}>
              Đổi mật khẩu sẽ thu hồi các phiên đăng nhập hiện có theo chính sách của Backend.
            </Typography>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<KeyRound size={16} />}
              onClick={() => setPasswordOpen(true)}
            >
              Đổi mật khẩu
            </Button>
          </Paper>
          <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Typography component="h2" sx={{ fontWeight: 750, mb: 1 }}>
              Phiên hiện tại
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 2, overflowWrap: 'anywhere' }}
            >
              Mã tài khoản: {current.userId}
            </Typography>
            <Button
              fullWidth
              color="error"
              variant="outlined"
              disabled={loggingOut}
              startIcon={
                loggingOut ? <CircularProgress size={16} color="inherit" /> : <LogOut size={16} />
              }
              onClick={() => void logout()}
            >
              {loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
            </Button>
          </Paper>
        </Stack>
      </Box>
      <ChangePasswordDialog
        open={passwordOpen}
        accountEmail={current.email ?? ''}
        onClose={() => setPasswordOpen(false)}
        onChanged={() => {
          setPasswordOpen(false);
          setPasswordChanged(true);
        }}
        onReauthenticationRequired={() =>
          navigate('/login', { replace: true, state: { passwordChanged: true } })
        }
      />
      <Snackbar open={saved} autoHideDuration={5000} onClose={() => setSaved(false)}>
        <Alert severity="success" onClose={() => setSaved(false)}>
          Đã cập nhật hồ sơ tài khoản.
        </Alert>
      </Snackbar>
      <Snackbar
        open={passwordChanged}
        autoHideDuration={5000}
        onClose={() => setPasswordChanged(false)}
      >
        <Alert severity="success" onClose={() => setPasswordChanged(false)}>
          Đã đổi mật khẩu. Vui lòng đăng nhập lại.
        </Alert>
      </Snackbar>
      <Snackbar open={logoutError} autoHideDuration={8000} onClose={() => setLogoutError(false)}>
        <Alert severity="error" onClose={() => setLogoutError(false)}>
          Chưa thể xác nhận đăng xuất trên máy chủ. Phiên vẫn được giữ để bạn thử lại.
        </Alert>
      </Snackbar>
    </>
  );
}
