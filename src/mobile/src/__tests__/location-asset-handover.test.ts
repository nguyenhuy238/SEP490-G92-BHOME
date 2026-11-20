import { expect, it, vi } from 'vitest';
import { availableTaskActions, type OperationalTask } from '../services/operationalTasks';
import {
  inventoryGroups,
  inventoryReady,
  locationAssetInventoryClient,
  type LocationAssetInventory,
  type LocationAssetInventoryItem,
} from '../services/locationAssetInventory';
import {
  locationAssetHandoverClient,
  type LocationAssetHandoverReport,
} from '../services/locationAssetHandover';
import type { MobileApi } from '../lib/api';

const taskId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const staff = '33333333-3333-4333-8333-333333333333';
const location = '44444444-4444-4444-8444-444444444444';
const room = '55555555-5555-4555-8555-555555555555';
const item = {
  id: itemId,
  roomId: room,
  roomNumber: '101',
  assetId: null,
  name: 'Giường',
  quantity: 2,
  commonArea: null,
  checked: false,
  inherited: false,
  sourceHandoverContractId: null,
  note: null,
  incidentId: null,
} satisfies LocationAssetInventoryItem;
const view = {
  taskId,
  locationId: location,
  assignmentId: itemId,
  status: 'InProgress',
  version: 9,
  totalCount: 2,
  checkedCount: 1,
  items: [item, { ...item, id: room, checked: true, inherited: true }],
} satisfies LocationAssetInventory;

it('groups actual rooms and common assets, preserving inherited Tenant records', () => {
  const common = { ...item, id: room, roomId: null, roomNumber: null, commonArea: 'Hành lang' };
  const result = inventoryGroups([
    common,
    item,
    { ...item, id: location, roomNumber: '101', checked: true },
  ]);
  expect(result.map((group) => group.title)).toEqual(['Phòng 101', 'Khu vực chung · Hành lang']);
  expect(result[0].items).toHaveLength(2);
  expect(result[1].items[0].id).toBe(room);
});

it('only enables Staff submission for a wholly checked inventory while task is in progress', () => {
  expect(inventoryReady(view)).toBe(false);
  const finished = {
    ...view,
    checkedCount: 2,
    items: view.items.map((entry) => ({ ...entry, checked: true })),
  };
  expect(inventoryReady(finished)).toBe(true);
  expect(inventoryReady({ ...finished, status: 'PendingVerification' })).toBe(false);
  expect(inventoryReady({ ...finished, checkedCount: 1 })).toBe(false);
  expect(inventoryReady({ ...finished, items: [item, view.items[1]] })).toBe(false);
  expect(inventoryReady({ ...finished, pendingOwnerRooms: ['102'] })).toBe(false);
  expect(inventoryReady({ ...finished, pendingOwnerCommonAssets: true })).toBe(false);
  expect(inventoryReady({ ...finished, totalCount: 0, checkedCount: 0, items: [] })).toBe(false);
});

it('limits progress and issue reporting to the assigned Staff and respects task state', () => {
  const task = {
    kind: 'LocationAssetHandover',
    status: 'InProgress',
    currentResponsibleStaffUserId: staff,
  } as OperationalTask;
  expect(availableTaskActions(task, 'Staff', staff)).toEqual(['progress', 'blockers', 'submit']);
  expect(availableTaskActions(task, 'Staff', taskId)).toEqual([]);
  expect(availableTaskActions(task, 'Owner', staff)).toEqual([]);
  expect(availableTaskActions({ ...task, status: 'Assigned' }, 'Staff', staff)).toEqual(['start']);
  expect(availableTaskActions({ ...task, status: 'Completed' }, 'Staff', staff)).toEqual([]);
});

it('sends an item update with the server version, linked incident and idempotency key', async () => {
  const request = vi.fn().mockResolvedValue(view);
  const api = { request } as unknown as MobileApi;
  const input = { version: 9, checked: true, note: 'Thấy đủ tài sản', incidentId: taskId };
  await locationAssetInventoryClient(api).updateItem(taskId, itemId, input, staff);
  expect(request).toHaveBeenCalledWith(
    `/api/v1/operational-tasks/${taskId}/location-asset-inventory/items/${itemId}`,
    {
      method: 'PUT',
      headers: { 'Idempotency-Key': staff },
      body: JSON.stringify(input),
    },
  );
});

it('signs only the backend report revision and exact snapshot digest', async () => {
  const request = vi.fn().mockResolvedValue(undefined);
  const api = { request } as unknown as MobileApi;
  const report = {
    revision: 4,
    snapshotSha256: 'A'.repeat(64),
    status: 'PendingStaffSignature',
  } as LocationAssetHandoverReport;
  await locationAssetHandoverClient(api).sign(taskId, report);
  expect(request).toHaveBeenCalledWith(
    `/api/v1/operational-tasks/${taskId}/location-asset-handover/sign`,
    {
      method: 'POST',
      body: JSON.stringify({
        revision: 4,
        snapshotSha256: 'A'.repeat(64),
        confirmed: true,
      }),
    },
  );
});
