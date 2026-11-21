import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { businessToday } from '../../../../../packages/client-core/src/contracts';
import { InitialMeterTask } from './InitialMeterTask';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./useMeterApi', () => ({ useMeterApi: () => mocks }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));

beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { id: 'initial-task' };
    if (path.endsWith('/meters'))
      return [
        { id: 'electricity', label: 'TEST ELECTRICITY', parentId: 'room' },
        { id: 'foreign', label: 'OTHER ROOM METER', parentId: 'other-room' },
      ];
    if (path.startsWith('/api/v1/staff-location-assignments'))
      return [{ staffUserId: 'staff', startDate: '2020-01-01', endDate: '2099-01-01' }];
    return [{ id: 'staff', label: 'Staff JOB09' }];
  });
});
afterEach(cleanup);

function show(location = 'location', room = 'room') {
  const created = vi.fn();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <InitialMeterTask location={location} room={room} created={created} />
    </QueryClientProvider>,
  );
  return created;
}

async function selectMeter() {
  fireEvent.click(screen.getByRole('button', { name: 'Giao nhiệm vụ ghi chỉ số ban đầu' }));
  await screen.findByText(/Staff JOB09/);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Công tơ ghi chỉ số ban đầu' }));
  expect(screen.queryByRole('option', { name: 'OTHER ROOM METER' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: 'TEST ELECTRICITY' }));
}

it('requires Location and Room selection before opening creation', () => {
  show('', '');
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ ghi chỉ số ban đầu' })).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('creates an Initial task with no billing period and refreshes the selected task', async () => {
  const created = show();
  await selectMeter();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo nhiệm vụ ban đầu' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith('initial-task'));
  const post = mocks.request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toBe('/api/v1/capture/meter-tasks');
  expect(JSON.parse(post[1].body)).toEqual({
    meterId: 'electricity',
    purpose: 0,
    readingDate: businessToday(),
    billingPeriod: null,
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Đã tạo nhiệm vụ');
});

it('keeps the form open and explains a backend duplicate conflict', async () => {
  const created = show();
  await selectMeter();
  mocks.request.mockRejectedValueOnce({ status: 409, code: 'duplicate_or_conflicting_record' });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo nhiệm vụ ban đầu' }));
  await screen.findByText(/Công tơ đã có nhiệm vụ ban đầu/);
  expect(created).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('requires a reading date before posting a task', async () => {
  show();
  await selectMeter();
  fireEvent.change(screen.getByLabelText('Ngày ghi chỉ số ban đầu'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Tạo nhiệm vụ ban đầu' })).toBeDisabled();
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('keeps creation disabled when no current Staff assignment is available', async () => {
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path.startsWith('/api/v1/staff-location-assignments')
      ? Promise.resolve([])
      : request(path, init),
  );
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Giao nhiệm vụ ghi chỉ số ban đầu' }));
  await screen.findByText(/Chưa có Staff đang hoạt động/);
  expect(screen.getByRole('button', { name: 'Tạo nhiệm vụ ban đầu' })).toBeDisabled();
});
