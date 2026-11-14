import type { Page } from './invoices';
export type NotificationItem = {
  id: string;
  category: string;
  title: string;
  summary: string;
  relatedObjectType: string;
  relatedObjectId: string;
  createdAt: string;
  readAt: string | null;
  deliveryState: string;
};
export type NotificationTarget = {
  objectType: string;
  objectId: string;
  locationId?: string | null;
  billingPeriod?: string | null;
};
export const notificationCategories = {
  Contract: 'Hợp đồng',
  Invoice: 'Hóa đơn',
  Payment: 'Thanh toán',
  Adjustment: 'Điều chỉnh',
  Task: 'Công việc',
};
export const ownerNotificationCategories = {
  ...notificationCategories,
  Incident: 'Sự cố',
  Account: 'Tài khoản',
  Announcement: 'Thông báo chung',
  Residence: 'Tạm trú',
  Other: 'Khác',
};
export function notificationClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  return {
    list: (page = 1, category = '', unread = '', signal?: AbortSignal) =>
      request<Page<NotificationItem>>(
        `/api/v1/notifications?page=${page}&pageSize=20${category ? '&category=' + encodeURIComponent(category) : ''}${unread ? '&unread=' + encodeURIComponent(unread) : ''}`,
        { signal },
      ),
    count: (signal?: AbortSignal) =>
      request<{ unreadCount: number }>('/api/v1/notifications/unread-count', { signal }),
    read: (id: string) =>
      request<void>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
    readAll: () => request<void>('/api/v1/notifications/read-all', { method: 'POST' }),
    target: (id: string) =>
      request<NotificationTarget>(`/api/v1/notifications/${encodeURIComponent(id)}/target`),
  };
}
const idPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
// Only known local routes are accepted; the server reauthorizes every target lookup.
export function ownerNotificationRoute(t: NotificationTarget): string | null {
  if (!idPattern.test(t.objectId)) return null;
  switch (t.objectType) {
    case 'Invoice':
      return `/invoices?invoiceId=${t.objectId}`;
    case 'Adjustment':
      return `/invoice-adjustments?requestId=${t.objectId}`;
    case 'Contract':
      return `/contracts?contractId=${t.objectId}`;
    case 'BankTransfer':
      return `/payments?transferId=${t.objectId}`;
    case 'MeterTask':
      return `/meters?taskId=${t.objectId}`;
    case 'OperationalTask':
      return `/tasks?taskId=${t.objectId}`;
    case 'Incident':
      return `/incidents?incidentId=${t.objectId}`;
    case 'AutomationExecution':
      return t.locationId &&
        idPattern.test(t.locationId) &&
        /^\d{4}-\d{2}-01$/.test(t.billingPeriod ?? '')
        ? `/billing-automation?locationId=${t.locationId}&period=${t.billingPeriod!.slice(0, 7)}`
        : null;
    default:
      return null;
  }
}
