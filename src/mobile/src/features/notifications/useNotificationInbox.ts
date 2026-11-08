import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../lib/SessionProvider';
import { queryPolicies } from '../../lib/queryPolicies';
import type { MobileApi } from '../../lib/api';
import { useCachedWorkspaceQuery } from '../workspace/useCachedWorkspaceQuery';
import {
  appendInbox,
  inboxPath,
  loadInbox,
  loadNotificationPage,
  notificationCountPath,
  type InboxData,
  type NotificationFilter,
} from '../../services/notificationInbox';

export function useNotificationInbox(filter: NotificationFilter) {
  const { api, session } = useSession();
  // The mounted inbox owns accumulated pages. A new filter starts at page one;
  // a retained tab keeps this loader/cache entry and its loaded pages.
  const firstPage = useCallback(
    (client: MobileApi, path: string, signal: AbortSignal) => loadInbox(client, path, signal),
    [],
  );
  const query = useCachedWorkspaceQuery<InboxData>(
    session && api ? inboxPath(filter) : null,
    queryPolicies.notifications,
    firstPage,
  );
  // Same decoder/key as NotificationBadge: this subscription has no polling timer.
  const count = useCachedWorkspaceQuery<{ unreadCount: number }>(
    session && api ? notificationCountPath : null,
    queryPolicies.notifications,
  );
  const request = useRef<AbortController | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  useEffect(() => () => request.current?.abort(), [api, session?.userId]);
  const commit = query.updateData,
    refreshQuery = query.refresh;
  const refresh = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setLoadingMore(false);
    setMoreError(false);
    // Keep loaded content while the page-one request is in flight or fails.
    return refreshQuery();
  }, [refreshQuery]);
  const confirmRead = useCallback(
    (id?: string) => {
      request.current?.abort();
      request.current = null;
      setLoadingMore(false);
      commit((current) =>
        current
          ? {
              ...current,
              hasMore: false,
              // readAt is a server timestamp; don't fabricate one for a 204 response.
              confirmedReadIds: [
                ...new Set([
                  ...current.confirmedReadIds,
                  ...(id ? [id] : current.items.map((item) => item.id)),
                ]),
              ],
            }
          : null,
      );
    },
    [commit],
  );
  const data = query.data;
  const loadMore = useCallback(async () => {
    if (!api || !data?.hasMore || request.current || query.fetching) return;
    const controller = new AbortController();
    request.current = controller;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const next = await loadNotificationPage(
        api,
        inboxPath(filter, data.page + 1),
        controller.signal,
      );
      if (!controller.signal.aborted)
        commit((current) => (current === data ? appendInbox(current, next) : null));
    } catch {
      if (!controller.signal.aborted) setMoreError(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoadingMore(false);
      }
    }
  }, [api, data, filter, commit, query.fetching]);
  const rawCount = count.data?.unreadCount;
  return {
    ...query,
    refresh,
    confirmRead,
    loadMore,
    loadingMore,
    moreError,
    items:
      data?.items.filter(
        (item) => !filter.unread || !(item.readAt || data.confirmedReadIds.includes(item.id)),
      ) ?? [],
    unreadCount: Number.isSafeInteger(rawCount) && rawCount! >= 0 ? rawCount! : null,
    refreshCount: count.revalidate,
  };
}
