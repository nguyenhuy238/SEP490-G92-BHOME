import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { router } from 'expo-router';
import { SessionClient } from '../../../../packages/client-core/src/sessionClient';
import { useSmsRecovery } from '../../../../packages/client-core/src/useSmsRecovery';
import { useSession } from '../lib/SessionProvider';

export default function SmsPasswordRecoveryScreen() {
  const { baseUrl } = useSession();
  const client = useMemo(() => new SessionClient(baseUrl, 'mobile'), [baseUrl]);
  const flow = useSmsRecovery(client);
  const [visible, setVisible] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">
        {flow.step === 'success'
          ? 'Đã đặt lại mật khẩu'
          : flow.step === 'reset'
            ? 'Mật khẩu mới'
            : flow.step === 'verify'
              ? 'Xác minh mã SMS'
              : 'Khôi phục qua SMS'}
      </Text>
      {flow.step === 'request' && (
        <TextInput
          label="Tài khoản hoặc số điện thoại"
          value={flow.identifier}
          onChangeText={flow.setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          disabled={flow.busy}
          maxLength={256}
        />
      )}
      {flow.step === 'verify' && (
        <>
          <Text>Nếu tài khoản đủ điều kiện, mã sẽ được gửi đến số điện thoại đã xác minh.</Text>
          <TextInput
            label="Mã xác minh"
            value={flow.otp}
            onChangeText={flow.setOtp}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            disabled={flow.busy}
          />
          <Button disabled={flow.busy || flow.seconds > 0} onPress={() => void flow.request()}>
            {flow.seconds > 0 ? `Gửi lại sau ${flow.seconds}s` : 'Gửi lại mã'}
          </Button>
        </>
      )}
      {flow.step === 'reset' && (
        <>
          <TextInput
            label="Mật khẩu mới"
            value={flow.password}
            onChangeText={flow.setPassword}
            autoCapitalize="none"
            secureTextEntry={!visible}
            disabled={flow.busy}
            maxLength={1024}
            right={
              <TextInput.Icon
                icon={visible ? 'eye-off' : 'eye'}
                accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                onPress={() => setVisible((v) => !v)}
              />
            }
          />
          <TextInput
            label="Xác nhận mật khẩu"
            value={flow.confirmation}
            onChangeText={flow.setConfirmation}
            autoCapitalize="none"
            secureTextEntry={!visible}
            disabled={flow.busy}
            maxLength={1024}
          />
        </>
      )}
      {!!flow.error && <HelperText type="error">{flow.error}</HelperText>}
      {flow.step === 'success' ? (
        <Text>Bạn có thể đăng nhập bằng mật khẩu mới.</Text>
      ) : (
        <Button
          mode="contained"
          loading={flow.busy}
          disabled={flow.busy}
          onPress={() =>
            void (flow.step === 'request'
              ? flow.request()
              : flow.step === 'verify'
                ? flow.verify()
                : flow.reset())
          }
        >
          {flow.step === 'request'
            ? 'Gửi mã xác minh'
            : flow.step === 'verify'
              ? 'Xác minh'
              : 'Đặt lại mật khẩu'}
        </Button>
      )}
      {flow.step === 'verify' && (
        <Button disabled={flow.busy} onPress={flow.restart}>
          Nhập lại tài khoản
        </Button>
      )}
      <Button disabled={flow.busy} onPress={() => router.replace('/')}>
        Quay lại đăng nhập
      </Button>
      {flow.step === 'request' && (
        <Button onPress={() => router.push('/forgot-password-email')}>Khôi phục qua email</Button>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ content: { padding: 24, gap: 16 } });
