// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TenantMeterReadingPage } from '../../../../packages/client-core/src/tenantReadings';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  reload: vi.fn(),
  go: vi.fn(),
  request: vi.fn(),
  role: 'Tenant',
}));
vi.mock('expo-router', () => ({ useFocusEffect: () => {} }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: [state.role] }, api: { request: state.request } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({ useWorkspaceQuery: state.query }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock('react-native', () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <div>{accessibilityLabel}</div>
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
  QueryState: ({ error }: { error?: string }) => (error ? <div role="alert">{error}</div> : null),
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
  state.query.mockReturnValue({ data, reload: state.reload, loading: false, error: '' });
});
afterEach(cleanup);
it('uses confirmed-reading source before any Draft invoice and loads private evidence only on demand', async () => {
  state.request.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  render(<TenantMeterHistoryScreen />);
  expect(state.query).toHaveBeenCalledWith('/api/v1/tenant/meter-readings?page=1&pageSize=20');
  expect(screen.getByText('Đã xác nhận: 125,5')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: 25,5 kWh')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh bằng chứng' }));
  expect(await screen.findByText('Ảnh đồng hồ đã xác nhận')).toBeTruthy();
  expect(state.request.mock.calls[0]![0]).toBe('/api/v1/tenant/meter-readings/' + id + '/evidence');
  fireEvent.click(screen.getByRole('button', { name: 'Xem hóa đơn và thanh toán' }));
  expect(state.go).toHaveBeenCalledWith('billing-history');
});
it('does not query Tenant records under another role and presents empty state', () => {
  state.role = 'Staff';
  state.query.mockReturnValue({ data: { ...data, items: [] }, reload: state.reload });
  render(<TenantMeterHistoryScreen />);
  expect(state.query).toHaveBeenCalledWith(null);
  expect(screen.getByText('Chưa có chỉ số đã xác nhận trong thời gian ở của bạn.')).toBeTruthy();
});
it('routes a reauthorized meter-reading notice to Tenant meter history', async () => {
  const api = { request: vi.fn().mockResolvedValue({ objectType: 'MeterReading', objectId: id }) };
  expect(
    await notificationDestination(api as never, 'Tenant', id, new AbortController().signal),
  ).toEqual({ screen: 'tenant-meters', params: { readingId: id } });
});
