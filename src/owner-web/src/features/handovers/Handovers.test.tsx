import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi, beforeEach } from 'vitest';
import HandoversPage from './pages/HandoversPage';

const mocks = vi.hoisted(() => ({
  transport: vi.fn(),
  locations: vi.fn(),
  action: vi.fn(),
}));

vi.mock('../contracts/useContractsApi', () => ({
  useContractsApi: () => ({ transport: mocks.transport, locations: mocks.locations }),
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
  mocks.transport.mockReset().mockImplementation(async () => ({
    items: entries,
    page: 1,
    pageSize: 20,
    totalCount: entries.length,
  }));
  mocks.locations.mockReset().mockResolvedValue([{ id: 'location-1', label: 'Cơ sở Trường Vũ' }]);
  mocks.action.mockReset();
});

it('loads move-in handover list immediately, opens a compact right Drawer, and keeps contract deep link', async () => {
  mount();
  expect(await screen.findByText('2 biên bản phù hợp')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Danh sách biên bản bàn giao' })).toBeInTheDocument();
  expect(screen.getAllByText('Phòng P.101').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Phòng P.102').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Kỳ thuê từ 19\/11\/2026/).length).toBeGreaterThan(0);
  expect(mocks.transport).toHaveBeenCalledWith('/api/v1/contracts/handovers?page=1&pageSize=20', {
    signal: expect.any(AbortSignal),
  });

  fireEvent.click(screen.getAllByRole('button', { name: 'Xem chi tiết' })[0]);
  expect(await screen.findByText('Biên bản chi tiết contract-1 dạng gọn')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở hồ sơ hợp đồng' })).toHaveAttribute(
    'href',
    '/contracts?contractId=contract-1',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết' }));
  expect(screen.queryByText('Biên bản chi tiết contract-1 dạng gọn')).not.toBeInTheDocument();
});

it('shows confirmed handovers as green success instead of neutral gray', async () => {
  const confirmed = {
    ...entries[1],
    status: 'Confirmed',
    tenantConfirmedAt: '2026-11-21T09:00:00Z',
  };
  mocks.transport.mockResolvedValue({ items: [confirmed], page: 1, pageSize: 20, totalCount: 1 });
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

  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái biên bản' }));
  fireEvent.click(screen.getByRole('option', { name: 'Chờ Owner duyệt' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=20&status=PendingOwnerReview',
      { signal: expect.any(AbortSignal) },
    ),
  );

  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(screen.getByRole('option', { name: 'Cơ sở Trường Vũ' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=20&locationId=location-1&status=PendingOwnerReview',
      { signal: expect.any(AbortSignal) },
    ),
  );

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm phòng' }), {
    target: { value: 'P.102' },
  });
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=20&locationId=location-1&status=PendingOwnerReview&room=P.102',
      { signal: expect.any(AbortSignal) },
    ),
  );
});

it('supports deep-linked report without selecting a location or room, and refreshes the inbox after detail action', async () => {
  mount('/handovers?contractId=synthetic-contract');
  expect(
    await screen.findByText('Biên bản chi tiết synthetic-contract dạng gọn'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở hồ sơ hợp đồng' })).toHaveAttribute(
    'href',
    '/contracts?contractId=synthetic-contract',
  );
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
    pageSize: 20,
    totalCount: 21,
  }));
  mount();
  expect(await screen.findByText('21 biên bản phù hợp')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith('/api/v1/contracts/handovers?page=2&pageSize=20', {
      signal: expect.any(AbortSignal),
    }),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái biên bản' }));
  fireEvent.click(screen.getByRole('option', { name: 'Chờ Owner duyệt' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/handovers?page=1&pageSize=20&status=PendingOwnerReview',
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
