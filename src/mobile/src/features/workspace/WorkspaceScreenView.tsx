import {
  IncidentListScreen,
  IncidentInbox,
  IncidentDetailScreen,
  MaintenanceListScreen,
  MaintenanceDetailScreen,
} from '../../features/incidents/IncidentScreens';
import React from 'react';
import { Redirect } from 'expo-router';
import { TenantInvoicesScreen } from '../../screens/TenantInvoicesScreen';
import { NotificationsScreen } from '../../screens/NotificationsScreen';
import { TenantPaymentHistoryScreen } from '../../screens/TenantPaymentHistoryScreen';
import { TenantFeaturesScreen } from '../../screens/TenantFeaturesScreen';
import { Text } from 'react-native-paper';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { RequestHistory } from '../../components/WorkflowControls';
import { WorkspaceShell } from '../../components/WorkspaceShell';
import { useWorkspace } from '../../features/workspace/WorkspaceProvider';
import {
  canOpenScreen,
  homeScreen,
  isWorkspaceScreen,
  ownerWebOnlyScreens,
} from '../../features/workspace/navigation';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import { OwnerHome, ApprovalCenter, Operations } from '../../screens/OwnerScreens';
import { OwnerOverviewScreen } from '../../screens/OwnerOverviewScreen';
import { OwnerResidenceScreen } from '../../screens/OwnerResidenceScreen';
import { StaffHome, WorkOrders, MeterReading } from '../../screens/StaffScreens';
import { StaffNotificationScreen } from '../../screens/StaffNotificationScreen';
import { StaffScheduleScreen } from '../../screens/StaffScheduleScreen';
import {
  StaffIncidentReportScreen,
  StaffMaintenanceScreen,
  StaffEmergencyScreen,
} from '../../screens/StaffIncidentScreens';
import {
  TenantHome,
  TenantInvoice,
  TenantContract,
  MoveInChecklist,
} from '../../screens/TenantScreens';
import { Profile, Notifications, SecuritySettings } from '../../screens/SharedScreens';

