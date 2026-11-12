import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import React, { useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { Text, TextInput } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, MobileApiError } from '../lib/api';

export function AccountSecurityScreen() {
  const { api, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState({ current: false, password: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const lock = useRef(false);
  React.useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setCurrent('');
        setPassword('');
        setConfirm('');
        setVisible({ current: false, password: false, confirm: false });
      }
    });
    return () => listener.remove();
  }, []);
  async function changePassword() {
    if (!api || lock.current) return;
    if (!current || !password || password !== confirm) {
      setError('Nhập mật khẩu hiện tại và xác nhận mật khẩu mới khớp nhau.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.json('/api/v1/auth/change-password', {
        currentPassword: current,
        newPassword: password,
      });
      setCurrent('');
      setPassword('');
      setConfirm('');
      setVisible({ current: false, password: false, confirm: false });
      // Password change revokes sessions server-side. Always clear the local credentials too.
      try {
        await logout();
      } catch {
        /* MobileSessions.logout clears credentials in finally. */
      }
      router.replace('/');
      showSuccess('Đã đổi mật khẩu. Hãy đăng nhập lại.');
    } catch (e) {
      setError(
        e instanceof MobileApiError && e.status === 400
          ? 'Không thể đổi mật khẩu. Vui lòng kiểm tra mật khẩu hiện tại và bảo đảm mật khẩu mới đáp ứng yêu cầu bên dưới. Nếu vẫn lỗi, hãy đăng nhập lại rồi thử lại.'
          : errorMessage(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Bảo mật tài khoản" detail="Đổi mật khẩu của tài khoản đang đăng nhập" />
      <Box>
        <TextInput
          label="Mật khẩu hiện tại"
          accessibilityLabel="Mật khẩu hiện tại"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry={!visible.current}
          right={
            <TextInput.Icon
              icon={visible.current ? 'eye-off' : 'eye'}
              accessibilityLabel={
                visible.current ? 'Ẩn mật khẩu hiện tại' : 'Hiện mật khẩu hiện tại'
              }
              onPress={() => setVisible((v) => ({ ...v, current: !v.current }))}
              disabled={busy}
            />
          }
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          mode="outlined"
        />
        <TextInput
          label="Mật khẩu mới"
          accessibilityLabel="Mật khẩu mới"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!visible.password}
          right={
            <TextInput.Icon
              icon={visible.password ? 'eye-off' : 'eye'}
              accessibilityLabel={visible.password ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
              onPress={() => setVisible((v) => ({ ...v, password: !v.password }))}
              disabled={busy}
            />
          }
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          mode="outlined"
        />
        <TextInput
          label="Xác nhận mật khẩu mới"
          accessibilityLabel="Xác nhận mật khẩu mới"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!visible.confirm}
          right={
            <TextInput.Icon
              icon={visible.confirm ? 'eye-off' : 'eye'}
              accessibilityLabel={
                visible.confirm ? 'Ẩn xác nhận mật khẩu mới' : 'Hiện xác nhận mật khẩu mới'
              }
              onPress={() => setVisible((v) => ({ ...v, confirm: !v.confirm }))}
              disabled={busy}
            />
          }
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          mode="outlined"
        />
        <Text>
          Mật khẩu mới từ 12 đến 1024 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.
        </Text>
        <Text>Sau khi đổi mật khẩu thành công, bạn cần đăng nhập lại.</Text>
        {!!error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        <Action disabled={busy} onPress={() => void changePassword()}>
          Đổi mật khẩu & Đăng xuất
        </Action>
      </Box>
    </>
  );
}
