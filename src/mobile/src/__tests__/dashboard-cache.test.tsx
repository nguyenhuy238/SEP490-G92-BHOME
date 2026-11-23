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
  useWorkspace: () => ({ role: state.role, preview: false, staffLocationId: 'loc' }),
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
const tenantRoom = '11111111-1111-4111-8111-111111111111';
function tenantTransport() {
  return vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/contracts?'))
      return json(
        page([
          {
            id: 'contract',
            roomId: tenantRoom,
            roomNumber: 'P1',
            status: 'Active',
            kind: 'Main',
          },
        ]),
      );
    if (path.includes('/invoices?'))
      return json(
        page([
          {
            id: 'bill',
            roomId: tenantRoom,
            status: 'Final',
            billingPeriod: month + '-01',
            lines: [],
          },
        ]),
      );
    if (path.includes('/tenant/meter-readings?')) return json(page([]));
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
it('reuses the seven scoped Tenant Home queries including monthly meter readings on return', async () => {
  const transport = tenantTransport();
  client(transport);
  const view = render(<TenantDashboardScreen />);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('outstandingAmount'),
  );
  expect(transport).toHaveBeenCalledTimes(7);
  view.unmount();
  render(<TenantDashboardScreen />);
  expect(screen.getByRole('status').textContent).toContain('outstandingAmount');
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(7);
  expect(JSON.parse(screen.getByRole('status').textContent!).paymentState.loading).toBe(false);
});
function StaffProbe() {
  const data = useStaffDashboard();
  // Same resource consumed by the real shell subtitle and dashboard body.
  const locations = useWorkspaceQuery('/api/v1/capture/locations', { cache: queryPolicies.rooms });
  return <output>{JSON.stringify({ data, locations })}</output>;
}
it('measures Staff Home plus header as nine scoped reads and reuses them on remount', async () => {
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
  expect(transport).toHaveBeenCalledTimes(9);
  expect(
    transport.mock.calls.filter(([url]) => String(url).endsWith('/capture/locations')),
  ).toHaveLength(1);
  expect(
    transport.mock.calls.some(([url]) => String(url).includes('/capture/locations/loc/rooms')),
  ).toBe(true);
  view.unmount();
  render(<StaffProbe />);
  await act(async () => {});
  expect(transport).toHaveBeenCalledTimes(9);
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
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(9));
  // Only payment (30s) and notifications (30s), not contracts/invoices/meters/debts.
  expect(
    transport.mock.calls.slice(7).every(([url]) => /\/payment$|notifications\?/.test(String(url))),
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
it('does not mistake a previous debt for this month’s invoice on Tenant Home', async () => {
  const transport = tenantTransport();
  transport.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/debts?'))
      return json(page([{ invoiceId: 'due-bill', outstandingAmount: '100' }], 1));
    if (path.includes('/invoices?'))
      return json(
        page([
          {
            id: 'current-bill',
            roomId: tenantRoom,
            status: 'Final',
            billingPeriod: month + '-01',
            lines: [],
          },
        ]),
      );
    if (path.includes('/contracts?'))
      return json(
        page([
          {
            id: 'contract',
            roomId: tenantRoom,
            roomNumber: 'P1',
            status: 'Active',
            kind: 'Main',
          },
        ]),
      );
    if (path.includes('/tenant/meter-readings?')) return json(page([]));
    if (path.endsWith('/payment'))
      return json({ paymentStatus: 'Unpaid', outstandingAmount: '100' });
    return json(page([]));
  });
  client(transport);
  render(<TenantDashboardScreen />);
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('"paymentStatus":"Unpaid"'),
  );
  const props = JSON.parse(screen.getByRole('status').textContent!);
  expect(props.invoice.id).toBe('current-bill');
  expect(props.debt.invoiceId).toBe('due-bill');
  expect(
    transport.mock.calls.some(([url]) => String(url).includes(`billingPeriod=${month}-01`)),
  ).toBe(true);
  expect(transport.mock.calls.some(([url]) => String(url).endsWith('/invoices/due-bill'))).toBe(
    false,
  );
});
it('does not load Tenant financial features after a completed move-out has no Active contract', async () => {
  const transport = tenantTransport();
  transport.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/contracts?')) return json(page([]));
    if (path.includes('/invoices?'))
      return json(
        page([
          {
            id: 'post-moveout-bill',
            roomId: tenantRoom,
            billingPeriod: month + '-01',
            status: 'Final',
            lines: [],
          },
        ]),
      );
    if (path.includes('/tenant/meter-readings?')) return json(page([]));
    if (path.endsWith('/payment'))
      return json({ paymentStatus: 'Paid', outstandingAmount: '0', paidAmount: '20000' });
    if (path.endsWith('/expiry-reminders')) return json([]);
    return json(page([]));
  });
  client(transport);
  render(<TenantDashboardScreen />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('"contracts":[]'));
  const props = JSON.parse(screen.getByRole('status').textContent!);
  expect(props.contracts).toEqual([]);
  expect(props.invoice).toBeUndefined();
  expect(props.payment).toBeUndefined();
  expect(
    transport.mock.calls.some(([url]) =>
      /\/invoices\?|\/debts\?|\/tenant\/meter-readings\?|\/notifications\?/.test(String(url)),
    ),
  ).toBe(false);
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
