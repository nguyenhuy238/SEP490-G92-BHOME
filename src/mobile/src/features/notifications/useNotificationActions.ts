import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import type { NotificationItem } from '../../../../../packages/client-core/src/notifications';
import { notificationClient } from '../../../../../packages/client-core/src/notifications';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { hasNotificationTarget, notificationDestination } from '../../services/notificationInbox';
import { notificationRefresh } from '../../services/notificationRefresh';
import { MobileApiError } from '../../lib/api';
import { showError, showInfo, showSuccess, showWarning } from '../../lib/toast';

type Sync = {
  confirmRead: (id?: string) => void;
  refresh: () => Promise<unknown>;
  refreshCount: () => void;
};
export function useNotificationActions({ confirmRead, refresh, refreshCount }: Sync) {
  const { api } = useSession();
  const { role, go } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [api]);
  const synchronize = useCallback(
    (id?: string) => {
      confirmRead(id);
      refreshCount();
      notificationRefresh.emit();
      void refresh().catch(() => {
        /* The inbox keeps content and exposes its retry state. */
      });
    },
    [confirmRead, refreshCount, refresh],
  );
  const open = useCallback(
    async (item: NotificationItem, read: boolean) => {
      if (!api || !role || request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setBusy(item.id);
      const client = notificationClient(<T>(path: string, init?: RequestInit) =>
        api.request<T>(path, { ...init, signal: controller.signal }),
      );
      try {
        if (!read) {
          try {
            await client.read(item.id);
            if (controller.signal.aborted) return;
            synchronize(item.id);
          } catch (e) {
            if (controller.signal.aborted || (e instanceof MobileApiError && e.status === 401))
              return;
            showWarning('Chưa đánh dấu đã đọc. Bạn vẫn có thể mở hồ sơ liên quan.');
          }
        }
        if (!hasNotificationTarget(item) || controller.signal.aborted) return;
        try {
          const destination = await notificationDestination(api, role, item.id, controller.signal);
          if (controller.signal.aborted) return;
          if (!destination) {
            showInfo(
              role === 'Owner'
                ? 'Hồ sơ này được xem trên Owner Web.'
                : 'Thông báo này chưa có màn hình chi tiết trên mobile.',
            );
            return;
          }
          if ('meterId' in destination)
            router.push({ pathname: '/meter', params: { taskId: destination.meterId } });
          else go(destination.screen, destination.params);
        } catch (e) {
          if (controller.signal.aborted) return;
          if (e instanceof MobileApiError && [403, 404].includes(e.status))
            showInfo('Hồ sơ không còn khả dụng hoặc bạn không còn quyền truy cập.');
          else if (!(e instanceof MobileApiError && e.status === 401))
            showError('Chưa thể mở hồ sơ liên quan. Vui lòng thử lại.');
        }
      } finally {
        if (request.current === controller) {
          request.current = null;
          if (!controller.signal.aborted) setBusy(null);
        }
      }
    },
    [api, role, go, synchronize],
  );
  const readAll = useCallback(async () => {
    if (!api || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('all');
    try {
      await notificationClient(<T>(path: string, init?: RequestInit) =>
        api.request<T>(path, { ...init, signal: controller.signal }),
      ).readAll();
      if (!controller.signal.aborted) {
        synchronize();
        showSuccess('Đã đánh dấu tất cả thông báo là đã đọc.');
      }
    } catch {
      if (!controller.signal.aborted)
        showError('Chưa đánh dấu được tất cả đã đọc. Vui lòng thử lại.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setBusy(null);
      }
    }
  }, [api, synchronize]);
  return { busy, open, readAll };
}
