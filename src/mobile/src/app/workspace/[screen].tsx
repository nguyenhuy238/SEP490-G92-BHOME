import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useWorkspace } from '../../features/workspace/WorkspaceProvider';
import { WorkspaceScreenView } from '../../features/workspace/WorkspaceScreenView';
import DemoSmsInboxScreen from '../../screens/DemoSmsInboxScreen';
import { useSession } from '../../lib/SessionProvider';
import {
  isWorkspaceScreen,
  isWorkspaceTabDestination,
  workspaceTabHref,
} from '../../features/workspace/navigation';

// Preserve existing deep links. Detail parameters must stay on the Stack route.
export default function WorkspaceRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const screen = typeof params.screen === 'string' ? params.screen : '';
  const { role } = useWorkspace();
  const { session } = useSession();
  if (__DEV__ && process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED === 'true' && screen === 'sms-demo')
    return session ? <DemoSmsInboxScreen /> : <Redirect href="/" />;
  if (role && isWorkspaceScreen(screen) && isWorkspaceTabDestination(role, screen, params))
    return <Redirect href={workspaceTabHref(screen)} />;
  return <WorkspaceScreenView screen={screen} />;
}
