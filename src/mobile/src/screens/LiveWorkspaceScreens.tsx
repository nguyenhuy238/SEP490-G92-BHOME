import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import {
  Action,
  Box,
  Heading,
  InfoRow,
  Metric,
  Pill,
  QuickActions,
  Row,
  ui,
} from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import {
  OwnerDivider,
  OwnerLinkRow,
  OwnerScreenIntro,
  OwnerSection,
  OwnerSurface,
} from '../components/OwnerMobileKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type Named } from '../lib/api';
import { OperationalTasksScreen } from './OperationalTaskScreens';
import {
  operationalTasks,
  taskActionLabels,
  type OperationalTask,
  type TaskNotification,
  type TaskPage,
} from '../services/operationalTasks';

export function StaffHomeScreen() {
  const { go } = useWorkspace();
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations');
  const pending = useWorkspaceQuery<TaskPage<OperationalTask>>(
    '/api/v1/operational-tasks?page=1&pageSize=1&status=Assigned',
  );
  const progress = useWorkspaceQuery<TaskPage<OperationalTask>>(
    '/api/v1/operational-tasks?page=1&pageSize=1&status=InProgress',
  );
  const verification = useWorkspaceQuery<TaskPage<OperationalTask>>(
    '/api/v1/operational-tasks?page=1&pageSize=1&status=PendingVerification',
  );
  return (
    <>
      <Box style={ui.dark}>
        <Text variant="labelSmall" style={ui.white}>
          NHÂN VIÊN VẬN HÀNH
        </Text>
        <Text variant="headlineSmall" style={ui.white}>
          Công việc của bạn
        </Text>
        <Text style={ui.white}>Theo phân công cơ sở hiện hành của bạn</Text>
        {locations.data?.map((location) => (
          <Pill key={location.id}>{location.label}</Pill>
        ))}
      </Box>
      <QueryState {...locations} />
      {locations.data?.length === 0 && (
        <Box>
          <Text>Chưa có cơ sở được phân công. Liên hệ Owner để được phân công.</Text>
        </Box>
      )}
      <View style={ui.wrap}>
        {[
          { query: pending, label: 'Cần làm' },
          { query: progress, label: 'Đang xử lý' },
          { query: verification, label: 'Chờ kiểm tra' },
        ].map(({ query, label }) => (
          <View key={label} style={ui.half}>
            {query.data && (
              <Metric
                label={label}
                value={String(query.data.totalCount)}
                icon="clipboard-check-outline"
                detail="Công việc được phép truy cập"
              />
            )}
            {(query.loading || !!query.error) && <QueryState {...query} />}
          </View>
        ))}
      </View>
      <QuickActions
        items={[
          { label: 'Công việc', icon: 'clipboard-check-outline', onPress: () => go('work-orders') },
          {
            label: 'Điện nước',
            icon: 'meter-electric-outline',
            onPress: () => go('meter-reading'),
          },
          { label: 'Tiếp nhận', icon: 'account-plus-outline', onPress: () => go('onboarding') },
        ]}
      />
      <Heading title="Hồ sơ & Tác nghiệp" />
      <Box>
        <InfoRow
          title="Phòng & Người ở"
          icon="door-open"
          detail="Danh sách trong cơ sở được phân công"
          onPress={() => go('rooms')}
        />
        <InfoRow
          title="Chuẩn bị hợp đồng"
          icon="file-document-outline"
          detail="Nháp hợp đồng và trạng thái ký"
          onPress={() => go('prepare-contract')}
        />
        <InfoRow
          title="Trả phòng & kiểm tra"
          icon="clipboard-text-outline"
          detail="Theo hồ sơ hợp đồng thực tế"
          onPress={() => go('move-out')}
        />
        <InfoRow
          title="Bàn giao nhận phòng"
          icon="key-outline"
          detail="Biên bản nhận phòng và xác nhận của Tenant"
          onPress={() => go('move-in')}
        />
        <InfoRow
          title="Thông báo công việc"
          icon="bell-outline"
          detail="Cập nhật và yêu cầu phối hợp"
          onPress={() => go('notifications')}
        />
      </Box>
    </>
  );
}

