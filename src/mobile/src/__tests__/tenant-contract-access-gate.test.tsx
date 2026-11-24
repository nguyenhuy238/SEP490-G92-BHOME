// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MobileApi } from '../lib/api';
import {
  hasActiveRoomRental,
  TenantContractAccessGate,
} from '../features/tenant/TenantContractAccessGate';
import { useTenantCurrentRental } from '../features/tenant/TenantCurrentRentalContext';

const state = vi.hoisted(() => ({
  role: 'Tenant',
  preview: false,
  actor: 'tenant-a',
  api: null as MobileApi | null,
  logout: vi.fn(),
  onAppState: null as null | ((next: string) => void),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    session: { userId: state.actor, roles: [state.role] },
    api: state.api,
    logout: state.logout,
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role, preview: state.preview }),
}));
vi.mock('../theme/theme', () => ({
  colors: { ink: '#111b2e', muted: '#64748b', primary: '#172b4d', tint: '#e8edff' },
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: <T,>(styles: T) => styles },
  AppState: {
    addEventListener: (_type: string, callback: (next: string) => void) => {
      state.onAppState = callback;
      return { remove: () => (state.onAppState = null) };
    },
  },
}));
vi.mock('../components/Controls', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  styles: { row: {}, card: {} },
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <span role="status">{accessibilityLabel}</span>
  ),
  Icon: () => <span aria-hidden="true" />,
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));

