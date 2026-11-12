import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { ApiError } from '../../../../packages/client-core/src/api';
import { SessionClient } from '../../../../packages/client-core/src/sessionClient';
import { authenticationLinkValues } from '../../../../packages/client-core/src/authLinks';
import { useSession } from '../lib/SessionProvider';

export default function PasswordRecoveryScreen({ reset = false }: { reset?: boolean }) {
  const { baseUrl } = useSession();
  const api = useMemo(() => new SessionClient(baseUrl, 'mobile'), [baseUrl]);
  const params = useLocalSearchParams<{
    userName?: string | string[];
    token?: string | string[];
  }>();
  const [link] = useState(() => authenticationLinkValues(params));
  const [email, setEmail] = useState(link.userName);
  const [token, setToken] = useState(link.token);
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function submit() {
    if (lock.current) return;
    if (!email.trim() || (!reset && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      setError('Vui lòng nhập email hợp lệ.');
      return;
    }
    if (
      reset &&
      (!token.trim() ||
        password !== repeat ||
        !/^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\p{Nd})(?=.*[^\p{L}\p{N}]).{12,1024}$/u.test(password))
    ) {
      setError(
        'Kiểm tra mã và mật khẩu: ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số, ký tự đặc biệt và khớp xác nhận.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (reset) await api.resetPassword(email.trim(), token.trim(), password);
      else await api.requestPasswordReset(email.trim());
      setDone(true);
      setPassword('');
      setRepeat('');
      setToken('');
      if (reset) router.replace('/');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
          : reset
            ? 'Mã không hợp lệ, hết hạn hoặc mật khẩu chưa đạt yêu cầu.'
            : 'Chưa thể tiếp nhận yêu cầu. Vui lòng thử lại sau.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">{reset ? 'Đặt lại mật khẩu' : 'Quên mật khẩu'}</Text>
      {done ? (
        <Text>Nếu tài khoản đủ điều kiện, hướng dẫn sẽ được gửi đến email của bạn.</Text>
      ) : (
        <>
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            disabled={busy}
          />
          {reset && (
            <>
              <TextInput
                label="Mã đặt lại mật khẩu"
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
                secureTextEntry
                disabled={busy}
              />
              <TextInput
                label="Mật khẩu mới"
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                secureTextEntry
                disabled={busy}
              />
              <TextInput
                label="Xác nhận mật khẩu"
                value={repeat}
                onChangeText={setRepeat}
                autoCapitalize="none"
                secureTextEntry
                disabled={busy}
              />
            </>
          )}
          {!!error && <HelperText type="error">{error}</HelperText>}
          <Button mode="contained" loading={busy} disabled={busy} onPress={() => void submit()}>
            {reset ? 'Đặt lại mật khẩu' : 'Gửi hướng dẫn'}
          </Button>
        </>
      )}
      <Button disabled={busy} onPress={() => router.replace('/')}>
        Quay lại đăng nhập
      </Button>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ content: { padding: 24, gap: 16 } });
