import React from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native-paper';
import { Page } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { homeScreen, sessionRole } from '../features/workspace/navigation';
import { LoginScreen } from '../screens/LoginScreen';
export default function Index() {
  const { session, ready } = useSession();
  if (!ready)
    return (
      <Page>
        <ActivityIndicator accessibilityLabel="Đang khôi phục phiên đăng nhập" />
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
  return (
    <Redirect href={{ pathname: '/workspace/[screen]', params: { screen: homeScreen[role] } }} />
  );
}
