// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TenantMeterReadingPage } from '../../../../packages/client-core/src/tenantReadings';
import { loadTenantReadings } from '../features/workspace/tenantFinancialLoads';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  reload: vi.fn(),
  go: vi.fn(),
  request: vi.fn(),
  role: 'Tenant',
  roomId: undefined as string | undefined,
}));
vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({ roomId: state.roomId }),
}));
vi.mock('../lib/SessionProvider', () => {
  // Match the real provider's stable API identity across local component rerenders.
  const api = { request: state.request };
  return {
    useSession: () => ({ session: { userId: 'tenant-meter-test', roles: [state.role] }, api }),
  };
});
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({ useWorkspaceQuery: state.query }));
vi.mock('../theme/theme', () => ({
  colors: {
    navy: '#001637',
    primary: '#172b4d',
    blue: '#1052cf',
    white: '#fff',
    soft: '#f1f3ff',
    tint: '#e8edff',
    border: '#e2e8f0',
    ink: '#111b2e',
    muted: '#64748b',
    red: '#ba1a1a',
  },
  staffColors: { blue: '#2563eb' },
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <p role={accessibilityRole === 'alert' ? 'alert' : undefined}>{children}</p>,
  Icon: () => null,
  ActivityIndicator: () => <span>Đang tải ảnh</span>,
  TouchableRipple: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: ({
    children,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    accessibilityLabel?: string;
  }) => <div aria-label={accessibilityLabel}>{children}</div>,
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <div role="img" aria-label={accessibilityLabel}>
      {accessibilityLabel}
    </div>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title, detail }: { title: string; detail: string }) => (
    <div>
      {title} {detail}
    </div>
  ),
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkspaceQueryState', () => ({
  QueryState: ({ error, loading }: { error?: string; loading?: boolean }) =>
    error ? <div role="alert">{error}</div> : loading ? <div>Đang tải dữ liệu</div> : null,
  Pagination: () => null,
}));
import { TenantMeterHistoryScreen } from '../screens/TenantMeterHistoryScreen';
import { notificationDestination } from '../services/notificationInbox';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const data: TenantMeterReadingPage = {
  page: 1,
  pageSize: 20,
  totalCount: 1,
  items: [
    {
      id,
      roomId: id,
      roomNumber: 'S101',
      locationName: 'Synthetic location',
      meterCode: 'E-S101',
      utilityType: 'Electricity',
      purpose: 'Periodic',
      readingDate: '2026-11-11',
      billingPeriod: '2026-11-01',
      previousValue: '100',
      confirmedValue: '125.5',
      consumption: '25.5',
      confirmedAt: '2026-11-11T01:00:00Z',
      status: 'Confirmed',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Tenant';
  state.roomId = undefined;
  state.query.mockReturnValue({ data, reload: state.reload, loading: false, error: '' });
});
afterEach(cleanup);
it('uses confirmed-reading source before any Draft invoice and loads private evidence only on demand', async () => {
  state.request.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  render(<TenantMeterHistoryScreen />);
  expect(state.query).toHaveBeenCalledWith('/api/v1/tenant/meter-readings?page=1&pageSize=20', {
    load: loadTenantReadings,
  });
  expect(screen.getByText('Đã xác nhận: 125,5')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 25,5 kWh')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh bằng chứng' }));
  expect(await screen.findByRole('img', { name: 'Ảnh bằng chứng' })).toBeTruthy();
  expect(state.request.mock.calls[0]![0]).toBe('/api/v1/tenant/meter-readings/' + id + '/evidence');
  expect(state.request.mock.calls[0]![2]).toBe('bytes');
  fireEvent.click(screen.getByRole('button', { name: 'Xem hóa đơn và thanh toán' }));
  expect(state.go).toHaveBeenCalledWith('billing-history');
});
it('does not query Tenant records under another role and presents empty state', () => {
  state.role = 'Staff';
  state.roomId = id;
  state.query.mockReturnValue({ data: { ...data, items: [] }, reload: state.reload });
  render(<TenantMeterHistoryScreen />);
  expect(state.query).toHaveBeenCalledWith(null, { load: loadTenantReadings });
  expect(screen.getByText('Chưa có chỉ số đã xác nhận trong thời gian ở của bạn.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xem ảnh bằng chứng' })).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
it('groups periods newest first and distinguishes zero consumption from an absent utility reading', () => {
  const rows: TenantMeterReadingPage['items'] = [
    {
      ...data.items[0]!,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      billingPeriod: '2026-10-01',
      readingDate: '2026-10-30',
      purpose: 'Initial',
      previousValue: null,
      confirmedValue: '100',
      consumption: null,
    },
    {
      ...data.items[0]!,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      utilityType: 'Water',
      meterCode: 'W-S101',
      billingPeriod: '2026-11-01',
      confirmedValue: '100',
      previousValue: '100',
      consumption: '0',
    },
    { ...data.items[0]!, billingPeriod: '2026-11-01', consumption: '25.5' },
  ];
  state.query.mockReturnValue({
    data: { ...data, items: rows, totalCount: rows.length },
    reload: state.reload,
    loading: false,
    error: '',
  });
  render(<TenantMeterHistoryScreen />);
  expect(screen.getAllByText(/^Tháng \d{2}\/\d{4}$/).map((x) => x.textContent)).toEqual([
    'Tháng 11/2026',
    'Tháng 10/2026',
  ]);
  expect(screen.getByText('Tiêu thụ: 0 m³')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 25,5 kWh')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: Chỉ số mốc')).toBeTruthy();
  expect(screen.getByText('Chỉ số trước: Chưa có')).toBeTruthy();
  expect(screen.getByText('Chưa có chỉ số')).toBeTruthy();
});
it('shows loading and error feedback without a misleading empty state', () => {
  state.query.mockReturnValueOnce({ data: null, reload: state.reload, loading: true, error: '' });
  const view = render(<TenantMeterHistoryScreen />);
  expect(screen.getByText('Đang tải dữ liệu')).toBeTruthy();
  expect(screen.queryByText('Chưa có chỉ số đã xác nhận trong thời gian ở của bạn.')).toBeNull();
  state.query.mockReturnValue({
    data: null,
    reload: state.reload,
    loading: false,
    error: 'Không tải được chỉ số',
  });
  view.rerender(<TenantMeterHistoryScreen />);
  expect(screen.getByRole('alert').textContent).toContain('Không tải được chỉ số');
  expect(screen.queryByText('Chưa có chỉ số đã xác nhận trong thời gian ở của bạn.')).toBeNull();
});
it('does not reveal a private photo when the Tenant evidence endpoint rejects authorization', async () => {
  state.request.mockRejectedValue({ status: 403, message: 'Không có quyền xem ảnh' });
  render(<TenantMeterHistoryScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh bằng chứng' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.queryByRole('img', { name: 'Ảnh bằng chứng' })).toBeNull();
  expect(state.request).toHaveBeenCalledTimes(1);
});
it.each([id, 'invalid-room', '00000000-0000-0000-0000-000000000000'])(
  'only forwards a valid room filter to the Tenant readings query (%s)',
  (roomId) => {
    state.roomId = roomId;
    render(<TenantMeterHistoryScreen />);
    expect(state.query).toHaveBeenCalledWith(
      '/api/v1/tenant/meter-readings?page=1&pageSize=20' + (roomId === id ? '&roomId=' + id : ''),
      { load: loadTenantReadings },
    );
  },
);
it('routes a reauthorized meter-reading notice to Tenant meter history', async () => {
  const api = { request: vi.fn().mockResolvedValue({ objectType: 'MeterReading', objectId: id }) };
  expect(
    await notificationDestination(api as never, 'Tenant', id, new AbortController().signal),
  ).toEqual({ screen: 'tenant-meters', params: { readingId: id } });
});
