import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { createApiClient } from '../../../../packages/client-core/src/api';
import {
  internalSigningClient,
  signingMessage,
} from '../../../../packages/client-core/src/internalSigning';
import { useSession } from '../lib/SessionProvider';

export default function AcceptInvitationScreen() {
  const { baseUrl } = useSession();
  const api = useMemo(() => internalSigningClient(createApiClient(baseUrl)), [baseUrl]);
  const [email, setEmail] = useState(''),
    [token, setToken] = useState(''),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function submit() {
    if (lock.current) return;
    if (password !== repeat || password.length < 12) {
      setError('Mật khẩu cần ít nhất 12 ký tự và khớp xác nhận.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.acceptAccount(email, token, password);
      setDone(true);
      setToken('');
      setPassword('');
      setRepeat('');
    } catch (e) {
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">Thiết lập tài khoản BHOME</Text>
      {done ? (
        <Text>Đã thiết lập mật khẩu. Bạn có thể quay lại đăng nhập.</Text>
      ) : (
        <>
          <TextInput
            label="Email nhận lời mời"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            disabled={busy}
          />
          <TextInput
            label="Mã lời mời trong email"
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
            secureTextEntry
            autoCapitalize="none"
            disabled={busy}
          />
          <Text>Mật khẩu ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</Text>
          <TextInput
            label="Xác nhận mật khẩu"
            value={repeat}
            onChangeText={setRepeat}
            secureTextEntry
            autoCapitalize="none"
            disabled={busy}
          />
          <Button mode="contained" disabled={busy} loading={busy} onPress={() => void submit()}>
            Thiết lập mật khẩu
          </Button>
        </>
      )}
      {!!error && <HelperText type="error">{error}</HelperText>}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ content: { padding: 24, gap: 16 } });