import { OnboardingScreen } from '../../screens/OnboardingScreen';
import { ContractScreen } from '../../features/contracts/ContractScreen';
import {
  OperationalTasksScreen,
  OperationalTaskDetail,
} from '../../screens/OperationalTaskScreens';
import {
  TenantHomeScreen,
  MeterTasksScreen,
  OwnerOperationsScreen,
  UnavailableWorkspaceScreen,
} from '../../screens/LiveWorkspaceScreens';
import { AccountSecurityScreen } from '../../screens/AccountSecurityScreen';
import { TenantRoomScreen } from '../../screens/TenantRoomScreen';
import { TenantMeterHistoryScreen } from '../../screens/TenantMeterHistoryScreen';
import {
  TenantIncidentScreen,
  TenantRequestsScreen,
  TenantResidenceScreen,
} from '../../screens/TenantServiceScreens';
import { ProfileEditScreen } from '../../screens/ProfileEditScreen';
import {
  OwnerAdjustmentListScreen,
  OwnerAdjustmentReviewScreen,
  OwnerAnnouncementScreen,
  OwnerApprovalCenterScreen,
  OwnerFinanceScreen,
  OwnerPaymentListScreen,
  OwnerPaymentReviewScreen,
} from '../../screens/OwnerDecisionScreens';
import { useSession } from '../../lib/SessionProvider';
import {
  ContractPreparation,
  Inspection,
  RoomOverview,
  DebtFollowUp,
  TaskDetail,
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
function StaffAssets() {
  return <UnavailableWorkspaceScreen screen="staff-assets" />;
}
function StaffInvoices() {
  return <UnavailableWorkspaceScreen screen="staff-invoices" />;
}
function EmergencyIncidents() {
  return <IncidentListScreen emergency />;
}
const screens = {
  'incident-detail': IncidentDetailScreen,
  'incident-inbox': IncidentInbox,
  'maintenance-detail': MaintenanceDetailScreen,
  'staff-incidents': IncidentListScreen,
  'owner-incidents': IncidentListScreen,
  'owner-maintenance': MaintenanceListScreen,
  'owner-emergencies': EmergencyIncidents,
  'tenant-room': TenantRoomScreen,
  'tenant-features': TenantFeaturesScreen,
  'tenant-requests': TenantRequestsScreen,
  'tenant-meters': TenantMeterHistoryScreen,
  'staff-assets': StaffAssets,
  'staff-maintenance': StaffMaintenanceScreen,
  'staff-emergencies': StaffEmergencyScreen,
  'staff-invoices': StaffInvoices,
  onboarding: OnboardingScreen,
  'prepare-contract': ContractPreparation,
  'move-out': Inspection,
  'report-incident': StaffIncidentReportScreen,
  'move-in': MoveIn,
  residence: ResidenceTracking,
  adjustment: InvoiceAdjustment,
  'contract-request': ContractRequest,
  signing: SigningStatus,
  'billing-history': BillingHistory,
  shifts: StaffScheduleScreen,
  rooms: RoomOverview,
  'debt-follow-up': DebtFollowUp,
  'task-detail': TaskDetail,
  'owner-home': OwnerHome,
  approvals: ApprovalCenter,
  'owner-adjustments': OwnerAdjustmentListScreen,
  'owner-adjustment-detail': OwnerAdjustmentReviewScreen,
  'owner-payments': OwnerPaymentListScreen,
  'owner-payment-detail': OwnerPaymentReviewScreen,
  'owner-announcements': OwnerAnnouncementScreen,
  'owner-finance': OwnerFinanceScreen,
  'owner-residence': OwnerResidenceScreen,
  operations: Operations,
  'staff-home': StaffHome,
  'work-orders': WorkOrders,
  'meter-reading': MeterReading,
  'tenant-home': TenantHome,
  invoice: TenantInvoice,
  contract: TenantContract,
  checklist: MoveInChecklist,
  incidents: TenantIncidentScreen,
  profile: Profile,
  'profile-edit': ProfileEditScreen,
  notifications: Notifications,
  'send-notification': StaffNotificationScreen,
  security: SecuritySettings,
  preferences: () => <UnavailableWorkspaceScreen screen="preferences" />,
};
export function WorkspaceScreenView({ screen }: { screen: string }) {
  const { role, preview, go } = useWorkspace();
  const { session } = useSession();
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
  if (role === 'Owner' && ownerWebOnlyScreens[screen])
    return (
      <WorkspaceShell screen={screen}>
        <OwnerWebNotice task={ownerWebOnlyScreens[screen]} />
      </WorkspaceShell>
    );
  if (
    role === 'Owner' &&
    ['owner-incidents', 'owner-maintenance', 'owner-emergencies'].includes(screen)
  )
    return (
      <WorkspaceShell screen={screen}>
        <OwnerOperationsScreen
          initialSection={
            screen === 'owner-maintenance'
              ? 'Bảo trì'
              : screen === 'owner-emergencies'
                ? 'Khẩn cấp'
                : 'Sự cố'
          }
        />
      </WorkspaceShell>
    );
  if (!preview) {
    let content: React.ReactNode;
    if (
      [
        'signing',
        'contract',
        'contract-request',
        'prepare-contract',
        'move-out',
        'move-in',
        'checklist',
      ].includes(screen)
    )
      content = <ContractScreen key={screen} prepare={screen === 'prepare-contract'} />;
    else
      switch (screen) {
        case 'invoice':
          content = <TenantInvoicesScreen />;
          break;
        case 'adjustment':
          content = <TenantInvoicesScreen intent="adjustment" />;
          break;
        case 'incidents':
          content = <TenantIncidentScreen />;
          break;
        case 'residence':
          content = <TenantResidenceScreen />;
          break;
        case 'tenant-room':
        case 'tenant-features':
        case 'tenant-requests':
        case 'tenant-meters':
          content = <Screen />;
          break;
        case 'billing-history':
          content = <TenantPaymentHistoryScreen />;
          break;
        case 'owner-home':
          content = <OwnerOverviewScreen />;
          break;
        case 'staff-home':
          content = <StaffHome />;
          break;
        case 'tenant-home':
          content = <TenantHomeScreen />;
          break;
        case 'work-orders':
          content = <OperationalTasksScreen />;
          break;
        case 'approvals':
          content = <OwnerApprovalCenterScreen />;
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
          content = <NotificationsScreen />;
          break;
        case 'security':
          content = <AccountSecurityScreen />;
          break;
        case 'profile':
          content = <Profile />;
          break;
        case 'profile-edit':
          content = <ProfileEditScreen />;
          break;
        case 'owner-adjustments':
        case 'owner-adjustment-detail':
        case 'owner-payments':
        case 'owner-payment-detail':
        case 'owner-announcements':
        case 'owner-finance':
        case 'owner-residence':
          content = <Screen />;
          break;
        case 'incident-detail':
        case 'incident-inbox':
        case 'maintenance-detail':
        case 'staff-incidents':
        case 'owner-incidents':
        case 'owner-maintenance':
        case 'owner-emergencies':
        case 'onboarding':
        case 'shifts':
        case 'report-incident':
        case 'staff-maintenance':
        case 'staff-emergencies':
        case 'rooms':
        case 'send-notification':
          content = <Screen />;
          break;
        default:
          content = <UnavailableWorkspaceScreen screen={screen} />;
      }
    return (
      <WorkspaceShell screen={screen}>
        <React.Fragment key={`${session?.userId}:${role}:${screen}`}>{content}</React.Fragment>
      </WorkspaceShell>
    );
  }
  return (
    <WorkspaceShell screen={screen}>
      <Screen />
      {preview &&
        !['report-incident', 'staff-maintenance', 'staff-emergencies'].includes(screen) && (
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
