import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import HandoversPage from './pages/HandoversPage';
vi.mock('../contracts/useContractsApi', () => ({ useContractsApi: () => ({}) }));
vi.mock('../contracts/ContractHandoverPanel', () => ({
  ContractHandoverPanel: ({ id }: { id: string }) => <span>Handover {id}</span>,
}));
vi.mock('../meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }) }),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
it('opens a linked handover without requiring manual UUID entry and links back to its contract', () => {
  render(
    <MemoryRouter initialEntries={['/handovers?contractId=synthetic-contract']}>
      <QueryClientProvider client={new QueryClient()}>
        <HandoversPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(screen.getByText('Handover synthetic-contract')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở hợp đồng và kiểm tra trả phòng' })).toHaveAttribute(
    'href',
    '/contracts?contractId=synthetic-contract',
  );
  expect(screen.queryByLabelText(/UUID/)).not.toBeInTheDocument();
});
