import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { Action, ui } from '../components/WorkspaceKit';
import {
  DashboardCard as Box,
  DashboardSection,
  DashboardMetric as Metric,
  DashboardActions as QuickActions,
  DashboardSummary,
} from '../components/DashboardKit';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { loadOwnerOverview } from '../services/ownerOverview';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { ownerQueuePolicy, OwnerApprovalQueue } from '../features/owner/OwnerApprovalQueue';
import type { MobileApi } from '../lib/api';
const loadOverview = (api: MobileApi, _path: string, signal: AbortSignal) =>
  loadOwnerOverview(api, signal);

export function OwnerOverviewScreen() {
  const { api, session } = useSession();
  const { go } = useWorkspace();
  const state = useWorkspaceQuery(
    api && session?.roles.includes('Owner') ? '/owner-mobile/overview' : null,
    { cache: ownerQueuePolicy, load: loadOverview },
  );
  if (!api || !session?.roles.includes('Owner'))
    return <Text>Cần đăng nhập Owner để xem tổng quan.</Text>;
  return (
    <>
      <DashboardSummary
        title="Tổng quan BHOME"
        detail="Cơ sở, phòng và hợp đồng trong phạm vi tài khoản"
      />
      <DashboardSection title="THAO TÁC NHANH">
        <QuickActions
          items={[
            { label: 'Phê duyệt', icon: 'clipboard-check-outline', onPress: () => go('approvals') },
            { label: 'Vận hành', icon: 'tune-variant', onPress: () => go('operations') },
            {
              label: 'Tài chính',
              icon: 'chart-line',
              onPress: () => go('owner-finance'),
            },
          ]}
        />
      </DashboardSection>
      <Action secondary disabled={state.loading} onPress={state.reload}>
        Tải lại dữ liệu
      </Action>
      <DashboardSection title="TỔNG QUAN CƠ SỞ">
        {state.loading && <ActivityIndicator accessibilityLabel="Đang tải tổng quan" />}
        {!!state.error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {state.error}
          </Text>
        )}
        {state.data && (
          <View style={ui.wrap}>
            <Metric
              label="Cơ sở"
              value={String(state.data.locations)}
              icon="office-building-outline"
              detail="Tổng số cơ sở"
            />
            <Metric
              label="Phòng"
              value={String(state.data.rooms)}
              icon="door-open"
              detail="Tổng số phòng"
            />
            <Metric
              label="Phòng đang ở"
              value={String(state.data.occupiedRooms)}
              icon="home-account"
              detail="Phòng hiện đang có người thuê"
            />
            <Metric
              label="Hợp đồng"
              value={String(state.data.contracts)}
              icon="file-document-outline"
              detail="Tất cả trạng thái"
            />
            <Metric
              label="Phòng trống"
              value={String(state.data.availableRooms)}
              icon="home-search-outline"
              detail="Sẵn sàng theo trạng thái phòng"
            />
            <Metric
              label="Tỷ lệ lấp đầy"
              value={`${state.data.operationalOccupancyRate.toFixed(1)}%`}
              icon="chart-donut"
              detail="Phòng đang ở / tổng số phòng"
              progress={Math.min(1, Math.max(0, state.data.operationalOccupancyRate / 100))}
            />
          </View>
        )}
      </DashboardSection>
      <DashboardSection title="CẦN XỬ LÝ">
        <OwnerApprovalQueue compact />
      </DashboardSection>
      <Action icon="tools" onPress={() => go('owner-incidents')}>
        Sự cố và bảo trì
      </Action>
      <Action icon="file-document-outline" onPress={() => go('signing')}>
        Hợp đồng & Vòng đời
      </Action>
      <Box>
        <Action secondary onPress={() => go('owner-finance')}>
          Xem doanh thu, công nợ và chi phí
        </Action>
        <Action secondary onPress={() => go('owner-announcements')}>
          Thông báo đã gửi
        </Action>
      </Box>
      <Action secondary onPress={() => go('profile')}>
        Tài khoản & Đăng xuất
      </Action>
    </>
  );
}
