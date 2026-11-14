import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { StaffAssignments } from './StaffAssignments';
import { AssignmentDialog, type AssignmentIntent } from './components/AssignmentDialog';
import {
  assignmentDate,
  assignmentState,
  mapFour,
  overlaps,
  readAllPages,
} from './useLocationAssignments';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('./staffContracts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  todayVietnam: () => '2026-11-12',
}));
const staff = {
  userId: 'staff',
  fullName: 'Staff synthetic',
  email: 'staff@example.invalid',
  phone: null,
  isActive: true,
  accountVersion: 'v1',
  employment: null,
};
const replacement = {
  ...staff,
  userId: 'other',
  fullName: 'Other synthetic',
  email: 'other@example.invalid',
};
const inactive = { ...staff, userId: 'inactive', fullName: 'Inactive synthetic', isActive: false };
const location = { id: 'location', name: 'Cơ sở mẫu', version: 4, isActive: true };
const assignment = {
  id: 'assignment',
  staffUserId: staff.userId,
  startDate: '2026-01-01',
  endDate: '2027-12-31',
};
let assignments = [assignment];
let canRemove = true;
let version = 4;
const saved = vi.fn(async () => {});
const close = vi.fn();
beforeEach(() => {
  assignments = [assignment];
  canRemove = true;
  version = 4;
  saved.mockClear();
  close.mockClear();
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/locations?')) return { items: [location], totalCount: 1 };
    if (path === '/api/v1/locations/location') return { ...location, version };
    if (path.startsWith('/api/v1/staff-location-assignments?')) return assignments;
    if (path.endsWith('/staff-change-preview'))
      return {
        locationId: location.id,
        canRemove,
        openResponsibilities: canRemove ? [] : [{ code: 'unrecognized_code', count: 2 }],
      };
    if (path.startsWith('/api/v1/staff?'))
      return { items: [staff, replacement, inactive], totalCount: 3 };
    return {};
  });
});
afterEach(() => vi.unstubAllGlobals());
function wrap(element: React.ReactNode, url = '/staff-assignments') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {element}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
function dialog(intent: AssignmentIntent) {
  wrap(
    <AssignmentDialog
      intent={intent}
      locations={[location]}
      staff={[staff, replacement, inactive]}
      close={close}
      saved={saved}
    />,
  );
}
async function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: new RegExp(label) }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
async function ready() {
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
}
it('opens a location drawer without selecting staff and updates the selected assignment in place', async () => {
  wrap(<StaffAssignments />);
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết phân công' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Chỉnh thời hạn' }));
  await ready();
  fireEvent.change(screen.getByLabelText(/Ngày kết thúc/), { target: { value: '2027-11-30' } });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), {
    target: { value: 'Điều chỉnh thời hạn' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/staff-location-assignments/assignment/assignment',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          startDate: '2026-01-01',
          endDate: '2027-11-30',
          locationVersion: 4,
          reason: 'Điều chỉnh thời hạn',
        }),
      }),
    ),
  );
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('keeps staff and the assignment action visible in the compact table', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width:599px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
  wrap(<StaffAssignments />);
  const table = await screen.findByRole('table', { name: 'Phân công theo cơ sở' });
  const row = await within(table).findByRole('row', { name: /Cơ sở mẫu/ });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Cơ sở', 'Thao tác']);
  expect(within(row).getByText(staff.fullName)).toBeVisible();
  fireEvent.click(within(row).getByRole('button', { name: 'Chi tiết' }));
  expect(await screen.findByRole('dialog', { name: 'Chi tiết phân công' })).toBeVisible();
});
it('treats future and historical assignments as unassigned today', async () => {
  assignments = [
    { ...assignment, startDate: '2026-12-01' },
    { ...assignment, id: 'past', startDate: '2025-01-01', endDate: '2025-12-31' },
  ];
  wrap(<StaffAssignments />);
  expect(await screen.findByRole('button', { name: 'Phân công' })).toBeInTheDocument();
  expect(screen.getByText('Sắp hiệu lực')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Chi tiết' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Cơ sở mẫu'));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết phân công' });
  expect(within(drawer).getByText('Đã kết thúc')).toBeInTheDocument();
  expect(within(drawer).getAllByRole('button', { name: 'Chỉnh thời hạn' })).toHaveLength(1);
});
it('honors staff URL filter and lets the owner clear it', async () => {
  wrap(<StaffAssignments />, '/staff-assignments?staffUserId=other');
  expect(await screen.findByText('Không có cơ sở phù hợp.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  expect(await screen.findByRole('button', { name: 'Chi tiết' })).toBeInTheDocument();
});
it('searches loaded names and preserves filters on refresh and drawer close', async () => {
  wrap(<StaffAssignments />);
  await screen.findByRole('button', { name: 'Chi tiết' });
  fireEvent.change(screen.getByLabelText('Tìm tên cơ sở hoặc nhân viên'), {
    target: { value: 'synthetic' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  expect(screen.getByLabelText('Tìm tên cơ sở hoặc nhân viên')).toHaveValue('synthetic');
});
it('does not show an assignment failure as an unassigned location or a complete KPI', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init: unknown) =>
    path.startsWith('/api/v1/staff-location-assignments?')
      ? Promise.reject(new Error('Synthetic failure'))
      : base(path, init),
  );
  wrap(<StaffAssignments />);
  expect(await screen.findByText('Lỗi tải dữ liệu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Phân công' })).not.toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
});
it('loads every directory page before reporting global counts', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init: unknown) =>
    path.startsWith('/api/v1/locations?')
      ? Promise.resolve({
          items: [
            path.includes('page=2')
              ? { ...location, id: 'second', name: 'Second location' }
              : location,
          ],
          totalCount: 2,
        })
      : base(path, init),
  );
  wrap(<StaffAssignments />);
  expect(await screen.findByText('Second location')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Chi tiết' })).toHaveLength(2);
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/locations?page=2&pageSize=100',
    expect.anything(),
  );
});
it('creates a nonoverlapping future assignment with a concrete endDate', async () => {
  assignments = [];
  dialog({ mode: 'create', locationId: 'location' });
  await ready();
  await pick('Nhân viên phụ trách', 'Staff synthetic · staff@example.invalid');
  fireEvent.change(screen.getByLabelText(/Ngày kết thúc/), { target: { value: '2027-05-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phân công' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/staff-location-assignments',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        locationId: 'location',
        staffUserId: 'staff',
        startDate: '2026-11-12',
        endDate: '2027-05-31',
      }),
    }),
  );
});
it('validates required fields, inactive staff, dates and overlapping intervals', async () => {
  dialog({ mode: 'create' });
  expect(screen.getByRole('button', { name: 'Tạo phân công' })).toBeDisabled();
  await pick('Cơ sở', 'Cơ sở mẫu');
  await ready();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Nhân viên phụ trách/ }));
  expect(screen.queryByRole('option', { name: /Inactive/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Staff synthetic · staff@example.invalid' }));
  fireEvent.change(screen.getByLabelText(/Ngày kết thúc/), { target: { value: '2026-11-01' } });
  expect(screen.getByText('Ngày kết thúc không được trước ngày bắt đầu.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Ngày kết thúc/), { target: { value: '2026-12-01' } });
  expect(
    screen.getByText('Khoảng thời gian trùng với một phân công tại cơ sở.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo phân công' })).toBeDisabled();
});
it('replaces even when canRemove is false, using current Vietnam date and latest location version', async () => {
  canRemove = false;
  dialog({ mode: 'replace', locationId: 'location' });
  await ready();
  expect(screen.getByText('unrecognized_code: 2')).toBeInTheDocument();
  await pick('Nhân viên thay thế', 'Other synthetic · other@example.invalid');
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Thay người' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/staff-location-assignments/location',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        staffUserId: 'other',
        effectiveFrom: '2026-11-12',
        locationVersion: 4,
        reason: 'Thay người',
      }),
    }),
  );
  expect(mocks.request.mock.calls.some(([path]) => path.includes('operational-tasks'))).toBe(false);
});
it('blocks removal when responsibilities remain', async () => {
  canRemove = false;
  dialog({ mode: 'remove', locationId: 'location' });
  await ready();
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Gỡ' } });
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});
it('removes through DELETE body and prevents double submission', async () => {
  dialog({ mode: 'remove', locationId: 'location' });
  await ready();
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Gỡ' } });
  fireEvent.submit(document.getElementById('assignment-editor')!);
  fireEvent.submit(document.getElementById('assignment-editor')!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const calls = mocks.request.mock.calls.filter(([, init]) => init?.method === 'DELETE');
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toEqual({
    effectiveFrom: '2026-11-12',
    locationVersion: 4,
    reason: 'Gỡ',
  });
});
it('requires explicit review after 409 and retains input while refreshing the version', async () => {
  const base = mocks.request.getMockImplementation()!;
  let failed = false;
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && !failed) {
      failed = true;
      version = 9;
      return Promise.reject(new ApiError(409, { title: 'Version conflict' }));
    }
    return base(path, init);
  });
  dialog({ mode: 'period', locationId: 'location', assignment });
  await ready();
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Giữ nội dung' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  const review = await screen.findByRole('button', { name: 'Tôi đã kiểm tra lại' });
  await ready();
  expect(screen.getByLabelText(/Lý do thay đổi/)).toHaveValue('Giữ nội dung');
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
  fireEvent.click(review);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const calls = mocks.request.mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(calls[1][1].body).locationVersion).toBe(9);
});
it('keeps a missing assignment blocked instead of creating a replacement record', async () => {
  assignments = [];
  dialog({ mode: 'period', locationId: 'location', assignment });
  await ready();
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Edit' } });
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
});
it('supports sentinel without sending null', async () => {
  assignments = [];
  dialog({ mode: 'create', locationId: 'location' });
  await ready();
  await pick('Nhân viên phụ trách', 'Staff synthetic · staff@example.invalid');
  fireEvent.click(screen.getByLabelText('Không xác định thời hạn'));
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phân công' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const call = mocks.request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(call[1].body).endDate).toBe('9999-12-31');
});
it('uses inclusive dates and Vietnamese display without UTC conversion', () => {
  expect(assignmentState({ ...assignment, startDate: '2026-11-12' }, '2026-11-12')).toBe('current');
  expect(assignmentState({ ...assignment, endDate: '2026-11-12' }, '2026-11-12')).toBe('current');
  expect(assignmentState({ ...assignment, endDate: '2026-11-11' }, '2026-11-12')).toBe('past');
  expect(assignmentState({ ...assignment, startDate: '2026-11-13' }, '2026-11-12')).toBe('future');
  expect(assignmentDate('9999-12-31')).toBe('Không xác định thời hạn');
  expect(assignmentDate('2026-11-12')).toBe('12/11/2026');
  expect(overlaps([assignment], '2027-12-31', '2028-01-01')).toBe(true);
  expect(overlaps([assignment], '2027-12-31', '2028-01-01', assignment.id)).toBe(false);
});
it('limits assignment fetch concurrency to four', async () => {
  let active = 0,
    maximum = 0;
  const result = await mapFour(
    Array.from({ length: 11 }, (_, i) => i),
    async (item) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return item;
    },
  );
  expect(maximum).toBe(4);
  expect(result).toHaveLength(11);
});
it('rejects an incomplete paginated response', async () => {
  await expect(
    readAllPages(async () => ({ items: [], totalCount: 2, page: 1, pageSize: 100 }), '/list'),
  ).rejects.toThrow('chưa tải đủ');
});

