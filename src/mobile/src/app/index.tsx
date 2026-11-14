import React, { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Page } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { homeScreen, sessionRole, workspaceTabHref } from '../features/workspace/navigation';
import { LoginScreen } from '../screens/LoginScreen';
import { clearPendingLink, peekPendingLink } from '../lib/pendingLink';
export default function Index() {
  const { session, ready, reconnecting, restoreError, retryRestore } = useSession();
  const role = session ? sessionRole(session.roles) : null;
  // A link opened before sign-in (e.g. the contract signing email) continues after sign-in, once.
  const pending = role ? peekPendingLink() : null;
  useEffect(() => {
    if (pending) clearPendingLink();
  }, [pending]);
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
  if (!role)
    return (
      <Page>
        <Text>Tài khoản chưa có vai trò mobile được hỗ trợ.</Text>
      </Page>
    );
  return <Redirect href={pending ?? workspaceTabHref(homeScreen[role])} />;
}
