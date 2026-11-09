import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

const request = vi.fn(async (path: string) => ({
  totalCount: path.includes('roomStatus=2') ? 7 : path.includes('roomStatus=0') ? 2 : 10,
}));
vi.mock('../../property-api/propertyApi', async (original) => ({
  ...(await original<typeof import('../../property-api/propertyApi')>()),
  usePropertyApi: () => ({ locations: async () => ({ totalCount: 3 }), request }),
}));
import LiveDashboardPage from './LiveDashboardPage';

it('loads full server-side counts rather than counting a truncated page', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <LiveDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('7')).toBeInTheDocument();
  expect(screen.getByText('10')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(
    '/api/v1/rooms?page=1&pageSize=1&roomStatus=2',
    expect.anything(),
  );
});
