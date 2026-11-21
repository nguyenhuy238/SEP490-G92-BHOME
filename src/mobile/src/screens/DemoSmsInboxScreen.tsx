import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Card, Chip, HelperText, Text } from 'react-native-paper';
import { Redirect } from 'expo-router';
import { useSession } from '../lib/SessionProvider';
import type { DemoSms } from '../../../../packages/client-core/src/smsDemo';
import { formatInstant } from '../../../../packages/client-core/src/localization';

export default function DemoSmsInboxScreen() {
  const { api, session } = useSession();
  const [messages, setMessages] = useState<DemoSms[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!api || !__DEV__ || process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED !== 'true') return;
    try {
      setMessages(await api.request<DemoSms[]>('/api/v1/demo/sms'));
      setError('');
    } catch {
      setMessages([]);
      setError('Hộp thư demo không khả dụng hoặc bạn không có quyền truy cập.');
    } finally {
      setBusy(false);
    }
  }, [api]);
  useEffect(() => {
    if (!api || !__DEV__ || process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED !== 'true') return;
    let active = true;
    void api.request<DemoSms[]>('/api/v1/demo/sms').then(
      (data) => {
        if (active) {
          setMessages(data);
          setBusy(false);
        }
      },
      () => {
        if (active) {
          setError('Hộp thư demo không khả dụng hoặc bạn không có quyền truy cập.');
          setBusy(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api]);
  if (!__DEV__ || process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED !== 'true' || !session)
    return <Redirect href="/" />;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text variant="headlineSmall">Hộp thư SMS Demo</Text>
      <Text>Demo cách ly · Tin nhắn mô phỏng, không gửi qua mạng di động. OTP tự hết hạn.</Text>
      <Button
        mode="outlined"
        disabled={busy}
        loading={busy}
        onPress={() => {
          setBusy(true);
          void refresh();
        }}
      >
        Làm mới
      </Button>
      {!!error && <HelperText type="error">{error}</HelperText>}
      {!error && messages.length === 0 && <Text>Chưa có tin nhắn mô phỏng còn hiệu lực.</Text>}
      {messages.map((message) => (
        <Card key={message.id}>
          <Card.Content>
            <Text variant="titleMedium">{message.maskedPhone}</Text>
            <Chip>Mô phỏng · {message.templateId}</Chip>
            <Text>{message.content}</Text>
            <Text variant="bodySmall">{formatInstant(message.createdAt)} · Mock</Text>
          </Card.Content>
        </Card>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 16 } });
