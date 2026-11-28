// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OperationalTask, TaskPage } from '../services/operationalTasks';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  go: vi.fn(),
  resetScroll: vi.fn(),
  routeTab: '' as string,
  cache: new Map<string, unknown>(),
}));

vi.mock('react-native', () => ({
  View: ({
    children,
    accessibilityRole,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    accessibilityRole?: string;
    accessibilityLabel?: string;
  }) => (
    <div role={accessibilityRole} aria-label={accessibilityLabel}>
      {children}
    </div>
  ),
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ tab: state.routeTab }) }));

vi.mock('react-native-paper', () => {
  const Button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { selected?: boolean };
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={accessibilityLabel}
      role={accessibilityRole ?? 'button'}
      aria-selected={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  );
  return {
    Button,
    Menu: Object.assign(
      ({
        anchor,
        visible,
        children,
      }: {
        anchor: React.ReactNode;
        visible: boolean;
        children: React.ReactNode;
      }) => (
        <>
          {anchor}
          {visible && children}
        </>
      ),
      {
        Item: ({ title, onPress }: { title: string; onPress: () => void }) => (
          <Button onPress={onPress}>{title}</Button>
        ),
      },
    ),
    SegmentedButtons: ({
      buttons,
      onValueChange,
    }: {
      buttons: { value: string; label: string }[];
      onValueChange: (value: string) => void;
    }) => (
      <div>
        {buttons.map((button) => (
          <Button key={button.value} onPress={() => onValueChange(button.value)}>
            {button.label}
          </Button>
        ))}
      </div>
    ),
    TextInput: Object.assign(
      ({
        value,
        onChangeText,
        accessibilityLabel,
      }: {
        value: string;
        onChangeText: (value: string) => void;
        accessibilityLabel: string;
      }) => (
        <input
          aria-label={accessibilityLabel}
          value={value}
          onChange={(event) => onChangeText(event.target.value)}
        />
      ),
      { Icon: () => null },
    ),
    IconButton: ({
      icon,
      ...props
    }: {
      icon: string;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => <Button {...props}>{icon}</Button>,
    TouchableRipple: Button,
    Text: ({
      children,
      accessibilityRole,
    }: {
      children?: React.ReactNode;
      accessibilityRole?: string;
    }) => <span role={accessibilityRole}>{children}</span>,
    Icon: () => null,
    ActivityIndicator: () => <span>Đang tải</span>,
  };
});
vi.mock('../theme/theme', () => ({
  colors: {
    white: '#fff',
    ink: '#222',
    primary: '#123',
    muted: '#666',
    blue: '#26f',
    green: '#080',
    tint: '#eef',
    soft: '#eee',
    border: '#ccc',
    red: '#b00',
    amber: '#a70',
    redSoft: '#fee',
    amberSoft: '#ffc',
  },
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go, staffLocationId: loc1, resetScroll: state.resetScroll }),
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: () => false,
}));
vi.mock('../features/incidents/IncidentScreens', () => ({
  MaintenanceListScreen: ({
    embedded,
    queueState,
  }: {
    embedded?: boolean;
    queueState: {
      page: number;
      status: string;
      setPage: (n: number) => void;
      setStatus: (s: string) => void;
    };
  }) =>
    embedded ? (
      <div>
        Danh sách công việc sửa chữa &amp; bảo trì
        <span>Trang bảo trì: {queueState.page}</span>
        <span>Trạng thái bảo trì: {queueState.status}</span>
        <button onClick={() => queueState.setStatus('InProgress')}>Lọc bảo trì</button>
        <button onClick={() => queueState.setPage(2)}>Trang bảo trì sau</button>
      </div>
    ) : (
      <div>Danh sách bảo trì</div>
    ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (
    path: string | null,
    options?: {
      load?: (
        api: { request: typeof state.request },
        path: string,
        signal: AbortSignal,
      ) => Promise<unknown>;
    },
  ) => {
    const load = options?.load;
    const [result, setResult] = React.useState<{
      path: string;
      data: unknown;
      error: string;
    } | null>(null);
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => {
      if (!path) return;
      let active = true;
      if (state.cache.has(path)) return;
      void Promise.resolve()
        .then(() =>
          load
            ? load({ request: state.request }, path, new AbortController().signal)
            : state.request(path),
        )
        .then(
          (data) => {
            if (active) {
              state.cache.set(path, data);
              setResult({ path, data, error: '' });
            }
          },
          (error: unknown) => {
            if (active) setResult({ path, data: null, error: String(error) });
          },
        );
      return () => {
        active = false;
      };
    }, [path, revision, load]);
    const current =
      result?.path === path
        ? result
        : path && state.cache.has(path)
          ? { path, data: state.cache.get(path), error: '' }
          : null;
    return {
      data: current?.data ?? null,
      error: current?.error ?? '',
      fetching: !!path && !current,
      reload: () => setRevision((value) => value + 1),
    };
  },
}));

