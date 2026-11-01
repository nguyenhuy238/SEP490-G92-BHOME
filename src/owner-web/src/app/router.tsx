import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LoginRoute, ProtectedRoute } from './routeGuards';
import { AppShell } from '../components/layout/AppShell';
import { LoadingState } from '../components/common/PortalUI';
const NotificationsPage = lazy(() => import('../features/notifications/pages/NotificationsPage'));
const LocationsPage = lazy(() => import('../features/locations/pages/LocationsPage'));
const RoomsPage = lazy(() => import('../features/rooms/pages/RoomsPage'));
const CreateRooms = lazy(() =>
  import('../features/property/Rooms').then((m) => ({ default: m.CreateRooms })),
);
const RoomDetail = lazy(() =>
  import('../features/property/Rooms').then((m) => ({ default: m.RoomDetail })),
);
const AssetAllocation = lazy(() =>
  import('../features/property/Assets').then((m) => ({ default: m.AssetAllocation })),
);
const RoomTypesPage = lazy(() => import('../features/room-types/pages/RoomTypesPage'));
const AssetsPage = lazy(() => import('../features/assets/pages/AssetsPage'));
const PricingPage = lazy(() => import('../features/pricing/pages/PricingPage'));
const StaffPage = lazy(() => import('../features/staff/pages/StaffPage'));
const SchedulesPage = lazy(() => import('../features/schedules/pages/SchedulesPage'));
const TasksPage = lazy(() => import('../features/tasks/pages/TasksPage'));
const TenantsPage = lazy(() => import('../features/tenants/pages/TenantsPage'));
const ContractsPage = lazy(() => import('../features/contracts/pages/ContractsPage'));
const HandoversPage = lazy(() => import('../features/handovers/pages/HandoversPage'));
const TemporaryResidencePage = lazy(
  () => import('../features/temporary-residence/pages/TemporaryResidencePage'),
);
const MetersPage = lazy(() => import('../features/meters/pages/MetersPage'));
const InvoicesPage = lazy(() => import('../features/invoices/pages/InvoicesPage'));
const PaymentsPage = lazy(() => import('../features/payments/pages/PaymentsPage'));
const DebtsPage = lazy(() => import('../features/debts/pages/DebtsPage'));
const IncidentsPage = lazy(() => import('../features/incidents/pages/IncidentsPage'));
const MaintenancePage = lazy(() => import('../features/maintenance/pages/MaintenancePage'));
const ExpensesPage = lazy(() => import('../features/expenses/pages/ExpensesPage'));
const DashboardPage = lazy(() => import('../features/dashboard/pages/DashboardPage'));
const ReportsPage = lazy(() => import('../features/reports/pages/ReportsPage'));
const WhatIfPage = lazy(() => import('../features/what-if/pages/WhatIfPage'));
const PublicContentPage = lazy(() => import('../features/public-content/pages/PublicContentPage'));
const LocationWorkspace = lazy(() =>
  import('../features/locations/pages/LocationWorkspace').then((module) => ({
    default: module.LocationWorkspace,
  })),
);
const LocationOverview = lazy(() =>
  import('../features/locations/pages/LocationWorkspace').then((module) => ({
    default: module.LocationOverview,
  })),
);
export function AppRouter() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/locations/:locationId" element={<LocationWorkspace />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<LocationOverview />} />
              <Route path="rooms/new" element={<CreateRooms />} />
              <Route path="rooms" element={<RoomsPage />} />
              <Route path="room-types" element={<RoomTypesPage />} />
              <Route path="assets" element={<AssetsPage />} />
              <Route path="pricing" element={<PricingPage />} />
              <Route path="investment" element={<ExpensesPage />} />
            </Route>
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/rooms/new" element={<CreateRooms />} />
            <Route path="/rooms/:id" element={<RoomDetail />} />
            <Route path="/asset-allocation" element={<AssetAllocation />} />
            <Route path="/room-types" element={<RoomTypesPage />} />
            <Route path="/assets" element={<AssetsPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/handovers" element={<HandoversPage />} />
            <Route path="/temporary-residence" element={<TemporaryResidencePage />} />
            <Route path="/meters" element={<MetersPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/debts" element={<DebtsPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/what-if" element={<WhatIfPage />} />
            <Route path="/public-content" element={<PublicContentPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
