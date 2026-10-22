import { AuthProvider } from '@bhome/client-core/auth.tsx';
import { MobileRoutes } from '../routes/MobileRoutes';
export function App() {
  return (
    <AuthProvider>
      <MobileRoutes />
    </AuthProvider>
  );
}
