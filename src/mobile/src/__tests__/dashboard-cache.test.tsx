// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { MobileApi } from '../lib/api';
import { queryPolicies } from '../lib/queryPolicies';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useOwnerAttention } from '../features/owner/useOwnerAttention';
import { useStaffDashboard } from '../features/workspace/useStaffDashboard';
import { TenantDashboardScreen } from '../screens/TenantDashboardScreen';
import { businessToday } from '../../../../packages/client-core/src/contracts';
const state = vi.hoisted(() => ({
  api: null as MobileApi | null,
  actor: 'tenant-a',
  role: 'Tenant',
  focused: true,
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => useEffect(callback, [callback]),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: state.api, session: { userId: state.actor, roles: [state.role] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role, preview: false }),
}));
vi.mock('../lib/toast', () => ({ conciseMessage: (text: string) => text, showError: vi.fn() }));
vi.mock('../screens/TenantDashboard', () => ({
  TenantDashboard: (props: unknown) => <output>{JSON.stringify(props)}</output>,
}));
const clients: MobileApi[] = [];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function client(transport: Mock<typeof fetch>) {
  const api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-access',
    async () => undefined,
    vi.fn(),
    transport as typeof fetch,
  );
  state.api = api;
  clients.push(api);
  return api;
}
const page = (items: unknown[], pageSize = 20) => ({
  items,
  page: 1,
  pageSize,
  totalCount: items.length,
});
const month = businessToday().slice(0, 7);
function tenantTransport() {
  return vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/contracts?')) return json(page([{ id: 'contract', roomNumber: 'P1' }]));
    if (path.includes('/invoices?'))
      return json(page([{ id: 'bill', status: 'Final', billingPeriod: month + '-01', lines: [] }]));
    if (path.endsWith('/payment'))
      return json({ paymentStatus: 'Unpaid', outstandingAmount: '100', paidAmount: '0' });
    if (path.endsWith('/expiry-reminders')) return json([]);
    return json(page([]));
  });
}
beforeEach(() => {
  state.actor = 'tenant-a';
  state.role = 'Tenant';
  state.focused = true;
});
afterEach(() => {
  cleanup();
  clients.forEach((api) => api.queryCache.dispose());
  clients.length = 0;
  vi.restoreAllMocks();
});
function TwinProbe({ cached }: { cached: boolean }) {
  const first = useWorkspaceQuery('/api/v1/capture/locations', {
    cache: cached ? queryPolicies.rooms : undefined,
  });
  const second = useWorkspaceQuery('/api/v1/capture/locations', {
    cache: cached ? queryPolicies.rooms : undefined,
  });
  return <output>{JSON.stringify({ first, second })}</output>;
}

function OwnerAttentionProbe() {
  const queue = useOwnerAttention();
  return (
    <output>
      {JSON.stringify({ complete: queue.complete, total: queue.totalKnown, error: queue.error })}
    </output>
  );
}
it('shares the Owner attention reads across dashboard/tab remounts and refreshes after a server mutation', async () => {
  state.role = 'Owner';
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json({ items: [], totalCount: 12 }));
  const api = client(transport);
  const view = render(<OwnerAttentionProbe />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('"complete":true'));
  expect(screen.getByRole('status').textContent).toContain('"total":96');
  expect(transport).toHaveBeenCalledTimes(8);
  view.unmount();
  render(<OwnerAttentionProbe />);
  expect(transport).toHaveBeenCalledTimes(8);
  await act(async () => {
    await api.request('/api/v1/operational-tasks/task/verify', { method: 'POST' });
  });
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(17));
});

