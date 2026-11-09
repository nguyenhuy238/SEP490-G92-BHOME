import type { Page } from '../../../../packages/client-core/src/invoices';
import {
  notificationClient,
  type NotificationItem,
  type NotificationTarget,
} from '../../../../packages/client-core/src/notifications';
import { MobileApiError, type MobileApi } from '../lib/api';
import type { MobileRole, WorkspaceScreen } from '../features/workspace/navigation';

export type NotificationFilter = { category: string; unread: boolean };
export interface InboxData extends Page<NotificationItem> {
  hasMore: boolean;
  confirmedReadIds: string[];
}
export const notificationCountPath = '/api/v1/notifications/unread-count';
const guid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const emptyGuid = '00000000-0000-0000-0000-000000000000';
const validId = (id: unknown): id is string =>
  typeof id === 'string' && guid.test(id) && id !== emptyGuid;
const invalid = () => new MobileApiError(502, 'invalid_response');
export function inboxPath(filter: NotificationFilter, page = 1) {
  return `/api/v1/notifications?page=${page}&pageSize=20${filter.category ? '&category=' + encodeURIComponent(filter.category) : ''}${filter.unread ? '&unread=true' : ''}`;
}
function isItem(value: unknown): value is NotificationItem {
  if (!value || typeof value !== 'object') return false;
  const p = value as NotificationItem;
  return (
    validId(p.id) &&
    typeof p.category === 'string' &&
    typeof p.title === 'string' &&
    typeof p.summary === 'string' &&
    typeof p.createdAt === 'string' &&
    Number.isFinite(Date.parse(p.createdAt)) &&
    (p.readAt === null ||
      (typeof p.readAt === 'string' && Number.isFinite(Date.parse(p.readAt)))) &&
    typeof p.relatedObjectType === 'string' &&
    typeof p.relatedObjectId === 'string' &&
    typeof p.deliveryState === 'string'
  );
}
export async function loadNotificationPage(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Page<NotificationItem>> {
  const result = await api.request<Page<NotificationItem>>(path, { signal });
  if (
    !result ||
    !Array.isArray(result.items) ||
    !result.items.every(isItem) ||
    !Number.isSafeInteger(result.totalCount) ||
    result.totalCount < 0 ||
    result.page !== Number(new URLSearchParams(path.split('?')[1]).get('page')) ||
    result.pageSize !== 20 ||
    result.items.length > result.pageSize
  )
    throw invalid();
  return result;
}
export async function loadInbox(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<InboxData> {
  const first = await loadNotificationPage(api, path, signal);
  return {
    ...first,
    items: [...new Map(first.items.map((item) => [item.id, item])).values()],
    hasMore: first.items.length > 0 && first.page * first.pageSize < first.totalCount,
    confirmedReadIds: [],
  };
}
export function appendInbox(current: InboxData, next: Page<NotificationItem>): InboxData {
  const ids = new Set(current.items.map((item) => item.id));
  const added = next.items.filter((item) => !ids.has(item.id));
  return {
    ...current,
    page: next.page,
    totalCount: next.totalCount,
    items: [...new Map([...current.items, ...added].map((item) => [item.id, item])).values()],
    hasMore: added.length > 0 && next.page * next.pageSize < next.totalCount,
  };
}
export type NotificationDestination =
  { screen: WorkspaceScreen; params: Record<string, string> } | { meterId: string };
export async function notificationDestination(
  api: MobileApi,
  role: MobileRole,
  id: string,
  signal: AbortSignal,
): Promise<NotificationDestination | null> {
  const client = notificationClient(<T>(path: string, init?: RequestInit) =>
    api.request<T>(path, { ...init, signal }),
  );
  const target = (await client.target(id)) as NotificationTarget | null;
  if (!target || !validId(target.objectId) || typeof target.objectType !== 'string')
    throw invalid();
  if (target.objectType === 'Invoice' && role === 'Tenant')
    return { screen: 'invoice', params: { invoiceId: target.objectId } };
  if (target.objectType === 'Adjustment' && role === 'Tenant') {
    const adjustment = await api.request<{ invoiceId: string }>(
      `/api/v1/invoice-adjustments/${encodeURIComponent(target.objectId)}`,
      { signal },
    );
    if (!adjustment || !validId(adjustment.invoiceId)) throw invalid();
    return { screen: 'invoice', params: { invoiceId: adjustment.invoiceId } };
  }
  if (target.objectType === 'Adjustment' && role === 'Owner')
    return {
      screen: 'owner-adjustment-detail',
      params: { adjustmentId: target.objectId },
    };
  if (target.objectType === 'Contract' && role !== 'Staff')
    return {
      screen: role === 'Tenant' ? 'contract' : 'signing',
      params: { contractId: target.objectId },
    };
  if (target.objectType === 'MeterTask' && role === 'Staff') return { meterId: target.objectId };
  if (target.objectType === 'OperationalTask' && role !== 'Tenant')
    return { screen: 'task-detail', params: { taskId: target.objectId } };
  if (target.objectType === 'Incident')
    return { screen: 'incident-detail', params: { incidentId: target.objectId } };
  if (target.objectType === 'WorkOrder' && role !== 'Tenant')
    return { screen: 'maintenance-detail', params: { workOrderId: target.objectId } };
  if (target.objectType === 'PaymentTransaction' && role === 'Owner')
    return { screen: 'owner-payment-detail', params: { paymentId: target.objectId } };
  return null; // The related record may only have an Owner Web destination.
}
export function hasNotificationTarget(item: NotificationItem) {
  return !!item.relatedObjectType && !!item.relatedObjectId && item.relatedObjectId !== emptyGuid;
}
