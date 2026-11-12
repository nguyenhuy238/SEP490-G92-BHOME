import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import DigitalSigningPage from './pages/DigitalSigningPage';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
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
  mocks.list.mockReset();
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
      },
    ],
    totalCount: 1,
  });
});
function mount() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DigitalSigningPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('starts with pending signing contracts and opens the existing review instead of exposing credentials', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
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
