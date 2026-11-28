import type { ReactNode } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../../../../../packages/client-core/src/api';

import { theme } from '../../theme/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Public reads can recover from transport/server outages; permanent refusals need no replay.
      retry: (attempt, error) =>
        attempt < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: true,
      gcTime: 0,
    },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>{children}</BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
