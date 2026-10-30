import { CssBaseline, ThemeProvider } from '@mui/material';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '../../../packages/client-core/src/auth';
import { getApiBaseUrl } from '../../../packages/client-core/src/config';
import { theme } from './theme/theme';
import { PortalProvider } from './app/PortalProvider';
import { AppRouter } from './app/router';
import { isMockMode } from './services/config';

const apiBaseUrl = isMockMode
  ? ''
  : getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider apiBaseUrl={apiBaseUrl} transport="web">
        <PortalProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </PortalProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
