import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import DigitalSigningPage from './pages/DigitalSigningPage';
import ContractsPage from './pages/ContractsPage';
const mocks = vi.hoisted(() => ({ list: vi.fn(), locations: vi.fn(), expiryReminders: vi.fn() }));
vi.mock('./useContractsApi', () => ({ useContractsApi: () => mocks, useSigningApi: () => ({}) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('./ContractDetailPanel', () => ({
  ContractDetailPanel: ({ id }: { id: string }) => <span>Reviewed {id}</span>,
}));
vi.mock('./ViettelSettingsPanel', () => ({
  ViettelSettingsPanel: () => <span>Restricted settings fixture</span>,
}));
vi.mock('./SigningCertificates', () => ({ SigningCertificates: () => null }));
vi.mock('./SignatureImagePanel', () => ({ SignatureImagePanel: () => null }));
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
function mount(element = <DigitalSigningPage />) {
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
it('starts with pending signing contracts and opens the existing review instead of exposing credentials', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Mở hồ sơ ký' }));
  expect(screen.getByText('Reviewed contract')).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledWith(1, 'PendingSigning', '', expect.any(AbortSignal));
  expect(screen.queryByText('Restricted settings fixture')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Cấu hình tích hợp MySign' }));
  expect(screen.getByText('Restricted settings fixture')).toBeInTheDocument();
});
it('shows failed retrieval as an error and retries without a false empty list', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Synthetic unavailable'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Synthetic · Phòng P101')).toBeInTheDocument();
});
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
  expect(mocks.list).toHaveBeenCalledWith(1, '', '', expect.any(AbortSignal));
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
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.getByTestId('query')).toHaveTextContent('?filter=keep'));
  expect(screen.getByTestId('query')).not.toHaveTextContent('contractId');
  await act(async () => navigate(-1));
  expect(await screen.findByText('Reviewed second')).toBeVisible();
  await act(async () => navigate(-1));
  expect(await screen.findByText('Reviewed first')).toBeVisible();
});
