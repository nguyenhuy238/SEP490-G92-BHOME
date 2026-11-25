import React, { createContext, useContext, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { resolveApiEndpoint } from './apiEndpoint';
import { MobileApiError } from './api';
import { clearAbandonedCaptures } from './captureFiles';
import { createCredentialStore } from './credentialStore';
import { MobileSessions, type SessionView } from './sessions';
import { showWarning } from './toast';
import {
  setDemoBusinessDate,
  type DemoClockState,
} from '../../../../packages/client-core/src/demoClock';

// Exported only so ContextPortal can re-provide it inside react-native-paper portals.
export const SessionContext = createContext<
  | (SessionView & {
      login: MobileSessions['login'];
      logout: MobileSessions['logout'];
      retryRestore: () => Promise<void>;
    })
  | null
>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [manager] = useState(
    () =>
      new MobileSessions(
        createCredentialStore(),
        resolveApiEndpoint({
          development: __DEV__,
          hostUri: Constants.expoConfig?.hostUri,
          configuredUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
          developmentUrl: process.env.EXPO_PUBLIC_DEV_API_BASE_URL,
          browserHostname: Platform.OS === 'web' ? globalThis.location?.hostname : undefined,
        }),
        undefined,
        __DEV__ ? process.env.EXPO_PUBLIC_DEV_SERVER_ID : undefined,
      ),
  );
  const [view, setView] = useState(manager.snapshot);
  const [demoClock, setDemoClock] = useState<{
    api: SessionView['api'];
    state: DemoClockState;
  } | null>(null);
  // All builds discover the server-owned capability; an explicit false disables the probe.
  const demoEnabled =
    process.env.EXPO_PUBLIC_DEMO_CLOCK_ENABLED === 'true' ||
    (process.env.NODE_ENV !== 'test' && process.env.EXPO_PUBLIC_DEMO_CLOCK_ENABLED !== 'false');
  const demoApi = view.api;
  const demoUser = view.session?.userId;
  useEffect(() => {
    if (!demoEnabled || !demoApi || !demoUser) {
      setDemoBusinessDate(null);
      return;
    }
    const api = demoApi;
    let active = true;
    let loading = false;
    async function sync() {
      if (!active || loading) return;
      loading = true;
      try {
        const state = await api.request<DemoClockState>('/api/v1/demo-clock');
        if (!active) return;
        const changed = setDemoBusinessDate(state);
        setDemoClock((previous) =>
          previous?.api === api &&
          previous.state.version === state.version &&
          previous.state.businessDate === state.businessDate &&
          previous.state.simulated === state.simulated
            ? previous
            : { api, state },
        );
        if (changed)
          api.queryCache.invalidate([
            'rooms',
            'contracts',
            'invoices',
            'payments',
            'debts',
            'tasks',
            'meters',
            'notifications',
            'incidents',
          ]);
      } catch (error) {
        if (active && error instanceof MobileApiError && error.status === 404) {
          const state: DemoClockState = {
            enabled: false,
            simulated: false,
            businessDate: '',
            version: 0,
          };
          const changed = setDemoBusinessDate(null);
          setDemoClock((previous) =>
            previous?.api === api && !previous.state.enabled ? previous : { api, state },
          );
          if (changed)
            api.queryCache.invalidate([
              'rooms',
              'contracts',
              'invoices',
              'payments',
              'debts',
              'tasks',
              'meters',
              'notifications',
              'incidents',
            ]);
        }
        /* Retry on the next foreground poll; retain the last server-confirmed date on transient errors. */
      } finally {
        loading = false;
      }
    }
    void sync();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, 3000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => {
      active = false;
      clearInterval(timer);
      listener.remove();
      setDemoBusinessDate(null);
    };
  }, [demoEnabled, demoApi, demoUser]);
  useEffect(() => {
    clearAbandonedCaptures();
    const unsubscribe = manager.subscribe(setView);
    void manager.restore();
    const reconnect = () => {
      if (AppState.currentState === 'active') void manager.reconnect();
    };
    const listener = AppState.addEventListener('change', (state) => {
      manager.snapshot.api?.queryCache.setForeground(state === 'active');
      if (state === 'active') void manager.reconnect();
    });
    const timer = setInterval(reconnect, 5000);
    return () => {
      unsubscribe();
      listener.remove();
      clearInterval(timer);
    };
  }, [manager]);
  useEffect(() => {
    view.api?.queryCache.setForeground(
      AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
    );
  }, [view.api]);
  return (
    <SessionContext.Provider
      value={{
        ...view,
        ready: view.ready && (!demoEnabled || !view.session || demoClock?.api === view.api),
        login: (base, name, password) => manager.login(base, name, password),
        logout: async () => {
          const { api, session, baseUrl } = manager.snapshot;
          if (api && session && Platform.OS !== 'web') {
            try {
              const { unregisterPushDevice } = await import('../services/pushRegistration');
              const result = await unregisterPushDevice(api, { userId: session.userId, baseUrl });
              if (!result.removed) showWarning(result.message);
            } catch {
              // Continue logout, but never say push was disabled without server confirmation.
              showWarning(
                'Chưa hủy được thông báo đẩy trên máy chủ. Thiết bị có thể vẫn nhận tin của tài khoản này.',
              );
            }
          }
          await manager.logout();
        },
        retryRestore: () => manager.reconnect(),
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}
