import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveNotificationsPage } from './pages/NotificationsPage';
import { ownerNotificationRoute } from '../../../../../packages/client-core/src/notifications';
const id = '00000000-0000-4000-8000-000000000001';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  readAll: vi.fn(),
  target: vi.fn(),
}));
vi.mock('./useNotifications', () => ({
  useNotifications: () => mocks,
  useUnreadNotifications: () => ({ data: { unreadCount: 1 }, refetch: vi.fn() }),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function Location() {
  return <span data-testid="route">{useLocation().search}</span>;
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <LiveNotificationsPage />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('marks the recipient notification and resolves its authorized invoice before navigation', async () => {
  mocks.list.mockResolvedValue({
    items: [
      {
        id,
        title: 'Hóa đơn kỳ tổng hợp',
        summary: 'Hóa đơn đã phát hành',
        category: 'Invoice',
        createdAt: '2026-11-02T00:00:00Z',
        readAt: null,
      },
    ],
    totalCount: 1,
  });
  mocks.target.mockResolvedValue({ objectType: 'Invoice', objectId: id });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Mở hồ sơ liên quan' }));
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(id));
  await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('invoiceId=' + id));
});
it('keeps the inbox visible when opening a revoked target fails', async () => {
  mocks.list.mockResolvedValue({
    items: [
      {
        id,
        title: 'Công việc',
        summary: 'Cập nhật',
        category: 'Task',
        createdAt: '2026-11-02T00:00:00Z',
        readAt: null,
      },
    ],
    totalCount: 1,
  });
  mocks.target.mockRejectedValue(new Error('404'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Mở hồ sơ liên quan' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.getByTestId('route')).toBeEmptyDOMElement();
});
it('rejects arbitrary URLs, malformed identifiers and unknown target kinds', () => {
  expect(
    ownerNotificationRoute({ objectType: 'https://example.invalid', objectId: id }),
  ).toBeNull();
  expect(ownerNotificationRoute({ objectType: 'Invoice', objectId: '../private' })).toBeNull();
  expect(
    ownerNotificationRoute({
      objectType: 'AutomationExecution',
      objectId: id,
      locationId: id,
      billingPeriod: '2026-11-01',
    }),
  ).toContain('/billing-automation?');
});
