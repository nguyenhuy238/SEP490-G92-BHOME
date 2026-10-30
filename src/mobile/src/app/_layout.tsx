/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static asset paths. */
import React from 'react';
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../lib/SessionProvider';
import { WorkspaceProvider } from '../features/workspace/WorkspaceProvider';
import { theme } from '../theme/theme';
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
        <SessionProvider>
          <WorkspaceProvider>
            <Stack screenOptions={{ headerTitle: 'BHOME', headerBackTitle: 'Quay lại' }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="workspace/[screen]" options={{ headerShown: false }} />
              <Stack.Screen name="capture" options={{ title: 'Tác nghiệp OCR' }} />
            </Stack>
          </WorkspaceProvider>
        </SessionProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
