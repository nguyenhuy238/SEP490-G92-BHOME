import React, { createContext, useContext, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { resolveApiEndpoint } from './apiEndpoint';
import { clearAbandonedCaptures } from './captureFiles';
import { createCredentialStore } from './credentialStore';
import { MobileSessions, type SessionView } from './sessions';

const Context = createContext<
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
    <Context.Provider
      value={{
        ...view,
        login: (base, name, password) => manager.login(base, name, password),
        logout: () => manager.logout(),
        retryRestore: () => manager.reconnect(),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}