const main = { id: 'main-a', kind: 'Main', status: 'Active', roomId: 'room-a' };
const holding = { id: 'holding-a', kind: 'Holding', status: 'Active', roomId: 'room-a' };
const terminated = {
  id: 'history-a',
  kind: 'Main',
  status: 'Terminated',
  roomId: 'room-a',
  locationId: 'location-a',
  locationName: 'Cơ sở A',
  roomNumber: 'A101',
  startDate: '2025-01-01',
  endDate: '2026-01-01',
  monthlyRent: '3000000',
};
function page(items: unknown[], pageNumber = 1, pageSize = 100, totalCount = items.length) {
  return { items, page: pageNumber, pageSize, totalCount };
}
function api(request: (path: string, init?: { signal?: AbortSignal }) => Promise<unknown>) {
  const stub = { request: vi.fn(request) };
  state.api = stub as unknown as MobileApi;
  return stub;
}
function ProtectedWorkspace() {
  return (
    <TenantContractAccessGate>
      <div data-testid="private-deep-link">Tenant invoice / payment / requests / meter screen</div>
    </TenantContractAccessGate>
  );
}
function RentalProbe() {
  const rental = useTenantCurrentRental();
  return <div data-testid="verified-rental">{rental?.id ?? 'missing'}</div>;
}
beforeEach(() => {
  state.role = 'Tenant';
  state.preview = false;
  state.actor = 'tenant-a';
  state.api = null;
  state.onAppState = null;
  state.logout.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('never mounts Tenant tabs or direct links for an empty or terminated-only tenancy', async () => {
  const request = api(async (path) =>
    path.includes('status=Active') ? page([]) : page([terminated], 1, 20),
  );
  render(<ProtectedWorkspace />);
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
  await screen.findByText('Bạn hiện không có phòng đang thuê');
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
  expect(screen.queryByText('Kiểm tra lại hợp đồng')).toBeNull();
  expect(screen.getByText('Đăng xuất')).toBeTruthy();
  expect(request.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Xem lịch sử hợp đồng'));
  expect(screen.queryByText('Kiểm tra lại hợp đồng')).toBeNull();
  await screen.findByText('Phòng A101');
  expect(screen.getByText('Đã kết thúc', { exact: false })).toBeTruthy();
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
  expect(request.request.mock.calls.every(([path]) => path.startsWith('/api/v1/contracts'))).toBe(
    true,
  );
});

it('only opens read-only contract detail, without actions or financial endpoints', async () => {
  const request = api(async (path) => {
    if (path.includes('status=Active')) return page([]);
    if (path === '/api/v1/contracts/history-a')
      return { ...terminated, terms: 'Điều khoản thuê đã ký' };
    return page([terminated], 1, 20);
  });
  render(<ProtectedWorkspace />);
  await screen.findByText('Bạn hiện không có phòng đang thuê');
  fireEvent.click(screen.getByText('Xem lịch sử hợp đồng'));
  fireEvent.click(await screen.findByText('Xem chi tiết hợp đồng'));
  await screen.findByText(/Điều khoản thuê đã ký/);
  expect(screen.getByText('Chi tiết hợp đồng')).toBeTruthy();
  expect(screen.getByText('Thông tin hợp đồng')).toBeTruthy();
  expect(screen.getByText('Loại hợp đồng')).toBeTruthy();
  expect(screen.getByText('Thời hạn')).toBeTruthy();
  expect(screen.getByText('Tiền thuê theo hợp đồng')).toBeTruthy();
  expect(screen.getAllByText('Quay lại')).toHaveLength(1);
  expect(screen.queryByText('Về danh sách hợp đồng')).toBeNull();
  expect(screen.queryByText('Thanh toán')).toBeNull();
  expect(screen.queryByText('Ký hợp đồng')).toBeNull();
  fireEvent.click(screen.getByText('Quay lại'));
  expect(screen.getByText('Lịch sử hợp đồng')).toBeTruthy();
  expect(screen.getByText('Phòng A101')).toBeTruthy();
  expect(screen.getAllByText('Quay lại')).toHaveLength(1);
  fireEvent.click(screen.getByText('Quay lại'));
  expect(screen.getByText('Bạn hiện không có phòng đang thuê')).toBeTruthy();
  expect(screen.queryByText('Lịch sử hợp đồng')).toBeNull();
  expect(request.request.mock.calls.every(([path]) => path.startsWith('/api/v1/contracts'))).toBe(
    true,
  );
});

it('does not count an Active Holding as a rented room', async () => {
  api(async () => page([holding]));
  render(<ProtectedWorkspace />);
  await screen.findByText('Bạn hiện không có phòng đang thuê');
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
});

it('grants normal workspace when Main or Renewal Active exists among 101 contracts', async () => {
  const firstPage = Array.from({ length: 100 }, (_, id) => ({ ...holding, id: `hold-${id}` }));
  const request = api(async (path) =>
    path.includes('page=2')
      ? page([{ ...main, kind: 'Renewal' }], 2, 100, 101)
      : page(firstPage, 1, 100, 101),
  );
  render(
    <TenantContractAccessGate>
      <RentalProbe />
    </TenantContractAccessGate>,
  );
  await screen.findByText('main-a');
  expect(screen.getByTestId('verified-rental').textContent).toBe('main-a');
  expect(request.request).toHaveBeenCalledTimes(2);
  expect(request.request.mock.calls[1][0]).toContain('page=2');
});

it('fails closed while contracts are loading or API fails, then retries successfully', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>((done) => (resolve = done));
  let attempts = 0;
  api(async () => {
    attempts += 1;
    if (attempts === 1) return pending;
    if (attempts === 2) throw new Error('403 Forbidden');
    return page([main]);
  });
  render(<ProtectedWorkspace />);
  expect(screen.getByText('Đang kiểm tra phòng và hợp đồng của bạn…')).toBeTruthy();
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
  await act(async () => resolve({ invalid: true }));
  await screen.findByText('Chưa kiểm tra được hợp đồng');
  expect(screen.queryByText('Bạn hiện không có phòng đang thuê')).toBeNull();
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText('Chưa kiểm tra được hợp đồng');
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByTestId('private-deep-link');
});

it('rechecks when returning to app and restricts immediately after move-out', async () => {
  let active = true;
  api(async () => page(active ? [main] : []));
  render(<ProtectedWorkspace />);
  await screen.findByTestId('private-deep-link');
  active = false;
  await act(async () => state.onAppState?.('active'));
  await screen.findByText('Bạn hiện không có phòng đang thuê');
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
});

it('does not destroy an active Tenant form while a background eligibility refresh is pending', async () => {
  let complete!: (value: unknown) => void;
  let calls = 0;
  api(async () => {
    if (++calls === 1) return page([main]);
    return new Promise<unknown>((resolve) => (complete = resolve));
  });
  render(<ProtectedWorkspace />);
  await screen.findByTestId('private-deep-link');
  await act(async () => state.onAppState?.('active'));
  expect(screen.getByTestId('private-deep-link')).toBeTruthy();
  await act(async () => complete(page([])));
  await screen.findByText('Bạn hiện không có phòng đang thuê');
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
});

it('does not reuse a previous user session while checking a different Tenant account', async () => {
  api(async () => page([main]));
  const view = render(<ProtectedWorkspace />);
  await screen.findByTestId('private-deep-link');
  state.actor = 'tenant-b';
  api(async () => page([]));
  view.rerender(<ProtectedWorkspace />);
  expect(screen.queryByTestId('private-deep-link')).toBeNull();
  await screen.findByText('Bạn hiện không có phòng đang thuê');
});

it.each(['Owner', 'Staff'])('does not query or restrict %s', (role) => {
  state.role = role;
  const request = api(async () => page([]));
  render(<ProtectedWorkspace />);
  expect(screen.getByTestId('private-deep-link')).toBeTruthy();
  expect(request.request).not.toHaveBeenCalled();
});

it('rejects malformed pagination instead of granting access or declaring no rental', async () => {
  const request = { request: vi.fn(async () => ({ items: [], totalCount: 1000 })) };
  await expect(
    hasActiveRoomRental(request as unknown as MobileApi, new AbortController().signal),
  ).rejects.toThrow('Không xác minh được');
  expect(request.request).toHaveBeenCalledTimes(1);
});

it('lets restricted Tenant sign out even if there are no historic contracts', async () => {
  api(async (path) => page([], 1, path.includes('status=Active') ? 100 : 20));
  render(<ProtectedWorkspace />);
  await screen.findByText('Bạn hiện không có phòng đang thuê');
  fireEvent.click(screen.getByText('Xem lịch sử hợp đồng'));
  await screen.findByText('Bạn chưa có lịch sử hợp đồng trong hệ thống.');
  fireEvent.click(screen.getByText('Đăng xuất'));
  await waitFor(() => expect(state.logout).toHaveBeenCalledTimes(1));
});