import { StaffTaskListScreen, TaskCard } from '../screens/StaffTaskListScreen';

const loc1 = '11111111-1111-4111-8111-111111111111';
const loc2 = '22222222-2222-4222-8222-222222222222';
const loc3 = '33333333-3333-4333-8333-333333333333';
function task(
  id: string,
  locationId: string,
  kind: OperationalTask['kind'] = 'AdHoc',
): OperationalTask {
  return {
    id,
    locationId,
    kind,
    title: `Công việc ${id}`,
    requirements: '',
    priority: 'Normal',
    dueAt: null,
    evidenceRequired: false,
    status: 'Assigned',
    isOverdue: false,
    currentResponsibleStaffUserId: 'staff',
    responsibilityAvailable: true,
    result: null,
    version: 1,
    verifiedAt: null,
  };
}
const page = (
  items: OperationalTask[],
  pageNumber = 1,
  totalCount = items.length,
): TaskPage<OperationalTask> => ({
  items,
  page: pageNumber,
  pageSize: 20,
  totalCount,
});

beforeEach(() => {
  state.request.mockReset();
  state.go.mockReset();
  state.resetScroll.mockReset();
  state.routeTab = '';
  state.cache.clear();
});
afterEach(() => cleanup());

it('loads the Location directory once for all visible task kinds and preserves page navigation', async () => {
  const initial = Array.from({ length: 20 }, (_, i) =>
    task(String(i + 1), i % 2 === 0 ? loc1 : loc2, i === 0 ? 'LocationAssetHandover' : 'AdHoc'),
  );
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/locations/assigned-to-me')
      return [
        { id: loc1, name: 'Cơ sở Phú Thọ' },
        { id: loc2, name: 'Cơ sở Hà Nội' },
      ];
    if (path.includes('page=2')) return page([task('next', loc1, 'MoveInInventory')], 2, 21);
    return page(initial, 1, 21);
  });
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getAllByText('Cơ sở: Cơ sở Phú Thọ')).toHaveLength(10));
  expect(state.request.mock.calls[0]?.[0]).toContain(`locationId=${loc1}`);
  expect(screen.queryByText('Cơ sở: Cơ sở Hà Nội')).toBeNull();
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await waitFor(() => expect(screen.getByText('Công việc next')).toBeTruthy());
  expect(screen.getByText('Cơ sở: Cơ sở Phú Thọ')).toBeTruthy();
  expect(screen.getByText('Trang 2 / 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Sửa chữa & bảo trì' }));
  await screen.findByText('Danh sách công việc sửa chữa & bảo trì');
  fireEvent.click(screen.getByRole('button', { name: 'Lọc bảo trì' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trang bảo trì sau' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Vận hành' }));
  await screen.findByText('Công việc next');
  expect(screen.getByText('Trang 2 / 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Sửa chữa & bảo trì' }));
  expect(await screen.findByText('Trang bảo trì: 2')).toBeTruthy();
  expect(screen.getByText('Trạng thái bảo trì: InProgress')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Vận hành' }));
  await screen.findByText('Công việc next');
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(1);
});

