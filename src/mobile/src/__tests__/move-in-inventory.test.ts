import { expect, it, vi } from 'vitest';
import {
  moveInInventoryClient,
  readyToComplete,
  validateInventoryItem,
  type MoveInInventoryItem,
} from '../services/moveInInventory';
import { operationalTasks } from '../services/operationalTasks';
import { canOpenScreen, activeWorkspaceTab } from '../features/workspace/navigation';

const taskId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';
const incidentId = '55555555-5555-4555-8555-555555555555';

const item: MoveInInventoryItem = {
  id: itemId,
  assetId: null,
  name: 'Giường đơn',
  expectedQuantity: 3,
  actualQuantity: 3,
  condition: 'Good',
  notes: '',
  evidenceIds: [photoId],
  incidentId: null,
};

it('checks exact quantities and requires issue details for prefilled BF-07 reporting', () => {
  expect(validateInventoryItem({ actualQuantity: 3, condition: 'Good', notes: '' }, 3)).toBe('');
  expect(validateInventoryItem({ actualQuantity: 2, condition: 'Good', notes: '' }, 3)).toMatch(
    /đủ số lượng/,
  );
  expect(
    validateInventoryItem({ actualQuantity: 3, condition: 'Missing', notes: 'Mất 1 chiếc' }, 3),
  ).toMatch(/nhỏ hơn/);
  expect(
    validateInventoryItem({ actualQuantity: 2, condition: 'Missing', notes: 'Thiếu một chiếc' }, 3),
  ).toBe('');
  expect(
    validateInventoryItem(
      { actualQuantity: 2, condition: 'Damaged', notes: 'Một chiếc bị gãy' },
      3,
    ),
  ).toBe('');
  expect(validateInventoryItem({ actualQuantity: 2, condition: 'Damaged', notes: '' }, 3)).toMatch(
    /Mô tả/,
  );
  expect(
    validateInventoryItem({ actualQuantity: -1, condition: 'Missing', notes: 'Thiếu' }, 3),
  ).toMatch(/không âm/);
  expect(validateInventoryItem({ actualQuantity: 4, condition: 'Good', notes: '' }, 3)).toMatch(
    /vượt/,
  );
});

it('requires per-item evidence and linked incidents before enabling direct Staff completion', () => {
  expect(readyToComplete([item])).toBe(true);
  expect(readyToComplete([{ ...item, evidenceIds: null }])).toBe(false);
  expect(readyToComplete([{ ...item, condition: null }])).toBe(false);
  expect(readyToComplete([{ ...item, actualQuantity: null }])).toBe(false);
  expect(
    readyToComplete([
      { ...item, condition: 'Missing', actualQuantity: 2, notes: 'Thiếu một chiếc' },
    ]),
  ).toBe(false);
  expect(
    readyToComplete([
      { ...item, condition: 'Missing', actualQuantity: 2, notes: 'Thiếu một chiếc', incidentId },
    ]),
  ).toBe(true);
  expect(
    readyToComplete([{ ...item, condition: 'Damaged', notes: 'Gãy chân giường', incidentId }]),
  ).toBe(true);
  expect(readyToComplete([{ ...item, condition: 'Damaged', notes: '', incidentId }])).toBe(false);
  // Empty configured asset list uses a separate explicit confirmNoAssets checkbox.
  expect(readyToComplete([])).toBe(true);
});

it('uses the Backend inventory routes, version and idempotency headers with zero-asset confirmation', async () => {
  const request = vi.fn().mockResolvedValue({ taskId, version: 2, items: [] });
  const client = moveInInventoryClient({ request });
  await client.get(taskId);
  expect(request.mock.calls[0]).toEqual([
    `/api/v1/operational-tasks/${taskId}/move-in-inventory`,
    { signal: undefined },
  ]);

  const write = {
    version: 2,
    actualQuantity: 2,
    condition: 'Missing' as const,
    notes: 'Thiếu một chiếc',
    evidenceIds: [photoId],
    incidentId,
  };
  await client.saveItem(taskId, itemId, write, key);
  const [path, options] = request.mock.calls[1];
  expect(path).toBe(`/api/v1/operational-tasks/${taskId}/move-in-inventory/items/${itemId}`);
  expect(options).toMatchObject({
    method: 'PUT',
    headers: { 'Idempotency-Key': key },
  });
  expect(JSON.parse(options.body)).toEqual(write);

  await client.complete(taskId, 3, 'Không có tài sản', key, true);
  expect(request.mock.calls[2][0]).toBe(
    `/api/v1/operational-tasks/${taskId}/move-in-inventory/complete`,
  );
  expect(request.mock.calls[2][1].method).toBe('POST');
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
    version: 3,
    note: 'Không có tài sản',
    confirmNoAssets: true,
  });
});

it('uploads evidence as task-scoped binary PUT and preserves PNG MIME type', async () => {
  const request = vi.fn().mockResolvedValue({ id: photoId });
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await operationalTasks({ request } as never).upload(taskId, bytes, key, 'image/png');
  expect(request.mock.calls[0][0]).toBe(`/api/v1/operational-tasks/${taskId}/evidence`);
  expect(request.mock.calls[0][1]).toEqual({
    method: 'PUT',
    body: bytes,
    headers: { 'Idempotency-Key': key, 'Content-Type': 'image/png' },
  });
});

it('restricts inventory to Staff and keeps it under the existing work-order tab', () => {
  expect(canOpenScreen('Staff', 'move-in-inventory')).toBe(true);
  expect(canOpenScreen('Owner', 'move-in-inventory')).toBe(false);
  expect(canOpenScreen('Tenant', 'move-in-inventory')).toBe(false);
  expect(activeWorkspaceTab('Staff', 'move-in-inventory')).toBe('work-orders');
});
