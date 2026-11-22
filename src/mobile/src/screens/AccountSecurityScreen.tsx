import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import React, { useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { Text, TextInput } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, MobileApiError } from '../lib/api';
import { getFieldErrors } from '../../../../packages/client-core/src/api';

export function AccountSecurityScreen() {
  const { api, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState({ current: false, password: false, confirm: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, unknown>>({});
  function invalid(field: string, message: string) {
    setFieldErrors({ [field]: message });
    setError('');
  }
  function clearField(field: string) {
    setFieldErrors((current) => ({ ...current, [field]: '' }));
  }
  React.useEffect(() => {
    if (busy) return;
    const first = ['currentPassword', 'newPassword', 'confirmPassword'].find(
      (field) => fieldErrors[field],
    );
    const target = first
      ? (inputs.current[first] as { focus?: () => void } | undefined)
      : undefined;
    if (typeof target?.focus === 'function') target.focus();
  }, [fieldErrors, busy]);
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
    if (lock.current) return;
    if (!api) {
      setError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để đổi mật khẩu.');
      return;
    }
    if (!current) {
      invalid('currentPassword', 'Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (!password) {
      invalid('newPassword', 'Vui lòng nhập mật khẩu mới.');
      return;
    }
    if (!confirm) {
      invalid('confirmPassword', 'Vui lòng xác nhận mật khẩu mới.');
      return;
    }
    if (password !== confirm) {
      invalid('confirmPassword', 'Xác nhận mật khẩu mới không khớp.');
      return;
    }
    if (current.length > 1024) {
      invalid('currentPassword', 'Mật khẩu hiện tại vượt quá độ dài cho phép.');
      return;
    }
    if (password.length < 12 || password.length > 1024) {
      invalid('newPassword', 'Mật khẩu mới phải từ 12 đến 1024 ký tự.');
      return;
    }
    if (current === password) {
      invalid('newPassword', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
      return;
    }
    if (!/^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\p{Nd})(?=.*[^\p{L}\p{N}]).{12,1024}$/u.test(password)) {
      invalid('newPassword', 'Mật khẩu mới phải gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setFieldErrors({});
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
      const fields = getFieldErrors(e);
      const first = ['currentPassword', 'newPassword', 'confirmPassword'].find(
        (field) => fields[field],
      );
      if (first) {
        setFieldErrors(fields);
      }
      setError(
        first
          ? ''
          : e instanceof MobileApiError && e.status === 400
            ? 'Mật khẩu hiện tại không đúng hoặc mật khẩu mới chưa đáp ứng yêu cầu. Vui lòng kiểm tra và thử lại.'
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
          ref={(target: unknown) => {
            inputs.current.currentPassword = target;
          }}
          label="Mật khẩu hiện tại"
          accessibilityLabel="Mật khẩu hiện tại"
          value={current}
          onChangeText={(value) => {
            setCurrent(value);
            clearField('currentPassword');
          }}
          error={!!fieldErrors.currentPassword}
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
        {!!fieldErrors.currentPassword && (
          <Text accessibilityRole="alert" style={ui.red}>
            {fieldErrors.currentPassword}
          </Text>
        )}
        <TextInput
          ref={(target: unknown) => {
            inputs.current.newPassword = target;
          }}
          label="Mật khẩu mới"
          accessibilityLabel="Mật khẩu mới"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            clearField('newPassword');
            clearField('confirmPassword');
          }}
          error={!!fieldErrors.newPassword}
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
        {!!fieldErrors.newPassword && (
          <Text accessibilityRole="alert" style={ui.red}>
            {fieldErrors.newPassword}
          </Text>
        )}
        <TextInput
          ref={(target: unknown) => {
            inputs.current.confirmPassword = target;
          }}
          label="Xác nhận mật khẩu mới"
          accessibilityLabel="Xác nhận mật khẩu mới"
          value={confirm}
          onChangeText={(value) => {
            setConfirm(value);
            clearField('confirmPassword');
          }}
          error={!!fieldErrors.confirmPassword}
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
        {!!fieldErrors.confirmPassword && (
          <Text accessibilityRole="alert" style={ui.red}>
            {fieldErrors.confirmPassword}
          </Text>
        )}
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
