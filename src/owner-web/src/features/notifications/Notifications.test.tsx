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
vi.mock('./NotificationManagement', () => ({
  NotificationManagement: () => <input aria-label="Nội dung soạn thử" defaultValue="" />,
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
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
        relatedObjectType: 'Invoice',
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
        relatedObjectType: 'OperationalTask',
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
it('resolves an Owner refund notice to its authorized source receipt before marking it read', async () => {
  mocks.list.mockResolvedValue({
    items: [
      {
        id,
        title: 'Cập nhật hoàn tiền dư',
        summary: 'Mở hồ sơ để xem',
        category: 'Payment',
        relatedObjectType: 'Refund',
        createdAt: '2026-11-12T00:00:00Z',
        readAt: null,
      },
    ],
    totalCount: 1,
  });
  mocks.target.mockResolvedValue({ objectType: 'BankTransfer', objectId: id });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Mở hồ sơ liên quan' }));
  await waitFor(() => expect(mocks.target).toHaveBeenCalledWith(id));
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(id));
  await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('transferId=' + id));
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
it('keeps the Owner inbox first and preserves composition when switching tabs', async () => {
  mocks.list.mockResolvedValue({ items: [], totalCount: 0 });
  mount();
  await screen.findByText('Không có thông báo phù hợp.');
  expect(screen.queryByLabelText('Nội dung soạn thử')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Soạn và quản lý' }));
  fireEvent.change(screen.getByLabelText('Nội dung soạn thử'), {
    target: { value: 'Bản đang soạn' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Thông báo của tôi' }));
  expect(screen.getByLabelText('Nội dung soạn thử')).not.toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Soạn và quản lý' }));
  expect(screen.getByLabelText('Nội dung soạn thử')).toHaveValue('Bản đang soạn');
});
it('distinguishes list failure from an empty inbox and retries reads', async () => {
  mocks.list.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({ items: [], totalCount: 0 });
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('Không có thông báo phù hợp.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  await screen.findByText('Không có thông báo phù hợp.');
});
it('opens a server-authorized Incident deep link and rejects malformed Incident IDs', () => {
  expect(ownerNotificationRoute({ objectType: 'Incident', objectId: id })).toBe(
    '/incidents?incidentId=' + id,
  );
  expect(ownerNotificationRoute({ objectType: 'Incident', objectId: '../private' })).toBeNull();
});
it('keeps read actions for an announcement without exposing an unsupported record link', async () => {
  mocks.list.mockResolvedValue({
    items: [
      {
        id,
        title: 'Thông báo chung',
        summary: 'Nội dung đầy đủ',
        category: 'Announcement',
        relatedObjectType: 'Announcement',
        createdAt: '2026-11-02T00:00:00Z',
        readAt: null,
      },
    ],
    totalCount: 1,
  });
  mount();
  await screen.findByText('Nội dung đầy đủ');
  expect(screen.queryByRole('button', { name: 'Mở hồ sơ liên quan' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã đọc' }));
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(id));
  expect(mocks.target).not.toHaveBeenCalled();
});
