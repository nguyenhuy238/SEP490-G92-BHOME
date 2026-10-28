import { AuthProvider } from '@bhome/client-core/auth.tsx';
import { MobileRoutes } from '../routes/MobileRoutes';
import { apiBaseUrl } from '../api/config';
export function App() {
  return (
    <AuthProvider apiBaseUrl={apiBaseUrl} transport="mobile">
      <MobileRoutes />
    </AuthProvider>
  );
}
