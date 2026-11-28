// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OwnerTask } from '../taskContracts';
import { LocationAssetHandoverOverview } from './LocationAssetHandoverOverview';

const mocks = vi.hoisted(() => ({
  inventory: null as Record<string, unknown> | null,
  reconciliation: null as Record<string, unknown> | null,
  report: null as Record<string, unknown> | null,
  request: vi.fn(),
}));

vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('../../meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: mocks.request }),
}));
vi.mock('../../../hooks/useOwnerWorkspace', () => ({
  useOwnerQuery: (key: string[]) => ({
    data:
      key[0] === 'task-location-asset-inventory-reconcile-preview'
        ? mocks.reconciliation
        : mocks.inventory,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

const baseTask = {
  id: 'task-1',
  locationId: 'location-1',
  title: 'Kiểm tra tài sản toàn cơ sở',
  kind: 'LocationAssetHandover',
  status: 'Completed',
  requirements: 'Kiểm tra toàn bộ',
} as OwnerTask;

const inventory = {
  locationId: 'location-1',
  totalCount: 26,
  checkedCount: 26,
  pendingOwnerRooms: [],
  pendingOwnerCommonAssets: false,
  items: [
    { checked: true, condition: 'Intact', note: 'Đã thử thiết bị', incidentId: null },
    { checked: true, condition: 'Intact', note: 'Có dấu sử dụng', incidentId: null },
    { checked: true, condition: 'Intact', note: null, incidentId: null },
  ],
};

const report = {
  revision: 1,
  status: 'Completed',
  approvedAt: '2026-11-22T10:00:00Z',
  ownerSignature: { actorId: 'owner', signedAt: '2026-11-23T08:03:00Z' },
  staffSignature: { actorId: 'staff', signedAt: '2026-11-23T08:05:00Z' },
};

beforeEach(() => {
  mocks.inventory = inventory;
  mocks.reconciliation = {
    currentCount: 26,
    ownerConfirmedCount: 26,
    addedCount: 0,
    removedCount: 0,
  };
  mocks.report = report;
  mocks.request.mockReset();
  mocks.request.mockImplementation(async () => mocks.report);
});
afterEach(cleanup);

function renderOverview(task: OwnerTask = baseTask) {
  const onOpenTab = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <LocationAssetHandoverOverview task={task} onOpenTab={onOpenTab} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onOpenTab;
}

it('keeps five completed green steps and signed PDF action without duplicated KPIs', async () => {
  const onOpenTab = renderOverview();
  expect(await screen.findByText('Hai bên đã hoàn tất bàn giao')).toBeVisible();
  expect(screen.queryByText('Kết quả bàn giao')).not.toBeInTheDocument();
  expect(screen.queryByText('Thông tin cần chú ý')).not.toBeInTheDocument();
  expect(screen.queryByTestId('handover-kpi-assets')).not.toBeInTheDocument();
  expect(screen.queryByText('2 mục có ghi chú')).not.toBeInTheDocument();
  expect(screen.getByText('Bước 5 · Hoàn tất')).toBeVisible();
  for (let step = 1; step <= 5; step += 1) {
    expect(screen.getByTestId(`handover-step-${step}`)).toHaveAttribute('data-state', 'done');
    expect(screen.getByLabelText(`Đã hoàn tất bước ${step}`)).toBeVisible();
  }
  expect(screen.getByTestId('handover-next-action')).toHaveAttribute('data-state', 'completed');
  expect(screen.getByLabelText('Bàn giao đã hoàn tất')).toBeVisible();
  expect(
    window.getComputedStyle(screen.getByTestId('handover-next-action')).backgroundColor,
  ).not.toBe('rgba(0, 0, 0, 0)');
  expect(screen.queryByText(/Việc cần xử lý/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản đã ký' }));
  expect(onOpenTab).toHaveBeenCalledWith('handover');
});

it('highlights Owner verification without duplicating progress or note counters', async () => {
  mocks.report = null;
  mocks.inventory = {
    ...inventory,
    checkedCount: 24,
    items: [
      { checked: true, condition: 'Intact', note: 'Ghi chú', incidentId: null },
      { checked: true, condition: 'Intact', note: 'Theo dõi', incidentId: null },
      { checked: false, condition: 'Unassessed', note: null, incidentId: null },
    ],
  };
  const onOpenTab = renderOverview({ ...baseTask, status: 'PendingVerification' });
  expect(await screen.findByText('Owner cần đối soát kết quả Staff')).toBeVisible();
  expect(screen.getByText('Bước 3 · Đang xử lý')).toBeVisible();
  expect(screen.getByTestId('handover-step-1')).toHaveAttribute('data-state', 'done');
  expect(screen.getByTestId('handover-step-2')).toHaveAttribute('data-state', 'done');
  expect(screen.getByTestId('handover-step-3')).toHaveAttribute('data-state', 'current');
  expect(screen.getByTestId('handover-step-3')).toHaveAttribute('aria-current', 'step');
  expect(screen.getByTestId('handover-step-4')).toHaveAttribute('data-state', 'pending');
  expect(screen.getByTestId('handover-next-action')).toHaveAttribute('data-state', 'in-progress');
  expect(window.getComputedStyle(screen.getByTestId('handover-step-3')).backgroundColor).not.toBe(
    window.getComputedStyle(screen.getByTestId('handover-step-4')).backgroundColor,
  );
  expect(window.getComputedStyle(screen.getByTestId('handover-step-1')).backgroundColor).not.toBe(
    window.getComputedStyle(screen.getByTestId('handover-step-4')).backgroundColor,
  );
  expect(screen.queryByText('24/26')).not.toBeInTheDocument();
  expect(screen.queryByText('2 mục có ghi chú')).not.toBeInTheDocument();
  expect(screen.queryByText(/mục thiếu, hỏng hoặc không thể kiểm tra/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đối soát kiểm kê' }));
  expect(onOpenTab).toHaveBeenCalledWith('inventory');
});

it('routes missing Owner confirmations to the correct location inventory page', async () => {
  mocks.inventory = {
    ...inventory,
    checkedCount: 12,
    pendingOwnerRooms: ['P.101', 'P.102'],
    pendingOwnerCommonAssets: true,
  };
  mocks.report = null;
  renderOverview({ ...baseTask, status: 'InProgress' });
  expect(await screen.findByText('Owner cần xác nhận phạm vi tài sản')).toBeVisible();
  expect(screen.getByText('Bước 1 · Đang xử lý')).toBeVisible();
  expect(screen.getByTestId('handover-step-1')).toHaveAttribute('data-state', 'current');
  expect(screen.getByTestId('handover-step-2')).toHaveAttribute('data-state', 'pending');
  expect(screen.queryByLabelText('Bàn giao đã hoàn tất')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở kiểm kê của Owner' })).toHaveAttribute(
    'href',
    '/locations/location-1/assets?tab=review',
  );
});

it('does not mark Owner scope complete when the submitted checklist still differs from Owner confirmation', async () => {
  mocks.report = null;
  mocks.reconciliation = {
    currentCount: 42,
    ownerConfirmedCount: 12,
    addedCount: 0,
    removedCount: 30,
  };
  const onOpenTab = renderOverview({ ...baseTask, status: 'InProgress' });
  expect(await screen.findByText('Phạm vi Owner và checklist chưa khớp')).toBeVisible();
  expect(screen.getByText('Bước 1 · Đang xử lý')).toBeVisible();
  expect(screen.getByTestId('handover-step-1')).toHaveAttribute('data-state', 'current');
  expect(screen.getByTestId('handover-step-2')).toHaveAttribute('data-state', 'pending');
  fireEvent.click(screen.getByRole('button', { name: 'Xem kiểm kê tài sản' }));
  expect(onOpenTab).toHaveBeenCalledWith('inventory');
});

it('blocks the first milestone for a Staff conflict even when item counts match', async () => {
  mocks.report = null;
  mocks.reconciliation = {
    currentCount: 26,
    ownerConfirmedCount: 26,
    addedCount: 0,
    removedCount: 0,
    blockedReason: 'location_asset_inventory_staff_work_conflict',
  };
  const onOpenTab = renderOverview({ ...baseTask, status: 'InProgress' });
  expect(await screen.findByText('Phạm vi Owner xung đột với kết quả Staff')).toBeVisible();
  expect(screen.getByTestId('handover-step-1')).toHaveAttribute('data-state', 'current');
  expect(screen.getByTestId('handover-step-2')).toHaveAttribute('data-state', 'pending');
  expect(screen.queryByTestId('handover-attention-scope')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Bàn giao đã hoàn tất')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả kiểm kê' }));
  expect(onOpenTab).toHaveBeenCalledWith('inventory');
});

it('shows a natural Owner confirmation prompt when only common-area assets are pending', async () => {
  mocks.report = null;
  mocks.inventory = {
    ...inventory,
    pendingOwnerRooms: [],
    pendingOwnerCommonAssets: true,
  };
  renderOverview({ ...baseTask, status: 'InProgress' });
  expect(await screen.findByText('Owner cần xác nhận phạm vi tài sản')).toBeVisible();
  expect(screen.getByText(/Còn tài sản khu vực chung chưa xác nhận/)).toBeVisible();
  expect(screen.queryByText(/Còn 0 phòng/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở kiểm kê của Owner' })).toHaveAttribute(
    'href',
    '/locations/location-1/assets?tab=review',
  );
});

it('keeps a historically signed and completed handover green after the live Owner baseline changes', async () => {
  mocks.inventory = {
    ...inventory,
    pendingOwnerRooms: ['P.909'],
    pendingOwnerCommonAssets: true,
  };
  mocks.reconciliation = {
    currentCount: 26,
    ownerConfirmedCount: 27,
    addedCount: 1,
    removedCount: 0,
    blockedReason: 'location_asset_inventory_reconciliation_locked',
  };
  renderOverview();
  expect(await screen.findByText('Hai bên đã hoàn tất bàn giao')).toBeVisible();
  expect(screen.getByTestId('handover-next-action')).toHaveAttribute('data-state', 'completed');
  for (let step = 1; step <= 5; step += 1) {
    expect(screen.getByTestId(`handover-step-${step}`)).toHaveAttribute('data-state', 'done');
  }
  expect(screen.queryByText('Owner cần xác nhận phạm vi tài sản')).not.toBeInTheDocument();
});

it('distinguishes Owner signing from waiting for the Staff signature', async () => {
  mocks.report = { ...report, status: 'PendingStaffSignature', staffSignature: null };
  const onOpenTab = renderOverview({ ...baseTask, status: 'PendingVerification' });
  expect(await screen.findByText('Đang chờ Staff ký nhận')).toBeVisible();
  expect(screen.getByText('Bước 5 · Đang xử lý')).toBeVisible();
  expect(screen.queryByText('1/2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản chờ ký' }));
  expect(onOpenTab).toHaveBeenCalledWith('handover');
});

it('does not claim completion when task is completed but the signed report is unavailable', async () => {
  mocks.report = null;
  renderOverview();
  expect(await screen.findByText('Cần đối chiếu trạng thái công việc và biên bản')).toBeVisible();
  expect(screen.queryByText('Hai bên đã hoàn tất bàn giao')).not.toBeInTheDocument();
  expect(screen.getByTestId('handover-next-action')).toHaveAttribute('data-state', 'in-progress');
  expect(screen.queryByLabelText('Bàn giao đã hoàn tất')).not.toBeInTheDocument();
  expect(screen.queryByText('—')).not.toBeInTheDocument();
});

it('keeps signed handover compact when historical checklist contains incidents and notes', async () => {
  mocks.inventory = {
    ...inventory,
    items: [
      { checked: true, condition: 'Intact', note: 'Đã kiểm tra', incidentId: 'incident-1' },
      { checked: true, condition: 'Missing', note: null, incidentId: null },
    ],
  };
  renderOverview();
  expect(await screen.findByText('Hai bên đã hoàn tất bàn giao')).toBeVisible();
  expect(screen.queryByText('1 mục liên quan sự cố')).not.toBeInTheDocument();
  expect(screen.queryByText('Thông tin cần chú ý')).not.toBeInTheDocument();
  expect(screen.getByTestId('handover-next-action')).toHaveAttribute('data-state', 'completed');
});
