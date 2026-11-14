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
it('recovers a saved draft and sends its persisted ID without creating a replacement', async () => {
  const draft = {
    id: 'recovered',
    title: 'Nháp phục hồi',
    body: 'Nội dung đã lưu',
    channels: ['IN_APP'],
    audience: { type: 'ALL_TENANTS' },
    status: 'Draft',
    recipientCount: 0,
  };
  mocks.request.mockImplementation(async (path: string) => {
    if (path.includes('/announcements/drafts?')) return [draft];
    if (path.endsWith('/recovered/send')) return { ...draft, status: 'Sent' };
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
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  expect(screen.getByLabelText('Tiêu đề thông báo')).toHaveValue(draft.title);
  expect(screen.getByRole('combobox', { name: 'Phạm vi người nhận' })).toHaveTextContent(
    'Tất cả Tenant',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Gửi nháp này' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.filter(([p]) => p.endsWith('/recovered/send'))).toHaveLength(1),
  );
  expect(mocks.request.mock.calls.filter(([p]) => p === '/api/v1/announcements')).toHaveLength(0);
});
it('selects linked Tenant accounts by name and previews their real IDs without manual UUID entry', async () => {
  const userId = '00000000-0000-4000-8000-000000000002';
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/residents?'))
      return {
        items: [
          { id: 'a', displayLabel: 'Tenant tổng hợp', roomNumber: '101', tenantUserId: userId },
          { id: 'b', displayLabel: 'Chưa có tài khoản', roomNumber: '102', tenantUserId: null },
        ],
        totalCount: 2,
        page: 1,
        pageSize: 20,
      };
    if (path.endsWith('preview-recipients')) return { recipientCount: 1, missingEmailCount: 0 };
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
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phạm vi người nhận' }));
  fireEvent.click(screen.getByRole('option', { name: 'Nhiều tài khoản' }));
  expect(screen.queryByLabelText(/UUID/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn tài khoản người nhận' }));
  const dialog = screen.getByRole('dialog');
  expect(
    await within(dialog).findByRole('checkbox', { name: 'Chọn người nhận Chưa có tài khoản' }),
  ).toBeDisabled();
  fireEvent.click(
    within(dialog).getByRole('checkbox', { name: 'Chọn người nhận Tenant tổng hợp' }),
  );
  fireEvent.change(within(dialog).getByLabelText('Tìm tên người nhận'), {
    target: { value: 'Tenant' },
  });
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([p]) => p.includes('/residents?') && p.includes('search=Tenant') && p.includes('page=1'),
      ),
    ).toBe(true),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xong' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra người nhận' }));
  await screen.findByText('1 người nhận · 0 tài khoản thiếu email');
  const preview = mocks.request.mock.calls.find(([p]) => p.endsWith('preview-recipients'))!;
  expect(JSON.parse(preview[1].body)).toEqual({ type: 'SELECTED_USERS', userIds: [userId] });
});
it('reuses the create intent after a lost response instead of creating another draft', async () => {
  let attempts = 0;
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith('preview-recipients')) return { recipientCount: 2, missingEmailCount: 0 };
    if (path === '/api/v1/announcements') {
      if (++attempts === 1) throw new Error('Synthetic lost response');
      return {
        id: 'retry',
        title: 'Thông báo',
        body: 'Nội dung',
        channels: ['IN_APP'],
        status: 'Draft',
        recipientCount: 0,
      };
    }
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
  fireEvent.change(screen.getByLabelText('Tiêu đề thông báo'), { target: { value: 'Thông báo' } });
  fireEvent.change(screen.getByLabelText('Nội dung thông báo'), { target: { value: 'Nội dung' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra người nhận' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Tạo nháp đã kiểm tra' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tạo nháp đã kiểm tra' }));
  await screen.findByText(
    'Chưa hoàn thành yêu cầu. Tải lại dữ liệu để kiểm tra trước khi thử lại.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tạo nháp đã kiểm tra' }));
  await screen.findByRole('button', { name: 'Gửi nháp này' });
  const posts = mocks.request.mock.calls.filter(([p]) => p === '/api/v1/announcements');
  expect(posts).toHaveLength(2);
  expect(posts[0][1].headers).toEqual(posts[1][1].headers);
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
