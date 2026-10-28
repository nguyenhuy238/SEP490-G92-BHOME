import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@bhome/client-core/auth.tsx';
import type { Role } from '@bhome/client-core/roles.ts';

// UX only: the API must separately enforce role, chain, location and tenancy scope.
export function ProtectedRoute({ allowedRoles }: { allowedRoles: readonly Role[] }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/" replace />;
  if (!session.roles.some((role) => allowedRoles.includes(role)))
    return <p role="alert">Bạn không có quyền truy cập.</p>;
  return <Outlet />;
}