it.each([400, 401, 403, 404, 500])(
  'keeps the dialog and form values on HTTP %s without reporting success',
  async (status) => {
    const base = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Promise.reject(new ApiError(status, { title: 'Synthetic rejection' }))
        : base(path, init),
    );
    dialog({ mode: 'period', locationId: 'location', assignment });
    await ready();
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), {
      target: { value: 'Giữ bản nhập' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/Lý do thay đổi/)).toHaveValue('Giữ bản nhập');
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  },
);

it('blocks destructive changes while preview fails', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init: unknown) =>
    path.endsWith('/staff-change-preview')
      ? Promise.reject(new Error('Offline'))
      : base(path, init),
  );
  dialog({ mode: 'remove', locationId: 'location' });
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Gỡ' } });
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Tải lại dữ liệu' })).toBeInTheDocument();
});

it('shows empty and loading states without fabricated records', async () => {
  let resolve!: (value: unknown) => void;
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init: unknown) =>
    path.startsWith('/api/v1/locations?')
      ? new Promise((done) => {
          resolve = done;
        })
      : base(path, init),
  );
  wrap(<StaffAssignments />);
  expect(screen.getByText('Đang tải cơ sở…')).toBeInTheDocument();
  resolve({ items: [], totalCount: 0 });
  expect(await screen.findByText('Không có cơ sở phù hợp.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Chi tiết' })).not.toBeInTheDocument();
});

it('filters by actual current or future assignment and does not fetch preview on drawer open', async () => {
  wrap(<StaffAssignments />);
  await screen.findByRole('button', { name: 'Chi tiết' });
  await pick('Trạng thái', 'Có phân công sắp hiệu lực');
  expect(screen.queryByRole('button', { name: 'Chi tiết' })).not.toBeInTheDocument();
  await pick('Trạng thái', 'Đang có người phụ trách');
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
  expect(await screen.findByRole('dialog', { name: 'Chi tiết phân công' })).toBeInTheDocument();
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/staff-change-preview'))).toBe(
    false,
  );
});

it('does not fetch another page after cancellation', async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => {
    controller.abort();
    return { items: [1], totalCount: 2, page: 1, pageSize: 100 };
  });
  await expect(readAllPages(read, '/list', controller.signal)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
});
