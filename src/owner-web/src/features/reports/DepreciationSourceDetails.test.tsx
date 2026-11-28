import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { DepreciationSourceDetails } from './DepreciationSourceDetails';
import { invalidateFinance } from '../finance/invalidateFinance';

const api = vi.hoisted(() => ({ depreciationSources: vi.fn(), expense: vi.fn() }));
vi.mock('../expenses/useFinanceApi', () => ({ useFinanceApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
vi.mock('../expenses/ExpenseFinanceActions', () => ({
  ExpenseFinanceActions: ({ expense }: { expense: { id: string } }) => (
    <div>Hồ sơ {expense.id}</div>
  ),
}));
const filter = { from: '2026-10-01', to: '2026-10-31', locationId: 'location', roomId: 'room' };
const lot = {
  expenseId: 'lot',
  locationId: 'location',
  roomId: 'room',
  assetId: 'asset',
  name: 'Giường',
  cost: '180000000',
  quantity: 2,
  purchasedOn: '2026-10-01',
  amounts: {
    period: '15000000',
    monthly: '15000000',
    accumulated: '15000000',
    carryingValue: '165000000',
  },
};
const source = {
  items: [lot],
  total: 2,
  page: 1,
  pageSize: 1,
  totalAmount: '15000000',
  knownAmount: '15000000',
  unknownLots: 0,
  snapshotAt: '2026-11-01T00:00:00Z',
};
beforeEach(() => {
  vi.resetAllMocks();
  api.depreciationSources.mockResolvedValue(source);
  api.expense.mockResolvedValue({ id: 'lot', category: 'Giường', amount: lot.cost });
});
function mount(expected: string | null = '15000000') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DepreciationSourceDetails filter={filter} expected={expected} />
    </QueryClientProvider>,
  );
  return client;
}
it('loads exact report scope and opens the actual lot by expense ID', async () => {
  mount();
  await screen.findByText('Giường');
  expect(api.depreciationSources).toHaveBeenCalledWith(filter, 1, expect.any(AbortSignal));
  expect(screen.getByText(/Lũy kế đến cuối kỳ/)).toHaveTextContent('165');
  fireEvent.click(screen.getByRole('button', { name: 'Mở lô đầu tư' }));
  expect(await screen.findByText('Hồ sơ lot')).toBeInTheDocument();
  expect(api.expense).toHaveBeenCalledWith('lot', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  api.depreciationSources.mockResolvedValue({ ...source, page: 2, items: [] });
  fireEvent.click(await screen.findByRole('button', { name: 'Trang sau' }));
  expect(await screen.findByText('Trang 2')).toBeInTheDocument();
  expect(api.depreciationSources).toHaveBeenLastCalledWith(filter, 2, expect.any(AbortSignal));
});
it('keeps unknown totals visible, retries and invalidates the source cache', async () => {
  api.depreciationSources.mockRejectedValueOnce(new Error('Network')).mockResolvedValue({
    ...source,
    totalAmount: null,
    unknownLots: 1,
    items: [{ ...lot, amounts: null }],
  });
  const client = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText(/Chưa đủ dữ liệu khấu hao/)).toBeInTheDocument();
  expect(screen.getByText(/Nguồn hiện tại khác báo cáo/)).toBeInTheDocument();
  await invalidateFinance(client, 'owner', 'location');
  expect(api.depreciationSources).toHaveBeenCalledTimes(3);
});
