import React from 'react';
import { Stack } from 'expo-router';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../lib/SessionProvider';
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider
        theme={{ ...MD3LightTheme, colors: { ...MD3LightTheme.colors, primary: '#166534' } }}
      >
        <SessionProvider>
          <Stack screenOptions={{ headerTitle: 'BHOME', headerBackTitle: 'Quay lại' }} />
        </SessionProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
