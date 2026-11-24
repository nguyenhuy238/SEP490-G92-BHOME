// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LocationAssetInventoryReport } from './LocationAssetInventoryReport';

const state = vi.hoisted(() => ({
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
  status: 'InProgress',
  totalCount: 42,
  checkedCount: 0,
  pendingOwnerRooms: ['P.201', 'P.202'],
  pendingOwnerCommonAssets: true,
}));

vi.mock('../../../hooks/useOwnerWorkspace', () => ({
  useOwnerQuery: (key: unknown[]) =>
    key[0] === 'task-location-asset-inventory-reconcile-preview'
      ? {
          data: state.preview,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }
      : {
          data: {
            taskId: state.preview.taskId,
            locationId: '22222222-2222-4222-8222-222222222222',
            assignmentId: '33333333-3333-4333-8333-333333333333',
            status: state.status,
            version: 2,
            totalCount: state.totalCount,
            checkedCount: state.checkedCount,
            items: state.items,
            pendingOwnerRooms: state.pendingOwnerRooms,
            pendingOwnerCommonAssets: state.pendingOwnerCommonAssets,
          },
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        },
}));
vi.mock('../../../components/common/OwnerWorkspace', () => ({
  OwnerFeedback: () => null,
}));

beforeEach(() => {
  state.preview.currentCount = 42;
  state.preview.ownerConfirmedCount = 12;
  state.preview.addedCount = 0;
  state.preview.removedCount = 30;
  state.preview.canApply = true;
  state.preview.blockedReason = null;
  state.items = [];
  state.status = 'InProgress';
  state.totalCount = 42;
  state.checkedCount = 0;
  state.pendingOwnerRooms = ['P.201', 'P.202'];
  state.pendingOwnerCommonAssets = true;
});
afterEach(cleanup);

it('shows a read-only Owner scope summary and routes pending confirmations to Owner inventory', () => {
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText('Phạm vi Owner: 12 mục xác nhận · checklist 42 mục')).toBeTruthy();
  expect(screen.getByText('Staff đã kiểm tra')).toBeTruthy();
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.getByText(/Cần Owner xác nhận 2 phòng/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Mở kiểm kê tài sản của Owner' })).toHaveAttribute(
    'href',
    '/locations/22222222-2222-4222-8222-222222222222/assets?tab=review',
  );
  expect(screen.queryByRole('button', { name: /đối chiếu|đồng bộ/i })).toBeNull();
});

it('preserves the Staff conflict warning without offering a manual reconciliation action', () => {
  state.preview.canApply = false;
  state.preview.blockedReason = 'location_asset_inventory_staff_work_conflict';
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Kết quả Staff được giữ nguyên/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng bộ checklist đã xác nhận' })).toBeNull();
  expect(screen.getByText(/Cần Owner xác nhận 2 phòng/)).toBeTruthy();
});

it('does not show green completion for a fully checked checklist with unmatched Owner scope', () => {
  state.totalCount = 1;
  state.checkedCount = 1;
  state.preview.currentCount = 1;
  state.preview.ownerConfirmedCount = 2;
  state.preview.removedCount = 0;
  state.preview.addedCount = 1;
  state.pendingOwnerRooms = [];
  state.pendingOwnerCommonAssets = false;
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Checklist hiện tại chưa khớp phạm vi Owner/)).toBeTruthy();
  expect(screen.getByRole('progressbar')).toHaveClass('MuiLinearProgress-colorPrimary');
  expect(screen.queryByRole('link', { name: 'Mở kiểm kê tài sản của Owner' })).toBeNull();
  expect(screen.queryByRole('button', { name: /đối chiếu|đồng bộ/i })).toBeNull();
});

it('offers the Owner confirmation link when no rooms are listed but the baseline is missing', () => {
  state.preview.blockedReason = 'location_asset_inventory_owner_confirmation_required';
  state.pendingOwnerRooms = [];
  state.pendingOwnerCommonAssets = false;
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Owner chưa xác nhận phạm vi tài sản/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Mở kiểm kê tài sản của Owner' })).toBeTruthy();
});

it('asks for common-area confirmation without saying zero rooms are pending', () => {
  state.pendingOwnerRooms = [];
  state.pendingOwnerCommonAssets = true;
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Cần Owner xác nhận tài sản khu vực chung/)).toBeTruthy();
  expect(screen.queryByText(/0 phòng/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Mở kiểm kê tài sản của Owner' })).toBeTruthy();
});

it('shows success only after the nonempty checklist and Owner scope are both aligned', () => {
  state.totalCount = 1;
  state.checkedCount = 1;
  state.preview.currentCount = 1;
  state.preview.ownerConfirmedCount = 1;
  state.preview.removedCount = 0;
  state.preview.addedCount = 0;
  state.preview.blockedReason = 'location_asset_inventory_reconciliation_locked';
  state.pendingOwnerRooms = [];
  state.pendingOwnerCommonAssets = false;
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('progressbar')).toHaveClass('MuiLinearProgress-colorSuccess');
  expect(screen.getByText('Owner đã xác nhận đủ phạm vi')).toBeTruthy();
  expect(screen.queryByText(/Phạm vi Owner:/)).toBeNull();
  expect(screen.queryByRole('link', { name: 'Mở kiểm kê tài sản của Owner' })).toBeNull();
  expect(screen.queryByRole('button', { name: /đối chiếu|đồng bộ/i })).toBeNull();
});

it('keeps the completed signed baseline distinct from later live Owner changes', () => {
  state.status = 'Completed';
  state.totalCount = 1;
  state.checkedCount = 1;
  state.preview.currentCount = 1;
  state.preview.ownerConfirmedCount = 2;
  state.preview.addedCount = 1;
  state.preview.removedCount = 0;
  state.pendingOwnerRooms = ['P.909'];
  state.pendingOwnerCommonAssets = false;
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Phạm vi bàn giao đã hoàn tất được lưu theo biên bản đã ký/)).toBeTruthy();
  expect(screen.getByRole('progressbar')).toHaveClass('MuiLinearProgress-colorSuccess');
  expect(screen.queryByText(/Checklist hiện tại chưa khớp phạm vi Owner/)).toBeNull();
  expect(screen.queryByRole('link', { name: 'Mở kiểm kê tài sản của Owner' })).toBeNull();
});

it('keeps the Staff conflict visible when counts match but confirmed item details differ', () => {
  state.totalCount = 1;
  state.checkedCount = 1;
  state.preview.currentCount = 1;
  state.preview.ownerConfirmedCount = 1;
  state.preview.removedCount = 0;
  state.preview.addedCount = 0;
  state.preview.blockedReason = 'location_asset_inventory_staff_work_conflict';
  state.pendingOwnerRooms = [];
  state.pendingOwnerCommonAssets = false;
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId={state.preview.taskId} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Kết quả Staff được giữ nguyên/)).toBeTruthy();
  expect(screen.getByRole('progressbar')).toHaveClass('MuiLinearProgress-colorPrimary');
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
  expect(screen.queryByText('Đã kiểm tra', { exact: true })).toBeNull();
  expect(screen.getByText('Quạt không quay khi bật công tắc.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Xem báo cáo sự cố' })).toHaveAttribute(
    'href',
    '/incidents?locationId=22222222-2222-4222-8222-222222222222&incidentId=77777777-7777-4777-8777-777777777777',
  );
});
