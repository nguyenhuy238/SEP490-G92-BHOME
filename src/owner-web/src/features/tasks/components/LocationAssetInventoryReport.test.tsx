// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
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
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../hooks/useOwnerWorkspace', () => ({
  useOwnerQuery: (key: unknown[]) =>
    key[0] === 'task-location-asset-inventory-reconcile-preview'
      ? {
          data: state.preview,
          isFetching: false,
          error: null,
          refetch: state.refetchPreview,
        }
      : {
          data: {
            taskId: state.preview.taskId,
            locationId: '22222222-2222-4222-8222-222222222222',
            assignmentId: '33333333-3333-4333-8333-333333333333',
            status: 'InProgress',
            version: 2,
            totalCount: 42,
            checkedCount: 0,
            items: state.items,
            pendingOwnerRooms: ['P.201', 'P.202'],
            pendingOwnerCommonAssets: true,
          },
          isFetching: false,
          error: null,
          refetch: state.refetchInventory,
        },
  useOwnerAction: () => ({
    busy: false,
    error: '',
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
  state.items = [];
});
afterEach(cleanup);

it('requires explicit Owner confirmation before replacing an old 42-item task with 12 attested items', async () => {
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText('Checklist hiện tại')).toBeTruthy();
  expect(screen.getByText('42', { exact: true })).toBeTruthy();
  expect(screen.getByText('Owner đã xác nhận')).toBeTruthy();
  expect(screen.getByText('12', { exact: true })).toBeTruthy();
  expect(screen.getByText(/Cần Owner xác nhận 2 phòng/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu / đồng bộ' }));
  expect(screen.getByText(/30 mục chưa được Owner xác nhận/)).toBeTruthy();
  const action = screen.getByRole('button', { name: 'Đồng bộ checklist đã xác nhận' });
  expect(action).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Tôi đã đối chiếu và đồng ý cập nhật checklist/));
  expect(action).toBeEnabled();
  fireEvent.click(action);
  await waitFor(() =>
    expect(state.command).toHaveBeenCalledWith(
      '/api/v1/operational-tasks/' + state.preview.taskId + '/location-asset-inventory/reconcile',
      'POST',
      { version: 2, confirmed: true },
    ),
  );
  expect(state.refetchInventory).toHaveBeenCalledTimes(1);
  expect(state.refetchPreview).toHaveBeenCalledTimes(1);
});

it('never applies an Owner baseline replacement that would discard checked Staff evidence', () => {
  state.preview.canApply = false;
  state.preview.blockedReason = 'location_asset_inventory_staff_work_conflict';
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu / đồng bộ' }));
  expect(screen.getByText(/Cần đối soát thủ công để tránh mất dữ liệu/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng bộ checklist đã xác nhận' })).toBeNull();
  expect(state.command).not.toHaveBeenCalled();
});

it('shows Staff-observed asset condition and linked incident context for Owner review', () => {
  state.items = [
    {
      id: '44444444-4444-4444-8444-444444444444',
      roomId: '55555555-5555-4555-8555-555555555555',
      roomNumber: '101',
      assetId: '66666666-6666-4666-8666-666666666666',
      name: 'Quạt trần',
      quantity: 1,
      commonArea: null,
      checked: true,
      condition: 'Damaged',
      inherited: false,
      sourceHandoverContractId: null,
      note: 'Quạt không quay khi bật công tắc.',
      incidentId: '77777777-7777-4777-8777-777777777777',
    },
  ];
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Phòng 101/ }));
  expect(screen.getByText('Tài sản hư hỏng')).toBeTruthy();
  expect(screen.getByText('Quạt không quay khi bật công tắc.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Xem báo cáo sự cố' })).toHaveAttribute(
    'href',
    '/incidents?locationId=22222222-2222-4222-8222-222222222222&incidentId=77777777-7777-4777-8777-777777777777',
  );
});
