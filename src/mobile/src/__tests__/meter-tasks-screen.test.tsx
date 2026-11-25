// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MeterTask, Named } from '../lib/api';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';

const state = vi.hoisted(() => ({
  role: 'Staff',
  userId: 'staff-1',
  selectedLocationId: '',
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

vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => {
    const locations = useWorkspaceQuery<Named[]>(
      state.role === 'Staff' ? '/api/v1/capture/locations' : null,
      { notifyError: false },
    );
    const authorized = locations.data ?? [];
    return {
      staffLocationId:
        authorized.find((item) => item.id === state.selectedLocationId)?.id ??
        authorized[0]?.id ??
        '',
      staffLocations: authorized,
      staffLocationsLoading: locations.loading,
      staffLocationsError: locations.error,
      selectStaffLocation: (id: string) => {
        if (authorized.some((item) => item.id === id)) state.selectedLocationId = id;
      },
      reloadStaffLocations: locations.reload,
    };
  },
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
const secondLocation: Named = { id: 'loc-2', label: 'BHOME SAMPLE 2' };

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
  automationPlanId: 'plan-1',
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
let floorsResponse: { id: string; floor: string }[];
let tasksResponse: MeterTask[];

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Staff';
  state.userId = 'staff-1';
  state.selectedLocationId = '';
  locationsResponse = [sampleLocation];
  floorsResponse = [];
  tasksResponse = [{ ...baseElectric }, { ...baseWater }];

  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return locationsResponse;
    if (path.startsWith('/api/v1/rooms?'))
      return { items: floorsResponse, totalCount: floorsResponse.length };
    if (path.startsWith('/api/v1/capture/meter-tasks')) return tasksResponse;
    return [];
  });
});

afterEach(cleanup);

it('uses the header location, latest period, compact room tiles and no reading requests', async () => {
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng 101');
  expect(screen.getByText('Ghi chỉ số điện nước')).toBeTruthy();
  expect(screen.queryByText('Quản lý ghi chỉ số theo phòng')).toBeNull();
  expect(screen.queryByLabelText('Cơ sở')).toBeNull();
  expect(screen.queryByText(/Phòng được phân công/)).toBeNull();
  expect(screen.queryByText('Điện')).toBeNull();
  expect(screen.queryByText('Nước')).toBeNull();
  expect(screen.queryByText('Chỉ số trước:')).toBeNull();
  expect((screen.getByLabelText('Kỳ ghi chỉ số') as HTMLSelectElement).value).toBe('2026-11-01');
  expect(screen.getByRole('option', { name: '11/2026' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: '01/11/2026' })).toBeNull();
  expect(state.request.mock.calls.some(([path]) => String(path).includes('/readings/'))).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Phòng 101, Chưa ghi' }));
  expect(state.push).toHaveBeenCalledWith({
    pathname: '/meter',
    params: { taskId: 'task-e-101' },
  });
});

