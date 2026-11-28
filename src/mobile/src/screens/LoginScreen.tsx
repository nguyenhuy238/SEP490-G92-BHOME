import { KeyboardFormScrollView } from '../components/KeyboardFormScrollView';
import { useFeedbackState } from '../lib/useFeedbackState';
import { conciseMessage } from '../lib/toast';
import React, { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Box, Row, ui } from '../components/WorkspaceKit';
import { useSession } from '../lib/SessionProvider';
import { checkApiConnection, errorMessage } from '../lib/api';
import { colors as c } from '../theme/theme';
import {
  loginIdentifierError,
  loginPasswordError,
} from '../../../../packages/client-core/src/loginValidation';

// Metro requires a literal asset path for bundled React Native images.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bhomeLogo = require('../../assets/bhome-logo.png');

export function LoginScreen() {
  const { baseUrl, login, restoreError } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [baseOverride, setBase] = useState<string | null>(null);
  const base = baseOverride ?? baseUrl;
  const [settings, setSettings] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const [validation, setValidation] = useState({ identifier: '', password: '' });
  const identifierInput = useRef<unknown>(null);
  const passwordInput = useRef<unknown>(null);
  const [connection, setConnection] = useState('');
  const [checking, setChecking] = useState(false);
  const submit = async () => {
    if (busy) return;
    const errors = {
      identifier: loginIdentifierError(email),
      password: loginPasswordError(password),
    };
    setValidation(errors);
    if (errors.identifier || errors.password) {
      const target = (errors.identifier ? identifierInput.current : passwordInput.current) as {
        focus?: () => void;
      } | null;
      if (typeof target?.focus === 'function') target.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(base, email, password);
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <KeyboardFormScrollView
          contentContainerStyle={[ui.page, styles.content]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <Image
              source={bhomeLogo}
              accessibilityLabel="Logo BHome"
              style={styles.logo}
              resizeMode="contain"
            />
            <Text variant="bodyLarge" style={ui.muted}>
              Quản lý nhà trọ thông minh
            </Text>
          </View>
          <View style={styles.welcome}>
            <Text variant="headlineMedium">Chào mừng trở lại</Text>
            <Text variant="bodyLarge" style={ui.muted}>
              Đăng nhập để tiếp tục sử dụng BHome
            </Text>
          </View>
          <Box style={styles.form}>
            <Text variant="titleMedium">Email hoặc số điện thoại</Text>
            <TextInput
              ref={(target: unknown) => {
                identifierInput.current = target;
              }}
              accessibilityLabel="Email hoặc số điện thoại đăng nhập"
              mode="flat"
              placeholder="Nhập email hoặc số điện thoại"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (validation.identifier)
                  setValidation((v) => ({ ...v, identifier: loginIdentifierError(value) }));
              }}
              error={!!validation.identifier}
              maxLength={256}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              autoComplete="username"
              disabled={busy}
              left={<TextInput.Icon icon="at" />}
              style={styles.field}
              underlineColor="transparent"
            />
            {!!validation.identifier && (
              <Text accessibilityRole="alert" style={ui.red}>
                {validation.identifier}
              </Text>
            )}
            <Text variant="titleMedium">Mật khẩu</Text>
            <TextInput
              ref={(target: unknown) => {
                passwordInput.current = target;
              }}
              accessibilityLabel="Mật khẩu đăng nhập"
              mode="flat"
              placeholder="Nhập mật khẩu"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (validation.password)
                  setValidation((v) => ({ ...v, password: loginPasswordError(value) }));
              }}
              error={!!validation.password}
              maxLength={1024}
              autoCapitalize="none"
              autoComplete="current-password"
              secureTextEntry={!visible}
              disabled={busy}
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={visible ? 'eye-off-outline' : 'eye-outline'}
                  accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  onPress={() => setVisible(!visible)}
                />
              }
              style={styles.field}
              underlineColor="transparent"
              onSubmitEditing={() => void submit()}
            />
            {!!validation.password && (
              <Text accessibilityRole="alert" style={ui.red}>
                {validation.password}
              </Text>
            )}
            <Row spread>
              <Text variant="labelSmall" style={[ui.muted, ui.grow]}>
                {Platform.OS === 'web'
                  ? 'Tải lại hoặc đóng trang sẽ kết thúc phiên đăng nhập'
                  : 'Phiên đăng nhập được lưu bảo mật trên thiết bị'}
              </Text>
              <Button compact textColor={c.blue} onPress={() => router.push('/forgot-password')}>
                Quên mật khẩu?
              </Button>
            </Row>
            {!!(error || restoreError) && (
              <Text accessibilityRole="alert" style={ui.red}>
                {conciseMessage(error || restoreError || '')}
              </Text>
            )}
            <Button
              mode="contained"
              loading={busy}
              disabled={busy}
              onPress={() => void submit()}
              contentStyle={{ minHeight: 48 }}
              style={{ borderRadius: 10 }}
              icon="arrow-right"
            >
              Đăng nhập
            </Button>
          </Box>
          <View style={styles.footer}>
            <Icon source="shield-check-outline" size={22} color={c.green} />
            <Text variant="bodySmall" style={ui.muted}>
              Kết nối HTTPS • Phiên lưu trong kho bảo mật
            </Text>
          </View>
          <Button
            compact
            icon="cog-outline"
            disabled={busy || checking}
            onPress={() => setSettings(!settings)}
            textColor={c.muted}
          >
            Cấu hình kết nối API
          </Button>
          {settings && (
            <Box>
              <TextInput
                label="Địa chỉ API HTTPS"
                accessibilityLabel="Địa chỉ API HTTPS"
                value={base}
                onChangeText={(value) => {
                  setBase(value);
                  setConnection('');
                }}
                disabled={busy || checking}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                mode="outlined"
              />
              <Text variant="bodySmall" style={ui.muted}>
                Dùng địa chỉ API của môi trường phát triển hoặc triển khai BHOME.
              </Text>
              <Button
                loading={checking}
                disabled={checking || busy}
                onPress={async () => {
                  setChecking(true);
                  setConnection('');
                  try {
                    await checkApiConnection(base);
                    setConnection('API HTTPS sẵn sàng. Hãy đăng nhập để xác minh tài khoản.');
                  } catch (failure) {
                    setConnection(errorMessage(failure));
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                Kiểm tra kết nối HTTPS
              </Button>
              {!!connection && <Text accessibilityRole="alert">{connection}</Text>}
            </Box>
          )}
          <Text variant="labelSmall" style={{ textAlign: 'center', color: c.muted }}>
            BHome • Smart Boarding House Management
          </Text>
        </KeyboardFormScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  brand: { alignItems: 'center', gap: 6 },
  welcome: { gap: 4 },
  form: { padding: 16, gap: 10 },
  logo: {
    width: 64,
    height: 64,
  },
  field: {
    backgroundColor: c.soft,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderRadius: 10,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
});
