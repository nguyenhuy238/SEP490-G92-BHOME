import { Text } from 'react-native-paper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import React from 'react';
import { IncidentReportForm } from '../features/incidents/IncidentReportForm';
import { IncidentListScreen, MaintenanceListScreen } from '../features/incidents/IncidentScreens';

function StaffAccess({ children }: { children: React.ReactNode }) {
  const { role, preview } = useWorkspace();
  const { session } = useSession();
  return role === 'Staff' && (preview || session?.roles.includes('Staff')) ? (
    children
  ) : (
    <Text>Bạn không có quyền truy cập chức năng Staff.</Text>
  );
}
export function StaffIncidentReportScreen() {
  return (
    <StaffAccess>
      <IncidentReportForm />
    </StaffAccess>
  );
}
export function StaffMaintenanceScreen() {
  return (
    <StaffAccess>
      <MaintenanceListScreen />
    </StaffAccess>
  );
}
export function StaffEmergencyScreen() {
  return (
    <StaffAccess>
      <IncidentListScreen emergency />
    </StaffAccess>
  );
}
