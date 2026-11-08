// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryCache } from '../lib/queryCache';
const state = vi.hoisted(() => ({
  role: 'Staff',
  preview: false,
  api: { request: vi.fn(), queryCache: null as QueryCache | null },
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role, preview: state.preview }),
}));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ api: state.api }) }));
import { useStaffDashboard } from '../features/workspace/useStaffDashboard';
beforeEach(() => {
  state.role = 'Staff';
  state.preview = false;
  state.api = {
    queryCache: new QueryCache(),
    request: vi.fn(async (path: string) =>
      path.includes('operational-tasks') ? { items: [], totalCount: 0 } : [],
    ),
  };
});
afterEach(() => {
  cleanup();
  state.api.queryCache?.dispose();
  vi.useRealTimers();
});
it('queries the full local day in Vietnam and uses the server total rather than the page length', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T18:30:00Z'));
  state.api.request.mockImplementation(async (path: string) =>
    path.includes('dueFrom')
      ? { items: [], totalCount: 37 }
      : path.includes('operational-tasks')
        ? { items: [], totalCount: 0 }
        : [],
  );
  const view = renderHook(useStaffDashboard);
  await act(async () => {
    await Promise.resolve();
  });
  const paths = state.api.request.mock.calls.map((call) => call[0]);
  expect(
    paths.some(
      (path) =>
        path.includes('dueFrom=2026-11-05T00:00:00%2B07:00') &&
        path.includes('dueTo=2026-11-05T23:59:59.999%2B07:00'),
    ),
  ).toBe(true);
  expect(view.result.current.tasks.data?.totalCount).toBe(37);
  expect(paths.some((path) => path.includes('/invoices'))).toBe(false);
});
it('does not query real Staff APIs in preview or for a Tenant', () => {
  state.preview = true;
  const view = renderHook(useStaffDashboard);
  expect(state.api.request).not.toHaveBeenCalled();
  state.preview = false;
  state.role = 'Tenant';
  view.rerender();
  expect(state.api.request).not.toHaveBeenCalled();
});
it('clears earlier account data while the replacement account is loading', async () => {
  state.api.request.mockResolvedValue([{ id: 'previous-location', label: 'Earlier account' }]);
  const view = renderHook(useStaffDashboard);
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.result.current.locations.data?.[0].label).toBe('Earlier account');
  state.api.queryCache?.dispose();
  state.api = { request: vi.fn(() => new Promise(() => {})), queryCache: new QueryCache() };
  view.rerender();
  expect(view.result.current.locations.data).toBeNull();
  expect(view.result.current.locations.loading).toBe(true);
});
it('keeps actionable overdue work visible and ordered across Assigned and InProgress pages', async () => {
  state.api.request.mockImplementation(async (path: string) => {
    if (path.includes('isOverdue=true&status=Assigned'))
      return {
        items: [{ id: 'assigned', dueAt: '2026-11-04T10:00:00Z', status: 'Assigned' }],
        totalCount: 1,
      };
    if (path.includes('isOverdue=true&status=InProgress'))
      return {
        items: [{ id: 'progress', dueAt: '2026-11-04T09:00:00Z', status: 'InProgress' }],
        totalCount: 1,
      };
    return path.includes('operational-tasks') ? { items: [], totalCount: 0 } : [];
  });
  const view = renderHook(useStaffDashboard);
  await act(async () => {
    await Promise.resolve();
  });
  expect(view.result.current.overdue.data?.items.map((item) => item.id)).toEqual([
    'progress',
    'assigned',
  ]);
  const paths = state.api.request.mock.calls.map((call) => call[0]);
  expect(
    paths
      .filter((path) => path.includes('isOverdue=true'))
      .every((path) => path.includes('&status=')),
  ).toBe(true);
});