it('shows overdue when a periodic utility is overdue, and clears the warning for completed rooms', async () => {
  tasksResponse = [
    { ...baseElectric, isOverdue: true, status: 1 },
    { ...baseWater, status: 2, confirmedReadingId: 'water-reading' },
    {
      ...baseElectric,
      id: 'completed',
      roomId: 'r2',
      room: '102',
      status: 2,
      confirmedReadingId: 'other',
      isOverdue: true,
    },
  ];
  render(<MeterTasksScreen />);
  expect(await screen.findByRole('button', { name: 'Phòng 101, Quá hạn' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Phòng 102, Đã ghi' })).toBeTruthy();
});

it('shows all assigned rooms in the notified period including completed and not-due rooms', async () => {
  tasksResponse = [
    { ...baseElectric, isOverdue: true, status: 1 },
    { ...baseWater, status: 2, confirmedReadingId: 'water-reading' },
    ...Array.from({ length: 11 }, (_, i) => ({
      ...baseElectric,
      id: 'overdue-' + i,
      roomId: 'overdue-' + i,
      room: String(200 + i),
      isOverdue: true,
    })),
    { ...baseElectric, id: 'not-due', roomId: 'not-due', room: '301', isOverdue: false },
    {
      ...baseElectric,
      id: 'completed',
      roomId: 'done',
      room: '302',
      status: 2,
      confirmedReadingId: 'reading',
      isOverdue: true,
    },
    {
      ...baseElectric,
      id: 'other-period',
      roomId: 'other',
      room: '303',
      billingPeriod: '2026-12-01',
      isOverdue: true,
    },
  ];
  render(
    <MeterTasksScreen
      initialLocationId={baseElectric.locationId!}
      initialBillingPeriod="2026-11-01"
    />,
  );
  await screen.findByRole('button', { name: 'Trang sau' });
  expect(screen.getAllByRole('button', { name: /^Phòng / })).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getAllByRole('button', { name: /^Phòng / })).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Phòng 301, Chưa ghi' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Phòng 302, Đã ghi' })).toBeTruthy();
  expect(screen.queryByText('Phòng 303')).toBeNull();
});

it('keeps completed rooms visible when opening a period from a notification', async () => {
  tasksResponse = [{ ...baseElectric, status: 2, confirmedReadingId: 'reading', isOverdue: true }];
  render(
    <MeterTasksScreen
      initialLocationId={baseElectric.locationId!}
      initialBillingPeriod="2026-11-01"
    />,
  );
  expect(await screen.findByRole('button', { name: 'Phòng 101, Đã ghi' })).toBeTruthy();
});

it('shows periodic jobs with or without an automation plan and excludes initial and final readings', async () => {
  tasksResponse = [
    { ...baseElectric },
    { ...baseWater, status: 2, confirmedReadingId: 'water-reading' },
    { ...baseElectric, id: 'initial-contract', purpose: 0, roomId: 'r2', room: '102' },
    { ...baseElectric, id: 'initial-standalone', purpose: 0, roomId: 'r3', room: '103' },
    { ...baseElectric, id: 'final', purpose: 2, roomId: 'r4', room: '104' },
    { ...baseElectric, id: 'legacy-periodic', automationPlanId: null, roomId: 'r5', room: '105' },
    { ...baseElectric, id: 'cancelled', status: 3, roomId: 'r6', room: '106' },
    { ...baseElectric, id: 'other-location', locationId: 'other', roomId: 'r7', room: '107' },
    { ...baseElectric, id: 'other-staff', assignedStaffUserId: 'other', roomId: 'r8', room: '108' },
    {
      ...baseElectric,
      id: 'finished',
      roomId: 'r9',
      room: '109',
      status: 2,
      confirmedReadingId: 'confirmed',
    },
  ];
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng 101');
  expect(
    screen
      .getAllByRole('button', { name: /^Phòng / })
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Phòng 101, Chưa ghi', 'Phòng 105, Chưa ghi', 'Phòng 109, Đã ghi']);
  expect(screen.queryByText('Chờ tổng hợp hóa đơn')).toBeNull();
});

it('defaults to the latest generated period even when it is on a later server page and switches exactly', async () => {
  const earlier = { ...baseElectric, billingPeriod: '2026-10-01', readingDate: '2026-10-03' };
  const latest = { ...baseElectric, id: 'new', room: '201', roomId: 'r201' };
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return locationsResponse;
    if (path.startsWith('/api/v1/rooms?')) return { items: [], totalCount: 0 };
    if (path.includes('page=2')) return [latest];
    if (path.includes('/meter-tasks')) return Array.from({ length: 100 }, () => earlier);
    return [];
  });
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng 201');
  const select = screen.getByLabelText('Kỳ ghi chỉ số') as HTMLSelectElement;
  expect(select.value).toBe('2026-11-01');
  expect(screen.queryByText('Phòng 101')).toBeNull();
  expect(Array.from(select.options, (option) => option.value)).toEqual([
    '2026-11-01',
    '2026-10-01',
  ]);
  fireEvent.change(select, { target: { value: '2026-10-01' } });
  expect(screen.getByText('Phòng 101')).toBeTruthy();
  expect(screen.queryByText('Phòng 201')).toBeNull();
});

