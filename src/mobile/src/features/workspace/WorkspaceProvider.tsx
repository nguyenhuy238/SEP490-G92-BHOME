import React, { createContext, useContext, useState } from 'react';
import { router } from 'expo-router';
import { Dialog, Portal, Button, Text } from 'react-native-paper';
import { useSession } from '../../lib/SessionProvider';
import { homeScreen, sessionRole, type MobileRole, type WorkspaceScreen } from './navigation';

interface WorkspaceContext {
  scrollRevision: number;
  resetScroll: () => void;
  requests: { id: string; kind: string; role: MobileRole; summary: string }[];
  recordPreviewRequest: (kind: string, summary: string) => void;
  role: MobileRole | null;
  preview: boolean;
  startPreview: (role: MobileRole) => void;
  leavePreview: () => void;
  go: (screen: WorkspaceScreen, params?: Record<string, string>) => void;
  unavailable: (action?: string) => void;
}
const Context = createContext<WorkspaceContext | null>(null);
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [previewRole, setPreviewRole] = useState<MobileRole | null>(null);
  const [message, setMessage] = useState('');
  const [scrollRevision, setScrollRevision] = useState(0);
  const [requests, setRequests] = useState<WorkspaceContext['requests']>([]);
  const requestId = React.useRef(0);
  const preview = __DEV__ && !session && previewRole !== null;
  const role = session ? sessionRole(session.roles) : previewRole;
  const go = (screen: WorkspaceScreen, params?: Record<string, string>) =>
    router.push({ pathname: '/workspace/[screen]', params: { ...params, screen } });
  return (
    <Context.Provider
      value={{
        role,
        scrollRevision,
        resetScroll: () => setScrollRevision((value) => value + 1),
        preview,
        go,
        requests: preview ? requests.filter((request) => request.role === role) : [],
        recordPreviewRequest: (kind, summary) => {
          if (!preview || !role) return;
          const id = `sample-request-${++requestId.current}`;
          setRequests((before) => [...before, { id, kind, role, summary }]);
        },
        startPreview: (next) => {
          if (session || !__DEV__) return;
          setPreviewRole(next);
          router.replace({ pathname: '/workspace/[screen]', params: { screen: homeScreen[next] } });
        },
        leavePreview: () => {
          setPreviewRole(null);
          setRequests([]);
          router.replace('/');
        },
        unavailable: (action = 'Thao tác này') =>
          setMessage(
            `${action} chưa được kết nối API. Chưa có dữ liệu hay giao dịch nào được gửi hoặc thay đổi.`,
          ),
      }}
    >
      {children}
      <Portal>
        <Dialog visible={!!message} onDismiss={() => setMessage('')}>
          <Dialog.Title>Chưa kết nối dịch vụ</Dialog.Title>
          <Dialog.Content>
            <Text>{message}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setMessage('')}>Đã hiểu</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Context.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error('WorkspaceProvider missing');
  return context;
}
