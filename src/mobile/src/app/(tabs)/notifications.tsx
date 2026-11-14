import React from 'react';
import { WorkspaceScreenView } from '../../features/workspace/WorkspaceScreenView';
import { View } from 'react-native';
import { Button } from 'react-native-paper';
import { router } from 'expo-router';

export default function WorkspaceTab() {
  return (
    <View style={{ flex: 1 }}>
      {__DEV__ && process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED === 'true' && (
        <Button onPress={() => router.push('/workspace/sms-demo')}>Hộp thư SMS Demo</Button>
      )}
      <WorkspaceScreenView screen="notifications" />
    </View>
  );
}