it.each(['Staff', 'Tenant'])('does not fetch Owner attention for %s', (role) => {
  state.role = role;
  const transport = vi.fn<typeof fetch>();
  client(transport);
  render(<OwnerAttentionProbe />);
  expect(transport).not.toHaveBeenCalled();
});
it('measures uncached control versus shared caching for duplicate consumers and remounts', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => json([{ id: 'room' }]));
  client(transport);
  let view = render(<TwinProbe cached={false} />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('room'));
  view.unmount();
  view = render(<TwinProbe cached={false} />);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(4));
  view.unmount();
  transport.mockClear();
  view = render(<TwinProbe cached />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('room'));
  view.unmount();
  render(<TwinProbe cached />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('room'));
  expect(transport).toHaveBeenCalledTimes(1);
});
it('measures Tenant Home as six initial reads and zero additional reads on immediate return', async () => {
  const transport = tenantTransport();
  client(transport);
  const view = render(<TenantDashboardScreen />);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('outstandingAmount'),
  );
  expect(transport).toHaveBeenCalledTimes(6);
  view.unmount();
  render(<TenantDashboardScreen />);
  expect(screen.getByRole('status').textContent).toContain('outstandingAmount');
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(6);
  expect(JSON.parse(screen.getByRole('status').textContent!).paymentState.loading).toBe(false);
});
function StaffProbe() {
  const data = useStaffDashboard();
  // Same resource consumed by the real shell subtitle and dashboard body.
  const locations = useWorkspaceQuery('/api/v1/capture/locations', { cache: queryPolicies.rooms });
  return <output>{JSON.stringify({ data, locations })}</output>;
}
it('measures Staff Home plus header as eight reads and reuses them on remount', async () => {
  state.role = 'Staff';
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(
        String(url).includes('/incidents?') || String(url).includes('operational-tasks?')
          ? page([])
          : [],
      ),
    );
  client(transport);
  const view = render(<StaffProbe />);
  await waitFor(() =>
    expect(JSON.parse(screen.getByRole('status').textContent!).data.meters.loading).toBe(false),
  );
  expect(transport).toHaveBeenCalledTimes(8);
  expect(
    transport.mock.calls.filter(([url]) => String(url).endsWith('/capture/locations')),
  ).toHaveLength(1);
  view.unmount();
  render(<StaffProbe />);
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(8);
});
it('keeps Tenant Home visible on stale background refetch and refreshes only expired resources', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const transport = tenantTransport();
  client(transport);
  const view = render(<TenantDashboardScreen />);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('outstandingAmount'),
  );
  view.unmount();
  now += 31_000;
  const pending: (() => void)[] = [];
  transport.mockImplementation(
    async (url) =>
      new Promise((resolve) =>
        pending.push(() =>
          resolve(
            json(
              String(url).endsWith('/payment')
                ? { paymentStatus: 'Paid', outstandingAmount: '0', paidAmount: '100' }
                : page([]),
            ),
          ),
        ),
      ),
  );
  render(<TenantDashboardScreen />);
  expect(JSON.parse(screen.getByRole('status').textContent!).paymentState.loading).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('contract');
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(8));
  // Only payment (30s) and notifications (30s), not contracts/invoices/debts.
  expect(
    transport.mock.calls.slice(6).every(([url]) => /\/payment$|notifications\?/.test(String(url))),
  ).toBe(true);
  await act(async () => {
    pending.splice(0).forEach((resolve) => resolve());
  });
});
it('never exposes cached data under a different account or role, even with the same test client', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json([{ id: 'PRIVATE-A' }]));
  client(transport);
  const view = render(<TwinProbe cached />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('PRIVATE-A'));
  state.actor = 'tenant-b';
  transport.mockImplementation(async () => new Promise(() => {}));
  view.rerender(<TwinProbe cached />);
  expect(screen.getByRole('status').textContent).not.toContain('PRIVATE-A');
  state.role = 'Staff';
  view.rerender(<TwinProbe cached />);
  expect(screen.getByRole('status').textContent).not.toContain('PRIVATE-A');
});
it('does not request the invoice list when the selected outstanding invoice needs its existing detail API', async () => {
  const transport = tenantTransport();
  transport.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/debts?'))
      return json(page([{ invoiceId: 'due-bill', outstandingAmount: '100' }], 1));
    if (path.endsWith('/invoices/due-bill'))
      return json({ id: 'due-bill', status: 'Final', billingPeriod: month + '-01' });
    if (path.endsWith('/payment'))
      return json({ paymentStatus: 'Unpaid', outstandingAmount: '100' });
    return json(page([]));
  });
  client(transport);
  render(<TenantDashboardScreen />);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('"paymentStatus":"Unpaid"'),
  );
  expect(transport.mock.calls.some(([url]) => String(url).includes('/invoices?'))).toBe(false);
});
function RetryProbe() {
  const query = useWorkspaceQuery<{ label: string }>('/api/v1/capture/locations', {
    cache: queryPolicies.rooms,
  });
  return (
    <>
      <output>{JSON.stringify(query)}</output>
      <button onClick={query.reload}>Thử lại</button>
    </>
  );
}
it('offers recovery from an initial API failure without an automatic request loop', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({}, 503))
    .mockResolvedValueOnce(json({ label: 'recovered' }));
  client(transport);
  const view = render(<RetryProbe />);
  await waitFor(() =>
    expect(JSON.parse(screen.getByRole('status').textContent!).error).not.toBe(''),
  );
  view.rerender(<RetryProbe />);
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Thử lại'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('recovered'));
  expect(transport).toHaveBeenCalledTimes(2);
});
