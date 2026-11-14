import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../../packages/client-core/src/propertySetup';
import { LocationRoomHistory } from './LocationApiWorkspace';

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () => propertySetupClient(state.request),
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));

beforeEach(() => {
  state.request.mockReset();
  state.request.mockImplementation(async (path: string) => {
    if (path.includes('/capture/locations/')) return [{ id: 'room-1', label: 'P.101' }];
    if (path.includes('/history?'))
      return {
        items: [
          {
            id: 'event',
            eventType: 'RoomStatusOrConfiguration',
            source: 'PropertyAudit',
            summary: 'Created',
            occurredAt: '2026-11-01T03:00:00Z',
          },
        ],
        limitations: [],
        totalCount: 1,
      };
    throw new Error('Unexpected request');
  });
});
afterEach(cleanup);

function mount(path: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <LocationRoomHistory locationId="location" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('uses a Location-scoped room option and server-side filters in history', async () => {
  mount('/history?roomId=room-1&eventType=RoomStatusOrConfiguration&from=2026-11-01&to=2026-11-13');
  expect(await screen.findByText('Tạo phòng')).toBeInTheDocument();
  expect(
    state.request.mock.calls.some(
      ([path]) =>
        path.includes('/rooms/room-1/history?') &&
        path.includes('from=2026-11-01') &&
        path.includes('eventType=RoomStatusOrConfiguration'),
    ),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-10-31' } });
  expect(screen.getByText('Khoảng ngày không hợp lệ')).toBeInTheDocument();
  expect(screen.queryByText('Tạo phòng')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path]) => path === '/api/v1/rooms/room-1/history?page=1&pageSize=20',
      ),
    ).toBe(true),
  );
});

it('does not load a foreign room from a direct URL', async () => {
  mount('/history?roomId=foreign-room');
  expect(await screen.findByText(/Phòng không có trong danh sách/)).toBeInTheDocument();
  expect(state.request.mock.calls.some(([path]) => path.includes('/history?'))).toBe(false);
});
