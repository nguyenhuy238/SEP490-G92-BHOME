import { Route, Routes } from 'react-router-dom';
import { roles } from '@bhome/client-core/roles.ts';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { MobileLayout } from '../layouts/MobileLayout';
import { OwnerHome } from '../features/owner/OwnerHome';
import { StaffHome } from '../features/staff/StaffHome';
import { TenantHome } from '../features/tenant/TenantHome';

export function MobileRoutes() {
  return (
    <Routes>
      <Route element={<MobileLayout />}>
        <Route
          index
          element={
            <main>
              <h1>BHOME trên thiết bị di động</h1>
              <p>Dành cho chủ nhà, nhân viên và người thuê.</p>
              <p>Chức năng đăng nhập sẽ được bổ sung trong giai đoạn tiếp theo.</p>
            </main>
          }
        />
        <Route element={<ProtectedRoute allowedRoles={[roles.owner]} />}>
          <Route path="owner" element={<OwnerHome />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={[roles.staff]} />}>
          <Route path="staff" element={<StaffHome />} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={[roles.tenant]} />}>
          <Route path="tenant" element={<TenantHome />} />
        </Route>
        <Route path="*" element={<main>Không tìm thấy trang.</main>} />
      </Route>
    </Routes>
  );
}
