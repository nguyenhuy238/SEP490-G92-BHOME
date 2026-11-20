import { guid } from '../../../../packages/client-core/src/contracts';
import type { MobileApi } from '../lib/api';

export interface LocationAssetInventoryItem {
  id: string;
  roomId: string | null;
  roomNumber: string | null;
  assetId: string | null;
  name: string;
  quantity: number;
  commonArea: string | null;
  checked: boolean;
  inherited: boolean;
  sourceHandoverContractId: string | null;
  note: string | null;
  incidentId: string | null;
}

export interface LocationAssetInventory {
  taskId: string;
  locationId: string;
  assignmentId: string;
  status: string;
  version: number;
  totalCount: number;
  checkedCount: number;
  items: LocationAssetInventoryItem[];
  /** Not checklist items: rooms still awaiting Owner's original inventory confirmation. */
  pendingOwnerRooms?: string[] | null;
  pendingOwnerCommonAssets?: boolean;
}

export function inventoryReady(view: LocationAssetInventory | null): boolean {
  return !!view && view.status === 'InProgress' &&
    view.totalCount > 0 && !view.pendingOwnerRooms?.length && !view.pendingOwnerCommonAssets &&
    Array.isArray(view.items) && view.items.length === view.totalCount &&
    view.checkedCount === view.totalCount && view.items.every((item) => item.checked);
}

export function inventoryGroups(items: LocationAssetInventoryItem[]) {
  const groups = new Map<string, { title: string; items: LocationAssetInventoryItem[] }>();
  for (const item of items) {
    const key = item.roomId ? `room:${item.roomId}` : `common:${item.commonArea ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        title: item.roomId ? `Phòng ${item.roomNumber || 'chưa rõ số'}` :
          `Khu vực chung${item.commonArea ? ` · ${item.commonArea}` : ''}`,
        items: [],
      });
    }
    groups.get(key)!.items.push(item);
  }
  return [...groups.entries()].sort(([a, av], [b, bv]) => {
    if (a.startsWith('room:') !== b.startsWith('room:')) return a.startsWith('room:') ? -1 : 1;
    return av.title.localeCompare(bv.title, 'vi', { numeric: true });
  }).map(([, value]) => value);
}

export function locationAssetInventoryClient(api: MobileApi) {
  const path = (taskId: string) =>
    `/api/v1/operational-tasks/${guid(taskId)}/location-asset-inventory`;
  return {
    get: (taskId: string, signal?: AbortSignal) =>
      api.request<LocationAssetInventory>(path(taskId), { signal }),
    updateItem: (
      taskId: string,
      itemId: string,
      input: { version: number; checked: boolean; note: string | null; incidentId: string | null },
      key: string,
    ) =>
      api.request<LocationAssetInventory>(`${path(taskId)}/items/${guid(itemId)}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': guid(key) },
        body: JSON.stringify(input),
      }),
  };
}
