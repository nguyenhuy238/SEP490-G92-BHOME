import type { MobileApi } from '../lib/api';
import { guid } from '../../../../packages/client-core/src/contracts';

export type InventoryCondition = 'Good' | 'Missing' | 'Damaged';
export interface MoveInInventoryItem {
  id: string;
  assetId: string | null;
  name: string;
  expectedQuantity: number;
  actualQuantity: number | null;
  condition: InventoryCondition | null;
  notes: string | null;
  evidenceIds: string[] | null;
  incidentId: string | null;
}
export interface MoveInInventory {
  taskId: string;
  contractId: string;
  roomId: string;
  locationId: string;
  status: string;
  outcome?: string | null;
  version: number;
  dueAt: string | null;
  completedAt: string | null;
  readyForHandover: boolean;
  items: MoveInInventoryItem[];
}
export interface InventoryItemUpdate {
  version: number;
  actualQuantity: number;
  condition: InventoryCondition;
  notes: string;
  evidenceIds: string[];
  incidentId: string | null;
}

export const inventoryStatusLabels: Record<InventoryCondition, string> = {
  Good: 'Đạt',
  Missing: 'Thiếu',
  Damaged: 'Hư hỏng',
};

export function validateInventoryItem(
  input: Pick<InventoryItemUpdate, 'actualQuantity' | 'condition' | 'notes'>,
  expectedQuantity: number,
) {
  if (!Number.isSafeInteger(input.actualQuantity) || input.actualQuantity < 0)
    return 'Số lượng thực tế phải là số nguyên không âm.';
  if (!Number.isSafeInteger(expectedQuantity) || expectedQuantity < 0)
    return 'Số lượng cần kiểm kê không hợp lệ; hãy tải lại.';
  if (input.actualQuantity > expectedQuantity)
    return 'Số lượng thực tế vượt số lượng dự kiến. Hãy báo Owner kiểm tra cấu hình.';
  if (input.condition === 'Good' && input.actualQuantity !== expectedQuantity)
    return 'Đạt yêu cầu phải đủ số lượng dự kiến.';
  if (input.condition === 'Missing' && input.actualQuantity >= expectedQuantity)
    return 'Chọn Thiếu khi số lượng thực tế nhỏ hơn dự kiến.';
  if (!['Good', 'Missing', 'Damaged'].includes(input.condition)) return 'Chọn tình trạng tài sản.';
  if (input.condition !== 'Good' && !input.notes.trim())
    return 'Mô tả tài sản thiếu hoặc hư hỏng để tự điền báo cáo sự cố.';
  if (input.notes.length > 2000) return 'Ghi chú không quá 2000 ký tự.';
  return '';
}

export function readyToComplete(items: MoveInInventoryItem[]) {
  return items.every(
    (item) =>
      item.actualQuantity !== null &&
      !!item.condition &&
      (item.evidenceIds ?? []).length > 0 &&
      !validateInventoryItem(
        { actualQuantity: item.actualQuantity, condition: item.condition, notes: item.notes ?? '' },
        item.expectedQuantity,
      ) &&
      (item.condition === 'Good' || !!item.incidentId),
  );
}

export function moveInInventoryClient(api: Pick<MobileApi, 'request'>) {
  const path = (id: string) => `/api/v1/operational-tasks/${guid(id)}/move-in-inventory`;
  return {
    get: (taskId: string, signal?: AbortSignal) =>
      api.request<MoveInInventory>(path(taskId), { signal }),
    saveItem: (taskId: string, itemId: string, input: InventoryItemUpdate, key: string) =>
      api.request<MoveInInventory>(`${path(taskId)}/items/${guid(itemId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': guid(key) },
      }),
    complete: (
      taskId: string,
      version: number,
      note: string,
      key: string,
      confirmNoAssets = false,
    ) =>
      api.request<MoveInInventory>(`${path(taskId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ version, note, confirmNoAssets }),
        headers: { 'Idempotency-Key': guid(key) },
      }),
  };
}