it('never displays a card from another location even if the API response contains it', async () => {
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/locations/assigned-to-me'
      ? [{ id: loc1, name: 'Cơ sở Phú Thọ' }]
      : page([task('one', loc1), task('two', loc3, 'MoveInInventory')]),
  );
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getByText('Cơ sở: Cơ sở Phú Thọ')).toBeTruthy());
  expect(screen.queryByText('Công việc two')).toBeNull();
  expect(screen.getAllByText(/^Cơ sở:/)).toHaveLength(1);
});

it('preserves task cards when the directory fails and supports retrying Location names only', async () => {
  let directoryAttempts = 0;
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/locations/assigned-to-me') {
      directoryAttempts++;
      if (directoryAttempts === 1) throw new Error('Lỗi tên cơ sở');
      return [{ id: loc1, name: 'Cơ sở Phú Thọ' }];
    }
    return page([task('one', loc1)]);
  });
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getByText('Cơ sở: Chưa tải được tên cơ sở')).toBeTruthy());
  expect(screen.getByText('Công việc one')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại tên cơ sở' }));
  await waitFor(() => expect(screen.getByText('Cơ sở: Cơ sở Phú Thọ')).toBeTruthy());
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(2);
  expect(
    state.request.mock.calls.filter(([path]) => path.startsWith('/api/v1/operational-tasks?')),
  ).toHaveLength(1);
});

it('does not request Location names for an empty task page and retains empty-state wording', async () => {
  state.request.mockResolvedValue(page([]));
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getByText('Chưa có công việc được giao')).toBeTruthy());
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(0);
});

it('always renders a Location row for a standalone ordinary task card', () => {
  render(<TaskCard task={task('one', loc1)} onPress={vi.fn()} />);
  expect(screen.getByText('Cơ sở: Chưa xác định tên cơ sở')).toBeTruthy();
});

it('switches between operational and maintenance queues without adding incident reports', async () => {
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/locations/assigned-to-me'
      ? [{ id: loc1, name: 'Cơ sở Phú Thọ' }]
      : page([task('one', loc1)]),
  );
  render(<StaffTaskListScreen />);
  await screen.findByText('Công việc one');
  expect(screen.queryByText('Danh sách công việc sửa chữa & bảo trì')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Sửa chữa & bảo trì' }));
  await screen.findByText('Danh sách công việc sửa chữa & bảo trì');
  expect(screen.queryByText('Công việc one')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Vận hành' }));
  await screen.findByText('Công việc one');
  expect(screen.queryByText('Danh sách công việc sửa chữa & bảo trì')).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Công việc' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Báo cáo sự cố' })).toBeNull();
  expect(screen.queryByText('Công việc thuộc cơ sở đang chọn trên trang chủ')).toBeNull();
  expect(screen.queryByText('Biên bản đã ký')).toBeNull();
  expect(screen.queryByText('Lịch làm việc')).toBeNull();
  expect(screen.queryByText('Công việc vận hành')).toBeNull();
  expect(screen.queryByText(/\d+ công việc/)).toBeNull();
  expect(screen.getByRole('tab', { name: 'Tất cả' })).toBeTruthy();
  expect(screen.queryByText('Danh sách báo cáo sự cố')).toBeNull();
});

it('opens the maintenance tab when returning from an embedded work order', async () => {
  state.routeTab = 'maintenance';
  render(<StaffTaskListScreen />);
  await screen.findByText('Danh sách công việc sửa chữa & bảo trì');
  expect(
    screen.getByRole('tab', { name: 'Sửa chữa & bảo trì' }).getAttribute('aria-selected'),
  ).toBe('true');
  expect(state.request).not.toHaveBeenCalled();
});

