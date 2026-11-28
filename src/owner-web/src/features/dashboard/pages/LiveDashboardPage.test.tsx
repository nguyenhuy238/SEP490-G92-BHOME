import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
vi.mock('../../../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
import DashboardPage from './DashboardPage';

const response = (path: string) =>
  path.includes('financial-reports')
    ? {
        total: {
          issued: '5000000',
          verifiedCollections: '4000000',
          outstandingNow: '2000000',
          operatingExpenses: '125000',
          management: { actualBusinessCollections: '3000000', currentOutstanding: '2000000' },
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
  request.mockImplementation(async (path: string) =>
    path.includes('owner-attention')
      ? {
          unsafeEquipment: 2,
          expiredLegalRecords: 0,
          overdueTaxPeriods: 1,
          pendingPersonalDataRequests: 3,
        }
      : response(path),
  );
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

it('keeps lifecycle follow-up after business metrics with links and server counts', async () => {
  mount();
  const attention = screen.getByRole('region', { name: 'Hồ sơ và thiết bị cần chú ý' });
  expect(
    screen.getByRole('region', { name: 'Tình hình kinh doanh' }).compareDocumentPosition(attention),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  const links = within(attention);
  expect(await links.findByRole('link', { name: 'Thiết bị không được sử dụng 2' })).toHaveAttribute(
    'href',
    '/assets',
  );
  expect(links.getByRole('link', { name: 'Hồ sơ quá ngày hết hạn ghi nhận 0' })).toHaveAttribute(
    'href',
    '/locations',
  );
  expect(links.getByRole('link', { name: 'Kỳ thuế quá hạn theo dõi 1' })).toHaveAttribute(
    'href',
    '/finance/tax-records',
  );
  expect(links.getByRole('link', { name: 'Yêu cầu dữ liệu chờ xử lý 3' })).toHaveAttribute(
    'href',
    '/account/profile',
  );
});

it('retries lifecycle failures and preserves missing counts as unknown', async () => {
  let failAttention = true;
  request.mockImplementation(async (path: string) => {
    if (path.includes('owner-attention')) {
      if (failAttention) throw new Error('Synthetic attention unavailable');
      return { unsafeEquipment: 0 };
    }
    return response(path);
  });
  mount();
  const attention = within(screen.getByRole('region', { name: 'Hồ sơ và thiết bị cần chú ý' }));
  expect(await attention.findByRole('alert')).toHaveTextContent('Chưa tải được dữ liệu cần chú ý.');
  expect(attention.queryByRole('link')).not.toBeInTheDocument();
  failAttention = false;
  fireEvent.click(attention.getByRole('button', { name: 'Thử lại' }));
  expect(
    await attention.findByRole('link', { name: 'Thiết bị không được sử dụng 0' }),
  ).toBeInTheDocument();
  expect(attention.getAllByText('—')).toHaveLength(3);
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
