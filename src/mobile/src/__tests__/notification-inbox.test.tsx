// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { MobileApi } from '../lib/api';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { NotificationBadge } from '../components/NotificationBadge';
import type { NotificationItem } from '../../../../packages/client-core/src/notifications';
import { getToastSnapshot } from '../lib/toast';

const s = vi.hoisted(() => ({
  role: 'Tenant',
  userId: 'synthetic-a',
  signedIn: true,
  api: null as MobileApi | null,
  go: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  expired: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: s.api,
    session: s.signedIn ? { userId: s.userId, roles: [s.role] } : null,
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: s.role,
    go: s.go,
    requestNavigation: (action: () => void) => action(),
  }),
}));
vi.mock('expo-router', () => ({
  router: { push: s.push, back: s.back, canGoBack: () => true },
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({
    children,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <div aria-label={accessibilityLabel} role={accessibilityRole}>
      {children}
    </div>
  ),
  RefreshControl: ({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) => (
    <button aria-label="Kéo để tải lại" disabled={refreshing} onClick={onRefresh} />
  ),
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
    refreshControl,
  }: {
    data: NotificationItem[];
    renderItem: (value: { item: NotificationItem }) => React.ReactNode;
    keyExtractor: (item: NotificationItem) => string;
    ListHeaderComponent: React.ReactNode;
    ListEmptyComponent: React.ReactNode;
    ListFooterComponent: React.ReactNode;
    refreshControl: React.ReactNode;
  }) => (
    <div data-testid="virtual-list">
      {ListHeaderComponent}
      {refreshControl}
      {data.length
        ? data.map((item) => <div key={keyExtractor(item)}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));
vi.mock('react-native-paper', () => {
  type Children = { children?: React.ReactNode };
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Icon: () => null,
    Text: ({ children, accessibilityRole }: Children & { accessibilityRole?: string }) => (
      <span role={accessibilityRole}>{children}</span>
    ),
    Badge: ({ children, accessibilityLabel }: Children & { accessibilityLabel?: string }) => (
      <span aria-label={accessibilityLabel}>{children}</span>
    ),
    Button: ({
      children,
      onPress,
      disabled,
    }: Children & { onPress: () => void; disabled?: boolean }) => (
      <button disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
    IconButton: ({
      onPress,
      accessibilityLabel,
    }: {
      onPress: () => void;
      accessibilityLabel: string;
    }) => <button onClick={onPress} aria-label={accessibilityLabel} />,
    TouchableRipple: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityHint,
    }: Children & {
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel: string;
      accessibilityHint: string;
    }) => (
      <button
        aria-label={accessibilityLabel}
        title={accessibilityHint}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Menu: Object.assign(
      ({ anchor, visible, children }: Children & { anchor: React.ReactNode; visible: boolean }) => (
        <>
          {anchor}
          {visible && <div role="menu">{children}</div>}
        </>
      ),
      {
        Item: ({ title, onPress }: { title: string; onPress: () => void }) => (
          <button role="menuitem" onClick={onPress}>
            {title}
          </button>
        ),
      },
    ),
  };
});
type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const caches: MobileApi[] = [];
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const targetId = '20000000-0000-4000-8000-000000000001';
const date = '2026-11-08T01:30:00Z';
const item = (n: number, overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: uuid(n),
  category: 'Invoice',
  title: `Thông báo ${n}`,
  summary: 'Nội dung ngắn gọn',
  createdAt: date,
  readAt: null,
  relatedObjectType: 'UNTRUSTED',
  relatedObjectId: uuid(999),
  deliveryState: 'INTERNAL-DELIVERY-STATE',
  ...overrides,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function setup(fetcher: Mock<Transport>) {
  s.api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-access',
    async () => undefined,
    s.expired,
    fetcher as typeof fetch,
  );
  caches.push(s.api);
}
function server(
  rows: NotificationItem[] = [item(1)],
  override?: (url: URL, init?: RequestInit) => Promise<Response | undefined>,
) {
  const data = rows.map((row) => ({ ...row }));
  const fetcher = vi.fn<Transport>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith('/unread-count'))
      return json({ unreadCount: data.filter((row) => !row.readAt).length });
    if (url.pathname.endsWith('/read-all')) {
      data.forEach((row) => {
        row.readAt = date;
      });
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/read')) {
      const found = data.find((row) => url.pathname.includes(row.id));
      if (found) found.readAt = date;
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/target'))
      return json({
        objectType: s.role === 'Staff' ? 'OperationalTask' : 'Contract',
        objectId: targetId,
      });
    if (url.pathname === '/api/v1/notifications') {
      const page = Number(url.searchParams.get('page'));
      const filtered = data.filter(
        (row) =>
          (!url.searchParams.get('category') ||
            row.category === url.searchParams.get('category')) &&
          (!url.searchParams.get('unread') || !row.readAt),
      );
      return json({
        items: filtered.slice((page - 1) * 20, page * 20),
        totalCount: filtered.length,
        page,
        pageSize: 20,
      });
    }
    throw new Error('Unexpected test endpoint');
  });
  setup(fetcher);
  return { fetcher, data };
}
beforeEach(() => {
  vi.clearAllMocks();
  s.role = 'Tenant';
  s.userId = 'synthetic-a';
  s.signedIn = true;
});
afterEach(() => {
  cleanup();
  caches.forEach((api) => api.queryCache.dispose());
  caches.length = 0;
});
it.each(['Owner', 'Staff', 'Tenant'])(
  'renders one compact %s inbox and only navigates using the authorized target',
  async (role) => {
    s.role = role;
    const { fetcher } = server();
    render(<NotificationsScreen />);
    await screen.findByRole('button', { name: 'Thông báo 1' });
    expect(screen.getAllByTestId('virtual-list')).toHaveLength(1);
    expect(screen.queryByText('Mở hồ sơ liên quan')).toBeNull();
    expect(screen.queryByText('INTERNAL-DELIVERY-STATE')).toBeNull();
    expect(screen.queryByText('Thông báo sự cố và bảo trì')).toBeNull();
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/incidents'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo 1' }));
    await waitFor(() =>
      expect(s.go).toHaveBeenCalledWith(
        role === 'Staff' ? 'task-detail' : role === 'Owner' ? 'signing' : 'contract',
        role === 'Staff' ? { taskId: targetId } : { contractId: targetId },
      ),
    );
    const order = fetcher.mock.calls.map(([url]) => String(url));
    expect(order.findIndex((path) => path.endsWith('/read'))).toBeLessThan(
      order.findIndex((path) => path.endsWith('/target')),
    );
    await screen.findByText('Chưa đọc (0)');
  },
);
it('deduplicates the unread count with the bell and synchronizes both after a read', async () => {
  const { fetcher } = server();
  render(
    <>
      <NotificationBadge />
      <NotificationsScreen />
    </>,
  );
  await screen.findByText('Chưa đọc (1)');
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/unread-count'))).toHaveLength(
    1,
  );
  expect(screen.getByLabelText('1 thông báo chưa đọc')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thông báo 1' }));
  await screen.findByText('Chưa đọc (0)');
  expect(screen.queryByLabelText('1 thông báo chưa đọc')).toBeNull();
});
it('marks unread items only after POST confirmation and prevents repeated taps', async () => {
  let finish!: (response: Response) => void;
  const { fetcher, data } = server(undefined, async (url) =>
    url.pathname.endsWith('/read')
      ? new Promise((yes) => {
          finish = yes;
        })
      : undefined,
  );
  render(<NotificationsScreen />);
  const card = await screen.findByRole('button', { name: 'Thông báo 1' });
  fireEvent.click(card);
  fireEvent.click(card);
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getAllByLabelText('Chưa đọc')).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/read'))).toHaveLength(1);
  expect(s.go).not.toHaveBeenCalled();
  data[0].readAt = date;
  await act(async () => finish(new Response(null, { status: 204 })));
  await waitFor(() => expect(s.go).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText('Chưa đọc')).toBeNull();
});
it('keeps the item unread on a failed read while independently allowing a valid target', async () => {
  server(undefined, async (url) => (url.pathname.endsWith('/read') ? json({}, 500) : undefined));
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() => expect(s.go).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Chưa đọc')).toBeTruthy();
  expect(getToastSnapshot().toast?.type).toBe('warning');
});
it.each([403, 404])(
  'retains confirmed read state when target access is unavailable (%s)',
  async (status) => {
    server(undefined, async (url) =>
      url.pathname.endsWith('/target') ? json({}, status) : undefined,
    );
    render(<NotificationsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
    await waitFor(() => expect(getToastSnapshot().toast?.type).toBe('info'));
    expect(s.go).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Chưa đọc')).toBeNull();
    await screen.findByText('Chưa đọc (0)');
  },
);
it('routes a server-authorized settlement notice to Tenant receivables', async () => {
  server(undefined, async (url) =>
    url.pathname.endsWith('/target')
      ? json({ objectType: 'SettlementReceivable', objectId: targetId })
      : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() => expect(s.go).toHaveBeenCalledWith('invoice', { focus: 'settlement' }));
});
it('opens own refund history from a server-authorized refund notification', async () => {
  server(undefined, async (url) =>
    url.pathname.endsWith('/target')
      ? json({ objectType: 'Refund', objectId: targetId })
      : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() =>
    expect(s.go).toHaveBeenCalledWith('billing-history', { historyTab: 'refunds' }),
  );
});
it('opens the existing Owner monitoring destination for a server-authorized bank receipt', async () => {
  s.role = 'Owner';
  server(undefined, async (url) =>
    url.pathname.endsWith('/target')
      ? json({ objectType: 'BankTransfer', objectId: targetId })
      : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() =>
    expect(s.go).toHaveBeenCalledWith('owner-payment-detail', { paymentId: targetId }),
  );
});
it('allows reading a notification without a related record and does not request a target', async () => {
  const { fetcher } = server([
    item(1, { relatedObjectType: '', relatedObjectId: '00000000-0000-0000-0000-000000000000' }),
  ]);
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await screen.findByText('Chưa đọc (0)');
  expect(getToastSnapshot().toast).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/target'))).toBe(false);
});
it('refuses malformed target IDs without trusting the saved notification fields', async () => {
  server(undefined, async (url) =>
    url.pathname.endsWith('/target')
      ? json({ objectType: 'Contract', objectId: '../foreign' })
      : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() => expect(getToastSnapshot().toast?.type).toBe('error'));
  expect(s.go).not.toHaveBeenCalled();
});
it('does not route a Tenant to a Staff task even when the target type is returned', async () => {
  server(undefined, async (url) =>
    url.pathname.endsWith('/target')
      ? json({ objectType: 'OperationalTask', objectId: targetId })
      : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() => expect(getToastSnapshot().toast?.type).toBe('info'));
  expect(s.go).not.toHaveBeenCalled();
  await screen.findByText('Chưa đọc (0)');
});
it('marks all only on success, keeps current filters, and updates the source unread count', async () => {
  const { fetcher } = server([item(1), item(2)]);
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByText('Chưa đọc (2)'));
  await screen.findByRole('button', { name: 'Thông báo 2' });
  fireEvent.click(screen.getByText('Đọc tất cả'));
  await screen.findByText('Không có thông báo phù hợp');
  await screen.findByText('Chưa đọc (0)');
  expect(screen.queryByText('Đọc tất cả')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/read-all'))).toHaveLength(1);
  expect(fetcher.mock.calls.at(-1)?.[0].toString()).not.toContain('page=2');
});
it('does not falsely mark all when the mutation fails', async () => {
  server(undefined, async (url) =>
    url.pathname.endsWith('/read-all') ? json({}, 500) : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByText('Đọc tất cả'));
  await waitFor(() => expect(getToastSnapshot().toast?.type).toBe('error'));
  expect(screen.getByLabelText('Chưa đọc')).toBeTruthy();
  expect(screen.getByText('Chưa đọc (1)')).toBeTruthy();
});
it('uses supported category filters and resets to the first page when filters change', async () => {
  const { fetcher } = server(Array.from({ length: 21 }, (_, index) => item(index + 1)));
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByText('Tải thêm'));
  await screen.findByRole('button', { name: 'Thông báo 21' });
  fireEvent.click(screen.getByText('Bộ lọc'));
  expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Hóa đơn' }));
  await screen.findByRole('button', { name: 'Thông báo 1' });
  expect(screen.queryByRole('button', { name: 'Thông báo 21' })).toBeNull();
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes('page=1&pageSize=20&category=Invoice')),
  ).toBe(true);
  fireEvent.click(screen.getByLabelText('Xóa bộ lọc nhóm'));
  await screen.findByRole('button', { name: 'Thông báo 1' });
  expect(screen.queryByRole('button', { name: 'Thông báo 21' })).toBeNull();
});
it('stops load-more at the backend total instead of requesting an endless next page', async () => {
  const { fetcher } = server(Array.from({ length: 21 }, (_, n) => item(n + 1)));
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByText('Tải thêm'));
  await screen.findByRole('button', { name: 'Thông báo 21' });
  expect(screen.queryByText('Tải thêm')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('page=2'))).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('page=3'))).toBe(false);
});
it('ignores a late pagination response after pull-to-refresh has replaced the first page', async () => {
  let finish!: (response: Response) => void;
  server(
    Array.from({ length: 21 }, (_, n) => item(n + 1)),
    async (url) =>
      url.searchParams.get('page') === '2'
        ? new Promise((yes) => {
            finish = yes;
          })
        : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByText('Tải thêm'));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByLabelText('Kéo để tải lại'));
  await act(async () => finish(json({ items: [item(99)], page: 2, pageSize: 20, totalCount: 21 })));
  expect(screen.queryByRole('button', { name: 'Thông báo 99' })).toBeNull();
});
it('retains loaded content on a refresh error and offers a small retry action', async () => {
  let fail = false;
  server(undefined, async (url) =>
    fail && url.pathname === '/api/v1/notifications' ? json({}, 500) : undefined,
  );
  render(<NotificationsScreen />);
  await screen.findByRole('button', { name: 'Thông báo 1' });
  fail = true;
  fireEvent.click(screen.getByLabelText('Kéo để tải lại'));
  await screen.findByText('Không thể tải thông báo');
  expect(screen.getByRole('button', { name: 'Thông báo 1' })).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByText('Thử lại'));
  await waitFor(() => expect(screen.queryByText('Không thể tải thông báo')).toBeNull());
});
it('shows the required empty state and no pager for an empty backend page', async () => {
  server([]);
  render(<NotificationsScreen />);
  await screen.findByText('Chưa có thông báo');
  expect(screen.getByText('Các cập nhật mới sẽ xuất hiện tại đây.')).toBeTruthy();
  expect(screen.queryByText('Tải thêm')).toBeNull();
  expect(screen.queryByText('Đọc tất cả')).toBeNull();
});
it('hides a previous account inbox immediately on account/API change', async () => {
  server();
  const view = render(<NotificationsScreen />);
  await screen.findByRole('button', { name: 'Thông báo 1' });
  s.userId = 'synthetic-b';
  server([item(2)]);
  view.rerender(<NotificationsScreen />);
  expect(screen.queryByRole('button', { name: 'Thông báo 1' })).toBeNull();
  await screen.findByRole('button', { name: 'Thông báo 2' });
});
it('expires the session on unauthorized read and never opens its target', async () => {
  const { fetcher } = server(undefined, async (url) =>
    url.pathname.endsWith('/read') ? json({}, 401) : undefined,
  );
  render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() => expect(s.expired).toHaveBeenCalledOnce());
  expect(s.go).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/target'))).toBe(false);
});
it('cancels an in-flight target request on unmount and ignores its late navigation result', async () => {
  let finish!: (response: Response) => void;
  const { fetcher } = server(undefined, async (url) =>
    url.pathname.endsWith('/target')
      ? new Promise((yes) => {
          finish = yes;
        })
      : undefined,
  );
  const view = render(<NotificationsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thông báo 1' }));
  await waitFor(() => expect(finish).toBeDefined());
  const target = fetcher.mock.calls.find(([url]) => String(url).endsWith('/target'))!;
  view.unmount();
  expect(target[1]?.signal?.aborted).toBe(true);
  await act(async () => finish(json({ objectType: 'Contract', objectId: targetId })));
  expect(s.go).not.toHaveBeenCalled();
  expect(s.push).not.toHaveBeenCalled();
});
