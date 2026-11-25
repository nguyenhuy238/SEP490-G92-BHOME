import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssetReplacementPanel } from './AssetReplacementPanel';
import { invalidateFinance } from '../finance/invalidateFinance';

const api = vi.hoisted(() => ({ replacementReview: vi.fn() }));
vi.mock('./useFinanceApi', () => ({ useFinanceApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const evidence = {
  repairCount: 2,
  repairCost: '100000',
  latestRepairAt: '2026-10-10T00:00:00Z',
  ageMonths: 12,
  carryingValue: null,
  replacementCost: null,
  repairCostPercent: null,
  reasons: ['repeated_repairs', 'depreciation_unknown'],
};
beforeEach(() => {
  vi.resetAllMocks();
  api.replacementReview.mockResolvedValue(evidence);
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssetReplacementPanel expenseId="lot" />
    </QueryClientProvider>,
  );
  return client;
}
it('renders accepted group evidence, unknown carrying value and submitted replacement comparison from the API', async () => {
  mount();
  expect(await screen.findByText(/Số lần nghiệm thu sửa chữa: 2/)).toBeInTheDocument();
  expect(screen.getByText(/Tài sản đã được sửa chữa nhiều lần/)).toBeInTheDocument();
  expect(screen.getByText(/Giá trị còn lại: Chưa xác định/)).toBeInTheDocument();
  expect(screen.getByText(/không phân bổ chi phí riêng cho từng chiếc/)).toBeInTheDocument();
  expect(api.replacementReview).toHaveBeenCalledWith('lot', '', expect.any(AbortSignal));
  api.replacementReview.mockResolvedValue({
    ...evidence,
    replacementCost: '200000',
    repairCostPercent: '50',
    reasons: ['repeated_repairs'],
  });
  fireEvent.change(screen.getByLabelText('Giá mua mới tham khảo (đ)'), {
    target: { value: '200000' },
  });
  expect(screen.getByText(/đang chỉnh sửa, chưa áp dụng/)).toBeInTheDocument();
  expect(api.replacementReview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu' }));
  expect(await screen.findByText(/Tỷ lệ chi phí sửa chữa: 50%/)).toBeInTheDocument();
  expect(screen.queryByText(/đạt ít nhất 50%/)).not.toBeInTheDocument();
  expect(api.replacementReview).toHaveBeenLastCalledWith('lot', '200000', expect.any(AbortSignal));
});
it('rejects zero replacement price, retries failed requests and invalidates the active review', async () => {
  api.replacementReview.mockRejectedValueOnce(new Error('Network'));
  const client = mount();
  await screen.findByRole('button', { name: 'Thử lại' });
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText(/Số lần nghiệm thu sửa chữa: 2/);
  fireEvent.change(screen.getByLabelText('Giá mua mới tham khảo (đ)'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: 'Đối chiếu' })).toBeDisabled();
  await invalidateFinance(client, 'owner', 'location');
  expect(api.replacementReview).toHaveBeenCalledTimes(3);
});
