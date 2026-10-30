import React from 'react';
import { Redirect, useLocalSearchParams, router } from 'expo-router';
import { Text } from 'react-native-paper';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { RequestHistory } from '../../components/WorkflowControls';
import { WorkspaceShell } from '../../components/WorkspaceShell';
import { useWorkspace } from '../../features/workspace/WorkspaceProvider';
import { canOpenScreen, homeScreen, isWorkspaceScreen } from '../../features/workspace/navigation';
import { OwnerHome, ApprovalCenter, Operations } from '../../screens/OwnerScreens';
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
  // Never fill an authenticated account with synthetic finance/identity records.
  // Only the OCR APIs exist today; new data needs a confirmed backend adapter.
  if (!preview && !['profile', 'onboarding', 'rooms'].includes(screen))
    return (
      <WorkspaceShell screen={screen}>
        <Heading
          title={screen === homeScreen[role] ? 'Chào mừng đến BHOME' : 'Dữ liệu chưa được kết nối'}
        />
        <Box>
          <Text>
            Bạn đã đăng nhập với vai trò {role}. Màn hình này chưa có API nghiệp vụ được kết nối.
          </Text>
          <Text>Thông tin tài khoản thật sẽ hiển thị sau khi có hợp đồng API tương ứng.</Text>
          {role === 'Staff' && (
            <>
              <Action onPress={() => go('onboarding')}>Tiếp nhận cư dân & CCCD</Action>
              <Action secondary onPress={() => go('rooms')}>
                Phòng & Người ở
              </Action>
            </>
          )}
          {role !== 'Tenant' && (
            <Action icon="camera-outline" onPress={() => router.push('/capture')}>
              Mở tác nghiệp OCR
            </Action>
          )}
          <Action secondary onPress={() => go('profile')}>
            Tài khoản & Đăng xuất
          </Action>
        </Box>
      </WorkspaceShell>
    );
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
