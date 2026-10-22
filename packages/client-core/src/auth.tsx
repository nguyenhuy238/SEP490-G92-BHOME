import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role } from './roles';

export interface Session {
  userId: string;
  roles: Role[];
  accessToken: string;
}
interface AuthState {
  session: Session | null;
  acceptSession: (session: Session) => void;
  clearSession: () => void;
}
const AuthContext = createContext<AuthState | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  // Memory only. Refresh/login and native secure token persistence are future identity work.
  const [session, setSession] = useState<Session | null>(null);
  const clearSession = useCallback(() => setSession(null), []);
  const value = useMemo(
    () => ({ session, acceptSession: setSession, clearSession }),
    [session, clearSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
