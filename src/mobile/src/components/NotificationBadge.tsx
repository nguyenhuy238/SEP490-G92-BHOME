import React, { useEffect } from 'react';
import { Badge } from 'react-native-paper';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { notificationRefresh } from '../services/notificationRefresh';
export function NotificationBadge() {
  const query = useWorkspaceQuery<{ unreadCount: number }>('/api/v1/notifications/unread-count');
  const refresh = query.reload;
  useEffect(() => {
    const stop = notificationRefresh.subscribe(() => refresh());
    const timer = setInterval(() => refresh(), 30000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [refresh]);
  return query.data && query.data.unreadCount > 0 ? (
    <Badge
      accessibilityLabel={`${query.data.unreadCount} thông báo chưa đọc`}
      style={{ position: 'absolute', right: 0, top: 0 }}
    >
      {query.data.unreadCount > 99 ? '99+' : query.data.unreadCount}
    </Badge>
  ) : null;
}
