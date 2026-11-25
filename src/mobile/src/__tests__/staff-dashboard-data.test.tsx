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
  useWorkspace: () => ({ role: state.role, preview: state.preview, staffLocationId: 'loc-1' }),
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
it('requests only two latest actionable tasks for the selected Location', async () => {
  const view = renderHook(useStaffDashboard);
  await act(async () => {
    await Promise.resolve();
  });
  const paths = state.api.request.mock.calls.map(([path]) => path);
  expect(paths.filter((path) => path.includes('latestActionable=true'))).toEqual([
    '/api/v1/operational-tasks?page=1&pageSize=2&locationId=loc-1&latestActionable=true',
  ]);
  expect(
    paths.some((path) => path.includes('isOverdue=true') || path.includes('/meter-tasks')),
  ).toBe(false);
  expect(view.result.current.priorities.data?.items).toEqual([]);
});
