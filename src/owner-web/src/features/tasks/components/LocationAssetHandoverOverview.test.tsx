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

it('shows the five completed steps, factual KPIs and signed PDF action without a pending-task prompt', async () => {
  const onOpenTab = renderOverview();
  expect(await screen.findByText('Hai bên đã hoàn tất bàn giao')).toBeVisible();
  expect(screen.getByText('26/26')).toBeVisible();
  expect(screen.getByText('2/2')).toBeVisible();
  expect(screen.queryByText('Phiên bản 1')).not.toBeInTheDocument();
  expect(screen.getByTestId('handover-kpi-assets')).toHaveAttribute('data-tone', 'success');
  expect(screen.getByTestId('handover-kpi-notes')).toHaveAttribute('data-tone', 'warning');
  expect(screen.getByTestId('handover-kpi-signatures')).toHaveAttribute('data-tone', 'success');
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
  expect(screen.getByText('2 mục có ghi chú')).toBeVisible();
  expect(screen.getByTestId('handover-attention-notes')).toHaveAttribute(
    'data-severity',
    'warning',
  );
  expect(screen.queryByTestId('handover-attention-incidents')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản đã ký' }));
  expect(onOpenTab).toHaveBeenCalledWith('handover');
});

it('highlights Owner verification and notes without interpreting all notes as missing assets', async () => {
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
  expect(screen.getByText('24/26')).toBeVisible();
  expect(screen.getByTestId('handover-kpi-assets')).toHaveAttribute('data-tone', 'warning');
  expect(screen.getByText('2 mục có ghi chú')).toBeVisible();
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
  expect(await screen.findByText('Owner cần đối chiếu và đồng bộ checklist')).toBeVisible();
  expect(screen.getByText('Bước 1 · Đang xử lý')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu checklist' }));
  expect(onOpenTab).toHaveBeenCalledWith('inventory');
});

it('distinguishes Owner signing from waiting for the Staff signature', async () => {
  mocks.report = { ...report, status: 'PendingStaffSignature', staffSignature: null };
  const onOpenTab = renderOverview({ ...baseTask, status: 'PendingVerification' });
  expect(await screen.findByText('Đang chờ Staff ký nhận')).toBeVisible();
  expect(screen.getByText('Bước 5 · Đang xử lý')).toBeVisible();
  expect(screen.getByText('1/2')).toBeVisible();
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
  expect(screen.getAllByText('—')).toHaveLength(1);
});

it('shows linked incidents in red and notes in yellow without hiding either context', async () => {
  mocks.inventory = {
    ...inventory,
    items: [
      { checked: true, condition: 'Intact', note: 'Đã kiểm tra', incidentId: 'incident-1' },
      { checked: true, condition: 'Missing', note: null, incidentId: null },
    ],
  };
  renderOverview();
  expect(await screen.findByText('Hai bên đã hoàn tất bàn giao')).toBeVisible();
  expect(screen.getByText('1 mục liên quan sự cố')).toBeVisible();
  expect(screen.getByTestId('handover-attention-incidents')).toHaveAttribute(
    'data-severity',
    'error',
  );
  expect(screen.getByTestId('handover-attention-notes')).toHaveAttribute(
    'data-severity',
    'warning',
  );
  expect(screen.getByTestId('handover-attention-exceptions')).toHaveAttribute(
    'data-severity',
    'error',
  );
});
