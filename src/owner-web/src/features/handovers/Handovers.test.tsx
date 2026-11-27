import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi, beforeEach } from 'vitest';
import HandoversPage from './pages/HandoversPage';

const mocks = vi.hoisted(() => ({
  transport: vi.fn(),
  locations: vi.fn(),
  rooms: vi.fn(),
  action: vi.fn(),
}));

vi.mock('../contracts/useContractsApi', () => ({
  useContractsApi: () => ({
    transport: mocks.transport,
    locations: mocks.locations,
    rooms: mocks.rooms,
  }),
}));
vi.mock('../contracts/OwnerHandoverDraftPanel', () => ({
  OwnerHandoverDraftPanel: ({
    id,
    compact,
    onChanged,
  }: {
    id: string;
    compact?: boolean;
    onChanged?: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        mocks.action();
        onChanged?.();
      }}
    >
      Biên bản chi tiết {id} {compact ? 'dạng gọn' : ''}
    </button>
  ),
}));
vi.mock('./OwnerMoveOutInbox', () => ({
  OwnerMoveOutInbox: () => <div>Danh sách kiểm tra trả phòng</div>,
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));

const entries = [
  {
    contractId: 'contract-1',
    locationId: 'location-1',
    locationName: 'Cơ sở Trường Vũ',
    roomNumber: 'P.101',
    status: 'PendingOwnerReview',
    startDate: '2026-11-19',
    staffSubmittedAt: '2026-11-20T08:30:00Z',
    ownerReadyAt: null,
    tenantConfirmedAt: null,
  },
  {
    contractId: 'contract-2',
    locationId: 'location-1',
    locationName: 'Cơ sở Trường Vũ',
    roomNumber: 'P.102',
    status: 'Ready',
    startDate: '2026-11-21',
    staffSubmittedAt: '2026-11-20T08:30:00Z',
    ownerReadyAt: '2026-11-21T08:30:00Z',
    tenantConfirmedAt: null,
  },
];

function mount(path = '/handovers') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={cache}>
        <HandoversPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.transport.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/contracts/handovers/rooms?'))
      return path.includes('location-1')
        ? [{ id: 'room-2', label: 'P.102' }]
        : [{ id: 'room-3', label: 'P.201' }];
    return { items: entries, page: 1, pageSize: 10, totalCount: entries.length };
  });
  mocks.locations.mockReset().mockResolvedValue([
    { id: 'location-1', label: 'Cơ sở Trường Vũ' },
    { id: 'location-2', label: 'Cơ sở khác' },
  ]);
  mocks.rooms
    .mockReset()
    .mockImplementation(async (location: string) =>
      location === 'location-1'
        ? [{ id: 'room-2', label: 'P.102' }]
        : [{ id: 'room-3', label: 'P.201' }],
    );
  mocks.action.mockReset();
});

it('loads move-in handover list immediately, opens a compact right Drawer, and keeps contract deep link', async () => {
  mount();
  expect(await screen.findByText('2 biên bản phù hợp')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Bộ lọc' })).toContainElement(
    screen.getByRole('button', { name: 'Tải lại' }),
  );
  expect(screen.getByText('Trang 1 / 1')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Danh sách biên bản bàn giao' })).toBeInTheDocument();
  expect(screen.getAllByText('Phòng P.101').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Phòng P.102').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Kỳ thuê từ 19\/11\/2026/).length).toBeGreaterThan(0);
  expect(mocks.transport).toHaveBeenCalledWith('/api/v1/contracts/handovers?page=1&pageSize=10', {
    signal: expect.any(AbortSignal),
  });

  fireEvent.click(screen.getAllByRole('button', { name: 'Xem chi tiết' })[0]);
  expect(await screen.findByText('Biên bản chi tiết contract-1 dạng gọn')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Mở hồ sơ hợp đồng' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết' }));
  expect(screen.queryByText('Biên bản chi tiết contract-1 dạng gọn')).not.toBeInTheDocument();
});

it('shows a handover task to Owner before Staff has completed any draft', async () => {
  mocks.transport.mockResolvedValue({
    items: [{ ...entries[0], status: 'Draft', staffSubmittedAt: null }],
    page: 1,
    pageSize: 10,
    totalCount: 1,
  });
  mount();
  expect(await screen.findByText('1 biên bản phù hợp')).toBeInTheDocument();
  expect(screen.getAllByText('Đang kiểm tra bàn giao').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Chờ nhân viên hoàn thành').length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem chi tiết' })[0]);
  expect(await screen.findByText('Biên bản chi tiết contract-1 dạng gọn')).toBeInTheDocument();
});

