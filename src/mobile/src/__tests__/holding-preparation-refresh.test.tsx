// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ContractClient } from '../../../../packages/client-core/src/contracts';
const events = vi.hoisted(() => ({
  listener: null as null | ((state: string) => void),
  focusEpoch: 0,
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_name: string, listener: (state: string) => void) => {
      events.listener = listener;
      return { remove: events.remove };
    },
  },
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    React.useEffect(callback, [callback, events.focusEpoch]),
}));
import { useHoldingPreparation } from '../features/contracts/useHoldingPreparation';
let ready = false;
const rooms = vi.fn(async () => ({
  items: [{ id: 'room', locationId: 'location', roomNumber: 'J09-102', status: 0 }],
  totalCount: 1,
}));
const api = {
  configuration: vi.fn(async () => ({})),
  locations: vi.fn(async () => [{ id: 'location', label: 'BHOME JOB09 TEST' }]),
  holdingRoomReady: vi.fn(async () => ready),
  preparation: vi.fn(async () => ({
    rooms: [{ id: 'room', locationId: 'location', label: 'J09-102', status: 'Available' }],
    residents: [],
    ownerSigners: [],
    locations: [],
  })),
  holdingRooms: rooms,
  holdingRoomReadiness: vi.fn(async (id: string) => ({
    roomId: id,
    purpose: 'Holding',
    status: ready ? 'Ready' : 'Blocked',
    isReady: ready,
    blockers: ready ? [] : [{ code: 'RENT_POLICY_MISSING', message: 'Missing rent' }],
    unverifiedConditions: [],
  })),
} as unknown as ContractClient;
function Harness({ selectedRoom = '' }: { selectedRoom?: string }) {
  const q = useHoldingPreparation(api, selectedRoom);
  return (
    <>
      <span>
        {q.loading ? 'Loading' : q.data?.rooms.map((x) => x.label).join(',') || 'No eligible rooms'}
      </span>
      <span>{q.data?.blockedRooms.flatMap((x) => x.codes).join(',')}</span>
      <span>{q.error}</span>
      <span>Catalog {q.catalogLoading ? 'loading' : 'ready'}</span>
      <span>{q.selectionBlocked ? 'Selected room blocked' : ''}</span>
    </>
  );
}
beforeEach(() => {
  ready = false;
  events.focusEpoch = 0;
  events.listener = null;
  vi.clearAllMocks();
});
afterEach(cleanup);
it('retains selected-room backend blockers without checking every room in the catalog', async () => {
  render(<Harness selectedRoom="room" />);
  await screen.findByText('RENT_POLICY_MISSING');
  expect(screen.getByText('J09-102')).toBeTruthy();
  expect(screen.getByText(/Owner cần cập nhật giá phòng/)).toBeTruthy();
  expect(api.holdingRoomReadiness).toHaveBeenCalledOnce();
});
it('refreshes eligibility on foreground without reloading the application', async () => {
  render(<Harness />);
  await screen.findByText('J09-102');
  expect(api.holdingRoomReadiness).not.toHaveBeenCalled();
  expect(rooms).toHaveBeenCalledOnce();
  act(() => events.listener?.('background'));
  expect(rooms).toHaveBeenCalledOnce();
  ready = true;
  act(() => events.listener?.('active'));
  await screen.findByText('J09-102');
  expect(rooms).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('RENT_POLICY_MISSING')).toBeNull();
});
it('refreshes on navigation focus and removes the foreground listener on unmount', async () => {
  const view = render(<Harness />);
  await screen.findByText('J09-102');
  ready = true;
  events.focusEpoch++;
  view.rerender(<Harness />);
  await screen.findByText('J09-102');
  await waitFor(() => expect(rooms).toHaveBeenCalledTimes(2));
  view.unmount();
  expect(events.remove).toHaveBeenCalledOnce();
});
it('refreshes only the selected room when returning from the camera, keeping the catalog cached', async () => {
  ready = true;
  render(<Harness selectedRoom="room" />);
  await screen.findByText('J09-102');
  expect(rooms).toHaveBeenCalledOnce();
  expect(api.preparation).toHaveBeenCalledOnce();
  act(() => events.listener?.('background'));
  act(() => events.listener?.('active'));
  await waitFor(() => expect(api.preparation).toHaveBeenCalledTimes(2));
  await screen.findByText('J09-102');
  expect(rooms).toHaveBeenCalledOnce();
  expect(api.holdingRoomReadiness).toHaveBeenCalledTimes(2);
});

it('shows 100 available rooms without waiting for a single readiness request', async () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({
    id: `room-${i}`,
    locationId: 'location',
    roomNumber: `R${i}`,
    status: 0,
  }));
  rooms.mockResolvedValueOnce({ items: candidates, totalCount: candidates.length });
  render(<Harness />);
  await screen.findByText('Catalog ready');
  expect(screen.getByText(candidates.map((r) => r.roomNumber).join(','))).toBeTruthy();
  expect(rooms).toHaveBeenCalledOnce();
  expect(api.preparation).not.toHaveBeenCalled();
  expect(api.holdingRoomReadiness).not.toHaveBeenCalled();
  expect(api.holdingRoomReady).not.toHaveBeenCalled();
});

it('explains a protected pending contract and finishes checking only the selected room', async () => {
  vi.mocked(api.holdingRoomReadiness).mockResolvedValueOnce({
    roomId: 'room',
    purpose: 'Holding',
    status: 'Blocked',
    isReady: false,
    blockers: [{ code: 'PROTECTED_PENDING_CONTRACT', message: 'Protected contract' }],
    unverifiedConditions: [],
  });
  render(<Harness selectedRoom="room" />);
  await screen.findByText(/Phòng đã có hợp đồng đang xử lý có chữ ký hoặc tiền cọc/);
  expect(screen.getByText('Selected room blocked')).toBeTruthy();
  expect(screen.queryByText('Loading')).toBeNull();
  expect(api.holdingRoomReadiness).toHaveBeenCalledWith('room', expect.any(AbortSignal));
  expect(api.holdingRoomReadiness).toHaveBeenCalledOnce();
});

it('keeps the catalog usable while the selected room is being checked', async () => {
  vi.mocked(api.holdingRoomReadiness).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<Harness />);
  await screen.findByText('J09-102');
  view.rerender(<Harness selectedRoom="room" />);
  await waitFor(() => expect(api.holdingRoomReadiness).toHaveBeenCalledOnce());
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(screen.getByText('Catalog ready')).toBeTruthy();
});
