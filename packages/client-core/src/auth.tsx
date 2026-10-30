import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Role } from './roles';
import { SessionClient, type AuthTransport } from './sessionClient';

export interface Session {
  userId: string;
  roles: Role[];
  accessToken: string;
  sessionId?: string;
  expiresAt?: string;
  sessionExpiresAt?: string;
}
interface AuthState {
  session: Session | null;
  acceptSession: (session: Session) => void;
  clearSession: () => void;
  client: SessionClient;
}
const AuthContext = createContext<AuthState | undefined>(undefined);
export function AuthProvider({
  children,
  apiBaseUrl = '',
  transport = 'mobile',
}: {
  children: ReactNode;
  apiBaseUrl?: string;
  transport?: AuthTransport;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [client] = useState(() => new SessionClient(apiBaseUrl, transport));
  useEffect(() => client.subscribe(setSession), [client]);
  useEffect(() => {
    if (transport === 'web' && apiBaseUrl) void client.refresh().catch(() => undefined);
  }, [client, transport, apiBaseUrl]);
  const value = useMemo(
    () => ({ session, acceptSession: client.accept, clearSession: client.clear, client }),
    [session, client],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
