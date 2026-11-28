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
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <section>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  ),
  ui: {},
}));

import { router } from 'expo-router';
import { ContractInitialMeterTasks } from '../features/contracts/handover/ContractInitialMeterTasks';

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
  const electricity = await screen.findByRole('button', { name: 'Chụp chỉ số công tơ điện' });
  const water = screen.getByRole('button', { name: 'Chụp chỉ số công tơ nước' });
  expect(screen.getByText(/Không dùng ảnh hoặc chỉ số của hợp đồng trước/)).toBeTruthy();
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

it.each(['PendingSigning', 'PendingActivation'])(
  'opens newly created Main initial tasks while the contract is %s',
  async (status) => {
    request.mockResolvedValue([
      task('electric-before-active', 0),
      task('water-before-active', 1),
      task('old-electric', 0, { contractId: 'contract-previous', status: 2 }),
      task('periodic', 0, { purpose: 1 }),
    ]);
    render(<ContractInitialMeterTasks contract={{ ...contract, status }} />);
    const electricity = await screen.findByRole('button', { name: 'Chụp chỉ số công tơ điện' });
    const water = screen.getByRole('button', { name: 'Chụp chỉ số công tơ nước' });
    fireEvent.click(electricity);
    fireEvent.click(water);
    expect(router.push).toHaveBeenNthCalledWith(1, {
      pathname: '/meter',
      params: { taskId: 'electric-before-active' },
    });
    expect(router.push).toHaveBeenNthCalledWith(2, {
      pathname: '/meter',
      params: { taskId: 'water-before-active' },
    });
    expect(request).toHaveBeenCalledTimes(1);
  },
);

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
  await screen.findByRole('button', { name: 'Xem chỉ số công tơ nước' });
  expect(screen.getByText('Chỉ số đầu kỳ công tơ điện')).toBeTruthy();
  expect(screen.getAllByText('Chưa có bước xác nhận chỉ số đầu kỳ cho hợp đồng này.')).toHaveLength(
    1,
  );
  expect(screen.queryByRole('button', { name: 'Chụp chỉ số công tơ điện' })).toBeNull();
});

it('does not open an ambiguous duplicate initial task for the same contract and utility', async () => {
  request.mockResolvedValue([task('electric-1', 0), task('electric-2', 0), task('water', 1)]);
  render(<ContractInitialMeterTasks contract={contract} />);
  await screen.findByText('Có nhiều nhiệm vụ cho cùng hợp đồng. Cần Owner kiểm tra.');
  expect(screen.queryByRole('button', { name: 'Chụp chỉ số công tơ điện' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Chụp chỉ số công tơ nước' })).toBeTruthy();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
});

it('updates both meter statuses from the server after OCR returns without a manual refresh button', async () => {
  let confirmed = false;
  request.mockImplementation(async () => [
    task('electric', 0, { status: confirmed ? 2 : 0 }),
    task('water', 1, { status: confirmed ? 2 : 0 }),
  ]);
  const page = render(
    <ContractInitialMeterTasks contract={contract} integrated refreshRevision={0} />,
  );
  expect(await screen.findByRole('button', { name: 'Chụp chỉ số công tơ điện' })).toBeTruthy();
  expect(screen.getAllByText('Chưa xác nhận')).toHaveLength(2);
  expect(
    screen.queryByRole('button', {
      name: /Cập nhật trạng thái điện nước|Tải lại nhiệm vụ khởi tạo/,
    }),
  ).toBeNull();
  confirmed = true;
  page.rerender(<ContractInitialMeterTasks contract={contract} integrated refreshRevision={1} />);
  expect(await screen.findByRole('button', { name: 'Xem chỉ số công tơ điện' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xem chỉ số công tơ nước' })).toBeTruthy();
  expect(screen.getAllByText('Đã xác nhận')).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(2);
});

it('repairs missing electricity and water baselines within the started move-in handover, not separate Staff jobs', async () => {
  let prepared = false;
  request.mockImplementation(async (url: string) => {
    if (url.includes('/initial-meter-baselines/ensure')) {
      prepared = true;
      return ['electric-new', 'water-new'];
    }
    return prepared ? [task('electric-new', 0), task('water-new', 1)] : [];
  });
  render(
    <ContractInitialMeterTasks
      contract={contract}
      integrated
      moveInTaskId="handover-1"
      moveInStarted
    />,
  );
  const button = await screen.findByRole('button', { name: 'Chuẩn bị chỉ số đầu kỳ điện và nước' });
  expect(screen.getAllByText('Chưa có bước xác nhận chỉ số đầu kỳ cho hợp đồng này.')).toHaveLength(
    2,
  );
  fireEvent.click(button);
  expect(await screen.findByRole('button', { name: 'Chụp chỉ số công tơ điện' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Chụp chỉ số công tơ nước' })).toBeTruthy();
  const ensureCall = request.mock.calls.find(([url]) =>
    url.includes('/initial-meter-baselines/ensure'),
  );
  expect(ensureCall?.[0]).toBe(
    '/api/v1/operational-tasks/handover-1/initial-meter-baselines/ensure',
  );
  expect(ensureCall?.[1]).toEqual({
    method: 'POST',
    headers: { 'Idempotency-Key': expect.any(String) },
  });
  expect(screen.queryByRole('button', { name: /Chuẩn bị chỉ số đầu kỳ/ })).toBeNull();
});

it('does not permit baseline repair from an unstarted handover', async () => {
  request.mockResolvedValue([]);
  render(
    <ContractInitialMeterTasks
      contract={contract}
      integrated
      moveInTaskId="handover-1"
      moveInStarted={false}
    />,
  );
  await screen.findAllByText('Chưa có bước xác nhận chỉ số đầu kỳ cho hợp đồng này.');
  expect(screen.queryByRole('button', { name: /Chuẩn bị chỉ số đầu kỳ/ })).toBeNull();
  expect(request.mock.calls.every(([url]) => url.includes('/capture/meter-tasks'))).toBe(true);
});

it('preserves the idempotency key across a failed or ambiguous baseline repair', async () => {
  const keys: string[] = [];
  let attempts = 0;
  request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/initial-meter-baselines/ensure')) {
      keys.push(new Headers(init?.headers).get('Idempotency-Key')!);
      attempts += 1;
      if (attempts === 1) throw new Error('Mất kết nối');
      return [];
    }
    return [];
  });
  render(
    <ContractInitialMeterTasks
      contract={contract}
      integrated
      moveInTaskId="handover-1"
      moveInStarted
    />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Chuẩn bị chỉ số đầu kỳ điện và nước' }),
  );
  expect(
    await screen.findByText('Không thể hoàn thành. Kiểm tra kết nối và địa chỉ HTTPS.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chuẩn bị chỉ số đầu kỳ điện và nước' }));
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).toEqual(keys[1]);
  expect(
    await screen.findByText(/Phòng chưa có đủ công tơ điện và nước đang hoạt động/),
  ).toBeTruthy();
});
