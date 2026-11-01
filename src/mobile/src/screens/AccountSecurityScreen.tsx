import React, { useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { Text, TextInput } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { useSession } from '../lib/SessionProvider';
import { errorMessage } from '../lib/api';

export function AccountSecurityScreen() {
  const { api, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  React.useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setCurrent('');
        setPassword('');
        setConfirm('');
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
      // Password change revokes sessions server-side. Always clear the local credentials too.
      try {
        await logout();
      } catch {
        /* MobileSessions.logout clears credentials in finally. */
      }
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
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
          secureTextEntry
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
          secureTextEntry
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
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          disabled={busy}
          mode="outlined"
        />
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
