// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  locations: [{ id: 'assigned', label: 'Cơ sở được phân công' }],
}));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ api: state.api }) }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ preview: false }),
}));
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
beforeEach(() => {
  vi.clearAllMocks();
  state.locations = [{ id: 'assigned', label: 'Cơ sở được phân công' }];
  state.api.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return [...state.locations];
    if (path.endsWith('/rooms'))
      return [{ id: path.includes('/other/') ? 'other-room' : 'room', label: 'T101' }];
    return [];
  });
});
afterEach(cleanup);
it('automatically loads rooms for the only assigned location without a location selection', async () => {
  const { result } = renderHook(() => useCaptureScope({ autoSelectAssignedLocation: true }));
  await waitFor(() => expect(result.current.rooms).toHaveLength(1));
  expect(result.current.location).toBe('assigned');
  expect(state.api.request).toHaveBeenCalledWith(
    '/api/v1/capture/locations/assigned/rooms',
    expect.anything(),
  );
  expect(result.current.room).toBe('');
});
it('does not silently select a location when Staff has multiple assignments', async () => {
  state.locations.push({ id: 'other', label: 'Cơ sở khác' });
  const { result } = renderHook(() => useCaptureScope({ autoSelectAssignedLocation: true }));
  await waitFor(() => expect(result.current.locations).toHaveLength(2));
  expect(result.current.location).toBe('');
  expect(result.current.rooms).toEqual([]);
  act(() => result.current.selectLocation('other'));
  await waitFor(() => expect(result.current.rooms[0]?.id).toBe('other-room'));
});
it('clears the selected room when the assignment is removed during reload', async () => {
  const { result } = renderHook(() => useCaptureScope({ autoSelectAssignedLocation: true }));
  await waitFor(() => expect(result.current.rooms).toHaveLength(1));
  act(() => result.current.setRoom('room'));
  state.locations = [];
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.location).toBe(''));
  await waitFor(() => expect(result.current.rooms).toEqual([]));
  expect(result.current.room).toBe('');
});
it('ignores a late room response after switching locations', async () => {
  state.locations.push({ id: 'other', label: 'Cơ sở khác' });
  let late: (rooms: { id: string; label: string }[]) => void = () => {};
  state.api.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return [...state.locations];
    if (path === '/api/v1/capture/locations/assigned/rooms')
      return new Promise((resolve) => {
        late = resolve;
      });
    if (path.endsWith('/rooms')) return [{ id: 'other-room', label: 'T201' }];
    return [];
  });
  const { result } = renderHook(() => useCaptureScope({ autoSelectAssignedLocation: true }));
  await waitFor(() => expect(result.current.locations).toHaveLength(2));
  act(() => result.current.selectLocation('assigned'));
  await waitFor(() =>
    expect(state.api.request).toHaveBeenCalledWith(
      '/api/v1/capture/locations/assigned/rooms',
      expect.anything(),
    ),
  );
  act(() => result.current.selectLocation('other'));
  await waitFor(() => expect(result.current.rooms[0]?.id).toBe('other-room'));
  await act(async () => late([{ id: 'old-room', label: 'Không còn được chọn' }]));
  expect(result.current.location).toBe('other');
  expect(result.current.rooms[0]?.id).toBe('other-room');
});
it('preserves explicit selection behavior for other screens that did not opt in', async () => {
  const { result } = renderHook(() => useCaptureScope());
  await waitFor(() => expect(result.current.locations).toHaveLength(1));
  expect(result.current.location).toBe('');
});
