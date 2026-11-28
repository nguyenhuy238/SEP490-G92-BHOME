import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import ContractsPage from './pages/ContractsPage';
const mocks = vi.hoisted(() => ({ list: vi.fn(), locations: vi.fn(), expiryReminders: vi.fn() }));
vi.mock('./hooks/useContractsApi', () => ({
  useContractsApi: () => mocks,
  useSigningApi: () => ({}),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('./components/detail/ContractDetailPanel', () => ({
  ContractDetailPanel: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <>
      <span>Reviewed {id}</span>
      <button onClick={onClose}>Đóng chi tiết hợp đồng</button>
    </>
  ),
}));
beforeEach(() => {
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mocks.list.mockReset();
  mocks.locations.mockResolvedValue([]);
  mocks.expiryReminders.mockResolvedValue([]);
  mocks.list.mockResolvedValue({
    items: [
      {
        id: 'contract',
        locationId: 'location',
        locationName: 'Synthetic',
        roomNumber: 'P101',
        kind: 'Main',
        status: 'PendingSigning',
        startDate: '2026-11-01',
        endDate: '2027-11-01',
        monthlyRent: '3000000',
      },
    ],
    totalCount: 1,
  });
});
function mount(element = <ContractsPage />) {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {element}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('keeps the real contract identity, status, rent and review action visible on mobile', async () => {
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches: query.includes('max-width:599px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mount(<ContractsPage />);
  const table = await screen.findByRole('table', { name: 'Danh sách hợp đồng' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
  const identity = within(table).getByRole('rowheader');
  expect(within(identity).getByText('Phòng P101')).toBeVisible();
  expect(within(identity).getByText('3.000.000 ₫')).toBeVisible();
  expect(within(identity).getByText('Chờ ký')).toBeVisible();
  fireEvent.click(within(table).getByRole('button', { name: 'Chi tiết' }));
  expect(await screen.findByText('Reviewed contract')).toBeVisible();
  expect(mocks.list).toHaveBeenCalledWith(1, '', '', expect.any(AbortSignal), '', 10);
});

it('paginates ten contracts and resets to the first page when changing kind', async () => {
  const data = await mocks.list();
  mocks.list.mockClear();
  mocks.list.mockResolvedValue({
    ...data,
    pageSize: 10,
    totalCount: 25,
    items: data.items.map((item: Record<string, unknown>) => ({
      ...item,
      representativeName: 'Người đại diện kiểm thử',
    })),
  });
  mount(<ContractsPage />);
  expect(await screen.findByText('Người đại diện kiểm thử')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /go to page 2/i }));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenCalledWith(2, '', '', expect.any(AbortSignal), '', 10),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Giữ chỗ' }));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenCalledWith(1, '', '', expect.any(AbortSignal), 'Holding', 10),
  );
});

it('opens deep links, reacts to browser history and removes only detail parameters on close', async () => {
  let navigate!: ReturnType<typeof useNavigate>;
  function HistoryProbe() {
    navigate = useNavigate();
    return <output data-testid="query">{useLocation().search}</output>;
  }
  render(
    <MemoryRouter initialEntries={['/contracts?contractId=first&filter=keep']}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <HistoryProbe />
        <ContractsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Reviewed first')).toBeVisible();
  await act(async () => navigate('/contracts?contractId=second&filter=keep'));
  expect(await screen.findByText('Reviewed second')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết hợp đồng' }));
  await waitFor(() => expect(screen.getByTestId('query')).toHaveTextContent('?filter=keep'));
  expect(screen.getByTestId('query')).not.toHaveTextContent('contractId');
  await act(async () => navigate(-1));
  expect(await screen.findByText('Reviewed second')).toBeVisible();
  await act(async () => navigate(-1));
  expect(await screen.findByText('Reviewed first')).toBeVisible();
});
