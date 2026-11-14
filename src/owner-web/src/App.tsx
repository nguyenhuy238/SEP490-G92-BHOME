import { CssBaseline, ThemeProvider } from '@mui/material';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '../../../packages/client-core/src/auth';
import { apiBaseUrl, isMockMode } from './services/config';
import { theme } from './theme/theme';
import { PortalProvider } from './app/PortalProvider';
import { AppRouter } from './app/router';

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider apiBaseUrl={apiBaseUrl} transport="web" restoreOnMount={!isMockMode}>
        <PortalProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </PortalProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
