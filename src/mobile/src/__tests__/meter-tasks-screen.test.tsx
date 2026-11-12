// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MeterTask, Named } from '../lib/api';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';

const state = vi.hoisted(() => ({
  role: 'Staff',
  userId: 'staff-1',
  request: vi.fn(),
  push: vi.fn(),
}));

const api = { request: state.request };

vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api,
    session: { userId: state.userId, roles: [state.role] },
  }),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  router: { push: state.push },
}));

vi.mock('react-native', () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: unknown) => styles },
}));

vi.mock('../theme/theme', () => ({ colors: {} }));

vi.mock('../components/WorkspaceKit', () => ({
  Pill: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ui: {},
}));

vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  ),
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));

vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  Icon: () => null,
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
    <span aria-label={accessibilityLabel}>Đang tải</span>
  ),
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  IconButton: ({
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} />,
  TouchableRipple: ({
    children,
    onPress,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { selected?: boolean };
  }) => (
    <button
      role={accessibilityRole || 'button'}
      aria-label={accessibilityLabel}
      aria-selected={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  Portal: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Dialog: Object.assign(
    ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? <div role="dialog">{children}</div> : null,
    {
      Title: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
      Content: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
      Actions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    },
  ),
}));

import { MeterTasksScreen } from '../screens/MeterTasksScreen';

const sampleLocation: Named = { id: 'loc-1', label: 'BHOME SAMPLE 1' };
const sampleRooms: Named[] = [
  { id: 'room-101', label: '101' },
  { id: 'room-102', label: '102' },
];

const baseElectric: MeterTask = {
  id: 'task-e-101',
  meterId: 'm-e-101',
  locationId: 'loc-1',
  roomId: 'room-101',
  location: 'BHOME SAMPLE 1',
  room: '101',
  meterCode: 'E101',
  utilityType: 0,
  display: 0,
  decimalPlaces: 2,
  purpose: 1,
  billingPeriod: '2026-11-01',
  readingDate: '2026-11-05',
  status: 0,
  previousValue: '100',
  dueAt: '2099-12-01T10:00:00Z',
  assignedStaffUserId: 'staff-1',
};

const baseWater: MeterTask = {
  ...baseElectric,
  id: 'task-w-101',
  meterId: 'm-w-101',
  meterCode: 'W101',
  utilityType: 1,
  previousValue: '20',
};

let locationsResponse: Named[];
let roomsResponse: Named[];
let tasksResponse: MeterTask[];
let readingsResponse: Record<string, ConfirmedReading>;

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Staff';
  state.userId = 'staff-1';
  locationsResponse = [sampleLocation];
  roomsResponse = [...sampleRooms];
  tasksResponse = [{ ...baseElectric }, { ...baseWater }];
  readingsResponse = {};

  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return locationsResponse;
    if (path.endsWith('/rooms')) return roomsResponse;
    if (path.includes('/readings/')) {
      const id = path.split('/').at(-1)!;
      return readingsResponse[id];
    }
    if (path.startsWith('/api/v1/capture/meter-tasks')) return tasksResponse;
    return [];
  });
});

afterEach(cleanup);

it('auto-identifies the single assigned Location as read-only and removes the location dropdown and oversized buttons', async () => {
  render(<MeterTasksScreen />);
  await screen.findByText('Cơ sở: BHOME SAMPLE 1');
  expect(screen.getByText('Ghi chỉ số điện nước')).toBeTruthy();
  expect(screen.getByText('Quản lý ghi chỉ số theo phòng')).toBeTruthy();
  expect(screen.queryByText('Tất cả cơ sở được phép')).toBeNull();
  expect(screen.queryByLabelText('Cơ sở')).toBeNull();
  expect(screen.queryByText('Lọc kỳ ghi & trạng thái')).toBeNull();
  expect(screen.queryByText('Tải lại dữ liệu')).toBeNull();
  expect(screen.queryByLabelText('Phòng')).toBeNull();
});

