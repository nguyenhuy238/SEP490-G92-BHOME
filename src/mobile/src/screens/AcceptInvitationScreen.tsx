import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { createApiClient } from '../../../../packages/client-core/src/api';
import { internalSigningClient } from '../../../../packages/client-core/src/internalSigning';
import { useSession } from '../lib/SessionProvider';
import { router, useLocalSearchParams } from 'expo-router';
import { authenticationLinkValues } from '../../../../packages/client-core/src/authLinks';
import { PasswordField } from '../components/PasswordField';

const messages: Record<string, string> = {
  Invalid: 'Liên kết lời mời không hợp lệ. Vui lòng mở lại liên kết trong email.',
  Expired: 'Lời mời đã hết hạn. Vui lòng liên hệ người quản lý để được gửi lại lời mời.',
  Revoked: 'Lời mời đã bị thu hồi. Vui lòng liên hệ người quản lý.',
  Used: 'Lời mời đã được sử dụng. Vui lòng đăng nhập.',
  AlreadyActivated: 'Tài khoản của bạn đã được kích hoạt. Vui lòng đăng nhập.',
};
export default function AcceptInvitationScreen() {
  const params = useLocalSearchParams<{
    userName?: string | string[];
    token?: string | string[];
  }>();
  const [link, setLink] = useState(() => authenticationLinkValues(params));
  const { baseUrl } = useSession();
  const api = useMemo(() => internalSigningClient(createApiClient(baseUrl)), [baseUrl]);
  const [invitation, setInvitation] = useState<{ status: string; email?: string | null }>({
    status: link.token ? 'Loading' : 'Invalid',
  });
  const [revision, setRevision] = useState(0);
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [validation, setValidation] = useState({ password: '', repeat: '' });
  const lock = useRef(false);
  useEffect(() => {
    if (params.token || params.userName)
      router.setParams({ token: undefined, userName: undefined });
  }, [params.token, params.userName]);
  useEffect(() => {
    if (!link.token) return;
    let active = true;
    void api
      .validateAccountInvitation(link.token)
      .then((result) => {
        if (active)
          setInvitation(
            result.status === 'Valid' && !result.email ? { status: 'Invalid' } : result,
          );
      })
      .catch(() => {
        if (active) setInvitation({ status: 'Unavailable' });
      });
    return () => {
      active = false;
    };
  }, [api, link.token, revision]);
  const valid = invitation.status === 'Valid' && Boolean(invitation.email);
  async function submit() {
    if (lock.current || !valid) return;
    const fields = {
      password:
        password.length < 12 ||
        password.length > 1024 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[^a-zA-Z0-9]/.test(password)
          ? 'Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'
          : '',
      repeat:
        repeat !== password
          ? 'Hai mật khẩu không khớp.'
          : !repeat
            ? 'Vui lòng xác nhận mật khẩu.'
            : '',
    };
    setValidation(fields);
    if (fields.password || fields.repeat) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.acceptAccount(null, link.token, password);
      setLink({ userName: '', token: '' });
      setPassword('');
      setRepeat('');
      setInvitation({ status: 'Activated' });
    } catch {
      try {
        const result = await api.validateAccountInvitation(link.token);
        setInvitation(result);
        if (result.status === 'Valid')
          setError('Chưa thể thiết lập mật khẩu. Kiểm tra yêu cầu bảo mật và thử lại.');
      } catch {
        setError('Không thể kết nối. Vui lòng thử lại.');
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">Thiết lập tài khoản BHOME</Text>
      {invitation.status === 'Loading' ? (
        <Text>Đang kiểm tra lời mời…</Text>
      ) : invitation.status === 'Activated' ? (
        <Text accessibilityRole="alert">Kích hoạt tài khoản thành công.</Text>
      ) : valid ? (
        <>
          <Text>Tạo mật khẩu để kích hoạt tài khoản của bạn.</Text>
          <TextInput
            label="Email nhận lời mời"
            value={invitation.email ?? ''}
            editable={false}
            autoCapitalize="none"
          />
          <PasswordField
            label="Mật khẩu mới"
            value={password}
            onChangeText={setPassword}
            disabled={busy}
            error={Boolean(validation.password)}
          />
          <HelperText type={validation.password ? 'error' : 'info'}>
            {validation.password ||
              'Ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'}
          </HelperText>
          <PasswordField
            label="Xác nhận mật khẩu"
            value={repeat}
            onChangeText={setRepeat}
            disabled={busy}
            error={Boolean(validation.repeat)}
          />
          {!!validation.repeat && <HelperText type="error">{validation.repeat}</HelperText>}
          <Button mode="contained" disabled={busy} loading={busy} onPress={() => void submit()}>
            Thiết lập mật khẩu
          </Button>
        </>
      ) : (
        <>
          <HelperText type="error">
            {messages[invitation.status] ||
              'Không thể kết nối để kiểm tra lời mời. Vui lòng thử lại.'}
          </HelperText>
          {invitation.status === 'Unavailable' && (
            <Button
              onPress={() => {
                setInvitation({ status: 'Loading' });
                setRevision((value) => value + 1);
              }}
            >
              Thử lại
            </Button>
          )}
        </>
      )}
      {!!error && <HelperText type="error">{error}</HelperText>}
      {invitation.status !== 'Activated' && (
        <Button disabled={busy} onPress={() => router.replace('/')}>
          Quay lại đăng nhập
        </Button>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ content: { padding: 24, gap: 16 } });