it('shows only actionable handovers, selects a room, and opens both task categories', async () => {
  const contractId = '44444444-4444-4444-8444-444444444444';
  const taskId = '55555555-5555-4555-8555-555555555555';
  const moveOut = {
    ...task(taskId, loc1),
    title: 'Kiểm tra trả phòng R.101',
    target: {
      roomId: '66666666-6666-4666-8666-666666666666',
      assetId: null,
      commonArea: null,
      label: 'R.101',
      contractId,
    },
  } satisfies OperationalTask;
  const room2 = '77777777-7777-4777-8777-777777777777';
  const second = {
    ...moveOut,
    id: 'second',
    title: 'Kiểm tra trả phòng R.102',
    status: 'InProgress' as const,
    target: { ...moveOut.target, roomId: room2, label: 'R.102' },
  };
  const hidden = (['PendingVerification', 'Completed', 'Cancelled'] as const).map((status) => ({
    ...moveOut,
    id: status,
    title: 'Kiểm tra trả phòng ' + status,
    status,
    target: { ...moveOut.target, roomId: 'historical-' + status, label: 'Historical ' + status },
  }));
  const moveIn = { ...moveOut, id: 'move-in', title: 'Bàn giao vào phòng R.101' };
  const later = {
    ...second,
    id: 'later',
    target: { ...second.target, roomId: '88888888-8888-4888-8888-888888888888', label: 'R.103' },
  };
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/locations/assigned-to-me') return [{ id: loc1, name: 'Cơ sở Phú Thọ' }];
    if (path.includes('category=MoveIn')) return page([moveIn]);
    if (path.includes('pageSize=100')) {
      if (path.includes('page=2')) return { ...page([later], 2, 101), pageSize: 100 };
      return { ...page([moveOut, second, ...hidden], 1, 101), pageSize: 100 };
    }
    if (path.includes('roomId=' + room2)) return page([second]);
    return page([moveOut, second, ...hidden]);
  });
  render(<StaffTaskListScreen handovers initialCategory="MoveOut" />);
  const item = await screen.findByRole('button', {
    name: 'Xem chi tiết: Kiểm tra trả phòng R.101',
  });
  expect(
    screen
      .getAllByRole('button', { name: /^Xem chi tiết:/ })
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Xem chi tiết: Kiểm tra trả phòng R.101', 'Xem chi tiết: Kiểm tra trả phòng R.102']);
  expect(screen.queryByText('Biên bản đã ký')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chọn cơ sở' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Tất cả' })).toBeNull();
  expect(screen.queryByText('Hoàn thành')).toBeNull();
  fireEvent.click(item);
  expect(state.go).toHaveBeenCalledWith('move-out', { contractId, taskId });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Lọc theo phòng' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lọc theo phòng' }));
  expect(screen.getByRole('button', { name: 'R.103' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Historical/ })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'R.102' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Xem chi tiết: Kiểm tra trả phòng R.101' }),
    ).toBeNull(),
  );
  expect(
    await screen.findByRole('button', { name: 'Xem chi tiết: Kiểm tra trả phòng R.102' }),
  ).toBeTruthy();
  expect(
    state.request.mock.calls.some(
      ([path]) =>
        path.includes('actionableOnly=true') &&
        path.includes('category=MoveOut') &&
        path.includes('roomId=' + room2),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Lọc theo phòng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả phòng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Xem chi tiết: Bàn giao vào phòng R.101' }),
  );
  expect(state.go).toHaveBeenLastCalledWith('move-in', {
    contractId,
    section: 'handover',
    origin: 'staff-handovers',
  });
  expect(
    state.request.mock.calls.some(
      ([path]) => path.includes('actionableOnly=true') && path.includes('category=MoveIn'),
    ),
  ).toBe(true);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Lọc theo phòng' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lọc theo phòng' }));
  expect(screen.getByRole('button', { name: 'R.101' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'R.102' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'R.103' })).toBeNull();
});

