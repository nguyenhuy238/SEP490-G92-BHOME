import { Route, Routes } from 'react-router-dom';
import { roles } from '@bhome/client-core/roles.ts';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { OwnerLayout } from '../layouts/OwnerLayout';
import { HomePage } from '../features/home/HomePage';
import { DashboardPage } from '../features/dashboard/DashboardPage';

export function OwnerRoutes() {
  return (
    <Routes>
      <Route element={<OwnerLayout />}>
        <Route index element={<HomePage />} />
        <Route element={<ProtectedRoute allowedRoles={[roles.owner]} />}>
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="*" element={<main>Không tìm thấy trang.</main>} />
      </Route>
    </Routes>
  );
}
