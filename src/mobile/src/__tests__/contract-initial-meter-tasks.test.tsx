// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContractView } from '../../../../packages/client-core/src/contracts';
import type { MeterTask } from '../../../../packages/client-core/src/meter';

const request = vi.fn();
const client = { request };
let locationId = 'location-1';
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: client, session: { roles: ['Staff'], userId: 'staff-1' } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ staffLocationId: locationId }),
}));
vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
  useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <section>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  ),
  ui: {},
}));

import { router } from 'expo-router';
import { ContractInitialMeterTasks } from '../features/contracts/ContractInitialMeterTasks';

const contract = {
  id: 'contract-new',
  locationId: 'location-1',
  roomId: 'room-1',
  status: 'Active',
  kind: 'Main',
} as ContractView;

function task(id: string, utilityType: number, fields: Partial<MeterTask> = {}): MeterTask {
  return {
    id,
    meterId: `meter-${utilityType}`,
    purpose: 0,
    contractId: 'contract-new',
    locationId: 'location-1',
    roomId: 'room-1',
    utilityType,
    status: 0,
    ...fields,
  } as MeterTask;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  locationId = 'location-1';
});

it('loads all room pages, shows only this contract’s fresh initial readings, and opens exact capture tasks', async () => {
  const previousContractTasks = Array.from({ length: 100 }, (_, index) =>
    task(`old-${index}`, index % 2, { contractId: 'contract-previous' }),
  );
  request.mockImplementation(async (url: string) =>
    url.includes('page=1')
      ? previousContractTasks
      : [task('electric-new', 0), task('water-new', 1)],
  );
  render(<ContractInitialMeterTasks contract={contract} />);
  const electricity = await screen.findByRole('button', { name: 'Chụp chỉ số điện' });
  const water = screen.getByRole('button', { name: 'Chụp chỉ số nước' });
  expect(screen.getByText(/Ảnh và chỉ số của hợp đồng cũ không được dùng thay thế/)).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(2);
  for (const [url] of request.mock.calls) {
    const query = new URL(url, 'http://test.local').searchParams;
    expect(query.get('locationId')).toBe('location-1');
    expect(query.get('roomId')).toBe('room-1');
  }
  fireEvent.click(electricity);
  fireEvent.click(water);
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/meter',
    params: { taskId: 'electric-new' },
  });
  expect(router.push).toHaveBeenCalledWith({ pathname: '/meter', params: { taskId: 'water-new' } });
});

it('blocks the request when Staff is viewing a contract outside their selected Location', () => {
  locationId = 'location-2';
  render(<ContractInitialMeterTasks contract={contract} />);
  expect(screen.getByText(/Hãy chọn đúng cơ sở của hợp đồng/)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Chụp chỉ số/ })).toBeNull();
});

it('does not substitute periodic readings or old contract baselines for a missing new-contract task', async () => {
  request.mockResolvedValue([
    task('previous-electric', 0, { contractId: 'contract-previous', status: 2 }),
    task('new-periodic', 0, { purpose: 1 }),
    task('new-water', 1, { status: 2 }),
  ]);
  render(<ContractInitialMeterTasks contract={contract} />);
  await screen.findByRole('button', { name: 'Xem chỉ số nước' });
  expect(screen.getByText('Chỉ số khởi tạo điện')).toBeTruthy();
  expect(screen.getAllByText('Chưa được giao nhiệm vụ khởi tạo cho hợp đồng này.')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Chụp chỉ số điện' })).toBeNull();
});

it('does not open an ambiguous duplicate initial task for the same contract and utility', async () => {
  request.mockResolvedValue([task('electric-1', 0), task('electric-2', 0), task('water', 1)]);
  render(<ContractInitialMeterTasks contract={contract} />);
  await screen.findByText('Có nhiều nhiệm vụ cho cùng hợp đồng. Cần Owner kiểm tra.');
  expect(screen.queryByRole('button', { name: 'Chụp chỉ số điện' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Chụp chỉ số nước' })).toBeTruthy();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
});
