import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import {
  displayContractDate,
  formatContractMoney,
  text,
  type ContractPage,
} from '../../../../packages/client-core/src/contracts';
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
import { ChoiceField, Input } from '../components/WorkflowControls';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type MeterTask, type Named } from '../lib/api';
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

export function MeterTasksScreen() {
  const { role } = useWorkspace();
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState(''),
    [due, setDue] = useState(''),
    [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations');
  const rooms = useWorkspaceQuery<Named[]>(
    location ? `/api/v1/capture/locations/${location}/rooms` : null,
  );
  const validDue = !due || /^\d{4}-\d{2}-\d{2}$/.test(due);
  const query = useWorkspaceQuery<MeterTask[]>(
    `/api/v1/capture/meter-tasks?page=${page}${location ? '&locationId=' + location : ''}${room ? '&roomId=' + room : ''}${filter ? '&status=' + filter : ''}${due && validDue ? '&dueDate=' + due : ''}`,
  );
  const items = query.data ?? [];
  return (
    <>
      <Heading
        title="Ghi chỉ số điện nước"
        detail="Kiểm tra ảnh, sửa đề xuất OCR và xác nhận chỉ số trước khi lưu"
      />
      <ChoiceField
        label="Cơ sở"
        value={location}
        options={[{ id: '', label: 'Tất cả cơ sở được phép' }, ...(locations.data ?? [])]}
        onChange={(v) => {
          setLocation(v);
          setRoom('');
          setPage(1);
        }}
      />
      {!!locations.error && <QueryState {...locations} />}
      <ChoiceField
        label="Phòng lọc tác vụ"
        value={room}
        disabled={!location}
        options={[{ id: '', label: 'Tất cả phòng' }, ...(rooms.data ?? [])]}
        onChange={(v) => {
          setRoom(v);
          setPage(1);
        }}
      />
      {!!rooms.error && <QueryState {...rooms} />}
      <Input
        label="Hạn ghi số (yyyy-MM-dd)"
        value={due}
        onChange={(v) => {
          setDue(v);
          setPage(1);
        }}
      />
      {!validDue && <Text style={ui.red}>Nhập ngày theo yyyy-MM-dd.</Text>}
      <ChoiceField
        label="Trạng thái tác vụ"
        value={filter}
        options={[
          { id: '', label: 'Tất cả' },
          { id: '0', label: 'Được giao' },
          { id: '1', label: 'Đang xử lý' },
          { id: '2', label: 'Đã xác nhận' },
          { id: '3', label: 'Đã hủy' },
        ]}
        onChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
      />
      <QueryState {...query} />
      {items.map((task) => (
        <Box key={task.id}>
          <Heading
            title={`Phòng ${task.room} · ${task.utilityType === 0 ? 'Điện' : 'Nước'}`}
            detail={task.location}
          />
          <Pill tone={task.status === 2 ? 'green' : 'blue'}>
            {task.status === 2 ? 'Đã xác nhận' : task.status === 3 ? 'Đã hủy' : 'Chờ ghi chỉ số'}
          </Pill>
          <Text>Đồng hồ: {task.meterCode}</Text>
          <Text>
            {task.purpose === 0
              ? 'Chỉ số ban đầu'
              : task.purpose === 2
                ? 'Chốt trả phòng'
                : `Kỳ: ${task.billingPeriod ? displayContractDate(task.billingPeriod) : 'Chưa xác định'}`}
          </Text>
          <Text>Ngày ghi: {displayContractDate(task.readingDate)}</Text>
          <Text>Hạn ghi số: {task.dueAt ? formatInstant(task.dueAt) : 'Chưa cấu hình'}</Text>
          {task.automationPlanId && <Pill>Tác vụ tự động</Pill>}
          <Text>Chỉ số trước: {task.previousValue ?? 'Chưa có'}</Text>
          {role === 'Staff' && task.status < 2 && (
            <Action
              icon="camera-outline"
              onPress={() => router.push({ pathname: '/meter', params: { taskId: task.id } })}
            >
              Chụp ảnh / Nhập & xác nhận
            </Action>
          )}
          {role === 'Staff' && task.status === 2 && (
            <Action
              onPress={() => router.push({ pathname: '/meter', params: { taskId: task.id } })}
            >
              Xem kết quả đã xác nhận
            </Action>
          )}
        </Box>
      ))}
      {query.data && !items.length && (
        <Box>
          <Text>Không có tác vụ ghi chỉ số phù hợp.</Text>
        </Box>
      )}
      <Row>
        <Action secondary disabled={page === 1 || query.loading} onPress={() => setPage(page - 1)}>
          Trang trước
        </Action>
        <Text>Trang {page}</Text>
        <Action
          secondary
          disabled={items.length < 100 || query.loading}
          onPress={() => setPage(page + 1)}
        >
          Trang sau
        </Action>
      </Row>
    </>
  );
}

export function OwnerOperationsScreen() {
  return (
    <>
      <Heading title="Vận hành cơ sở" />
      <Box>
        <Action icon="office-building-outline" onPress={() => router.push('/setup')}>
          Thiết lập cơ sở, phòng & phân công
        </Action>
      </Box>
      <OperationalTasksScreen />
      <MeterTasksScreen />
    </>
  );
}

export function TenantHomeScreen() {
  const { go } = useWorkspace();
  const query = useWorkspaceQuery<ContractPage>('/api/v1/contracts?page=1&pageSize=5');
  return (
    <>
      <Box style={ui.dark}>
        <Text variant="labelSmall" style={ui.white}>
          KHÔNG GIAN CƯ DÂN
        </Text>
        <Text variant="headlineSmall" style={ui.white}>
          Chào mừng bạn đến BHOME
        </Text>
        <Text style={ui.white}>Hợp đồng và hồ sơ thuê của bạn</Text>
      </Box>
      <QuickActions
        items={[
          { label: 'Hợp đồng', icon: 'file-document-outline', onPress: () => go('contract') },
          {
            label: 'Gia hạn / Trả phòng',
            icon: 'calendar-clock',
            onPress: () => go('contract-request'),
          },
          { label: 'Tài khoản', icon: 'account-outline', onPress: () => go('profile') },
        ]}
      />
      <Heading title="Hợp đồng của bạn" action="Xem tất cả" onPress={() => go('contract')} />
      <QueryState {...query} />
      {query.data?.items.map((contract) => (
        <Box key={contract.id}>
          <Heading title={`Phòng ${contract.roomNumber}`} detail={contract.locationName} />
          <Pill tone={contract.status === 'Active' ? 'green' : 'blue'}>
            {text(contract.status)}
          </Pill>
          <Text>
            {displayContractDate(contract.startDate)} – {displayContractDate(contract.endDate)}
          </Text>
          <Text style={ui.money}>{formatContractMoney(contract.monthlyRent)} / tháng</Text>
          <Action onPress={() => go('contract', { contractId: contract.id })}>
            Xem hợp đồng & trạng thái ký
          </Action>
        </Box>
      ))}
      {query.data?.items.length === 0 && (
        <Box>
          <Text>Chưa có hợp đồng gắn với tài khoản của bạn.</Text>
        </Box>
      )}
      <Heading title="Tiện ích cư dân" />
      <Box>
        <InfoRow
          icon="receipt-text-outline"
          title="Hóa đơn & Thanh toán"
          detail="Theo dõi tình trạng triển khai"
          onPress={() => go('invoice')}
        />
        <InfoRow
          icon="wrench-outline"
          title="Báo sự cố"
          detail="Theo dõi tình trạng triển khai"
          onPress={() => go('incidents')}
        />
        <InfoRow
          icon="shield-home-outline"
          title="Cư trú"
          detail="Đăng ký chính thức bên ngoài qua VNeID"
          onPress={() => go('residence')}
        />
      </Box>
    </>
  );
}

export function TaskNotificationsScreen() {
  const { api } = useSession();
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const query = useWorkspaceQuery<TaskPage<TaskNotification>>(
    `/api/v1/operational-tasks/notifications?page=${page}&pageSize=20`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
