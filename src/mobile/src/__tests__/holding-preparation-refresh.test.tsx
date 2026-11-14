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
function Harness() {
  const q = useHoldingPreparation(api);
  return (
    <>
      <span>
        {q.loading ? 'Loading' : q.data?.rooms.map((x) => x.label).join(',') || 'No eligible rooms'}
      </span>
      <span>{q.data?.blockedRooms.flatMap((x) => x.codes).join(',')}</span>
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
it('retains backend blockers instead of presenting missing rent as missing room data', async () => {
  render(<Harness />);
  await screen.findByText('RENT_POLICY_MISSING');
  expect(screen.getByText('No eligible rooms')).toBeTruthy();
});
it('refreshes eligibility on foreground without reloading the application', async () => {
  render(<Harness />);
  await screen.findByText('RENT_POLICY_MISSING');
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
  await screen.findByText('RENT_POLICY_MISSING');
  ready = true;
  events.focusEpoch++;
  view.rerender(<Harness />);
  await screen.findByText('J09-102');
  await waitFor(() => expect(rooms).toHaveBeenCalledTimes(2));
  view.unmount();
  expect(events.remove).toHaveBeenCalledOnce();
});