export { MeterTasksScreen } from './MeterTasksScreen';

export function OwnerOperationsScreen() {
  const { go } = useWorkspace();
  return (
    <>
      <OwnerScreenIntro
        title="Vận hành cơ sở"
        detail="Theo dõi sự cố, bảo trì, công việc và chỉ số theo từng nhóm"
      />
      <OwnerSection title="Sự cố & bảo trì">
        <OwnerSurface>
          <OwnerLinkRow
            icon="alert-circle-outline"
            title="Báo cáo sự cố"
            detail="Xem và phân loại các báo cáo đang mở"
            onPress={() => go('owner-incidents')}
          />
          <OwnerDivider />
          <OwnerLinkRow
            icon="tools"
            title="Bảo trì"
            detail="Phê duyệt phương án và nghiệm thu kết quả"
            onPress={() => go('owner-maintenance')}
          />
          <OwnerDivider />
          <OwnerLinkRow
            icon="alarm-light-outline"
            title="Sự cố khẩn cấp"
            detail="Theo dõi xác nhận và hành động ứng phó"
            onPress={() => go('owner-emergencies')}
          />
        </OwnerSurface>
      </OwnerSection>
      <OwnerSurface>
        <OwnerLinkRow
          icon="office-building-outline"
          title="Cơ sở, phòng & phân công"
          detail="Mở khu vực thiết lập vận hành"
          onPress={() => router.push('/setup')}
        />
      </OwnerSurface>
      <OwnerSection title="Công việc nhân viên" detail="Theo dõi tiến độ và nghiệm thu">
        <OperationalTasksScreen />
      </OwnerSection>
    </>
  );
}

export { TenantDashboardScreen as TenantHomeScreen } from './TenantDashboardScreen';

export function TaskNotificationsScreen() {
  const { api } = useSession();
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const query = useWorkspaceQuery<TaskPage<TaskNotification>>(
    `/api/v1/operational-tasks/notifications?page=${page}&pageSize=20`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const lock = useRef(false);
  async function read(item: TaskNotification, open: boolean) {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (!item.readAt) await operationalTasks(api).read(item.id);
      query.reload();
      if (open) go('task-detail', { taskId: item.taskId });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Thông báo công việc" detail="Cập nhật dành riêng cho tài khoản của bạn" />
      <QueryState {...query} />
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {query.data?.items.map((item) => (
        <Box key={item.id}>
          <Row spread>
            <Pill tone={item.readAt ? 'neutral' : 'blue'}>
              {item.readAt ? 'Đã đọc' : 'Chưa đọc'}
            </Pill>
            <Text style={ui.muted}>{formatInstant(item.createdAt)}</Text>
          </Row>
          <Heading title={taskActionLabels[item.event] ?? 'Cập nhật công việc'} />
          <Action disabled={busy} onPress={() => void read(item, true)}>
            Xem công việc
          </Action>
          {!item.readAt && (
            <Action secondary disabled={busy} onPress={() => void read(item, false)}>
              Đánh dấu đã đọc
            </Action>
          )}
        </Box>
      ))}
      {query.data?.items.length === 0 && (
        <Box>
          <Text>Chưa có thông báo công việc.</Text>
        </Box>
      )}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          loading={query.loading || busy}
          onChange={setPage}
        />
      )}
    </>
  );
}