it('separates Bàn giao and Trả phòng without navigating away from /handovers', async () => {
  mount();
  await screen.findByText('2 biên bản phù hợp');
  fireEvent.click(screen.getByRole('tab', { name: 'Trả phòng' }));
  expect(await screen.findByText('Danh sách kiểm tra trả phòng')).toBeInTheDocument();
  expect(screen.queryByText('2 biên bản phù hợp')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Bàn giao' }));
  expect(await screen.findByText('2 biên bản phù hợp')).toBeInTheDocument();
});

it('shows confirmed handovers as green success instead of neutral gray', async () => {
  const confirmed = {
    ...entries[1],
    status: 'Confirmed',
    tenantConfirmedAt: '2026-11-21T09:00:00Z',
  };
  mocks.transport.mockResolvedValue({ items: [confirmed], page: 1, pageSize: 10, totalCount: 1 });
  mount();
  expect(await screen.findByText('1 biên bản phù hợp')).toBeInTheDocument();
  expect(screen.getAllByText('Hoàn tất')).toHaveLength(2);
  for (const label of screen.getAllByText('Hoàn tất')) {
    expect(label.closest('[data-status-tone]')).toHaveAttribute('data-status-tone', 'success');
  }
});

it('filters status, location and room on the backend instead of filtering only one contract page', async () => {
  mount();
  await screen.findByText('2 biên bản phù hợp');

  expect(screen.getByRole('combobox', { name: 'Phòng' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái biên bản' }));
  fireEvent.click(screen.getByRole('option', { name: 'Chờ chủ trọ xử lý' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=10&stage=Owner',
      { signal: expect.any(AbortSignal) },
    ),
  );

  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(screen.getByRole('option', { name: 'Cơ sở Trường Vũ' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=10&locationId=location-1&stage=Owner',
      { signal: expect.any(AbortSignal) },
    ),
  );

  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Phòng' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phòng' }));
  expect(screen.queryByRole('option', { name: 'P.101' })).not.toBeInTheDocument();
  expect(mocks.transport).toHaveBeenCalledWith(
    '/api/v1/contracts/handovers/rooms?locationId=location-1',
    { signal: expect.any(AbortSignal) },
  );
  expect(mocks.rooms).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: 'P.102' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=10&locationId=location-1&stage=Owner&roomId=room-2',
      { signal: expect.any(AbortSignal) },
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(screen.getByRole('option', { name: 'Cơ sở khác' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=10&locationId=location-2&stage=Owner',
      { signal: expect.any(AbortSignal) },
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Phòng' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phòng' }));
  expect(screen.getByRole('option', { name: 'P.201' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'P.102' })).not.toBeInTheDocument();
});

it('supports deep-linked report without selecting a location or room, and refreshes the inbox after detail action', async () => {
  mount('/handovers?contractId=synthetic-contract');
  expect(
    await screen.findByText('Biên bản chi tiết synthetic-contract dạng gọn'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Mở hồ sơ hợp đồng' })).not.toBeInTheDocument();
  await screen.findByText('2 biên bản phù hợp');
  const calls = mocks.transport.mock.calls.length;
  fireEvent.click(
    screen.getByRole('button', { name: 'Biên bản chi tiết synthetic-contract dạng gọn' }),
  );
  await waitFor(() => expect(mocks.transport.mock.calls.length).toBeGreaterThan(calls));
  expect(mocks.action).toHaveBeenCalledOnce();
});

it('paginates handovers from the server and resets to the first page for a changed status filter', async () => {
  mocks.transport.mockImplementation(async (path: string) => ({
    items: path.includes('page=2') ? [entries[1]] : [entries[0]],
    page: path.includes('page=2') ? 2 : 1,
    pageSize: 10,
    totalCount: 15,
  }));
  mount();
  expect(await screen.findByText('15 biên bản phù hợp')).toBeInTheDocument();
  expect(screen.getByText('Trang 1 / 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith('/api/v1/contracts/handovers?page=2&pageSize=10', {
      signal: expect.any(AbortSignal),
    }),
  );
  expect(await screen.findByText('Trang 2 / 2')).toBeInTheDocument();
  expect(screen.getAllByText('Phòng P.102').length).toBeGreaterThan(0);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái biên bản' }));
  fireEvent.click(screen.getByRole('option', { name: 'Chờ chủ trọ xử lý' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=10&stage=Owner',
      { signal: expect.any(AbortSignal) },
    ),
  );
});

it('shows a recoverable server error rather than a fabricated handover list', async () => {
  mocks.transport.mockRejectedValue(new Error('failed'));
  mount();
  expect(await screen.findByText(/Không tải được danh sách biên bản/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(
    screen.queryByRole('table', { name: 'Danh sách biên bản bàn giao' }),
  ).not.toBeInTheDocument();
});