it('paginates handovers five at a time, preserves room scope, and resets on tab changes', async () => {
  const queue: OperationalTask[] = Array.from({ length: 11 }, (_, index) => ({
    ...task(String(index + 1), loc1),
    title: `Bàn giao vào phòng R.${index + 1}`,
    status: index < 7 ? 'InProgress' : 'Assigned',
    target: {
      roomId: index < 6 ? 'room-a' : 'room-b',
      assetId: null,
      commonArea: null,
      label: index < 6 ? 'R.A' : 'R.B',
      contractId: `contract-${index + 1}`,
    },
  }));
  state.request.mockImplementation(async (path: string) => {
    const params = new URLSearchParams(path.split('?')[1]);
    const size = Number(params.get('pageSize'));
    const number = Number(params.get('page'));
    const room = params.get('roomId');
    const filtered =
      params.get('category') === 'MoveOut'
        ? []
        : queue.filter((item) => !room || item.target?.roomId === room);
    return {
      items: filtered.slice((number - 1) * size, number * size),
      page: number,
      pageSize: size,
      totalCount: filtered.length,
    };
  });
  render(<StaffTaskListScreen handovers />);
  await screen.findByText('Trang 1/3');
  expect(screen.getByText('1–5 / 11')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Xem chi tiết:/ })).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Trang công việc trước' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await screen.findByText('Trang 2/3');
  expect(screen.getByText('6–10 / 11')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Xem chi tiết:/ })).toHaveLength(5);
  expect(state.resetScroll).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await screen.findByText('Trang 3/3');
  expect(screen.getByText('11–11 / 11')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Xem chi tiết:/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Trang công việc sau' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc trước' }));
  await screen.findByText('Trang 2/3');
  fireEvent.click(screen.getByRole('button', { name: 'Lọc theo phòng' }));
  fireEvent.click(screen.getByRole('button', { name: 'R.A' }));
  await screen.findByText('Trang 1/2');
  expect(screen.getByText('1–5 / 6')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await screen.findByText('Trang 2/2');
  expect(
    state.request.mock.calls.some(
      ([path]) =>
        path.includes('page=2&pageSize=5') &&
        path.includes('roomId=room-a') &&
        path.includes('actionableOnly=true'),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Trả phòng' }));
  await screen.findByText('Không có nhiệm vụ cần xử lý');
  expect(screen.queryByRole('button', { name: 'Trang công việc sau' })).toBeNull();
  expect(
    state.request.mock.calls.some(
      ([path]) =>
        path.includes('page=1&pageSize=5') &&
        path.includes('category=MoveOut') &&
        !path.includes('roomId='),
    ),
  ).toBe(true);
});

it('recovers a valid page if the active queue shrinks during navigation', async () => {
  const entry: OperationalTask = {
    ...task('one', loc1),
    title: 'Bàn giao vào phòng R.101',
    target: {
      roomId: 'room-a',
      assetId: null,
      commonArea: null,
      label: 'R.101',
      contractId: 'contract-a',
    },
  };
  state.request.mockImplementation(async (path: string) => {
    const params = new URLSearchParams(path.split('?')[1]);
    const size = Number(params.get('pageSize'));
    const number = Number(params.get('page'));
    if (size === 100) return { ...page([entry]), pageSize: size };
    if (number === 2) return { ...page([], 2, 5), pageSize: 5 };
    return { ...page([entry], 1, 6), pageSize: 5 };
  });
  render(<StaffTaskListScreen handovers />);
  await screen.findByText('Trang 1/2');
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await waitFor(() =>
    expect(state.request.mock.calls.some(([path]) => path.includes('page=2&pageSize=5'))).toBe(
      true,
    ),
  );
  await screen.findByText('Trang 1/2');
  expect(screen.queryByText('Không có nhiệm vụ cần xử lý')).toBeNull();
});
