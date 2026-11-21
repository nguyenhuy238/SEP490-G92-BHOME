import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { notificationClient } from '../../../../../packages/client-core/src/notifications';
import { useMeterApi } from '../meters/useMeterApi';
export function useNotifications() {
  const { request } = useMeterApi();
  return useMemo(() => notificationClient(request), [request]);
}
export function useUnreadNotifications(enabled = true) {
  const api = useNotifications();
  const { session } = useAuth();
  return useQuery({
    queryKey: ['notification-count', session?.userId],
    enabled: enabled && !!session,
    queryFn: ({ signal }) => api.count(signal),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
}
