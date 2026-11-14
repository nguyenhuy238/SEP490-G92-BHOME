import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from './api';
import type { Role } from './roles';
import { SessionClient, type AuthTransport } from './sessionClient';
import type { TokenSession } from './jwtSession';

export interface Session extends TokenSession {
  roles: Role[];
}
interface AuthState {
  session: Session | null;
  isRestoring: boolean;
  restoreError: string;
  retryRestore: () => Promise<void>;
  acceptSession: (session: Session) => void;
  clearSession: () => void;
  client: SessionClient;
}
const AuthContext = createContext<AuthState | undefined>(undefined);
export function AuthProvider({
  children,
  apiBaseUrl = '',
  transport = 'mobile',
  restoreOnMount = true,
}: {
  children: ReactNode;
  apiBaseUrl?: string;
  transport?: AuthTransport;
  restoreOnMount?: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [isRestoring, setIsRestoring] = useState(transport === 'web' && restoreOnMount);
  const [restoreError, setRestoreError] = useState('');
  const [client] = useState(() => new SessionClient(apiBaseUrl, transport));
  useEffect(() => client.subscribe(setSession), [client]);
  const restore = useCallback(
    () =>
      client.refresh().then(
        () => setIsRestoring(false),
        (e: unknown) => {
          if (!(e instanceof ApiError && e.status === 401))
            setRestoreError(
              'Chưa thể khôi phục phiên do kết nối hoặc máy chủ. Vui lòng thử lại; bạn có thể cần đăng nhập lại nếu phiên đã hết hạn.',
            );
          setIsRestoring(false);
        },
      ),
    [client],
  );
  const retryRestore = useCallback(() => {
    setIsRestoring(true);
    setRestoreError('');
    return restore();
  }, [restore]);
  useEffect(() => {
    if (transport === 'web' && restoreOnMount) void restore();
  }, [restore, transport, restoreOnMount]);
  const value = useMemo(
    () => ({
      session,
      isRestoring,
      restoreError,
      retryRestore,
      acceptSession: client.accept,
      clearSession: client.clear,
      client,
    }),
    [session, isRestoring, restoreError, retryRestore, client],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
