import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { router, useSegments } from 'expo-router';
import { Dialog, Portal, Button, Text } from 'react-native-paper';
import { useSession } from '../../lib/SessionProvider';
import { StaffLocationProvider } from './StaffLocationProvider';
import { useStaffLocation } from './StaffLocationProvider';
import type { Named } from '../../lib/api';
import { showInfo } from '../../lib/toast';
import {
  homeScreen,
  sessionRole,
  isWorkspaceTabDestination,
  workspaceTabHref,
  type MobileRole,
  type WorkspaceScreen,
} from './navigation';

interface WorkspaceContext {
  staffLocationId: string;
  staffLocations: Named[];
  staffLocationsLoading: boolean;
  staffLocationsError: string;
  selectStaffLocation: (id: string) => void;
  navigateInStaffLocation: (id: string, action: () => void) => void;
  reloadStaffLocations: () => void;
  registerExitGuard: (
    guard: () => boolean,
    onLeave: () => void,
    exitToHome?: boolean,
  ) => () => void;
  requestNavigation: (action: () => void, keepDestination?: boolean) => void;
  scrollRevision: number;
  resetScroll: () => void;
  requests: { id: string; kind: string; role: MobileRole; summary: string }[];
  recordPreviewRequest: (kind: string, summary: string) => void;
  role: MobileRole | null;
  preview: boolean;
  startPreview: (role: MobileRole) => void;
  leavePreview: () => void;
  go: (screen: WorkspaceScreen, params?: Record<string, string>, keepDestination?: boolean) => void;
  unavailable: (action?: string) => void;
}
const Context = createContext<WorkspaceContext | null>(null);
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const identity = session ? `${session.userId}:${session.roles.join(',')}` : 'anonymous';
  return (
    <StaffLocationProvider key={identity}>
      <WorkspaceSessionProvider>{children}</WorkspaceSessionProvider>
    </StaffLocationProvider>
  );
}
function WorkspaceSessionProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const staffLocation = useStaffLocation();
  const segments = useSegments();
  const [previewRole, setPreviewRole] = useState<MobileRole | null>(null);
  const [message, setMessage] = useState('');
  const [confirmExit, setConfirmExit] = useState<{ exitToHome: boolean } | null>(null);
  const exitGuard = useRef<{
    shouldBlock: () => boolean;
    onLeave: () => void;
    exitToHome: boolean;
  } | null>(null);
  const pendingNavigation = useRef<{
    action: () => void;
    guard: NonNullable<typeof exitGuard.current>;
    exitToHome: boolean;
  } | null>(null);
  const cancelExit = useCallback(() => {
    pendingNavigation.current = null;
    setConfirmExit(null);
  }, []);
  const registerExitGuard = useCallback(
    (guard: () => boolean, onLeave: () => void, exitToHome = false) => {
      const entry = { shouldBlock: guard, onLeave, exitToHome };
      exitGuard.current = entry;
      return () => {
        if (exitGuard.current === entry) exitGuard.current = null;
        if (pendingNavigation.current?.guard === entry) cancelExit();
      };
    },
    [cancelExit],
  );
  const requestNavigation = useCallback((action: () => void, keepDestination = false) => {
    const guard = exitGuard.current;
    if (guard?.shouldBlock()) {
      if (pendingNavigation.current) return;
      const exitToHome = guard.exitToHome && !keepDestination;
      pendingNavigation.current = { action, guard, exitToHome };
      setConfirmExit({ exitToHome });
    } else action();
  }, []);
  const [scrollRevision, setScrollRevision] = useState(0);
  const [requests, setRequests] = useState<WorkspaceContext['requests']>([]);
  const requestId = React.useRef(0);
  const preview = __DEV__ && !session && previewRole !== null;
  const role = session ? sessionRole(session.roles) : previewRole;
  const locationNavigation = useRef<{
    id: string;
    action: () => void;
  } | null>(null);
  const [locationNavigationRevision, setLocationNavigationRevision] = useState(0);
  const navigateInStaffLocation = (id: string, action: () => void) =>
    requestNavigation(() => {
      if (role !== 'Staff' || preview) return;
      locationNavigation.current = { id, action };
      setLocationNavigationRevision((revision) => revision + 1);
      // A newly assigned location may not yet be in the shared catalogue.
      if (!staffLocation.loading && !staffLocation.locations.some((item) => item.id === id))
        staffLocation.reload();
    });
  useEffect(() => {
    const pending = locationNavigation.current;
    if (!pending || staffLocation.loading) return;
    if (
      role !== 'Staff' ||
      preview ||
      !staffLocation.locations.some((item) => item.id === pending.id)
    ) {
      locationNavigation.current = null;
      showInfo('Cơ sở không còn khả dụng hoặc bạn không còn quyền truy cập.');
      return;
    }
    if (staffLocation.selectedLocationId !== pending.id) {
      staffLocation.selectLocation(pending.id);
      return;
    }
    // Wait until the shared selection has committed before mounting a scoped
    // destination. This also survives the inbox remount when its location changes.
    locationNavigation.current = null;
    pending.action();
  }, [locationNavigationRevision, staffLocation, role, preview]);
  const go = (screen: WorkspaceScreen, params?: Record<string, string>, keepDestination = false) =>
    requestNavigation(() => {
      if (role && isWorkspaceTabDestination(role, screen, params)) {
        const href = workspaceTabHref(screen);
        // Inside Tabs this changes the selected route. From a detail, unwind to
        // the existing Tabs instance instead of stacking another workspace.
        if (segments.includes('(tabs)')) router.navigate(href);
        else router.dismissTo(href);
      } else router.push({ pathname: '/workspace/[screen]', params: { ...params, screen } });
    }, keepDestination);
  return (
    <Context.Provider
      value={{
        staffLocationId: role === 'Staff' && !preview ? staffLocation.selectedLocationId : '',
        staffLocations: role === 'Staff' && !preview ? staffLocation.locations : [],
        staffLocationsLoading: role === 'Staff' && !preview && staffLocation.loading,
        staffLocationsError: role === 'Staff' && !preview ? staffLocation.error : '',
        selectStaffLocation: (id) =>
          requestNavigation(() => {
            staffLocation.selectLocation(id);
          }),
        navigateInStaffLocation,
        reloadStaffLocations: staffLocation.reload,
        role,
        registerExitGuard,
        requestNavigation,
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
          // Owner uses only live, server-authorized screens. The legacy Owner mock
          // must not be mistaken for an operational workspace.
          if (session || !__DEV__ || next === 'Owner') return;
          setPreviewRole(next);
          router.replace(workspaceTabHref(homeScreen[next]));
        },
        leavePreview: () =>
          requestNavigation(() => {
            setPreviewRole(null);
            setRequests([]);
            router.replace('/');
          }),
        unavailable: (action = 'Thao tác này') =>
          setMessage(
            `${action} chưa được kết nối API. Chưa có dữ liệu hay giao dịch nào được gửi hoặc thay đổi.`,
          ),
      }}
    >
      {children}
      <Portal>
        <Dialog visible={!!confirmExit} onDismiss={cancelExit}>
          <Dialog.Title>
            {confirmExit?.exitToHome ? 'Rời bước nhập CCCD?' : 'Rời quy trình tiếp nhận?'}
          </Dialog.Title>
          <Dialog.Content>
            <Text>Thông tin chưa xác nhận có thể bị mất. Hồ sơ đã lưu vẫn được giữ lại.</Text>
            {confirmExit?.exitToHome && <Text>Bạn sẽ trở về Trang chủ.</Text>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={cancelExit}>Tiếp tục nhập</Button>
            <Button
              onPress={() => {
                const pending = pendingNavigation.current;
                cancelExit();
                if (!pending || pending.guard !== exitGuard.current) return;
                exitGuard.current = null;
                pending.guard.onLeave();
                if (pending.exitToHome && role)
                  router.dismissTo(workspaceTabHref(homeScreen[role]));
                else pending.action();
              }}
            >
              Rời quy trình
            </Button>
          </Dialog.Actions>
        </Dialog>
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
