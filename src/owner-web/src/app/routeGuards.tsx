import { useEffect, useRef } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../../../packages/client-core/src/auth';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { DEMO_PASSWORD, DEMO_USER, useDemoSession } from '../services/demoAuth';
import { isMockMode } from '../services/config';
import { LoadingState } from '../components/common/PortalUI';
function useOwnerSession() {
  const demo = useDemoSession();
  const { session, isRestoring, restoreError, retryRestore } = useAuth();
  return {
    owner: isMockMode ? demo : !!session?.roles.includes('Owner'),
    restoring: !isMockMode && isRestoring,
    unavailable: !isMockMode && !session && !!restoreError,
    restoreError,
    retryRestore,
  };
}
export function ProtectedRoute() {
  const { owner, restoring, unavailable, restoreError, retryRestore } = useOwnerSession();
  const { session, client } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (!restoring && session && !session.roles.includes('Owner')) {
      void client.logout().catch(() => undefined);
    }
  }, [client, restoring, session]);
  if (restoring) return <LoadingState />;
  if (unavailable) return <RestorationFailure message={restoreError} retry={retryRestore} />;
  return owner ? (
    <Outlet />
  ) : (
    <Navigate
      to="/login"
      replace
      state={{ from: location.pathname + location.search + location.hash }}
    />
  );
}
export function LoginRoute() {
  const { owner, restoring, unavailable, restoreError, retryRestore } = useOwnerSession();
  const { session, client } = useAuth();
  const wasRestoring = useRef(restoring);
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  useEffect(() => {
    const restorationFinished = wasRestoring.current && !restoring;
    wasRestoring.current = restoring;
    if (restorationFinished && session && !session.roles.includes('Owner')) {
      void client.logout().catch(() => undefined);
    }
  }, [client, restoring, session]);
  if (restoring) return <LoadingState />;
  if (unavailable) return <RestorationFailure message={restoreError} retry={retryRestore} />;
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

function RestorationFailure({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return (
    <Box sx={{ p: 3 }}>
      <Alert severity="warning">{message}</Alert>
      <Button onClick={() => void retry()}>Thử khôi phục phiên</Button>
    </Box>
  );
}
