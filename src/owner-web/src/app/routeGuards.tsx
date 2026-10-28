import { Alert, Box, Typography } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../../../packages/client-core/src/auth';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { DEMO_PASSWORD, DEMO_USER, useDemoSession } from '../services/demoAuth';
import { isMockMode } from '../services/config';
function useOwnerSession() {
  const demo = useDemoSession();
  const { session } = useAuth();
  return isMockMode ? demo : !!session?.roles.includes('Owner');
}
export function ProtectedRoute() {
  const owner = useOwnerSession(),
    location = useLocation();
  return owner ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
export function LoginRoute() {
  const owner = useOwnerSession(),
    location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return owner ? (
    <Navigate
      to={
        from?.startsWith('/') && !from.startsWith('//') && from !== '/login' ? from : '/dashboard'
      }
      replace
    />
  ) : (
    <>
      {isMockMode && (
        <Box sx={{ bgcolor: '#eaedff', py: 1, px: 2 }}>
          <Alert severity="info" sx={{ maxWidth: 620, mx: 'auto', fontSize: 12 }}>
            Chế độ demo — không cần backend.{' '}
            <Typography component="span" sx={{ fontSize: 12, fontWeight: 600 }}>
              Tài khoản: {DEMO_USER} • Mật khẩu: {DEMO_PASSWORD}
            </Typography>
          </Alert>
        </Box>
      )}
      <LoginPage />
    </>
  );
}
