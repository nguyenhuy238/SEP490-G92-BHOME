import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IdentityRetentionPanel } from './IdentityRetentionPanel';
const request = vi.hoisted(() => vi.fn());
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const initial = {
  residentId: 'resident',
  reference: 'RETENTION-1',
  policy: { approvedDecisionReference: null, retentionDays: null, startBasis: null },
  startDate: null,
  reviewAfter: null,
  status: 'Restricted',
  canDelete: false,
  blockingReasons: ['retention_policy_unapproved', 'refund_pending'],
  activeHolds: [],
  history: [],
};
let cache: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  request.mockResolvedValue(initial);
});
afterEach(() => {
  cleanup();
  cache.clear();
});
function mount() {
  render(
    <QueryClientProvider client={cache}>
      <IdentityRetentionPanel residentId="resident" />
    </QueryClientProvider>,
  );
}
it('loads only metadata on demand and never offers erasure or an invented duration', async () => {
  mount();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu giữ và rà soát định danh' }));
  await screen.findByText('Chưa có tham chiếu quyết định chính sách được phê duyệt.');
  expect(screen.getByText('Còn nghĩa vụ hoàn tiền chưa hoàn tất.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /xóa|ẩn danh/i })).not.toBeInTheDocument();
  expect(screen.getByText(/Thời hạn: Chưa được duyệt/)).toBeInTheDocument();
});
it('binds consent to the current server context and records a hold without changing identity fields', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu giữ và rà soát định danh' }));
  await screen.findByText('Chưa có rà soát lưu giữ.');
  fireEvent.mouseDown(screen.getByLabelText('Thao tác metadata lưu giữ'));
  fireEvent.click(await screen.findByRole('option', { name: 'Đặt giữ hồ sơ' }));
  fireEvent.change(screen.getByLabelText('Lý do rà soát/giữ hồ sơ'), {
    target: { value: 'Synthetic dispute evidence hold' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  cache.setQueryData(['owner-workspace', 'owner', 'identity-retention', 'resident'], {
    ...initial,
    reference: 'RETENTION-2',
  });
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  expect(screen.getByRole('button', { name: 'Lưu metadata rà soát' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu metadata rà soát' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/api/v1/residents/resident/identity-retention/reviews',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Idempotency-Key': expect.any(String) },
        body: JSON.stringify({
          expectedReference: 'RETENTION-2',
          action: 'PlaceHold',
          holdId: null,
          reason: 'Synthetic dispute evidence hold',
          humanConfirmed: true,
        }),
      }),
    ),
  );
});
