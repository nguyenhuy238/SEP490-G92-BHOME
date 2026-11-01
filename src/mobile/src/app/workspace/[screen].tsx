import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { RequestHistory } from '../../components/WorkflowControls';
import { WorkspaceShell } from '../../components/WorkspaceShell';
import { useWorkspace } from '../../features/workspace/WorkspaceProvider';
import { canOpenScreen, homeScreen, isWorkspaceScreen } from '../../features/workspace/navigation';
import { OwnerHome, ApprovalCenter, Operations } from '../../screens/OwnerScreens';
import { OwnerOverviewScreen } from '../../screens/OwnerOverviewScreen';
import { StaffHome, WorkOrders, MeterReading } from '../../screens/StaffScreens';
import {
  TenantHome,
  TenantInvoice,
  TenantContract,
  MoveInChecklist,
  TenantIncidents,
} from '../../screens/TenantScreens';
import {
  Profile,
  Notifications,
  SecuritySettings,
  NotificationPreferences,
} from '../../screens/SharedScreens';

import { OnboardingScreen } from '../../screens/OnboardingScreen';
import { ContractScreen } from '../../features/contracts/ContractScreen';
import {
  OperationalTasksScreen,
  OperationalTaskDetail,
} from '../../screens/OperationalTaskScreens';
import {
  StaffHomeScreen,
  TenantHomeScreen,
  MeterTasksScreen,
  OwnerOperationsScreen,
  TaskNotificationsScreen,
  UnavailableWorkspaceScreen,
} from '../../screens/LiveWorkspaceScreens';
import { AccountSecurityScreen } from '../../screens/AccountSecurityScreen';
import {
  ContractPreparation,
  Inspection,
  StaffSchedule,
  RoomOverview,
  DebtFollowUp,
  TaskDetail,
  StaffIncidentReport,
} from '../../screens/StaffWorkflowScreens';
import {
  ResidenceTracking,
  InvoiceAdjustment,
  ContractRequest,
  BillingHistory,
  SigningStatus,
} from '../../screens/TenantWorkflowScreens';
function MoveIn() {
  return <Inspection moveIn />;
}
const screens = {
  onboarding: OnboardingScreen,
  'prepare-contract': ContractPreparation,
  'move-out': Inspection,
  'report-incident': StaffIncidentReport,
  'move-in': MoveIn,
  residence: ResidenceTracking,
  adjustment: InvoiceAdjustment,
  'contract-request': ContractRequest,
  signing: SigningStatus,
  'billing-history': BillingHistory,
  shifts: StaffSchedule,
  rooms: RoomOverview,
  'debt-follow-up': DebtFollowUp,
  'task-detail': TaskDetail,
  'owner-home': OwnerHome,
  approvals: ApprovalCenter,
  operations: Operations,
  'staff-home': StaffHome,
  'work-orders': WorkOrders,
  'meter-reading': MeterReading,
  'tenant-home': TenantHome,
  invoice: TenantInvoice,
  contract: TenantContract,
  checklist: MoveInChecklist,
  incidents: TenantIncidents,
  profile: Profile,
  notifications: Notifications,
  security: SecuritySettings,
  preferences: NotificationPreferences,
};
export default function WorkspaceRoute() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  const { role, preview, go } = useWorkspace();
  if (!role) return <Redirect href="/" />;
  if (!isWorkspaceScreen(screen) || !canOpenScreen(role, screen))
    return (
      <WorkspaceShell screen={homeScreen[role]}>
        <Box>
          <Heading
            title={
              !isWorkspaceScreen(screen)
                ? 'Không tìm thấy màn hình'
                : 'Bạn không có quyền truy cập màn hình này'
            }
          />
          <Text>Chỉ mở dữ liệu và chức năng trong phạm vi tài khoản của bạn.</Text>
          <Action onPress={() => go(homeScreen[role])}>Về màn hình chính</Action>
        </Box>
      </WorkspaceShell>
    );
  const Screen = screens[screen];
  if (!preview) {
    let content: React.ReactNode;
    if (
      ['signing', 'contract', 'contract-request', 'prepare-contract', 'move-out'].includes(screen)
    )
      content = <ContractScreen key={screen} prepare={screen === 'prepare-contract'} />;
    else
      switch (screen) {
        case 'owner-home':
          content = <OwnerOverviewScreen />;
          break;
        case 'staff-home':
          content = <StaffHomeScreen />;
          break;
        case 'tenant-home':
          content = <TenantHomeScreen />;
          break;
        case 'work-orders':
          content = <OperationalTasksScreen />;
          break;
        case 'approvals':
          content = <OperationalTasksScreen approvals />;
          break;
        case 'operations':
          content = <OwnerOperationsScreen />;
          break;
        case 'task-detail':
          content = <OperationalTaskDetail />;
          break;
        case 'meter-reading':
          content = <MeterTasksScreen />;
          break;
        case 'notifications':
          content =
            role === 'Tenant' ? (
              <UnavailableWorkspaceScreen screen={screen} />
            ) : (
              <TaskNotificationsScreen />
            );
          break;
        case 'security':
          content = <AccountSecurityScreen />;
          break;
        case 'profile':
        case 'onboarding':
        case 'rooms':
          content = <Screen />;
          break;
        default:
          content = <UnavailableWorkspaceScreen screen={screen} />;
      }
    return (
      <WorkspaceShell screen={screen}>
        <React.Fragment key={screen}>{content}</React.Fragment>
      </WorkspaceShell>
    );
  }
  return (
    <WorkspaceShell screen={screen}>
      <Screen />
      {preview && (
        <RequestHistory
          kind={
            screen === 'prepare-contract'
              ? 'contract'
              : screen === 'task-detail'
                ? 'task'
                : screen === 'debt-follow-up'
                  ? 'debt'
                  : screen === 'report-incident'
                    ? 'incident'
                    : screen
          }
        />
      )}
    </WorkspaceShell>
  );
}
