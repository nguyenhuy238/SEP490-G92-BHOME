// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStaffIncidentScope } from '../features/workspace/useStaffIncidentScope';

const state = vi.hoisted(() => ({
  selected: 'working-location',
  assigned: ['working-location', 'inventory-location'],
  query: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ staffLocationId: state.selected, selectStaffLocation: vi.fn() }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.query(path);
    const data =
      path === null
        ? undefined
        : path === '/api/v1/capture/locations'
          ? state.assigned.map((id) => ({ id, label: id }))
          : path?.endsWith('/rooms')
            ? [
                {
                  id: path.includes('inventory-location') ? 'inventory-room' : 'working-room',
                  label: 'Room',
                },
              ]
            : { items: [] };
    return { data, reload: state.reload };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.selected = 'working-location';
  state.assigned = ['working-location', 'inventory-location'];
});
afterEach(cleanup);

it('uses the shared Staff Location for ordinary incident reporting', () => {
  const { result, rerender } = renderHook(() => useStaffIncidentScope(true));
  expect(result.current.location).toBe('working-location');
  state.selected = 'inventory-location';
  rerender();
  expect(result.current.location).toBe('inventory-location');
});

it('keeps inventory reporting on the assigned source Location and Room', () => {
  const { result } = renderHook(() =>
    useStaffIncidentScope(true, {
      locationId: 'inventory-location',
      roomId: 'inventory-room',
    }),
  );
  expect(result.current.location).toBe('inventory-location');
  expect(result.current.area).toBe('inventory-room');
  expect(state.query).toHaveBeenCalledWith('/api/v1/capture/locations/inventory-location/rooms');
});

it('stops scoped queries when the source Location assignment is revoked', () => {
  const { result, rerender } = renderHook(() =>
    useStaffIncidentScope(true, {
      locationId: 'inventory-location',
      roomId: 'inventory-room',
    }),
  );
  state.assigned = ['working-location'];
  state.query.mockClear();
  rerender();
  expect(result.current.location).toBe('');
  expect(result.current.area).toBe('');
  expect(state.query.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/capture/locations',
    null,
    null,
  ]);
});

it('does not select a Room outside the source Location or query when disabled', () => {
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useStaffIncidentScope(enabled, {
        locationId: 'inventory-location',
        roomId: 'working-room',
      }),
    { initialProps: { enabled: true } },
  );
  expect(result.current.area).toBe('');
  state.query.mockClear();
  rerender({ enabled: false });
  expect(result.current.location).toBe('');
  expect(state.query.mock.calls.map(([path]) => path)).toEqual([null, null, null]);
});
