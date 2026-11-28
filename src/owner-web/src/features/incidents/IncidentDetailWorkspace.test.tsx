// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IncidentDetailWorkspace } from './IncidentDetailWorkspace';
import { WorkOrderDetailWorkspace } from './WorkOrderDetailWorkspace';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  incident: {} as Record<string, unknown>,
  orders: [] as Record<string, unknown>[],
}));
vi.mock('../meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: mocks.request }),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner-1', roles: ['Owner'] } }),
}));

const baseIncident = {
  id: 'incident',
  code: 'INC-001',
  locationId: 'location',
  roomId: 'room',
  assetId: 'asset',
  locationName: 'Cơ sở Đầu Tiên',
  roomNumber: 'P.101',
  assetName: 'Bóng đèn',
  commonArea: null,
  description: 'Không thấy bóng đèn',
  severity: 'Normal',
  status: 'Submitted',
  type: null,
  category: null,
  createdAt: '2026-11-22T16:14:00Z',
  acknowledgedAt: null,
  resolutionNote: null,
  version: 7,
  staffAvailable: true,
  escalationEnabled: false,
  openWorkOrderStatus: null,
};

beforeEach(() => {
  mocks.incident = { ...baseIncident };
  mocks.orders = [];
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (url: string) => {
    if (url === '/api/v1/incidents/incident') return mocks.incident;
    if (url.startsWith('/api/v1/work-orders?')) {
      return { items: mocks.orders, totalCount: mocks.orders.length, page: 1, pageSize: 20 };
    }
    const selectedWork = mocks.orders.find((work) => url === '/api/v1/work-orders/' + work.id);
    if (selectedWork) return selectedWork;
    if (url === '/api/v1/staff-location-assignments?locationId=location') {
      return [{ staffUserId: 'staff-1', startDate: '2026-01-01', endDate: '2027-12-31' }];
    }
    if (url.startsWith('/api/v1/staff?page=')) {
      return {
        items: [
          {
            userId: 'staff-1',
            fullName: 'Nhân viên A',
            isActive: true,
            employment: { status: 'Active', startDate: '2026-01-01', endDate: null },
          },
        ],
        totalCount: 1,
      };
    }
    if (url === '/api/v1/locations/location') return { name: 'Cơ sở Đầu Tiên' };
    if (url === '/api/v1/rooms/room') return { roomNumber: 'P.101' };
    if (url === '/api/v1/assets/asset') return { name: 'Bóng đèn' };
    if (url === '/api/v1/staff/staff-1') return { fullName: 'Nhân viên A' };
    if (
      url.includes('/history?') ||
      url.includes('/expenses') ||
      url.includes('/emergency-actions') ||
      url.includes('/evidence')
    )
      return url.includes('/history?') ? { items: [], totalCount: 0 } : [];
    return [];
  });
});
afterEach(cleanup);

function mount(initialWorkOrderId?: string, onOpenWorkOrder?: (id: string) => void) {
  const onBack = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <IncidentDetailWorkspace
          id="incident"
          initialWorkOrderId={initialWorkOrderId}
          onBack={onBack}
          mode={onOpenWorkOrder ? 'report' : undefined}
          onOpenWorkOrder={onOpenWorkOrder}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onBack;
}

