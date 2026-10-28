
import type { ReactNode } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { theme } from '../../theme/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppProviders({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
