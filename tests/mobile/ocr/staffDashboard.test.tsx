// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
const state = vi.hoisted(() => ({
  preview: false,
  go: vi.fn(),
  inspections: [] as Array<{
    contractId: string;
    roomNumber: string;
    locationName: string;
    proposedDate: string;
    status: string;
    scheduledAt: string | null;
  }>,
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('../../../src/mobile/src/features/workspace/useStaffDashboard', () => ({
  useStaffDashboard: () => ({
    locations: { data: null },
    tasks: { data: null },
    overdue: { data: null },
    inspections: { data: state.inspections.length ? state.inspections : null },
    meters: { data: null },
    reload: vi.fn(),
  }),
}));
vi.mock('../../../src/mobile/src/features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => state,
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1, scale: 3 }),
}));
vi.mock('../../../src/mobile/src/theme/theme', () => ({ colors: {}, staffColors: {} }));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h1>{title}</h1>,
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
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
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  );
  return {
    Text: Content,
    Chip: Content,
    useTheme: () => ({
      colors: { surface: '#fff', onSurfaceVariant: '#64748b' },
      fonts: { titleMedium: { lineHeight: 20 }, bodySmall: { lineHeight: 18 } },
    }),
    Icon: () => null,
    Portal: Content,
    Button,
    TouchableRipple: Button,
    Dialog: Object.assign(
      ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: Content, Content, Actions: Content, ScrollArea: Content },
    ),
  };
});
import { StaffDashboard } from '../../../src/mobile/src/screens/StaffDashboard';
import { StaffNotificationScreen } from '../../../src/mobile/src/screens/StaffNotificationScreen';
beforeEach(() => {
  state.preview = false;
  state.go.mockClear();
  state.inspections = [];
});
afterEach(cleanup);

it.each([
  ['Ghi điện nước', 'meter-reading'],
  ['Công việc', 'work-orders'],
  ['Xử lý sự cố', 'staff-incidents'],
])('opens %s from the authenticated dashboard', (label, destination) => {
  render(<StaffDashboard />);
  fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)!);
  expect(state.go).toHaveBeenCalledWith(destination);
});
it.each([
  ['Bàn giao nhận phòng', 'move-in'],
  ['Kiểm tra trả phòng', 'move-out'],
])('lets Staff choose %s', (label, destination) => {
  render(<StaffDashboard />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao / Trả phòng' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
  expect(state.go).toHaveBeenCalledWith(destination);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not present sample identity, shift or counts to a signed-in account', () => {
  render(<StaffDashboard />);
  expect(screen.queryByText('Xin chào, Long!')).toBeNull();
  expect(screen.queryByText('Đang trực')).toBeNull();
  expect(screen.queryByText('4/6')).toBeNull();
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(screen.queryByText('Chưa có dữ liệu ca làm')).toBeNull();
});

it('shows location move-out work on the dashboard even without a schedule, while identifying future inspection dates', () => {
  state.inspections = [
    {
      contractId: 'contract-101',
      roomNumber: 'R.101',
      locationName: 'Cơ sở A',
      proposedDate: '2099-11-18',
      status: 'Approved',
      scheduledAt: null,
    },
  ];
  render(<StaffDashboard />);
  expect(screen.getByText('Chờ ngày trả ›')).toBeTruthy();
  expect(screen.getByText(/Phòng R\.101 · Cơ sở A · Ngày trả 18\/11\/2099/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Kiểm tra trả phòng, Phòng R\.101/ }));
  expect(state.go).toHaveBeenCalledWith('work-orders');
});

it('shows four quick actions and hides management shortcuts', () => {
  render(<StaffDashboard />);
  for (const title of ['Công việc', 'Ghi điện nước', 'Bàn giao / Trả phòng', 'Xử lý sự cố'])
    expect(screen.getAllByRole('button', { name: title }).length).toBeGreaterThan(0);
  for (const title of ['Hóa đơn', 'Công nợ', 'Gửi thông báo'])
    expect(screen.queryByRole('button', { name: title })).toBeNull();
});
it('allows closing handover selection without navigating', () => {
  render(<StaffDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao / Trả phòng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.go).not.toHaveBeenCalled();
});

it('states that sending is unavailable and only offers the existing inbox', () => {
  render(<StaffNotificationScreen />);
  expect(screen.getByText('Chức năng chưa triển khai')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi thông báo' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem thông báo của tôi' }));
  expect(state.go).toHaveBeenCalledWith('notifications');
});