it('shows one primary action to classify a new unclassified incident', async () => {
  const onBack = mount();
  expect((await screen.findAllByText('Không thấy bóng đèn')).length).toBeGreaterThan(0);
  expect(screen.getByText('Việc cần làm tiếp theo')).toBeVisible();
  expect(screen.getByRole('button', { name: /Phân loại sự cố/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Giao nhân viên xử lý' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Ảnh & bằng chứng' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Lịch sử' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại hàng đợi' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('lets the Owner assign a classified incident only after eligible Staff are known', async () => {
  mocks.incident = { ...baseIncident, type: 'MissingAsset', category: 'Room' };
  mount();
  const assign = await screen.findByRole('button', { name: 'Giao nhân viên xử lý' });
  await vi.waitFor(() => expect(assign).toBeEnabled());
  fireEvent.click(assign);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Giao lệnh sửa chữa')).toBeVisible();
  expect(within(dialog).getByRole('combobox', { name: /Nhân viên phụ trách/ })).toBeVisible();
  expect(within(dialog).getByLabelText(/Hạn hoàn thành/)).toBeVisible();
});

it('opens the linked work order in the incident repair tab without a nested tab bar', async () => {
  mocks.incident = {
    ...baseIncident,
    status: 'InProgress',
    type: 'MissingAsset',
    category: 'Room',
    openWorkOrderStatus: 'PendingApproval',
  };
  mocks.orders = [
    {
      id: 'work-1',
      incidentId: 'incident',
      locationId: 'location',
      roomId: 'room',
      assignedStaffName: 'Nhân viên A',
      status: 'PendingApproval',
      expectedOutcome: 'Thay bóng đèn',
      planApproved: false,
      targetCompletionAt: '2026-11-26T09:00:00Z',
    },
  ];
  mount();
  const action = await screen.findByRole('button', { name: 'Duyệt phương án sửa chữa' });
  fireEvent.click(action);
  expect(await screen.findByRole('button', { name: 'Duyệt phương án' })).toBeVisible();
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(screen.getByRole('tab', { name: 'Sửa chữa & xử lý' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại các lệnh' }));
  expect(screen.queryByRole('button', { name: 'Duyệt phương án' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mở lệnh' })).toBeVisible();
});

it('deep-links an approved child and uses shared tabs for its evidence and history', async () => {
  mocks.incident = {
    ...baseIncident,
    status: 'InProgress',
    type: 'MissingAsset',
    category: 'Room',
    openWorkOrderStatus: 'PendingApproval',
  };
  mocks.orders = [
    {
      id: 'work-1',
      incidentId: 'incident',
      status: 'Verified',
      expectedOutcome: 'Lệnh trước',
      targetCompletionAt: '2026-11-26T09:00:00Z',
    },
    {
      id: 'work-2',
      incidentId: 'incident',
      locationId: 'location',
      roomId: 'room',
      assignedStaffName: 'Nhân viên A',
      status: 'PendingApproval',
      planApproved: true,
      canStart: true,
      expectedOutcome: 'Thay bóng đèn',
      targetCompletionAt: '2026-11-26T09:00:00Z',
    },
  ];
  mount('work-2');
  expect(await screen.findByText('Chờ nhân viên bắt đầu sửa chữa')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Duyệt phương án' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(
    mocks.request.mock.calls.some(([path]) => path === '/api/v1/work-orders/work-2/evidence'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: 'Ảnh & bằng chứng' }));
  expect(await screen.findByText('Ảnh kiểm tra và kết quả')).toBeVisible();
  await vi.waitFor(() =>
    expect(
      mocks.request.mock.calls.some(([path]) => path === '/api/v1/work-orders/work-2/evidence'),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
  expect(await screen.findByText('Lịch sử xử lý của lệnh')).toBeVisible();
  await vi.waitFor(() =>
    expect(
      mocks.request.mock.calls.some(([path]) =>
        path.startsWith('/api/v1/work-orders/work-2/history?'),
      ),
    ).toBe(true),
  );
  expect(screen.getByText('Lịch sử toàn sự cố')).toBeVisible();
});

it('separates emergency evidence and decisions from ordinary report actions', async () => {
  mocks.incident = { ...baseIncident, severity: 'Emergency', staffAvailable: false };
  mount();
  expect(await screen.findByText(/Chưa có xác nhận tiếp nhận từ Staff/)).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Ảnh & bằng chứng' }));
  expect(screen.getByText('Ảnh ứng phó khẩn cấp')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Chi phí' }));
  expect(await screen.findByText('Quyết định chi phí ứng phó khẩn cấp')).toBeVisible();
});

it('shows a completed incident read-only without forcing the standard repair workflow', async () => {
  mocks.incident = { ...baseIncident, status: 'Resolved', resolutionNote: 'Đã bổ sung bóng đèn' };
  mount();
  expect(await screen.findByText('Đã bổ sung bóng đèn')).toBeVisible();
  expect(screen.getByText('Kết quả xử lý')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Phân loại sự cố' })).not.toBeInTheDocument();
});

it('creates work from a report using the existing review and assign requests and links to the resulting work', async () => {
  const staffId = '11111111-1111-4111-8111-111111111111';
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/staff-location-assignments?locationId=location') {
      return [{ staffUserId: staffId, startDate: '2026-01-01', endDate: '2027-12-31' }];
    }
    if (path.startsWith('/api/v1/staff?page=')) {
      return {
        items: [
          {
            userId: staffId,
            fullName: 'Nhân viên A',
            isActive: true,
            employment: { status: 'Active', startDate: '2026-01-01', endDate: null },
          },
        ],
        totalCount: 1,
      };
    }
    if (path === '/api/v1/incidents/incident/evidence') {
      return [
        {
          id: 'proof',
          kind: 'Report',
          workOrderId: null,
          activityId: null,
          contentType: 'image/png',
        },
      ];
    }
    if (path === '/api/v1/incidents/incident/review' && init?.method === 'POST') {
      mocks.incident = { ...baseIncident, type: 'MissingAsset', category: 'Room', version: 8 };
      return { incidentId: 'incident' };
    }
    if (path === '/api/v1/incidents/incident/work-orders' && init?.method === 'POST') {
      mocks.incident = {
        ...mocks.incident,
        status: 'InProgress',
        openWorkOrderStatus: 'Assigned',
        version: 9,
      };
      mocks.orders = [
        {
          id: 'work-new',
          incidentId: 'incident',
          locationId: 'location',
          roomId: 'room',
          assignedStaffName: 'Nhân viên A',
          status: 'Assigned',
          description: 'Không thấy bóng đèn',
          expectedOutcome: 'Thay bóng đèn',
          targetCompletionAt: '2027-01-01T03:00:00Z',
        },
      ];
      return { incidentId: 'incident', workOrderId: 'work-new' };
    }
    return original(path, init);
  });
  const onOpenWorkOrder = vi.fn();
  mount(undefined, onOpenWorkOrder);
  expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
    'Nội dung báo cáo',
    'Công việc liên quan',
    'Lịch sử',
  ]);
  expect(await screen.findByText('Ảnh báo cáo và bằng chứng')).toBeVisible();
  expect(await screen.findByText('Ảnh báo cáo ban đầu')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo công việc xử lý' }));
  let dialog = await screen.findByRole('dialog', { name: /Phân loại sự cố/ });
  expect(within(dialog).getByText('Thông tin tự điền từ báo cáo')).toBeVisible();
  expect(within(dialog).getByText('Không thấy bóng đèn')).toBeVisible();
  expect(within(dialog).getByText('Cơ sở Đầu Tiên')).toBeVisible();
  expect(within(dialog).getByText('Phòng P.101')).toBeVisible();
  expect(within(dialog).getByText('Bóng đèn')).toBeVisible();
  expect(await within(dialog).findByText('Ảnh báo cáo ban đầu (1)')).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText(/Loại sự cố/), {
    target: { value: 'MissingAsset' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Nhóm xử lý/), { target: { value: 'Room' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  dialog = await screen.findByRole('dialog', { name: 'Giao lệnh sửa chữa' });
  expect(within(dialog).getByText('Thông tin tự điền từ báo cáo')).toBeVisible();
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Nhân viên phụ trách/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Nhân viên A' }));
  fireEvent.change(within(dialog).getByLabelText(/Kết quả cần đạt/), {
    target: { value: 'Thay bóng đèn' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Hạn hoàn thành/), {
    target: { value: '2027-01-01T10:00' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText('Công việc từ báo cáo')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Công việc liên quan' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getAllByRole('button', { name: 'Xem công việc xử lý' })).toHaveLength(1);
  expect(screen.queryByText('Ảnh báo cáo và bằng chứng')).not.toBeInTheDocument();
  const write = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/incidents/incident/work-orders' && init?.method === 'POST',
  );
  expect(JSON.parse(write![1].body)).toEqual({
    version: 8,
    staffId,
    expectedOutcome: 'Thay bóng đèn',
    targetCompletionAt: '2027-01-01T03:00:00.000Z',
  });
  fireEvent.click(
    within(screen.getByRole('table', { name: 'Lệnh sửa chữa của sự cố' })).getByRole('button', {
      name: 'Xem công việc xử lý',
    }),
  );
  expect(onOpenWorkOrder).toHaveBeenCalledWith('work-new');
  expect(mocks.request.mock.calls.some(([path]) => path === '/api/v1/work-orders/work-new')).toBe(
    false,
  );
});

it('navigates from a standalone work order to its source report', async () => {
  mocks.orders = [
    {
      id: 'work-link',
      incidentId: 'incident',
      locationId: 'location',
      status: 'Assigned',
      targetCompletionAt: '2027-01-01T03:00:00Z',
      expectedOutcome: 'Thay bóng đèn',
    },
  ];
  const onOpenIncident = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WorkOrderDetailWorkspace id="work-link" onOpenIncident={onOpenIncident} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Xem báo cáo sự cố gốc' }));
  expect(onOpenIncident).toHaveBeenCalledWith('incident');
  expect(screen.getByText('Quy trình xử lý')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Ảnh' }));
  expect(screen.queryByText('Quy trình xử lý')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Chi phí' }));
  expect(screen.queryByText('Quy trình xử lý')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
  expect(screen.queryByText('Quy trình xử lý')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Tổng quan' }));
  expect(screen.getByText('Quy trình xử lý')).toBeVisible();
});

it('preserves emergency decision access in the three-tab report view', async () => {
  mocks.incident = { ...baseIncident, severity: 'Emergency', staffAvailable: false };
  mount(undefined, vi.fn());
  expect(await screen.findByText('Ảnh ứng phó khẩn cấp')).toBeVisible();
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi phí ứng phó và vận hành' }));
  expect(await screen.findByText('Quyết định chi phí ứng phó khẩn cấp')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn chi phí liên quan' }));
  expect(screen.queryByText('Quyết định chi phí ứng phó khẩn cấp')).not.toBeInTheDocument();
});
