import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { ApiError } from '../../../../packages/client-core/src/api';
import { SessionClient } from '../../../../packages/client-core/src/sessionClient';
import { authenticationLinkValues } from '../../../../packages/client-core/src/authLinks';
import { useSession } from '../lib/SessionProvider';

export default function ConfirmEmailScreen() {
  const { baseUrl } = useSession();
  const api = useMemo(() => new SessionClient(baseUrl, 'mobile'), [baseUrl]);
  const params = useLocalSearchParams<{
    userName?: string | string[];
    token?: string | string[];
  }>();
  const [link] = useState(() => authenticationLinkValues(params));
  const [email, setEmail] = useState(link.userName),
    [token, setToken] = useState(link.token);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function submit(confirm: boolean) {
    if (lock.current) return;
    if (!email.trim() || (!confirm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      setError('Vui lòng nhập email hợp lệ.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (confirm) {
        await api.confirmEmail(email.trim(), token.trim());
        setDone(true);
        setToken('');
      } else {
        await api.requestEmailVerification(email.trim());
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
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">Xác nhận email BHOME</Text>
      {done ? (
        <>
          <Text>Email đã được xác nhận. Bạn có thể yêu cầu đặt lại mật khẩu.</Text>
          <Button onPress={() => router.replace('/forgot-password')}>Quên mật khẩu</Button>
        </>
      ) : (
        <>
          <Text>Xác nhận email đã đăng ký trước khi yêu cầu đặt lại mật khẩu.</Text>
          <TextInput
            label={token ? 'Tài khoản' : 'Email'}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={token ? 'default' : 'email-address'}
            disabled={busy}
          />
          {!!token && (
            <TextInput
              label="Mã xác nhận"
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              secureTextEntry
              disabled={busy}
            />
          )}
          <Button
            mode="contained"
            loading={busy}
            disabled={busy}
            onPress={() => void submit(!!token)}
          >
            {token ? 'Xác nhận email' : 'Gửi liên kết xác nhận'}
          </Button>
          {!!token && (
            <Button disabled={busy} onPress={() => void submit(false)}>
              Gửi lại liên kết
            </Button>
          )}
        </>
      )}
      {!!message && <Text>{message}</Text>}
      {!!error && <HelperText type="error">{error}</HelperText>}
      <Button disabled={busy} onPress={() => router.replace('/')}>
        Quay lại đăng nhập
      </Button>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ content: { padding: 24, gap: 16 } });
