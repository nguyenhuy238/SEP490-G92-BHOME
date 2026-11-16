import { IncidentReportForm } from '../features/incidents/IncidentReportForm';
import { IncidentListScreen } from '../features/incidents/IncidentScreens';
import React from 'react';
import { Action, Box, Heading } from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
export { TenantResidenceScreen } from './TenantResidenceScreen';

export function TenantIncidentScreen() {
  return <IncidentReportForm />;
}
export function TenantRequestsScreen() {
  const { go } = useWorkspace();
  return (
    <>
      <Box>
        <Heading title="Hoàn tiền" detail="Gửi đề nghị và theo dõi phản hồi từ Owner" />
        <Action icon="cash-refund" onPress={() => go('refund-requests')}>
          Tạo / theo dõi yêu cầu hoàn tiền
        </Action>
      </Box>
      <IncidentListScreen />
    </>
  );
}
