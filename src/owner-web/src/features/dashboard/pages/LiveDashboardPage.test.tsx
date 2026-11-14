import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('../../property-api/propertyApi', async (original) => ({
  ...(await original<typeof import('../../property-api/propertyApi')>()),
  usePropertyApi: () => ({ locations: async () => ({ totalCount: 3 }), request }),
}));
vi.mock('../../../services/config', () => ({ isMockMode: false }));
import DashboardPage from './DashboardPage';

const response = (path: string) =>
  path.includes('financial-reports')
    ? {
        total: {
          issued: '5000000',
          verifiedCollections: '3000000',
          outstandingNow: '2000000',
          operatingExpenses: '125000',
        },
      }
    : {
        totalCount: path.includes('roomStatus=2')
          ? 7
          : path.includes('roomStatus=0')
            ? 2
            : path.includes('roomStatus=1')
              ? 1
              : path.includes('roomStatus=3')
                ? 0
                : 10,
      };
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path: string) => response(path));
});
afterEach(cleanup);

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('loads full server-side counts rather than counting a truncated page', async () => {
  mount();
  const section = within(screen.getByRole('region', { name: 'Tình hình khai thác' }));
  expect(await section.findByText('7')).toBeInTheDocument();
  expect(section.getByText('10')).toBeInTheDocument();
  expect(screen.getByText('70% đang cho thuê')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Đang cho thuê: 7.*Phòng trống: 2/ })).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(
    '/api/v1/rooms?page=1&pageSize=1&roomStatus=2',
    expect.anything(),
  );
  expect(request).toHaveBeenCalledWith(
    '/api/v1/rooms?page=1&pageSize=1&roomStatus=1',
    expect.anything(),
  );
  expect(await screen.findByText('3.000.000 ₫')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Quản lý cơ sở' })).toHaveAttribute('href', '/locations');
  expect(screen.queryByText(/DỮ LIỆU MÔ PHỎNG/)).not.toBeInTheDocument();
});

it('keeps unknown finance and inconsistent room counts distinct from zero', async () => {
  request.mockImplementation(async (path: string) => {
    if (path.includes('financial-reports')) throw new Error('Synthetic finance unavailable');
    if (path.includes('roomStatus=3')) return { totalCount: 5 };
    return response(path);
  });
  mount();
  expect(await screen.findByText('Chưa đủ số liệu')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  const finance = within(screen.getByRole('region', { name: 'Tình hình kinh doanh' }));
  expect(await finance.findByRole('alert')).toBeInTheDocument();
  expect(finance.getAllByText('—')).toHaveLength(4);
});
