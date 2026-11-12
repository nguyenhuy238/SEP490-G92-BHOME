import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useProfile } from '../features/profile/useProfile';
import {
  ProfileFailure,
  ProfileSkeleton,
  profileStyles as styles,
} from '../features/profile/ProfileComponents';
import {
  contactChanged,
  normalizeProfilePhone,
  profileError,
  profileFields,
  validateProfile,
  type AccountProfile,
  type ProfileFields,
} from '../services/accountProfile';
import { MobileApiError } from '../lib/api';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { showError, showInfo, showSuccess, showWarning } from '../lib/toast';

const noop = () => {};
export function ProfileEditScreen({ completion = false }: { completion?: boolean }) {
  const query = useProfile();
  return query.data ? (
    <ProfileEditForm initial={query.data} query={query} completion={completion} />
  ) : query.rawError ? (
    <ProfileFailure
      message={profileError(query.rawError)}
      retry={query.reload}
      busy={query.fetching}
    />
  ) : (
    <ProfileSkeleton />
  );
}
function ProfileEditForm({
  initial,
  query,
  completion,
}: {
  initial: AccountProfile;
  query: ReturnType<typeof useProfile>;
  completion: boolean;
}) {
  const { api } = useSession();
  const { go } = useWorkspace();
  // Keep the version the user actually edited. Background reads never rebase a draft.
  const [baseline, setBaseline] = useState(initial);
  const [fields, setFields] = useState(() => profileFields(initial));
  const [validation, setValidation] = useState<
    Partial<Record<keyof ProfileFields | 'currentPassword', string>>
  >({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false),
    alive = useRef(true);
  const sensitiveChanged = contactChanged(baseline, {
    ...baseline,
    email: fields.email.trim(),
    phone: normalizeProfilePhone(fields.phone) ?? null,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const back = useCallback(() => {
    if (lock.current) return;
    if (router.canGoBack()) router.back();
    else go('profile');
  }, [go]);
  const persist = query.save;
  const refreshProfile = query.refresh;
  const save = useCallback(async () => {
    if (lock.current || stale) return;
    const errors: typeof validation = validateProfile(fields, baseline.roles.includes('Tenant'));
    if (sensitiveChanged && !currentPassword)
      errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại để xác nhận thay đổi liên hệ.';
    setValidation(errors);
    if (Object.keys(errors).length) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await persist({
        fullName: fields.fullName.trim(),
        email: fields.email.trim(),
        phone: normalizeProfilePhone(fields.phone) ?? null,
        version: baseline.version,
        ...(sensitiveChanged ? { currentPassword } : {}),
      });
      if (!result || !alive.current) return;
      if (baseline.email?.toUpperCase() !== result.email?.toUpperCase() && api) {
        try {
          await api.json('/api/v1/auth/request-email-verification', { userName: result.email });
          showInfo(
            'Đã tiếp nhận yêu cầu xác nhận email mới. Kiểm tra hộp thư trước khi dùng quên mật khẩu.',
          );
        } catch {
          showWarning(
            'Đã lưu hồ sơ. Chưa thể gửi yêu cầu xác nhận email; hãy yêu cầu lại tại màn hình Xác nhận email.',
          );
        }
      }
      setCurrentPassword('');
      if (!completion) {
        lock.current = false;
        back();
      }
      showSuccess('Đã cập nhật hồ sơ. Phiên đăng nhập được giữ.');
    } catch (e) {
      if (!alive.current) return;
      const message = profileError(e);
      if (e instanceof MobileApiError && e.code === 'current_password_invalid') {
        setCurrentPassword('');
        try {
          const latest = await refreshProfile();
          if (
            latest &&
            JSON.stringify(profileFields(latest)) === JSON.stringify(profileFields(baseline))
          )
            setBaseline(latest);
          else if (latest) setStale(true);
        } catch {
          /* Keep the original safe error; API client handles a genuinely revoked session. */
        }
      }
      setError(message);
      showError(message);
      if (e instanceof MobileApiError && e.code === 'stale_profile_version') setStale(true);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }, [
    fields,
    baseline,
    stale,
    persist,
    api,
    back,
    completion,
    currentPassword,
    sensitiveChanged,
    refreshProfile,
  ]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          mode="contained"
          icon="check"
          loading={busy}
          disabled={busy || stale}
          onPress={() => void save()}
        >
          Lưu thay đổi
        </Button>
        {!completion && (
          <Button mode="text" disabled={busy} onPress={back}>
            Hủy
          </Button>
        )}
      </View>
    ),
    [busy, stale, save, back, completion],
  );
  const shell = useWorkspaceHeaderRefresh(noop, busy, {
    title: 'Chỉnh sửa hồ sơ',
    onBack: back,
    footer,
  });
  const refresh = query.refresh;
  async function reloadDraft() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const latest = await refresh();
      if (!latest || !alive.current) return;
      setBaseline(latest);
      setFields(profileFields(latest));
      setStale(false);
      setError('');
      setValidation({});
      showInfo('Đã tải hồ sơ mới. Kiểm tra thông tin trước khi lưu.');
    } catch (e) {
      if (alive.current) {
        setError(profileError(e));
        showError(profileError(e));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function change(field: keyof ProfileFields, value: string) {
    setFields((before) => ({ ...before, [field]: value }));
    setValidation((before) => ({ ...before, [field]: undefined }));
  }
  return (
    <>
      {!shell && <Text variant="titleLarge">Chỉnh sửa hồ sơ</Text>}
      <View style={styles.card}>
        <TextInput
          label="Họ và tên"
          accessibilityLabel="Họ và tên"
          value={fields.fullName}
          onChangeText={(value) => change('fullName', value)}
          mode="outlined"
          style={styles.input}
          disabled={busy}
          error={!!validation.fullName}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="name"
        />
        {!!validation.fullName && (
          <HelperText type="error" accessibilityRole="alert">
            {validation.fullName}
          </HelperText>
        )}
        <TextInput
          label={
            baseline.roles.includes('Tenant') ? 'Số điện thoại' : 'Số điện thoại (không bắt buộc)'
          }
          accessibilityLabel="Số điện thoại"
          value={fields.phone}
          onChangeText={(value) => change('phone', value)}
          mode="outlined"
          style={styles.input}
          disabled={busy}
          error={!!validation.phone}
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        {!!validation.phone && (
          <HelperText type="error" accessibilityRole="alert">
            {validation.phone}
          </HelperText>
        )}
        <TextInput
          label="Email"
          accessibilityLabel="Email"
          value={fields.email}
          onChangeText={(value) => change('email', value)}
          mode="outlined"
          style={styles.input}
          disabled={busy}
          error={!!validation.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        {!!validation.email && (
          <HelperText type="error" accessibilityRole="alert">
            {validation.email}
          </HelperText>
        )}
        {sensitiveChanged && (
          <TextInput
            label="Mật khẩu hiện tại để xác nhận"
            accessibilityLabel="Mật khẩu hiện tại để xác nhận"
            value={currentPassword}
            onChangeText={(value) => {
              setCurrentPassword(value);
              setValidation((v) => ({ ...v, currentPassword: undefined }));
            }}
            secureTextEntry
            autoCapitalize="none"
            disabled={busy}
          />
        )}
        {!!validation.currentPassword && (
          <HelperText type="error">{validation.currentPassword}</HelperText>
        )}
        <Text>
          Số điện thoại là thông tin liên hệ; BHOME chưa có kênh xác minh SMS. Email mới cần được
          xác nhận trước khi khôi phục mật khẩu.
        </Text>
      </View>
      {!!error && (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          {stale && (
            <>
              <Text style={styles.label}>Nội dung đang nhập sẽ được thay bằng hồ sơ mới.</Text>
              <Button compact icon="refresh" disabled={busy} onPress={() => void reloadDraft()}>
                Tải hồ sơ mới
              </Button>
            </>
          )}
        </View>
      )}
      {!shell && footer}
    </>
  );
}
