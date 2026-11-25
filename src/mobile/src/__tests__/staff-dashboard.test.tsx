// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
const state = vi.hoisted(() => ({
  preview: false,
  go: vi.fn(),
  push: vi.fn(),
  reload: vi.fn(),
  selectLocation: vi.fn(),
  selectedId: 'loc',
  locations: [{ id: 'loc', label: 'Cơ sở kiểm thử' }],
  tasks: null as null | { totalCount: number },
  priorities: [] as {
    id: string;
    title: string;
    locationId: string;
    status: string;
    kind?: string;
  }[],
  failed: false,
  overdueMeterRooms: null as number | null,
}));
vi.mock('expo-router', () => ({ router: { push: state.push } }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    preview: state.preview,
    go: state.go,
    staffLocationId: state.selectedId,
    staffLocations: state.locations,
    staffLocationsLoading: false,
    staffLocationsError: '',
    selectStaffLocation: state.selectLocation,
    reloadStaffLocations: state.reload,
  }),
}));
vi.mock('../features/workspace/useStaffDashboard', () => ({
  useStaffDashboard: () => ({
    locations: { data: [{ id: 'loc', label: 'Cơ sở kiểm thử' }], loading: false, error: '' },
    tasks: { data: state.tasks, error: state.failed ? 'Lỗi tải' : '' },
    priorities: { data: { items: state.priorities }, error: state.failed ? 'Lỗi tải' : '' },
    inspections: { data: [], error: '' },
    meters: { data: [], error: '' },
    overdueMeterRooms: state.overdueMeterRooms,
    reload: state.reload,
  }),
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => {
  const Content = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Button = ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  );
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Text: Content,
    Button,
    TouchableRipple: Button,
    Portal: Content,
    Dialog: Object.assign(
      ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: Content, Content, Actions: Content, ScrollArea: Content },
    ),
  };
});
vi.mock('../components/DashboardKit', () => ({
  dashboardStyles: {},
  DashboardHeading: ({ title }: { title: string }) => <h2>{title}</h2>,
  DashboardStatus: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/StaffFeatureCard', () => ({
  StaffFeatureCard: ({
    title,
    onPress,
    status,
  }: {
    title: string;
    onPress: () => void;
    status?: string;
  }) => (
    <button onClick={onPress}>
      {title}
      {status && <span>{status}</span>}
    </button>
  ),
}));
import { StaffDashboard } from '../screens/StaffDashboard';
import { staffFeatureGroups } from '../features/workspace/staffFeatures';
import { activeWorkspaceTab, canOpenScreen, tabs } from '../features/workspace/navigation';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.preview = false;
  state.tasks = null;
  state.priorities = [];
  state.failed = false;
  state.overdueMeterRooms = null;
  state.selectedId = 'loc';
  state.locations = [{ id: 'loc', label: 'Cơ sở kiểm thử' }];
});
it('shows the distinct overdue-room count on the meter workspace tile and opens the workspace', () => {
  state.overdueMeterRooms = 3;
  render(<StaffDashboard />);
  const tile = screen.getByRole('button', { name: /Ghi điện nước/ });
  expect(within(tile).getByText('3 phòng quá hạn')).toBeTruthy();
  fireEvent.click(tile);
  expect(state.go).toHaveBeenCalledWith('meter-reading');
});
it('lets Staff choose between two assigned Locations directly on Home', () => {
  state.locations = [
    { id: 'loc', label: 'Cơ sở kiểm thử' },
    { id: 'loc-2', label: 'Cơ sở thứ hai' },
  ];
  render(<StaffDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển cơ sở' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Cơ sở kiểm thử' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cơ sở thứ hai' }));
  expect(state.selectLocation).toHaveBeenCalledWith('loc-2');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not show a sample name, shift status or manufactured counts in authenticated mode', () => {
  render(<StaffDashboard />);
  expect(screen.queryByText('Xin chào, Long!')).toBeNull();
  expect(screen.queryByText('Đang trực')).toBeNull();
  expect(screen.queryByText('Chưa có dữ liệu ca làm')).toBeNull();
  expect(screen.getByText('Chưa có việc ưu tiên cần xử lý.')).toBeTruthy();
  expect(screen.getByText('Cơ sở kiểm thử')).toBeTruthy();
  expect(screen.getAllByText('—')).toHaveLength(2);
});
it('distinguishes a real zero from unavailable counts', () => {
  state.tasks = { totalCount: 0 };
  render(<StaffDashboard />);
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getAllByText('—')).toHaveLength(1);
});
it('opens the actual priority task and offers retry on partial failure', () => {
  state.failed = true;
  state.priorities = [
    { id: 'task-id', title: 'Kiểm tra bơm', locationId: 'loc', status: 'Assigned' },
  ];
  render(<StaffDashboard />);
  expect(screen.getByText('Cần xử lý')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bơm, Cơ sở kiểm thử' }));
  expect(state.go).toHaveBeenCalledWith('task-detail', { taskId: 'task-id' });
  fireEvent.click(screen.getByText('Chưa tải đủ tác vụ ưu tiên · Thử lại'));
  expect(state.reload).toHaveBeenCalledOnce();
});
it('shows at most two priority tasks and opens a task only after a tap', () => {
  state.priorities = ['Newest', 'Next', 'Older'].map((title) => ({
    id: title,
    title,
    locationId: 'loc',
    status: 'Assigned',
  }));
  render(<StaffDashboard />);
  expect(screen.getByText('Newest')).toBeTruthy();
  expect(screen.getByText('Next')).toBeTruthy();
  expect(screen.queryByText('Older')).toBeNull();
  expect(state.go).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Next,/ }));
  expect(state.go).toHaveBeenCalledExactlyOnceWith('task-detail', { taskId: 'Next' });
});
it('opens an assigned move-in inventory task from priorities', () => {
  state.priorities = [
    {
      id: 'inventory-task',
      title: 'Kiểm kê trước nhận phòng',
      locationId: 'loc',
      status: 'Assigned',
      kind: 'MoveInInventory',
    },
  ];
  render(<StaffDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm kê trước nhận phòng, Cơ sở kiểm thử' }));
  expect(state.go).toHaveBeenCalledWith('move-in-inventory', { taskId: 'inventory-task' });
});
it('shows four quick actions and keeps six work areas available', () => {
  render(<StaffDashboard />);
  expect(staffFeatureGroups).toHaveLength(6);
  expect(screen.queryByText('Sự cố khẩn cấp')).toBeNull();
  for (const group of staffFeatureGroups) {
    for (const item of group.items) {
      expect(canOpenScreen('Staff', item.screen)).toBe(true);
    }
  }
  expect(screen.getByText('Truy cập nhanh')).toBeTruthy();
  expect(screen.getByText('Công việc')).toBeTruthy();
  expect(screen.getByText('Ghi điện nước')).toBeTruthy();
  expect(screen.getByText('Bàn giao / Trả phòng')).toBeTruthy();
  fireEvent.click(screen.getByText('Xử lý sự cố'));
  expect(state.go).toHaveBeenLastCalledWith('staff-incidents');
  expect(screen.queryByText('Hóa đơn')).toBeNull();
  expect(screen.queryByText('Công nợ')).toBeNull();
  expect(screen.queryByText('Gửi thông báo')).toBeNull();
});
it('opens the dedicated two-tab handover list from the dashboard', () => {
  render(<StaffDashboard />);
  fireEvent.click(screen.getByText('Bàn giao / Trả phòng'));
  expect(state.go).toHaveBeenLastCalledWith('staff-handovers');
});
it('opens both contract creation flows and the contract list from the dashboard', () => {
  render(<StaffDashboard />);
  fireEvent.click(screen.getByText('Hợp đồng'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Tạo hợp đồng thuê'));
  expect(state.go).toHaveBeenLastCalledWith('onboarding');
  fireEvent.click(screen.getByText('Hợp đồng'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Tạo hợp đồng giữ chỗ'));
  expect(state.go).toHaveBeenLastCalledWith('prepare-contract', { kind: 'Holding' });
  fireEvent.click(screen.getByText('Hợp đồng'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Xem hợp đồng'));
  expect(state.go).toHaveBeenLastCalledWith('signing');
});
it('denies other roles the new Staff screens and preserves the correct active tab', () => {
  expect(tabs.Staff.map((tab) => tab.title)).toEqual([
    'Trang chủ',
    'Công việc',
    'Phòng',
    'Cá nhân',
  ]);
  expect(canOpenScreen('Staff', 'notifications')).toBe(true);
  for (const route of [
    'staff-assets',
    'staff-invoices',
    'staff-maintenance',
    'staff-emergencies',
    'staff-handovers',
  ] as const) {
    expect(canOpenScreen('Owner', route)).toBe(false);
    expect(canOpenScreen('Tenant', route)).toBe(false);
  }
  expect(activeWorkspaceTab('Staff', 'staff-maintenance')).toBe('work-orders');
  expect(activeWorkspaceTab('Staff', 'staff-emergencies')).toBe('work-orders');
  expect(activeWorkspaceTab('Staff', 'rooms')).toBe('rooms');
});
