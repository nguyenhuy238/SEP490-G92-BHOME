import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Box, Row, ui } from '../components/WorkspaceKit';
import { useSession } from '../lib/SessionProvider';
import { checkApiConnection, errorMessage } from '../lib/api';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { roleLabel, type MobileRole } from '../features/workspace/navigation';
import { colors as c } from '../theme/theme';
export function LoginScreen() {
  const { baseUrl, login, restoreError } = useSession();
  const { startPreview, unavailable } = useWorkspace();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [base, setBase] = useState(baseUrl);
  const [settings, setSettings] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [checking, setChecking] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password) {
      setError('Nhập email hợp lệ và mật khẩu để đăng nhập.');
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[ui.page, { paddingTop: 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Icon source="home-city-outline" size={40} color={c.primary} />
            </View>
            <Text style={styles.wordmark}>BHOME</Text>
            <Text variant="bodyLarge" style={ui.muted}>
              Quản lý nhà trọ thông minh
            </Text>
          </View>
          <View style={{ gap: 8 }}>
            <Text variant="headlineMedium">Chào mừng trở lại</Text>
            <Text variant="bodyLarge" style={ui.muted}>
              Đăng nhập để tiếp tục sử dụng BHOME
            </Text>
          </View>
          <Box style={{ padding: 20, gap: 18 }}>
            <Text variant="titleMedium">Email</Text>
            <TextInput
              accessibilityLabel="Email đăng nhập"
              mode="flat"
              placeholder="Nhập email của bạn"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              disabled={busy}
              left={<TextInput.Icon icon="at" />}
              style={styles.field}
              underlineColor="transparent"
            />
            <Text variant="titleMedium">Mật khẩu</Text>
            <TextInput
              accessibilityLabel="Mật khẩu đăng nhập"
              mode="flat"
              placeholder="Nhập mật khẩu"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              secureTextEntry={!visible}
              disabled={busy}
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={visible ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setVisible(!visible)}
                />
              }
              style={styles.field}
              underlineColor="transparent"
              onSubmitEditing={() => void submit()}
            />
            <Row spread>
              <Text variant="labelSmall" style={[ui.muted, ui.grow]}>
                Phiên đăng nhập được lưu bảo mật trên thiết bị
              </Text>
              <Button compact textColor={c.blue} onPress={() => unavailable('Khôi phục mật khẩu')}>
                Quên mật khẩu?
              </Button>
            </Row>
            {!!(error || restoreError) && (
              <Text accessibilityRole="alert" style={ui.red}>
                {error || restoreError}
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
          {__DEV__ && (
            <Box style={{ backgroundColor: c.soft, borderWidth: 0 }}>
              <Row spread>
                <Text variant="titleSmall" style={ui.muted}>
                  XEM GIAO DIỆN MẪU
                </Text>
                <Text variant="labelSmall" style={ui.muted}>
                  Không cần tài khoản
                </Text>
              </Row>
              <View style={ui.wrap}>
                {(['Owner', 'Staff', 'Tenant'] as MobileRole[]).map((role) => (
                  <View key={role} style={{ flex: 1, minWidth: 85 }}>
                    <Button
                      mode="elevated"
                      disabled={busy}
                      onPress={() => {
                        setPassword('');
                        startPreview(role);
                      }}
                      buttonColor={c.white}
                      textColor={role === 'Tenant' ? c.green : role === 'Staff' ? c.blue : c.navy}
                      style={{ borderRadius: 10 }}
                      labelStyle={{ fontSize: 12 }}
                    >
                      {roleLabel[role]}
                    </Button>
                  </View>
                ))}
              </View>
              <Text variant="labelSmall" style={ui.muted}>
                Dữ liệu minh họa tách biệt với hệ thống thật. Không thay đổi quyền tài khoản.
              </Text>
            </Box>
          )}
          <Button icon="cog-outline" onPress={() => setSettings(!settings)}>
            Cấu hình kết nối API
          </Button>
          {settings && (
            <Box>
              <TextInput
                label="Địa chỉ API HTTPS"
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
          <View style={styles.footer}>
            <Icon source="shield-check-outline" size={22} color={c.green} />
            <Text variant="bodySmall" style={ui.muted}>
              Kết nối HTTPS • Phiên lưu trong kho bảo mật
            </Text>
          </View>
          <Action secondary icon="headset" onPress={() => unavailable('Hỗ trợ kỹ thuật')}>
            Hỗ trợ kỹ thuật BHOME
          </Action>
          <Text variant="labelSmall" style={{ textAlign: 'center', color: c.muted }}>
            BHOME • Smart Boarding House Management
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: 12, marginBottom: 16 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
  },
  wordmark: { fontFamily: 'Inter-Bold', fontSize: 30, letterSpacing: -1, color: c.navy },
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
    paddingVertical: 12,
  },
});
