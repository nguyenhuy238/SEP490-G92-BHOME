import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../../../packages/client-core/src/auth';
import { Alert, Snackbar } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMockRepository } from '../services/repositories/mockPortalRepository';
import type { PortalRepository } from '../types/portal';

interface PortalContextValue {
  repository: PortalRepository;
  locationId: string;
  setLocationId: (id: string) => void;
  search: string;
  setSearch: (search: string) => void;
  notify: (message: string, error?: boolean) => void;
}
const PortalContext = createContext<PortalContextValue | null>(null);
export function PortalProvider({ children }: { children: ReactNode }) {
  return isMockMode ? (
    <PortalScope>{children}</PortalScope>
  ) : (
    <AuthenticatedPortalScope>{children}</AuthenticatedPortalScope>
  );
}
function AuthenticatedPortalScope({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const scope = JSON.stringify([
    session?.userId,
    session?.sessionId,
    [...(session?.roles ?? [])].sort(),
  ]);
  return <PortalScope key={scope}>{children}</PortalScope>;
}
function PortalScope({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } }),
  );
  useEffect(() => () => queryClient.clear(), [queryClient]);
  const [locationId, setLocationId] = useState('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState({ message: '', error: false });
  const [repository] = useState(() => {
    return createMockRepository();
  });
  const value = useMemo(
    () => ({
      repository,
      locationId,
      setLocationId,
      search,
      setSearch,
      notify: (message: string, error = false) => setToast({ message, error }),
    }),
    [repository, locationId, search],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PortalContext.Provider value={value}>
        {children}
        <Snackbar
          open={!!toast.message}
          autoHideDuration={5000}
          onClose={() => setToast({ ...toast, message: '' })}
        >
          <Alert
            severity={toast.error ? 'error' : 'success'}
            onClose={() => setToast({ ...toast, message: '' })}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      </PortalContext.Provider>
    </QueryClientProvider>
  );
}
// Kept beside the provider so all feature hooks use the same scoped repository instance.
// eslint-disable-next-line react-refresh/only-export-components
export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) throw new Error('PortalProvider is required.');
  return context;
}
