// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IncidentQueueWorkspace } from './IncidentQueueWorkspace';

const state = vi.hoisted(() => ({
  request: vi.fn(),
}));
vi.mock('../meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: state.request }),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner-1', roles: ['Owner'] } }),
}));
vi.mock('../../components/common/OwnerSelectors', () => ({
  OwnerLocationPicker: () => <span>Cơ sở</span>,
  OwnerRoomPicker: () => <span>Phòng</span>,
}));
vi.mock('./MaintenanceControls', () => ({
  CreateProactiveMaintenance: () => <button>Bảo trì chủ động</button>,
  FastRepairPolicyPanel: () => <button>Chính sách sửa nhanh</button>,
}));

beforeEach(() => {
  state.request.mockReset();
  state.request.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/incidents/notifications')) {
      return { items: [], totalCount: 0, page: 1, pageSize: 10 };
    }
    if (url.startsWith('/api/v1/incidents?')) {
      return {
        items: [
          {
            id: 'i-1',
            code: 'INC-1',
            description: 'Không thấy bóng đèn',
            status: 'Submitted',
            severity: 'Emergency',
            locationName: 'Cơ sở Đầu Tiên',
            roomNumber: 'P.101',
            createdAt: '2026-11-22T16:14:00Z',
            type: null,
            category: null,
          },
        ],
        totalCount: 2,
        page: 1,
        pageSize: 20,
      };
    }
    if (url.startsWith('/api/v1/work-orders?')) {
      return {
        items: [
          {
            id: 'w-1',
            description: 'Bảo trì chủ động hành lang',
            expectedOutcome: 'Hoàn tất bảo trì',
            locationName: 'Cơ sở Đầu Tiên',
            status: 'PendingApproval',
            assignedStaffName: 'Staff A',
            targetCompletionAt: '2026-11-26T09:00:00Z',
          },
        ],
        totalCount: 1,
        page: 1,
        pageSize: 20,
      };
    }
    return [];
  });
});
afterEach(cleanup);

function mount(maintenance = false, incidentFilter = '') {
  const select = vi.fn();
  const clear = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <IncidentQueueWorkspace
          maintenance={maintenance}
          incidentFilter={incidentFilter}
          onSelect={select}
          onClearIncidentFilter={clear}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { select, clear };
}

it('keeps the incident queue above any detail and opens a selected report via callback', async () => {
  const { select } = mount();
  expect(await screen.findByText('Không thấy bóng đèn')).toBeVisible();
  expect(screen.getByText('Phân loại sự cố')).toBeVisible();
  expect(screen.getByText('2 hồ sơ theo bộ lọc')).toBeVisible();
  expect(screen.queryByText('Chi tiết sự cố · Mới báo cáo')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem & xử lý' }));
  expect(select).toHaveBeenCalledWith('i-1');
});

it('keeps emergency and status filters on the server rather than filtering only the visible page', async () => {
  mount();
  await screen.findByText('Không thấy bóng đèn');
  fireEvent.click(screen.getByRole('button', { name: 'Ưu tiên khẩn cấp' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      expect.stringContaining('severity=Emergency'),
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đang xử lý' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      expect.stringContaining('status=InProgress'),
      expect.anything(),
    ),
  );
});

it('explicitly limits local text search to the current page', async () => {
  mount();
  await screen.findByText('Không thấy bóng đèn');
  fireEvent.change(screen.getByLabelText('Tìm trong trang hiện tại'), {
    target: { value: 'không tìm thấy' },
  });
  expect(screen.getByText(/Không thấy kết quả trong trang hiện tại/)).toBeVisible();
  expect(screen.getByText('0 kết quả trên trang 1', { exact: false })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  expect(screen.getByText('Không thấy bóng đèn')).toBeVisible();
});

it('shows proactive maintenance and preserves the incident filter in work-order API requests', async () => {
  const { select, clear } = mount(true, 'incident-A');
  expect(await screen.findByText('Bảo trì chủ động hành lang')).toBeVisible();
  expect(screen.getByText('Duyệt phương án')).toBeVisible();
  expect(state.request).toHaveBeenCalledWith(
    expect.stringContaining('incidentId=incident-A'),
    expect.anything(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở lệnh' }));
  expect(select).toHaveBeenCalledWith('w-1');
  fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả lệnh sửa chữa' }));
  expect(clear).toHaveBeenCalledTimes(1);
});
