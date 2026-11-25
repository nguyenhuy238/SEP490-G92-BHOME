// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OwnerTask, TaskHistory } from '../taskContracts';
import { TaskDetailDrawer } from './TaskDetailDrawer';

const progress: TaskHistory[] = Array.from({ length: 25 }, (_, index) => ({
  id: 'progress-' + index,
  action: 'progress',
  note: 'Đã kiểm tra mục thứ ' + index,
  actorId: '11111111-2222-3333-4444-555555555555',
  occurredAt: new Date(Date.UTC(2026, 10, 23, 10, 0, -index)).toISOString(),
  taskVersion: 5,
  responsibleStaffUserId: null,
}));
const milestones: TaskHistory[] = [
  {
    id: 'signed-1',
    action: 'location_asset_handover_owner_signed',
    note: 'Owner ký lần đầu',
    actorId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    occurredAt: '2026-11-22T02:00:00Z',
    taskVersion: 5,
    responsibleStaffUserId: null,
  },
  {
    id: 'signed-2',
    action: 'location_asset_handover_owner_signed',
    note: 'Bản ghi lặp từ dữ liệu cũ',
    actorId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    occurredAt: '2026-11-22T01:00:00Z',
    taskVersion: 5,
    responsibleStaffUserId: null,
  },
  {
    id: 'completed',
    action: 'location_asset_handover_completed',
    note: 'Hai bên đã ký',
    actorId: '11111111-2222-3333-4444-555555555555',
    occurredAt: '2026-11-22T00:00:00Z',
    taskVersion: 6,
    responsibleStaffUserId: null,
  },
];
const allHistory = [...progress, ...milestones];
const completedTask: OwnerTask = {
  id: 'task-1',
  locationId: 'location-1',
  title: 'Kiểm kê bàn giao cơ sở',
  requirements: 'Kiểm tra tài sản trước khi ký',
  kind: 'LocationAssetHandover',
  status: 'Completed',
  priority: 'Normal',
  dueAt: null,
  evidenceRequired: false,
  isOverdue: false,
  currentResponsibleStaffUserId: null,
  recordedStaffUserId: null,
  responsibilityAvailable: true,
  result: 'Đã kiểm tra',
  version: 6,
  verifiedByUserId: null,
  verifiedAt: null,
};
let task: OwnerTask = completedTask;

vi.mock('../../../hooks/useOwnerWorkspace', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../hooks/useOwnerWorkspace')>();
  return {
    ...original,
    useOwnerQuery: (_key: unknown, url: string) => {
      let data: unknown = null;
      if (url.endsWith('/task-1')) data = task;
      else if (url.includes('/history?')) {
        const pageSize = url.includes('pageSize=100') ? 100 : 20;
        const page = url.includes('page=2&') ? 2 : 1;
        data = {
          items: allHistory.slice((page - 1) * pageSize, page * pageSize),
          totalCount: allHistory.length,
          page,
          pageSize,
        };
      } else if (url.endsWith('/evidence') || url.endsWith('/actors')) data = [];
      return {
        data,
        isFetching: false,
        isPending: false,
        error: null,
        refetch: vi.fn(async () => ({ data, error: null })),
      };
    },
  };
});
vi.mock('../useOperationalTasksApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../useOperationalTasksApi')>();
  return {
    ...original,
    useTaskAction: () => ({
      busy: false,
      error: '',
      conflict: false,
      fields: {},
      run: vi.fn(async () => true),
      command: vi.fn(),
      reviewed: vi.fn(),
    }),
  };
});
vi.mock('../../property/EquipmentInspectionsPanel', () => ({
  TaskInspectionReview: () => <div>Đánh giá kiểm tra kỹ thuật</div>,
}));
vi.mock('./MoveInInventoryReport', () => ({
  MoveInInventoryReport: () => <div>Báo cáo kiểm kê trước bàn giao</div>,
}));
vi.mock('./LocationAssetInventoryReport', () => ({
  LocationAssetInventoryReport: ({
    selectedIds = [],
    onSelectedIdsChange,
  }: {
    selectedIds?: string[];
    onSelectedIdsChange?: (ids: string[]) => void;
  }) => (
    <div>
      <div>Danh sách phòng kiểm kê</div>
      <div>Đang chọn {selectedIds.length} mục</div>
      <button onClick={() => onSelectedIdsChange?.([...selectedIds, 'item-101'])}>
        Chọn tài sản P.101
      </button>
    </div>
  ),
}));
vi.mock('./LocationAssetHandoverPanel', () => ({
  LocationAssetHandoverPanel: ({
    reworkItemIds = [],
    onReworked,
  }: {
    reworkItemIds?: string[];
    onReworked?: () => void;
  }) => (
    <div>
      <div>Phần ký biên bản</div>
      <div>Đã chọn từ danh sách: {reworkItemIds.join(', ') || 'chưa có'}</div>
      <button onClick={onReworked}>Hoàn tất yêu cầu kiểm tra lại</button>
    </div>
  ),
}));
vi.mock('./LocationAssetHandoverOverview', () => ({
  LocationAssetHandoverOverview: ({ onOpenTab }: { onOpenTab: (tab: string) => void }) => (
    <div>
      <div>Quy trình bàn giao</div>
      <button onClick={() => onOpenTab('handover')}>Xem biên bản từ tổng quan</button>
    </div>
  ),
}));
vi.mock('./TaskEvidenceGallery', () => ({
  TaskEvidenceGallery: () => <div>Bằng chứng của công việc</div>,
}));