const unavailableFeatures: Record<string, { title: string; detail: string }> = {
  'staff-assets': {
    title: 'Tài sản cơ sở',
    detail:
      'Danh sách và cập nhật tài sản chưa khả dụng. Bạn có thể đối chiếu tài sản trong biên bản bàn giao hoặc kiểm tra trả phòng của hợp đồng được giao.',
  },
  'staff-maintenance': {
    title: 'Xử lý sự cố & Bảo trì',
    detail:
      'Danh sách sửa chữa, đề xuất phương án và chi phí, thực hiện sau phê duyệt chưa khả dụng. Công việc vận hành được giao được theo dõi riêng tại mục Công việc.',
  },
  'staff-emergencies': {
    title: 'Sự cố khẩn cấp',
    detail:
      'Tiếp nhận cảnh báo và ghi nhận xử lý tức thời chưa khả dụng. Nếu có nguy hiểm đến người, liên hệ lực lượng khẩn cấp tại địa phương và báo ngay cho chủ cơ sở.',
  },
  'staff-invoices': {
    title: 'Hóa đơn theo cơ sở',
    detail:
      'Xem hóa đơn dành cho nhân viên chưa khả dụng. Liên hệ chủ cơ sở khi cần kiểm tra trạng thái hóa đơn phục vụ vận hành.',
  },
  invoice: {
    title: 'Hóa đơn & Thanh toán',
    detail:
      'Chức năng hóa đơn và thanh toán chưa sẵn sàng. Bạn có thể xem hợp đồng và thông tin tiền thuê trong mục Hợp đồng.',
  },
  'billing-history': {
    title: 'Lịch sử hóa đơn & Thanh toán',
    detail: 'Lịch sử hóa đơn và phân bổ thanh toán chưa sẵn sàng.',
  },
  incidents: { title: 'Báo sự cố', detail: 'Chức năng gửi và theo dõi sự cố chưa sẵn sàng.' },
  'report-incident': {
    title: 'Báo sự cố cơ sở',
    detail:
      'Chức năng ghi nhận sự cố chưa sẵn sàng. Với công việc đã được giao, hãy cập nhật vướng mắc ở mục Công việc.',
  },
  residence: {
    title: 'Theo dõi cư trú',
    detail:
      'Tenant thực hiện đăng ký chính thức bên ngoài BHOME qua VNeID; Owner cung cấp hoặc xác nhận thông tin chỗ ở. Tính năng theo dõi kết quả trong BHOME chưa sẵn sàng.',
  },
  adjustment: {
    title: 'Yêu cầu điều chỉnh hóa đơn',
    detail: 'Chức năng yêu cầu và phê duyệt điều chỉnh chưa sẵn sàng.',
  },
  checklist: {
    title: 'Bàn giao vào ở',
    detail: 'Biên bản bàn giao và xác nhận hai bên chưa sẵn sàng.',
  },
  'move-in': {
    title: 'Bàn giao phòng',
    detail: 'Chức năng kiểm kê và xác nhận bàn giao vào ở chưa sẵn sàng.',
  },
  shifts: {
    title: 'Lịch ca trực',
    detail:
      'Lịch ca trực chưa sẵn sàng. Công việc hiện tại được hiển thị theo phân công cơ sở có hiệu lực.',
  },
  'debt-follow-up': {
    title: 'Theo dõi công nợ',
    detail: 'Chức năng theo dõi công nợ được giao chưa sẵn sàng.',
  },
  notifications: { title: 'Thông báo', detail: 'Thông báo cư dân chưa sẵn sàng.' },
  preferences: {
    title: 'Tùy chọn thông báo',
    detail: 'Cài đặt kênh và lịch nhận thông báo chưa sẵn sàng.',
  },
};
export function UnavailableWorkspaceScreen({ screen }: { screen: string }) {
  const { role, go } = useWorkspace();
  const feature = unavailableFeatures[screen] ?? {
    title: 'Chức năng đang hoàn thiện',
    detail: 'Chức năng này chưa sẵn sàng để sử dụng.',
  };
  return (
    <>
      <Heading title={feature.title} />
      <Box>
        <Pill tone="amber">Chưa khả dụng</Pill>
        <Text>{feature.detail}</Text>
      </Box>
      <Action onPress={() => go('signing')}>
        Hợp đồng của {role === 'Tenant' ? 'bạn' : 'cơ sở'}
      </Action>
      {role === 'Staff' && (
        <Action secondary onPress={() => go('work-orders')}>
          Công việc được giao
        </Action>
      )}
    </>
  );
}
