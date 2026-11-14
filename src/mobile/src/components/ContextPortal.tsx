import React, { useContext } from 'react';
import { Portal } from 'react-native-paper';
import { NavigationContext, NavigationRouteContext } from 'expo-router/react-navigation';
import { SessionContext } from '../lib/SessionProvider';

// react-native-paper mounts Portal content at PaperProvider's host, which sits above
// SessionProvider and the route tree. Re-provide the screen's session and navigation
// contexts so portal content can use useSession / useFocusEffect-based queries.
export function ContextPortal({ children }: { children: React.ReactNode }) {
  const session = useContext(SessionContext);
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  return (
    <Portal>
      <SessionContext.Provider value={session}>
        <NavigationContext.Provider value={navigation}>
          <NavigationRouteContext.Provider value={route}>
            {children}
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      </SessionContext.Provider>
    </Portal>
  );
}