afterEach(() => {
  cleanup();
  task = completedTask;
});

function openDrawer() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TaskDetailDrawer
        id="task-1"
        staff={[]}
        locationName={() => 'Cơ sở thử nghiệm'}
        close={vi.fn()}
        edit={vi.fn()}
        notify={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return screen.getByRole('dialog', { name: 'Chi tiết công việc' });
}

it('opens the signing tab for a completed handover and keeps the inventory out of view', () => {
  const dialog = openDrawer();
  expect(within(dialog).getByRole('tab', { name: 'Biên bản & ký' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(dialog).getByRole('tabpanel', { name: 'Biên bản & ký' })).toBeVisible();
  expect(within(dialog).getByText('Phần ký biên bản')).toBeVisible();
  expect(within(dialog).getByText('Danh sách phòng kiểm kê')).not.toBeVisible();
  expect(within(dialog).getByText('Cơ sở thử nghiệm · Toàn cơ sở')).toBeVisible();
  expect(within(dialog).getByText('Vị trí')).toBeVisible();
  expect(within(dialog).queryByText('Bạn cần làm gì tiếp theo')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Tổng quan' }));
  expect(within(dialog).getByText('Quy trình bàn giao')).toBeVisible();
  expect(within(dialog).queryByText('Đánh giá kiểm tra kỹ thuật')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('Bằng chứng của công việc')).not.toBeInTheDocument();
  expect(
    within(dialog).queryByText('Xem yêu cầu ban đầu và ghi chú Staff'),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByText('Phần ký biên bản')).not.toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xem biên bản từ tổng quan' }));
  expect(within(dialog).getByText('Phần ký biên bản')).toBeVisible();
});

it('preserves selected inventory items while switching to signing and rework', () => {
  task = { ...completedTask, status: 'PendingVerification' };
  const dialog = openDrawer();
  expect(within(dialog).getByRole('tab', { name: 'Kiểm kê tài sản' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(dialog).getByText('Danh sách phòng kiểm kê')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Chọn tài sản P.101' }));
  expect(within(dialog).getByText('Đang chọn 1 mục')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mở biên bản & ký' }));
  expect(within(dialog).getByText('Đã chọn từ danh sách: item-101')).toBeVisible();
  expect(within(dialog).getByText('Danh sách phòng kiểm kê')).not.toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại kiểm kê tài sản' }));
  expect(within(dialog).getByText('Đang chọn 1 mục')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Biên bản & ký' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hoàn tất yêu cầu kiểm tra lại' }));
  expect(within(dialog).getByText('Đã chọn từ danh sách: chưa có')).toBeVisible();
});

it('keeps handover overview guidance inside its tab while inventory is in progress', () => {
  task = { ...completedTask, status: 'InProgress' };
  const dialog = openDrawer();
  expect(within(dialog).getByRole('tab', { name: 'Kiểm kê tài sản' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(dialog).getByText('Quy trình bàn giao')).not.toBeVisible();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Tổng quan' }));
  expect(within(dialog).getByText('Quy trình bàn giao')).toBeVisible();
  expect(within(dialog).getByText('Phần ký biên bản')).not.toBeVisible();
});

it('shows key handover milestones from beyond page 1, hides duplicate signing and preserves full history', () => {
  const dialog = openDrawer();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Lịch sử' }));
  expect(within(dialog).getAllByText('Owner đã ký xác nhận')).toHaveLength(1);
  expect(within(dialog).getByText('Hai bên hoàn tất ký bàn giao')).toBeVisible();
  expect(within(dialog).queryByText('Cập nhật tiến độ')).not.toBeInTheDocument();
  expect(dialog.textContent).toContain(' · Owner');
  expect(dialog.textContent).toContain(' · Nhân viên');
  expect(dialog.textContent).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

  fireEvent.click(within(dialog).getByRole('button', { name: 'Xem toàn bộ lịch sử' }));
  expect(within(dialog).getAllByText('Cập nhật tiến độ')).toHaveLength(20);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Trang sau' }));
  expect(within(dialog).getAllByText('Owner đã ký xác nhận')).toHaveLength(2);
  expect(within(dialog).getAllByText('Cập nhật tiến độ')).toHaveLength(5);
});

it('shows only overview and history tabs for ordinary tasks', () => {
  task = {
    ...completedTask,
    kind: 'AdHoc',
    title: 'Kiểm tra bóng đèn',
    requirements: 'Kiểm tra bóng đèn còn sáng không',
    result: null,
    status: 'Assigned',
  };
  const dialog = openDrawer();
  expect(within(dialog).getAllByRole('tab')).toHaveLength(2);
  expect(within(dialog).getByRole('tab', { name: 'Tổng quan' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(dialog).queryByRole('tab', { name: 'Kiểm kê tài sản' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('tab', { name: 'Biên bản & ký' })).not.toBeInTheDocument();
  expect(within(dialog).getByText('Quy trình công việc')).toBeVisible();
  expect(within(dialog).queryByText('Đã giao việc · Chờ Staff bắt đầu')).not.toBeInTheDocument();
  expect(within(dialog).getByTestId('operational-step-1')).toHaveAttribute('data-state', 'done');
  expect(within(dialog).getByTestId('operational-step-2')).toHaveAttribute('data-state', 'current');
  expect(within(dialog).getByText('Kiểm tra bóng đèn còn sáng không')).toBeVisible();
  expect(within(dialog).getByText('Chưa có kết quả từ nhân viên.')).toBeVisible();
  expect(within(dialog).queryByText('Đánh giá kiểm tra kỹ thuật')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('Bằng chứng của công việc')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('Biên bản & ký')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Lịch sử' }));
  expect(within(dialog).getByRole('tab', { name: 'Lịch sử' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(dialog).getByText('Hai bên hoàn tất ký bàn giao')).toBeVisible();
  expect(within(dialog).getByText('Quy trình công việc')).not.toBeVisible();
});

it('shows owner verification only after a regular Staff submission and keeps the existing action dialog', async () => {
  task = {
    ...completedTask,
    kind: 'AdHoc',
    status: 'PendingVerification',
    result: 'Đã thay bóng đèn và thử bật sáng',
  };
  const dialog = openDrawer();
  expect(within(dialog).queryByText('Owner cần kiểm tra và nghiệm thu')).not.toBeInTheDocument();
  expect(within(dialog).getByTestId('operational-step-3')).toHaveAttribute('data-state', 'done');
  expect(within(dialog).getByTestId('operational-step-4')).toHaveAttribute('data-state', 'current');
  expect(within(dialog).getByText('Đã thay bóng đèn và thử bật sáng')).toBeVisible();
  expect(within(dialog).getAllByRole('button', { name: 'Nghiệm thu' })).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Nghiệm thu' }));
  expect(await screen.findByRole('dialog', { name: 'Nghiệm thu' })).toBeVisible();
});

it('shows the regular task as completed without a signing or inventory workflow', () => {
  task = {
    ...completedTask,
    kind: 'AdHoc',
    status: 'Completed',
    result: 'Bóng đèn đã sáng bình thường',
    verifiedAt: '2026-11-23T08:05:00Z',
  };
  const dialog = openDrawer();
  expect(
    within(dialog).queryByText('Công việc đã hoàn thành và nghiệm thu'),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByText('Bóng đèn đã sáng bình thường')).toBeVisible();
  expect(within(dialog).getByTestId('operational-step-4')).toHaveAttribute('data-state', 'done');
  expect(within(dialog).getByText(/Owner nghiệm thu:/)).toBeVisible();
  expect(within(dialog).queryByRole('tab', { name: 'Biên bản & ký' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Nghiệm thu' })).not.toBeInTheDocument();
});

it('shows evidence only when available or required for regular operational tasks', () => {
  task = { ...completedTask, kind: 'AdHoc', status: 'InProgress', evidenceRequired: true };
  const dialog = openDrawer();
  expect(within(dialog).queryByText('Bằng chứng của công việc')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Bằng chứng' }));
  expect(within(dialog).getByText('Bắt buộc bằng chứng hoàn thành.')).toBeVisible();
  expect(within(dialog).getByText('Bằng chứng của công việc')).toBeVisible();
});

it('keeps move-in inventory results available in the overview tab', () => {
  task = { ...completedTask, kind: 'MoveInInventory', status: 'PendingVerification' };
  const dialog = openDrawer();
  expect(within(dialog).getAllByRole('tab')).toHaveLength(2);
  expect(within(dialog).getByText('Báo cáo kiểm kê trước bàn giao')).toBeVisible();
  expect(within(dialog).getByText('Bằng chứng của công việc')).toBeVisible();
});
