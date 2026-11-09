import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { TenantsApiPage } from './TenantsApiPage';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const person = {
  id: 'resident',
  roomId: 'room',
  roomNumber: 'Synthetic room',
  displayLabel: 'Synthetic resident',
  residentType: 'CoOccupant',
  verificationStatus: 'Pending',
  version: 'a'.repeat(64),
  tenancies: [],
  tenantUserId: null,
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/residents/resident'
      ? person
      : path.includes('/preparation/accounts')
        ? []
        : { items: path.startsWith('/api/v1/residents?') ? [person] : [], totalCount: 1 },
  );
});
function mount() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TenantsApiPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('forwards paginated search to administration and keeps identity confirmation out of Owner actions', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Tìm tên hiển thị'), { target: { value: 'synthetic' } });
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('search=synthetic'),
      expect.anything(),
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  expect(await screen.findByText(/không hiển thị CCCD/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xác nhận định danh' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gửi lời mời Tenant' })).toBeDisabled();
});
it('updates only the workspace label with its reviewed version and reason', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  fireEvent.change(await screen.findByLabelText('Tên hiển thị hồ sơ'), {
    target: { value: 'Updated label' },
  });
  fireEvent.change(screen.getByLabelText('Lý do chỉnh sửa'), {
    target: { value: 'Synthetic correction' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tên hiển thị' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/residents/resident/workspace-label',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          displayLabel: 'Updated label',
          version: 'a'.repeat(64),
          reason: 'Synthetic correction',
        }),
      }),
    ),
  );
});
