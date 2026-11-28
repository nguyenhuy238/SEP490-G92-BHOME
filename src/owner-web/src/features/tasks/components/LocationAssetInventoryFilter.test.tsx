// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocationAssetInventoryReport } from './LocationAssetInventoryReport';

const state = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  preview: null as null | {
    taskId: string;
    version: number;
    currentCount: number;
    ownerConfirmedCount: number;
    addedCount: number;
    removedCount: number;
    preservedChecks: number;
    canApply: boolean;
    blockedReason: null;
  },
}));

vi.mock('../../../hooks/useOwnerWorkspace', () => ({
  useOwnerQuery: (key: string[]) => ({
    data:
      key[0] === 'task-location-asset-inventory-reconcile-preview'
        ? state.preview
        : {
            taskId: 'task-1',
            locationId: 'location-1',
            assignmentId: 'assignment-1',
            status: 'PendingVerification',
            version: 1,
            totalCount: state.items.length,
            checkedCount: state.items.filter((item) => item.checked).length,
            items: state.items,
            pendingOwnerRooms: ['P.205'],
            pendingOwnerCommonAssets: false,
          },
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../components/common/OwnerWorkspace', () => ({
  OwnerFeedback: () => null,
}));

beforeEach(() => {
  state.preview = null;
  state.items = [
    {
      id: 'checked-noted',
      roomId: 'room-101',
      roomNumber: '101',
      assetId: 'asset-1',
      name: 'Quạt trần',
      quantity: 1,
      commonArea: null,
      checked: true,
      inherited: false,
      sourceHandoverContractId: null,
      note: 'Cần thay cánh quạt',
      incidentId: null,
    },
    {
      id: 'unchecked',
      roomId: 'room-102',
      roomNumber: '102',
      assetId: 'asset-2',
      name: 'Giường đơn',
      quantity: 1,
      commonArea: null,
      checked: false,
      inherited: false,
      sourceHandoverContractId: null,
      note: null,
      incidentId: null,
    },
    {
      id: 'common-noted',
      roomId: null,
      roomNumber: null,
      assetId: 'asset-3',
      name: 'Đèn hành lang',
      quantity: 2,
      commonArea: 'Hành lang',
      checked: false,
      inherited: false,
      sourceHandoverContractId: null,
      note: 'Chưa mở được tủ điện',
      incidentId: null,
    },
    {
      id: 'blank-note',
      roomId: 'room-103',
      roomNumber: '103',
      assetId: 'asset-4',
      name: 'Tủ đồ',
      quantity: 1,
      commonArea: null,
      checked: true,
      inherited: false,
      sourceHandoverContractId: null,
      note: '  ',
      incidentId: null,
    },
  ];
});

afterEach(cleanup);

it('shows read-only scope counts without a manual synchronization control', () => {
  state.preview = {
    taskId: 'task-1',
    version: 1,
    currentCount: 4,
    ownerConfirmedCount: 4,
    addedCount: 0,
    removedCount: 0,
    preservedChecks: 0,
    canApply: true,
    blockedReason: null,
  };
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId="task-1" />
    </MemoryRouter>,
  );

  expect(screen.getByText('Phạm vi Owner: 4 mục xác nhận · checklist 4 mục')).toBeTruthy();
  expect(screen.getByText('Staff đã kiểm tra')).toBeTruthy();
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /đối chiếu|đồng bộ/i })).toBeNull();
  expect(screen.getByText(/Cần Owner xác nhận 1 phòng/)).toBeTruthy();
});

it('counts real unchecked and nonblank notes, showing only matching room groups', () => {
  render(
    <MemoryRouter>
      <LocationAssetInventoryReport taskId="task-1" />
    </MemoryRouter>,
  );

  expect(screen.getByRole('button', { name: 'Tất cả (4)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Chưa kiểm tra (2)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Có ghi chú (2)' })).toBeTruthy();
  expect(screen.getByText('Chưa xác minh được phạm vi Owner.')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Có ghi chú (2)' }));
  expect(screen.getByRole('button', { name: /Phòng 101/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Khu vực chung · Hành lang/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Phòng 102/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Phòng 103/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Chưa kiểm tra (2)' }));
  expect(screen.getByRole('button', { name: /Phòng 102/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Khu vực chung · Hành lang/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Phòng 101/ })).toBeNull();
  expect(screen.getByText(/Cần Owner xác nhận 1 phòng/)).toBeTruthy();
});

it('keeps pending recheck selections after changing filters', () => {
  function ControlledReport() {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    return (
      <MemoryRouter>
        <span data-testid="selected-ids">{selectedIds.join(',')}</span>
        <LocationAssetInventoryReport
          taskId="task-1"
          selectable
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
        />
      </MemoryRouter>
    );
  }

  render(<ControlledReport />);
  fireEvent.click(screen.getByRole('button', { name: 'Có ghi chú (2)' }));
  fireEvent.click(screen.getByRole('button', { name: /Phòng 101/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kiểm tra lại' }));
  expect(screen.getByTestId('selected-ids').textContent).toBe('checked-noted');

  fireEvent.click(screen.getByRole('button', { name: 'Chưa kiểm tra (2)' }));
  fireEvent.click(screen.getByRole('button', { name: /Phòng 102/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kiểm tra lại' }));
  expect(screen.getByTestId('selected-ids').textContent).toBe('checked-noted,unchecked');

  fireEvent.click(screen.getByRole('button', { name: 'Tất cả (4)' }));
  expect(screen.getAllByText('1 mục chọn kiểm tra lại')).toHaveLength(2);
  expect(screen.getByTestId('selected-ids').textContent).toBe('checked-noted,unchecked');
});
