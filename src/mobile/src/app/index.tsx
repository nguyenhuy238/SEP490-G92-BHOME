import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Page } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { homeScreen, sessionRole, workspaceTabHref } from '../features/workspace/navigation';
import { LoginScreen } from '../screens/LoginScreen';
export default function Index() {
  const { session, ready, reconnecting, restoreError, retryRestore } = useSession();
  if (!ready)
    return (
      <Page>
        <ActivityIndicator accessibilityLabel="Đang khôi phục phiên đăng nhập" />
      </Page>
    );
  if (!session && reconnecting)
    return (
      <Page>
        <Text>{restoreError}</Text>
        <Button onPress={() => void retryRestore()}>Thử khôi phục phiên</Button>
      </Page>
    );
  if (!session) return <LoginScreen />;
  const role = sessionRole(session.roles);
  if (!role)
    return (
      <Page>
        <Text>Tài khoản chưa có vai trò mobile được hỗ trợ.</Text>
      </Page>
    );
  return <Redirect href={workspaceTabHref(homeScreen[role])} />;
}
