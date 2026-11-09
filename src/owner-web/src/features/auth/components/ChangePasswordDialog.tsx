import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../../packages/client-core/src/api';

interface ChangePasswordDialogProps {
  open: boolean;
  accountEmail: string;
  onClose: () => void;
  onChanged: () => void;
  onReauthenticationRequired: () => void;
}

const passwordRule = /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\p{Nd})(?=.*[^\p{L}\p{N}]).{12,1024}$/u;

export function ChangePasswordDialog({
  open,
  accountEmail,
  onClose,
  onChanged,
  onReauthenticationRequired,
}: ChangePasswordDialogProps) {
  const { client } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busyAction, setBusyAction] = useState<'change' | null>(null);
  const [error, setError] = useState('');
  const busy = busyAction !== null;

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setShowCurrent(false);
    setShowNew(false);
    setError('');
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
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

    setBusyAction('change');
    setError('');
    let passwordChanged = false;
    try {
      await client.changePassword(currentPassword, newPassword);
      passwordChanged = true;
      await client.login(accountEmail, newPassword);
      if (!client.session?.roles.includes('Owner')) {
        client.clear();
        throw new Error('Owner session was not restored.');
      }
      reset();
      onChanged();
    } catch (failure) {
      if (passwordChanged) {
        reset();
        onReauthenticationRequired();
        return;
      }
      if (failure instanceof ApiError && failure.status === 400) {
        setError('Không thể đổi mật khẩu. Hãy kiểm tra mật khẩu hiện tại và yêu cầu bảo mật.');
      } else if (failure instanceof ApiError && failure.status === 401) {
        setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      } else if (failure instanceof ApiError && failure.status === 403) {
        setError('Tài khoản không có quyền đổi mật khẩu.');
      } else if (failure instanceof ApiError && failure.status === 429) {
        setError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.');
      } else {
        setError('Không thể kết nối dịch vụ xác thực. Vui lòng thử lại sau.');
      }
    } finally {
      setBusyAction(null);
    }
  }

  const visibilityButton = (visible: boolean, toggle: () => void, label: string) => (
    <InputAdornment position="end">
      <IconButton
        type="button"
        size="small"
        disabled={busy}
        aria-label={`${visible ? 'Ẩn' : 'Hiện'} ${label}`}
        onClick={toggle}
      >
        {visible ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Đổi mật khẩu</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="change-password-form"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => void submit(event)}
        >
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Mật khẩu hiện tại"
            required
            autoComplete="current-password"
            type={showCurrent ? 'text' : 'password'}
            value={currentPassword}
            disabled={busy}
            onChange={(event) => setCurrentPassword(event.target.value)}
            slotProps={{
              htmlInput: { maxLength: 1024 },
              input: {
                endAdornment: visibilityButton(
                  showCurrent,
                  () => setShowCurrent(!showCurrent),
                  'mật khẩu hiện tại',
                ),
              },
            }}
          />
          <TextField
            label="Mật khẩu mới"
            required
            autoComplete="new-password"
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            disabled={busy}
            onChange={(event) => setNewPassword(event.target.value)}
            slotProps={{
              htmlInput: { minLength: 12, maxLength: 1024 },
              input: {
                endAdornment: visibilityButton(showNew, () => setShowNew(!showNew), 'mật khẩu mới'),
              },
            }}
          />
          <TextField
            label="Xác nhận mật khẩu mới"
            required
            autoComplete="new-password"
            type={showNew ? 'text' : 'password'}
            value={confirmation}
            disabled={busy}
            error={Boolean(confirmation) && confirmation !== newPassword}
            onChange={(event) => setConfirmation(event.target.value)}
            slotProps={{ htmlInput: { minLength: 12, maxLength: 1024 } }}
          />
          <Typography variant="caption" color="text.secondary">
            Tối thiểu 12 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt. Các phiên cũ sẽ bị thu
            hồi; phiên hiện tại sẽ được xác thực lại tự động bằng mật khẩu mới.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          Hủy
        </Button>
        <Button
          type="submit"
          form="change-password-form"
          variant="contained"
          disabled={busy || !currentPassword || !newPassword || !confirmation}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {busyAction === 'change' ? 'Đang đổi...' : 'Đổi mật khẩu'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
