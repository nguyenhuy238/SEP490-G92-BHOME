// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ preview: false, go: vi.fn() }));
vi.mock('../../../src/mobile/src/features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => state,
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
      { Title: Content, Content, Actions: Content },
    ),
  };
});
import { StaffDashboard } from '../../../src/mobile/src/screens/StaffDashboard';
import { StaffNotificationScreen } from '../../../src/mobile/src/screens/StaffNotificationScreen';
beforeEach(() => {
  state.preview = false;
  state.go.mockClear();
});
afterEach(cleanup);

it.each([
  ['Tiếp nhận người thuê', 'onboarding'],
  ['Hợp đồng', 'signing'],
  ['Ghi điện nước', 'meter-reading'],
  ['Báo cáo sự cố', 'report-incident'],
  ['Công việc của tôi', 'work-orders'],
  ['Lịch làm việc', 'shifts'],
  ['Xử lý sự cố', 'work-orders'],
  ['Theo dõi công nợ', 'debt-follow-up'],
  ['Gửi thông báo', 'send-notification'],
])('opens %s from the authenticated dashboard', (label, destination) => {
  render(<StaffDashboard />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(state.go).toHaveBeenCalledWith(destination);
});
it.each([
  ['Bàn giao nhận phòng', 'move-in'],
  ['Kiểm tra trả phòng', 'move-out'],
])('lets Staff choose %s', (label, destination) => {
  render(<StaffDashboard />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao / Trả phòng' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(state.go).toHaveBeenCalledWith(destination);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not present sample identity, shift or counts to a signed-in account', () => {
  render(<StaffDashboard />);
  expect(screen.queryByText('Xin chào, Long!')).toBeNull();
  expect(screen.queryByText('Đang trực')).toBeNull();
  expect(screen.queryByText('4/6')).toBeNull();
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(screen.getByText('Chưa có dữ liệu tổng quan từ hệ thống.')).toBeTruthy();
});

it('shows all ten feature cards without room or asset management shortcuts', () => {
  render(<StaffDashboard />);
  for (const title of [
    'Tiếp nhận người thuê',
    'Hợp đồng',
    'Công việc của tôi',
    'Lịch làm việc',
    'Ghi điện nước',
    'Bàn giao / Trả phòng',
    'Báo cáo sự cố',
    'Xử lý sự cố',
    'Theo dõi công nợ',
    'Gửi thông báo',
  ])
    expect(screen.getByRole('button', { name: title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Danh sách phòng|Quản lý tài sản/ })).toBeNull();
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