it('opens the period from a notification instead of the newest period', async () => {
  tasksResponse = [
    { ...baseElectric, id: 'older', billingPeriod: '2026-10-01' },
    { ...baseElectric, id: 'newer', roomId: 'r201', room: '201' },
  ];
  render(
    <MeterTasksScreen
      initialLocationId={baseElectric.locationId!}
      initialBillingPeriod="2026-10-01"
    />,
  );
  await screen.findByText('Phòng 101');
  expect((screen.getByLabelText('Kỳ ghi chỉ số') as HTMLSelectElement).value).toBe('2026-10-01');
  expect(screen.queryByText('Phòng 201')).toBeNull();
});
it('sorts by actual floor first and natural room number within each floor', async () => {
  tasksResponse = [
    { ...baseElectric, id: 'a', roomId: 'a', room: '101' },
    { ...baseElectric, id: 'b', roomId: 'b', room: '10' },
    { ...baseElectric, id: 'c', roomId: 'c', room: '2' },
    { ...baseElectric, id: 'd', roomId: 'd', room: 'B1' },
  ];
  floorsResponse = [
    { id: 'a', floor: '10' },
    { id: 'b', floor: '2' },
    { id: 'c', floor: '2' },
    { id: 'd', floor: 'B1' },
  ];
  render(<MeterTasksScreen />);
  await screen.findByText('Phòng B1');
  expect(
    screen.getAllByRole('button', { name: /^Phòng / }).map((button) => button.textContent),
  ).toEqual(['Phòng B1Chưa ghi', 'Phòng 2Chưa ghi', 'Phòng 10Chưa ghi', 'Phòng 101Chưa ghi']);
});

it('switches scope from the workspace header without leaking the previous location or period', async () => {
  locationsResponse = [sampleLocation, secondLocation];
  tasksResponse = [
    { ...baseElectric },
    { ...baseElectric, id: 'oct', billingPeriod: '2026-10-01' },
    {
      ...baseElectric,
      id: 'other',
      locationId: secondLocation.id,
      location: secondLocation.label,
      room: '201',
      roomId: 'r201',
      billingPeriod: '2026-12-01',
    },
  ];
  const view = render(<MeterTasksScreen />);
  await screen.findByText('Phòng 101');
  fireEvent.change(screen.getByLabelText('Kỳ ghi chỉ số'), { target: { value: '2026-10-01' } });
  state.selectedLocationId = secondLocation.id;
  view.rerender(<MeterTasksScreen />);
  expect(screen.queryByText('Phòng 101')).toBeNull();
  await screen.findByText('Phòng 201');
  expect((screen.getByLabelText('Kỳ ghi chỉ số') as HTMLSelectElement).value).toBe('2026-12-01');
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/capture/meter-tasks?page=1&locationId=loc-2',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it('shows no assignment and does not request tasks for non-Staff', async () => {
  locationsResponse = [];
  const view = render(<MeterTasksScreen />);
  await screen.findByText('Chưa có cơ sở được phân công');
  expect(state.request.mock.calls.some(([path]) => String(path).includes('meter-tasks'))).toBe(
    false,
  );
  state.role = 'Tenant';
  view.rerender(<MeterTasksScreen />);
  expect(screen.getByText('Chỉ Staff được phép ghi chỉ số điện nước.')).toBeTruthy();
});

it('shows location loading failures without fetching tasks', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') throw new Error('Không thể kết nối máy chủ');
    return tasksResponse;
  });
  render(<MeterTasksScreen />);
  await screen.findByText('Không tải được cơ sở được phân công');
  expect(state.request.mock.calls.some(([path]) => String(path).includes('meter-tasks'))).toBe(
    false,
  );
});

