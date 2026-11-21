import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PersonalDataRequestsPanel } from './PersonalDataRequestsPanel';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../meters/useMeterApi', () => ({ useMeterApi: () => ({ request }) }));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
it('keeps the decision and basis after a stale response without claiming success', async () => {
  request.mockImplementation((path: string) =>
    path.endsWith('/decisions')
      ? Promise.reject({ status: 409 })
      : Promise.resolve({
          items: [
            {
              id: 'request',
              requestedBy: 'tenant',
              requesterLabel: 'Synthetic tenant',
              requestType: 'Deletion',
              description: 'Synthetic retention review',
              status: 'Pending',
              version: 2,
              requestedAt: '2026-11-16T03:00:00Z',
              history: [],
            },
          ],
          totalCount: 1,
        }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PersonalDataRequestsPanel />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Xem xét yêu cầu' }));
  fireEvent.change(screen.getByLabelText(/Phản hồi \/ hành động/), {
    target: { value: 'Đang rà soát dữ liệu cần lưu.' },
  });
  fireEvent.change(screen.getByLabelText(/Căn cứ và phạm vi/), {
    target: { value: 'Căn cứ tổng hợp thử nghiệm.' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Lưu phản hồi' }).closest('form')!);
  expect(await screen.findByText(/Dữ liệu đã thay đổi/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Căn cứ và phạm vi/)).toHaveValue('Căn cứ tổng hợp thử nghiệm.');
});
