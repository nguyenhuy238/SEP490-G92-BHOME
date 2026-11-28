import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { invoiceError } from '../../../../../packages/client-core/src/invoices';
import {
  ownerNotificationRoute,
  type NotificationItem,
} from '../../../../../packages/client-core/src/notifications';
import { useNotifications } from './useNotifications';

const targetTypes = new Set([
  'Invoice',
  'Adjustment',
  'Contract',
  'Refund',
  'BankTransfer',
  'MeterTask',
  'OperationalTask',
  'AutomationExecution',
  'Incident',
  'WorkOrder',
]);
export const hasNotificationTarget = (item: NotificationItem) =>
  targetTypes.has(item.relatedObjectType);

export function useNotificationActions() {
  const api = useNotifications();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  async function action(work: () => Promise<void>, fallback?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['notification-list'] }),
        cache.invalidateQueries({ queryKey: ['notification-count'] }),
      ]);
    } catch (failure) {
      setError(fallback ?? invoiceError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const markRead = async (item: NotificationItem) => {
    if (!item.readAt) await api.read(item.id);
  };
  return {
    busy,
    error,
    clearError: () => setError(''),
    read: (item: NotificationItem, onRead?: () => void) =>
      action(async () => {
        await markRead(item);
        onRead?.();
      }),
    readAll: () => action(() => api.readAll()),
    open: (item: NotificationItem, onNavigate?: () => void) =>
      action(async () => {
        const target = await api.target(item.id);
        const route = ownerNotificationRoute(target);
        if (!route) throw new Error('unsupported_notification_target');
        await markRead(item);
        onNavigate?.();
        navigate(
          item.eventType === 'CONTRACT_MOVE_OUT_REQUESTED' && target.objectType === 'Contract'
            ? `/contracts/${target.objectId}/termination-review`
            : route,
        );
      }, 'Không thể mở hồ sơ. Hồ sơ có thể đã thay đổi hoặc bạn không còn quyền truy cập.'),
  };
}
