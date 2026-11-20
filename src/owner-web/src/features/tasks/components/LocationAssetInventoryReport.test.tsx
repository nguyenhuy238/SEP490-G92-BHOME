// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocationAssetInventoryReport } from './LocationAssetInventoryReport';

const state = vi.hoisted(() => ({
  command: vi.fn(),
  refetchInventory: vi.fn(),
  refetchPreview: vi.fn(),
  preview: {
    taskId: '11111111-1111-4111-8111-111111111111',
    version: 2,
    currentCount: 42,
    ownerConfirmedCount: 12,
    removedCount: 30,
    addedCount: 0,
    preservedChecks: 0,
    canApply: true,
    blockedReason: null as null | string,
  },
}));

vi.mock('../../../hooks/useOwnerWorkspace', () => ({
  useOwnerQuery: (key: unknown[], _path: string) =>
    key[0] === 'task-location-asset-inventory-reconcile-preview'
      ? {
          data: state.preview,
          isFetching: false, error: null, refetch: state.refetchPreview,
        }
      : {
          data: {
            taskId: state.preview.taskId,
            locationId: '22222222-2222-4222-8222-222222222222',
            assignmentId: '33333333-3333-4333-8333-333333333333',
            status: 'InProgress',
            version: 2, totalCount: 42, checkedCount: 0,
            items: [], pendingOwnerRooms: ['P.201', 'P.202'], pendingOwnerCommonAssets: true,
          },
          isFetching: false, error: null, refetch: state.refetchInventory,
        },
  useOwnerAction: () => ({
    busy: false, error: '',
    run: async (work: () => Promise<unknown>) => {
      await work();
      return true;
    },
    command: state.command,
  }),
}));
vi.mock('../../../components/common/OwnerWorkspace', () => ({
  OwnerFeedback: () => null,
}));

beforeEach(() => {
  state.command.mockReset().mockResolvedValue({});
  state.refetchInventory.mockReset().mockResolvedValue({});
  state.refetchPreview.mockReset().mockResolvedValue({});
  state.preview.canApply = true;
  state.preview.blockedReason = null;
});
afterEach(cleanup);

it('requires explicit Owner confirmation before replacing an old 42-item task with 12 attested items', async () => {
  render(<LocationAssetInventoryReport taskId={state.preview.taskId} />);
  expect(screen.getByText(/Checklist hiện tại: 42 mục/)).toBeTruthy();
  expect(screen.getByText(/Đã được Owner kiểm kê: 12 mục/)).toBeTruthy();
  expect(screen.getByText(/Còn 2 phòng/)).toBeTruthy();
  const action = screen.getByRole('button', { name: 'Đồng bộ checklist đã xác nhận' });
  expect(action).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Tôi đã đối chiếu và đồng ý cập nhật danh sách/));
  expect(action).toBeEnabled();
  fireEvent.click(action);
  await waitFor(() => expect(state.command).toHaveBeenCalledWith(
    '/api/v1/operational-tasks/' + state.preview.taskId + '/location-asset-inventory/reconcile',
    'POST', { version: 2, confirmed: true },
  ));
  expect(state.refetchInventory).toHaveBeenCalledTimes(1);
  expect(state.refetchPreview).toHaveBeenCalledTimes(1);
});

it('never applies an Owner baseline replacement that would discard checked Staff evidence', () => {
  state.preview.canApply = false;
  state.preview.blockedReason = 'location_asset_inventory_staff_work_conflict';
  render(<LocationAssetInventoryReport taskId={state.preview.taskId} />);
  expect(screen.getByText(/Cần đối soát thủ công để tránh mất dữ liệu/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng bộ checklist đã xác nhận' })).toBeNull();
  expect(state.command).not.toHaveBeenCalled();
});
