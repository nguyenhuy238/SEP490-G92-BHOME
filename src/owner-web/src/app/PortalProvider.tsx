import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMockRepository } from '../services/repositories/mockPortalRepository';
import { isMockMode } from '../services/config';
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
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } }),
  );
  const [locationId, setLocationId] = useState('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState({ message: '', error: false });
  const [repository] = useState(() => {
    const mock = createMockRepository();
    if (isMockMode) return mock;
    // Business OpenAPI endpoints are not finalized; never silently return mock data in API mode.
    const unavailable = async (): Promise<never> => {
      throw new Error(
        'Chưa có hợp đồng API nghiệp vụ. Đặt VITE_API_MODE=mock để dùng dữ liệu demo.',
      );
    };
    return Object.fromEntries(
      Object.keys(mock).map((key) => [key, unavailable]),
    ) as unknown as PortalRepository;
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
