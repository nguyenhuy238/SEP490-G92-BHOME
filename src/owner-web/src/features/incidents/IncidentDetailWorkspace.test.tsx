// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IncidentDetailWorkspace } from './IncidentDetailWorkspace';

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
vi.mock('./WorkOrderDetailWorkspace', () => ({
  WorkOrderDetailWorkspace: ({ id, onBack }: { id: string; onBack: () => void }) => (
    <div>
      <div>Đang xem lệnh {id}</div>
      <button onClick={onBack}>Quay lại các lệnh</button>
    </div>
  ),
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

function mount() {
  const onBack = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <IncidentDetailWorkspace id="incident" onBack={onBack} />
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

it('routes a pending work order to its dedicated repair screen instead of placing it below the incident', async () => {
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
      locationId: 'location',
      roomId: 'room',
      assignedStaffName: 'Nhân viên A',
      status: 'PendingApproval',
      expectedOutcome: 'Thay bóng đèn',
      targetCompletionAt: '2026-11-26T09:00:00Z',
    },
  ];
  mount();
  const action = await screen.findByRole('button', { name: 'Duyệt phương án sửa chữa' });
  fireEvent.click(action);
  expect(await screen.findByText('Đang xem lệnh work-1')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Sửa chữa & xử lý' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại các lệnh' }));
  expect(screen.queryByText('Đang xem lệnh work-1')).not.toBeInTheDocument();
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
