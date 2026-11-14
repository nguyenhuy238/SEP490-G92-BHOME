/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static asset paths. */
import React from 'react';
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/SessionProvider';
import { WorkspaceProvider, useWorkspace } from '../features/workspace/WorkspaceProvider';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/ToastHost';
import { TenantProfileGate } from '../features/profile/TenantProfileGate';
export default function RootLayout() {
  const [loaded, error] = useFonts({
    'Inter-Regular': require('../../assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('../../assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('../../assets/fonts/Inter-Bold.ttf'),
    ...MaterialCommunityIcons.font,
  });
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <PaperProvider
        theme={theme}
        settings={{
          icon: (props) => (
            <MaterialCommunityIcons
              {...props}
              name={props.name as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
            />
          ),
        }}
      >
        <ToastProvider>
          <SessionProvider>
            <WorkspaceProvider>
              <TenantProfileGate>
                <WorkspaceNavigation />
              </TenantProfileGate>
            </WorkspaceProvider>
          </SessionProvider>
        </ToastProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function WorkspaceNavigation() {
  const { session } = useSession();
  const { role, preview } = useWorkspace();
  // Drop navigation history and mounted tab state at every principal/role change.
  const identity = `${session?.userId ?? (preview ? 'preview' : 'anonymous')}:${role}`;
  return (
    <Stack key={identity} screenOptions={{ headerTitle: 'BHOME', headerBackTitle: 'Quay lại' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="accept-invitation" options={{ title: 'Thiết lập tài khoản' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Quên mật khẩu' }} />
      <Stack.Screen name="forgot-password-email" options={{ title: 'Khôi phục qua email' }} />
      <Stack.Screen name="confirm-email" options={{ title: 'Xác nhận email' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Đặt lại mật khẩu' }} />
      <Stack.Screen name="contract-signing" options={{ title: 'Chấp thuận hợp đồng' }} />
      <Stack.Protected guard={!!role}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="workspace/[screen]" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={role !== 'Owner'}>
        <Stack.Screen name="meter" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="capture" options={{ title: 'Tác nghiệp OCR' }} />
        <Stack.Screen name="setup" />
        <Stack.Screen name="resident" />
        <Stack.Screen name="identity" />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="ocr-test" options={{ title: 'Thử OCR' }} />
        </Stack.Protected>
      </Stack.Protected>
    </Stack>
  );
}
