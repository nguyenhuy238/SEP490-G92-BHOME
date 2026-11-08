import { afterEach, expect, it, vi } from 'vitest';
import { appendInbox, inboxPath, type InboxData } from '../services/notificationInbox';
import { notificationRefresh } from '../services/notificationRefresh';
import type { NotificationItem } from '../../../../packages/client-core/src/notifications';
afterEach(() => {
  vi.useRealTimers();
});
it('uses a single polling timer per API and releases it when the last active subscriber leaves', () => {
  vi.useFakeTimers();
  const api = {},
    first = vi.fn(),
    second = vi.fn();
  const stopFirst = notificationRefresh.poll(api, first),
    stopSecond = notificationRefresh.poll(api, second);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(30000);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  stopFirst();
  expect(vi.getTimerCount()).toBe(1);
  stopSecond();
  expect(vi.getTimerCount()).toBe(0);
});
it('deduplicates IDs across pages and stops when a further page adds nothing', () => {
  const a = { id: 'a' } as NotificationItem,
    b = { id: 'b' } as NotificationItem;
  const initial: InboxData = {
    items: [a],
    page: 1,
    pageSize: 20,
    totalCount: 100,
    hasMore: true,
    confirmedReadIds: [],
  };
  const next = appendInbox(initial, { items: [a, b, b], page: 2, pageSize: 20, totalCount: 100 });
  expect(next.items.map((item) => item.id)).toEqual(['a', 'b']);
  expect(appendInbox(next, { items: [b], page: 3, pageSize: 20, totalCount: 100 }).hasMore).toBe(
    false,
  );
  expect(appendInbox(next, { items: [], page: 3, pageSize: 20, totalCount: 100 }).hasMore).toBe(
    false,
  );
});
it('builds only the existing pagination/filter query parameters', () => {
  expect(inboxPath({ category: 'Invoice', unread: true }, 2)).toBe(
    '/api/v1/notifications?page=2&pageSize=20&category=Invoice&unread=true',
  );
});
