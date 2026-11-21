import React, { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { Badge } from 'react-native-paper';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { notificationRefresh } from '../services/notificationRefresh';
import { queryPolicies } from '../lib/queryPolicies';
import { useSession } from '../lib/SessionProvider';
export function NotificationBadge() {
  const { api } = useSession();
  const query = useWorkspaceQuery<{ unreadCount: number }>('/api/v1/notifications/unread-count', {
    cache: queryPolicies.notifications,
  });
  const refresh = query.revalidate;
  useEffect(() => {
    return notificationRefresh.subscribe(refresh);
  }, [refresh]);
  useFocusEffect(
    useCallback(() => {
      return api ? notificationRefresh.poll(api, refresh) : undefined;
    }, [api, refresh]),
  );
  return query.data && query.data.unreadCount > 0 ? (
    <Badge
      accessibilityLabel={`${query.data.unreadCount} thông báo chưa đọc`}
      style={{ position: 'absolute', right: 0, top: 0 }}
    >
      {query.data.unreadCount > 99 ? '99+' : query.data.unreadCount}
    </Badge>
  ) : null;
}
