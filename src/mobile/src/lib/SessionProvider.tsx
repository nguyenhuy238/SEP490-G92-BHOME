import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { resolveApiEndpoint } from './apiEndpoint';
import { clearAbandonedCaptures } from './captureFiles';
import { MobileSessions, type SessionView } from './sessions';

const KEY = 'bhome.mobile.session.v1';
const Context = createContext<
  (SessionView & { login: MobileSessions['login']; logout: MobileSessions['logout'] }) | null
>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [manager] = useState(
    () =>
      new MobileSessions(
        {
          read: () => SecureStore.getItemAsync(KEY),
          write: (value) =>
            SecureStore.setItemAsync(KEY, value, {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            }),
          remove: () => SecureStore.deleteItemAsync(KEY),
        },
        resolveApiEndpoint({
          development: __DEV__,
          hostUri: Constants.expoConfig?.hostUri,
          configuredUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
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
    return unsubscribe;
  }, [manager]);
  return (
    <Context.Provider
      value={{
        ...view,
        login: (base, name, password) => manager.login(base, name, password),
        logout: () => manager.logout(),
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
