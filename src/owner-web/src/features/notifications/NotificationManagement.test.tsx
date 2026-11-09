import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationManagement } from './NotificationManagement';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('../../components/common/OwnerSelectors', () => ({
  OwnerLocationPicker: ({ change }: { change: (id: string) => void }) => (
    <button onClick={() => change('00000000-0000-4000-8000-000000000001')}>
      Chọn cơ sở tổng hợp
    </button>
  ),
  OwnerRoomPicker: () => null,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('invalidates recipient review when content changes and sends only the persisted draft ID after confirmation', async () => {
  const draft = {
    id: 'draft',
    title: 'Thông báo tổng hợp',
    body: 'Nội dung kiểm thử',
    channels: ['IN_APP'],
    status: 'Draft',
    recipientCount: 0,
  };
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith('preview-recipients')) return { recipientCount: 2, missingEmailCount: 0 };
    if (path === '/api/v1/announcements') return draft;
    if (path.endsWith('/draft/send')) return { ...draft, status: 'Sent', recipientCount: 2 };
    if (path.includes('delivery-status')) return { deliveries: { items: [], totalCount: 0 } };
    if (path.endsWith('channel-status')) return { mode: 'Sandbox', deliveries: [] };
    return [];
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NotificationManagement />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Chọn cơ sở tổng hợp' })[0]);
  fireEvent.change(screen.getByLabelText('Tiêu đề thông báo'), { target: { value: draft.title } });
  fireEvent.change(screen.getByLabelText('Nội dung thông báo'), { target: { value: draft.body } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra người nhận' }));
  await screen.findByText('2 người nhận · 0 tài khoản thiếu email');
  fireEvent.change(screen.getByLabelText('Nội dung thông báo'), {
    target: { value: 'Nội dung đã đổi' },
  });
  expect(screen.getByRole('button', { name: 'Tạo nháp đã kiểm tra' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra người nhận' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Tạo nháp đã kiểm tra' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tạo nháp đã kiểm tra' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi nháp này' }));
  expect(mocks.request.mock.calls.filter(([p]) => p.endsWith('/send'))).toHaveLength(0);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.filter(([p]) => p.endsWith('/draft/send'))).toHaveLength(1),
  );
});