it('displays 0/2 đã ghi, 1/2 đã ghi, and Hoàn thành progress badges with confirmed readings and action buttons', async () => {
  readingsResponse = {
    'reading-e-102': {
      id: 'reading-e-102',
      taskId: 'task-e-102',
      confirmedValue: '150',
      previousValue: '100',
      consumption: '50',
      status: 1,
      confirmedAt: '2026-11-05T02:00:00Z',
    },
    'reading-w-102': {
      id: 'reading-w-102',
      taskId: 'task-w-102',
      confirmedValue: '28',
      previousValue: '20',
      consumption: '8',
      status: 1,
      confirmedAt: '2026-11-05T02:05:00Z',
    },
  };
  tasksResponse = [
    { ...baseElectric, status: 0 },
    { ...baseWater, status: 0 },
    {
      ...baseElectric,
      id: 'task-e-102',
      roomId: 'room-102',
      room: '102',
      status: 2,
      confirmedReadingId: 'reading-e-102',
    },
    {
      ...baseWater,
      id: 'task-w-102',
      roomId: 'room-102',
      room: '102',
      status: 2,
      confirmedReadingId: 'reading-w-102',
    },
  ];

  render(<MeterTasksScreen />);
  await screen.findByText('Phòng được phân công (2)');
  expect(screen.getByText('0/2 đã ghi')).toBeTruthy();
  expect(screen.getByText('Hoàn thành')).toBeTruthy();
  await screen.findByText('150 kWh');
  expect(screen.getByText('28 m³')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 50 kWh')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 8 m³')).toBeTruthy();
  expect(
    screen.getByText('Đã lưu chỉ số kỳ này để hệ thống tổng hợp hóa đơn theo lịch'),
  ).toBeTruthy();
  expect(screen.queryByText('BHOME SAMPLE 1')).toBeNull();
  expect(screen.queryByText('Quá hạn')).toBeNull();

  const recordBtn = screen.getByRole('button', { name: 'Ghi chỉ số' });
  const detailBtn = screen.getByRole('button', { name: 'Xem chi tiết' });
  expect(recordBtn).toBeTruthy();
  expect(detailBtn).toBeTruthy();

  fireEvent.click(recordBtn);
  expect(state.push).toHaveBeenCalledWith({
    pathname: '/meter',
    params: { taskId: 'task-e-101' },
  });
});

it('shows Quá hạn indicator only when a pending task is actually overdue', async () => {
  tasksResponse = [
    {
      ...baseElectric,
      status: 0,
      dueAt: '2020-01-01T00:00:00Z',
    },
  ];
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng 101');
  expect(screen.getByText('Quá hạn')).toBeTruthy();
});

it('filters out tasks from other locations or assigned to another Staff member', async () => {
  tasksResponse = [
    { ...baseElectric, room: '101', locationId: 'loc-1', assignedStaffUserId: 'staff-1' },
    {
      ...baseElectric,
      id: 'other-location-task',
      room: '201',
      locationId: 'loc-other',
      location: 'Cơ sở khác',
      assignedStaffUserId: 'staff-1',
    },
    {
      ...baseElectric,
      id: 'other-staff-task',
      room: '301',
      locationId: 'loc-1',
      assignedStaffUserId: 'staff-other',
    },
  ];
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng được phân công (1)');
  expect(screen.getByText('Phòng 101')).toBeTruthy();
  expect(screen.queryByText('Phòng 201')).toBeNull();
  expect(screen.queryByText('Phòng 301')).toBeNull();
});

it('shows error state and does not load meter tasks when assigned Location fails to load', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') throw new Error('Không thể kết nối máy chủ');
    return tasksResponse;
  });
  render(<MeterTasksScreen />);
  await screen.findByText('Không tải được cơ sở được phân công');
  expect(
    state.request.mock.calls.some(([url]) => String(url).includes('/meter-tasks')),
  ).toBe(false);
  expect(screen.queryByText('Phòng 101')).toBeNull();
});

it('supports filtering in the bottom sheet and removing active filter chips', async () => {
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng 101');
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
  fireEvent.change(screen.getByLabelText('Phòng'), { target: { value: 'room-101' } });
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

  await waitFor(() =>
    expect(
      state.request.mock.calls.some(([url]) => String(url).includes('roomId=room-101')),
    ).toBe(true),
  );
  const chip = await screen.findByRole('button', { name: 'Xóa lọc phòng 101' });
  fireEvent.click(chip);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Xóa lọc phòng 101' })).toBeNull(),
  );
});

it('formats 55555.0000 to 55.555 kWh and 65555.0000 to 65.555 m³, and cleans allCompleted subtitle', async () => {
  readingsResponse = {
    'reading-e-long': {
      id: 'reading-e-long',
      taskId: 'task-e-long',
      confirmedValue: '55555.0000',
      previousValue: '54320.5000',
      consumption: '1234.5000',
      status: 1,
      confirmedAt: '2026-11-05T02:00:00Z',
    },
    'reading-w-long': {
      id: 'reading-w-long',
      taskId: 'task-w-long',
      confirmedValue: '65555.0000',
      previousValue: '64320.4322',
      consumption: '1234.5678',
      status: 1,
      confirmedAt: '2026-11-05T02:05:00Z',
    },
  };
  tasksResponse = [
    {
      ...baseElectric,
      id: 'task-e-long',
      roomId: 'room-105',
      room: '105',
      status: 2,
      confirmedReadingId: 'reading-e-long',
    },
    {
      ...baseWater,
      id: 'task-w-long',
      roomId: 'room-105',
      room: '105',
      status: 2,
      confirmedReadingId: 'reading-w-long',
    },
  ];

  render(<MeterTasksScreen />);
  await screen.findByText('Phòng 105');
  expect(screen.getByText('Hoàn thành')).toBeTruthy();
  expect(screen.queryByText(/Tiến độ: 2\/2 đã ghi/)).toBeNull();

  await screen.findByText('55.555 kWh');
  expect(screen.getByText('65.555 m³')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 1.234,5 kWh')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 1.234,5678 m³')).toBeTruthy();
});