it('has a usable empty state and reload action', async () => {
  tasksResponse = [];
  render(<MeterTasksScreen />);
  await screen.findByText('Chưa có tác vụ ghi chỉ số được giao');
  expect((screen.getByLabelText('Kỳ ghi chỉ số') as HTMLSelectElement).disabled).toBe(true);
  tasksResponse = [baseElectric];
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách ghi chỉ số' }));
  await screen.findByText('Phòng 101');
});

it('keeps an existing billing period visible when every periodic task lacks an automation plan ID', async () => {
  tasksResponse = [
    { ...baseElectric, automationPlanId: null, status: 2, confirmedReadingId: 'electric-reading' },
    { ...baseWater, automationPlanId: undefined, status: 2, confirmedReadingId: 'water-reading' },
    { ...baseElectric, id: 'final', purpose: 2, billingPeriod: null },
  ];
  render(<MeterTasksScreen />);
  await screen.findByRole('button', { name: 'Phòng 101, Đã ghi' });
  expect((screen.getByLabelText('Kỳ ghi chỉ số') as HTMLSelectElement).value).toBe('2026-11-01');
  expect(screen.getAllByRole('button', { name: /^Phòng / })).toHaveLength(1);
});

it('paginates sorted room groups, preserves complete utilities, and resets to page one when changing periods', async () => {
  tasksResponse = [
    ...Array.from({ length: 23 }, (_, index) => ({
      ...baseElectric,
      id: 'task-' + (23 - index),
      roomId: 'room-' + (23 - index),
      room: String(23 - index),
    })),
    { ...baseWater, id: 'water-10', roomId: 'room-10', room: '10' },
    { ...baseElectric, id: 'old-1', roomId: 'old-1', room: '301', billingPeriod: '2026-10-01' },
  ];
  render(<MeterTasksScreen />);
  await screen.findByText('Trang 1 / 3');
  const roomLabels = () =>
    screen.getAllByRole('button', { name: /^Phòng / }).map((button) => button.textContent);
  expect(roomLabels()).toEqual(
    Array.from({ length: 10 }, (_, i) => 'Phòng ' + (i + 1) + 'Chưa ghi'),
  );
  expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByText('Trang 2 / 3')).toBeTruthy();
  expect(roomLabels()).toEqual(
    Array.from({ length: 10 }, (_, i) => 'Phòng ' + (i + 11) + 'Chưa ghi'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByText('Trang 3 / 3')).toBeTruthy();
  expect(roomLabels()).toEqual(['Phòng 21Chưa ghi', 'Phòng 22Chưa ghi', 'Phòng 23Chưa ghi']);
  expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
  expect(screen.getByText('Trang 2 / 3')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kỳ ghi chỉ số'), { target: { value: '2026-10-01' } });
  expect(roomLabels()).toEqual(['Phòng 301Chưa ghi']);
  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Kỳ ghi chỉ số'), { target: { value: '2026-11-01' } });
  expect(screen.getByText('Trang 1 / 3')).toBeTruthy();
});

it('clamps the current page after reload when fewer rooms remain', async () => {
  tasksResponse = Array.from({ length: 22 }, (_, i) => ({
    ...baseElectric,
    id: 'task-' + i,
    roomId: 'room-' + i,
    room: String(i + 1),
  }));
  render(<MeterTasksScreen />);
  await screen.findByText('Trang 1 / 3');
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByText('Trang 3 / 3')).toBeTruthy();
  tasksResponse = tasksResponse.slice(0, 11);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách ghi chỉ số' }));
  await screen.findByText('Trang 2 / 2');
  expect(screen.getByRole('button', { name: 'Phòng 11, Chưa ghi' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Phòng / })).toHaveLength(1);
});
