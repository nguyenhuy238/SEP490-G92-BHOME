// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
const state = vi.hoisted(() => ({
  preview: false,
  go: vi.fn(),
  push: vi.fn(),
  reload: vi.fn(),
  tasks: null as null | { totalCount: number },
  overdue: [] as { id: string; title: string; locationId: string; status: string }[],
  failed: false,
}));
vi.mock('expo-router', () => ({ router: { push: state.push } }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ preview: state.preview, go: state.go }),
}));
vi.mock('../features/workspace/useStaffDashboard', () => ({
  useStaffDashboard: () => ({
    locations: { data: [{ id: 'loc', label: 'Cơ sở kiểm thử' }], loading: false, error: '' },
    tasks: { data: state.tasks, error: state.failed ? 'Lỗi tải' : '' },
    overdue: { data: { items: state.overdue }, error: state.failed ? 'Lỗi tải' : '' },
    inspections: { data: [], error: '' },
    meters: { data: [], error: '' },
    reload: state.reload,
  }),
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
      { Title: Content, Content, Actions: Content },
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
import { activeWorkspaceTab, canOpenScreen } from '../features/workspace/navigation';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.preview = false;
  state.tasks = null;
  state.overdue = [];
  state.failed = false;
});
it('does not show a sample name, shift status or manufactured counts in authenticated mode', () => {
  render(<StaffDashboard />);
  expect(screen.queryByText('Xin chào, Long!')).toBeNull();
  expect(screen.queryByText('Đang trực')).toBeNull();
  expect(screen.getByText('Chưa có dữ liệu ca làm')).toBeTruthy();
  expect(screen.queryByText('Cần xử lý')).toBeNull();
  expect(screen.getByText('Cơ sở kiểm thử')).toBeTruthy();
  expect(screen.getAllByText('—')).toHaveLength(2);
});
it('distinguishes a real zero from unavailable counts', () => {
  state.tasks = { totalCount: 0 };
  render(<StaffDashboard />);
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getAllByText('—')).toHaveLength(1);
});
it('opens the actual overdue task and offers retry on partial failure', () => {
  state.failed = true;
  state.overdue = [{ id: 'task-id', title: 'Kiểm tra bơm', locationId: 'loc', status: 'Assigned' }];
  render(<StaffDashboard />);
  expect(screen.getByText('Cần xử lý')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bơm, Cơ sở kiểm thử' }));
  expect(state.go).toHaveBeenCalledWith('task-detail', { taskId: 'task-id' });
  fireEvent.click(screen.getByText('Chưa tải đủ tác vụ ưu tiên · Thử lại'));
  expect(state.reload).toHaveBeenCalledOnce();
});
it('exposes all 14 Staff functions and keeps maintenance separate from operational tasks', () => {
  render(<StaffDashboard />);
  expect(screen.queryByText('TIẾP NHẬN & HỢP ĐỒNG')).toBeNull();
  fireEvent.click(screen.getByText('Xem tất cả chức năng (14)'));
  expect(staffFeatureGroups.reduce((total, group) => total + group.items.length, 0)).toBe(14);
  for (const group of staffFeatureGroups) {
    expect(screen.getByText(group.title)).toBeTruthy();
    for (const item of group.items) {
      expect(canOpenScreen('Staff', item.screen)).toBe(true);
      expect(screen.getAllByText(item.title).length).toBeGreaterThan(0);
    }
  }
  fireEvent.click(screen.getByText('Xử lý sự cố'));
  expect(state.go).toHaveBeenLastCalledWith('staff-maintenance');
  fireEvent.click(screen.getByText('Hóa đơn'));
  expect(state.go).toHaveBeenLastCalledWith('staff-invoices');
  fireEvent.click(screen.getByText('Thu gọn chức năng'));
  expect(screen.queryByText('SỰ CỐ & BẢO TRÌ')).toBeNull();
});
it('offers both move-in and move-out from the handover action', () => {
  render(<StaffDashboard />);
  fireEvent.click(screen.getByText('Bàn giao / Trả phòng'));
  fireEvent.click(screen.getByText('Bàn giao nhận phòng'));
  expect(state.go).toHaveBeenLastCalledWith('move-in');
  fireEvent.click(screen.getByText('Bàn giao / Trả phòng'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Kiểm tra trả phòng'));
  expect(state.go).toHaveBeenLastCalledWith('move-out');
});
it('denies other roles the new Staff screens and preserves the correct active tab', () => {
  for (const route of [
    'staff-assets',
    'staff-invoices',
    'staff-maintenance',
    'staff-emergencies',
  ] as const) {
    expect(canOpenScreen('Owner', route)).toBe(false);
    expect(canOpenScreen('Tenant', route)).toBe(false);
  }
  expect(activeWorkspaceTab('Staff', 'staff-maintenance')).toBe('work-orders');
  expect(activeWorkspaceTab('Staff', 'staff-emergencies')).toBe('work-orders');
  expect(activeWorkspaceTab('Staff', 'send-notification')).toBe('notifications');
});
