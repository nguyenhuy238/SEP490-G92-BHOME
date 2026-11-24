import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TasksPage from './pages/TasksPage';
import { legacyWorkSearch } from './legacyWorkSearch';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { TaskEvidenceGallery } from './components/TaskEvidenceGallery';
import { taskActions } from './useOperationalTasksApi';
import type { OwnerTask } from './taskContracts';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const location = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic API Location' };
const staff = {
  userId: '00000000-0000-4000-8000-000000000002',
  fullName: 'Staff phụ trách mẫu',
  email: 'staff@example.invalid',
  isActive: true,
};
const task = {
  id: 'task',
  locationId: location.id,
  kind: 'AdHoc',
  title: 'Synthetic API Task',
  requirements: 'Check evidence',
  status: 'PendingVerification',
  priority: 'High',
  version: 3,
  responsibilityAvailable: true,
  result: 'Synthetic result',
  dueAt: '2099-11-20T03:00:00Z',
  evidenceRequired: false,
  isOverdue: false,
  currentResponsibleStaffUserId: staff.userId,
  recordedStaffUserId: staff.userId,
  verifiedAt: null,
  verifiedByUserId: null,
};
const workRow = {
  ...task,
  kind: 'task',
  workType: 'AdHoc',
  source: 'Owner',
  locationName: location.name,
  status: 'Chờ xác minh',
  phase: 'needsOwner',
  nextAction: 'Xác minh kết quả',
  staffName: staff.fullName,
  workOrderCount: 0,
  createdAt: '2026-11-24T00:00:00Z',
};
const workCounts = { total: 1, needsOwner: 1, active: 0, closed: 0, overdue: 0, verification: 1 };
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return task;
    if (path.startsWith('/api/v1/locations?')) return { items: [location], totalCount: 1 };
    if (path === '/api/v1/staff?page=1&pageSize=100') return { items: [staff], totalCount: 1 };
    if (path.startsWith('/api/v1/staff-location-assignments?'))
      return [
        {
          id: 'assignment',
          staffUserId: staff.userId,
          startDate: '2020-01-01',
          endDate: '9999-12-31',
        },
      ];
    if (path === '/api/v1/operational-tasks/task') return task;
    if (path.endsWith('/actors')) return [];
    if (path.endsWith('/evidence') || path.startsWith('/api/v1/operational-task-templates?'))
      return [];
    if (path.startsWith('/api/v1/operational-work?'))
      return { items: [workRow], totalCount: 1, page: 1, pageSize: 20, counts: workCounts };
    return { items: path.startsWith('/api/v1/operational-tasks?') ? [task] : [], totalCount: 1 };
  });
});
afterEach(cleanup);
function mount(url = '/tasks') {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('shows separate compact work and report lists without duplicating detail fields', async () => {
  const base = mocks.request.getMockImplementation()!;
  const report = {
    ...workRow,
    id: 'incident',
    kind: 'incident',
    title: 'Báo cáo bóng đèn',
    source: 'Tenant',
    workType: 'Incident',
    status: 'Đang xử lý',
    phase: 'active',
    workOrderCount: 2,
    openWorkOrderCount: 1,
    verifiedWorkOrderCount: 1,
    workOrderStatus: 'Đang thực hiện',
    incidentId: 'incident',
  };
  const order = {
    ...workRow,
    id: 'order',
    kind: 'workOrder',
    workType: 'Incident',
    source: 'Tenant',
    incidentId: 'incident',
    title: 'Sửa bóng đèn',
    assetName: 'Tài sản chỉ hiện trong chi tiết',
  };
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/operational-work?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      const items =
        params.get('view') === 'reports'
          ? [
              report,
              {
                ...report,
                id: 'new',
                title: 'Báo cáo chưa giao',
                status: 'Chờ tiếp nhận',
                workOrderCount: 0,
                workOrderStatus: null,
              },
            ]
          : params.get('incidentId')
            ? [order]
            : [workRow, order];
      return Promise.resolve({
        items,
        totalCount: items.length,
        counts: { ...workCounts, total: items.length },
      });
    }
    return base(path, init);
  });
  mount();
  expect(await screen.findByText('Sửa bóng đèn')).toBeInTheDocument();
  const workTable = screen.getByRole('table', { name: 'Danh sách công việc' });
  expect(within(workTable).getAllByRole('columnheader')).toHaveLength(5);
  expect(within(workTable).queryByText('Nguồn phát sinh')).not.toBeInTheDocument();
  expect(within(workTable).queryByText('Xem báo cáo gốc')).not.toBeInTheDocument();
  expect(within(workTable).queryByText('Tài sản chỉ hiện trong chi tiết')).not.toBeInTheDocument();
  expect(within(workTable).queryByText(workRow.nextAction)).not.toBeInTheDocument();
  expect(screen.queryByText('Tổng công việc')).not.toBeInTheDocument();
  expect(screen.queryByText('Cần Owner xử lý')).not.toBeInTheDocument();
  expect(screen.queryByText('Báo cáo chưa giao')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Báo cáo sự cố' }));
  expect(await screen.findByText('Báo cáo chưa giao')).toBeInTheDocument();
  const reportTable = screen.getByRole('table', { name: 'Danh sách báo cáo sự cố' });
  expect(within(reportTable).getAllByRole('columnheader')).toHaveLength(5);
  expect(within(reportTable).queryByText('2 công việc đã tạo')).not.toBeInTheDocument();
  expect(within(reportTable).queryByText('Chưa tạo công việc')).not.toBeInTheDocument();
  expect(within(reportTable).queryByText('Tiến độ công việc')).not.toBeInTheDocument();
  expect(within(reportTable).queryByText('Người phụ trách')).not.toBeInTheDocument();
  expect(screen.queryByText('Tổng báo cáo')).not.toBeInTheDocument();
  expect(within(reportTable).getByText('Đang xử lý')).toBeInTheDocument();
  expect(within(reportTable).getByText('Chờ tiếp nhận')).toBeInTheDocument();
  expect(screen.queryByText('Sửa bóng đèn')).not.toBeInTheDocument();
  expect(screen.queryByText('Quá hạn')).not.toBeInTheDocument();
  fireEvent.click(within(reportTable).getAllByRole('button', { name: 'Xem báo cáo' })[0]);
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([path]) => path === '/api/v1/incidents/incident')).toBe(
      true,
    ),
  );
});
it('offers only Normal and Emergency and refreshes the unfiltered current view', async () => {
  mount('/tasks?priority=High');
  await screen.findByText('Synthetic API Task');
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc nâng cao' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Ưu tiên' }));
  const options = await screen.findByRole('listbox');
  expect(
    within(options)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Tất cả', 'Bình thường', 'Khẩn cấp']);
  fireEvent.click(within(options).getByRole('option', { name: 'Khẩn cấp' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([path]) => path.includes('priority=Emergency'))).toBe(
      true,
    ),
  );
  expect(screen.queryByRole('button', { name: 'Xóa bộ lọc' })).not.toBeInTheDocument();
  mocks.request.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([path]) => path.startsWith('/api/v1/operational-work?') && !path.includes('priority='),
      ),
    ).toBe(true),
  );
  expect(screen.getByRole('tab', { name: 'Danh sách công việc' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
it('opens repair and source report in the same overlay and preserves the underlying queue', async () => {
  const base = mocks.request.getMockImplementation()!;
  const order = {
    id: 'order',
    incidentId: 'incident',
    source: 'Incident',
    description: 'Sửa bóng đèn',
    locationId: location.id,
    locationName: location.name,
    roomId: 'room',
    roomNumber: 'P.101',
    assignedStaffId: staff.userId,
    assignedStaffName: staff.fullName,
    status: 'PendingApproval',
    planApproved: true,
    expectedOutcome: 'Khôi phục bóng đèn',
    targetCompletionAt: '2099-11-20T03:00:00Z',
    version: 2,
  };
  const report = {
    id: 'incident',
    description: 'Báo cáo bóng đèn',
    code: 'INC-001',
    locationId: location.id,
    locationName: location.name,
    roomId: 'room',
    roomNumber: 'P.101',
    status: 'InProgress',
    severity: 'Normal',
    type: 'MissingAsset',
    category: 'Room',
    createdAt: '2026-11-24T00:00:00Z',
    openWorkOrderStatus: 'PendingApproval',
    version: 3,
  };
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/operational-work?'))
      return Promise.resolve({
        items: [
          { ...workRow, ...order, kind: 'workOrder', title: order.description, phase: 'active' },
        ],
        totalCount: 25,
        counts: workCounts,
      });
    if (path === '/api/v1/work-orders/order') return Promise.resolve(order);
    if (path === '/api/v1/incidents/incident') return Promise.resolve(report);
    if (path.startsWith('/api/v1/work-orders?'))
      return Promise.resolve({ items: [order], totalCount: 1 });
    return base(path, init);
  });
  mount('/tasks?search=bong&phase=active&page=2');
  await screen.findByText('Sửa bóng đèn');
  const queue = screen.getByRole('table', { name: 'Danh sách công việc' });
  fireEvent.click(within(queue).getByRole('button', { name: 'Xem chi tiết' }));
  let dialog = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  expect(await within(dialog).findByText('Quy trình xử lý')).toBeVisible();
  expect(within(dialog).getByText('Staff thực hiện').closest('[data-step-state]')).toHaveAttribute(
    'aria-current',
    'step',
  );
  expect(
    within(dialog).getByText('Owner duyệt phương án').closest('[data-step-state]'),
  ).toHaveAttribute('data-step-state', 'completed');
  expect(queue).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xem báo cáo sự cố gốc' }));
  dialog = await screen.findByRole('dialog', { name: 'Chi tiết báo cáo sự cố' });
  fireEvent.click(await within(dialog).findByRole('tab', { name: 'Công việc liên quan' }));
  expect(await within(dialog).findByText('Công việc từ báo cáo')).toBeVisible();
  fireEvent.click(
    within(within(dialog).getByRole('table', { name: 'Lệnh sửa chữa của sự cố' })).getByRole(
      'button',
      { name: 'Xem công việc xử lý' },
    ),
  );
  dialog = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng chi tiết' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('table', { name: 'Danh sách công việc' })).toBe(queue);
  expect(screen.getByLabelText('Tìm kiếm công việc')).toHaveValue('bong');
  expect(screen.getByRole('tab', { name: /Đang thực hiện/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByText('Trang 2 · 25 bản ghi')).toBeInTheDocument();
});
it('keeps old incident, maintenance and task links pointing at the correct new view', () => {
  expect(
    new URLSearchParams(legacyWorkSearch('?incidentId=i&locationId=l', 'incidents')).get('view'),
  ).toBe('reports');
  const maintenance = new URLSearchParams(
    legacyWorkSearch('?incidentId=i&locationId=l', 'maintenance'),
  );
  expect(maintenance.get('incidentFilter')).toBe('i');
  expect(maintenance.get('incidentId')).toBeNull();
  expect(maintenance.get('locationId')).toBe('l');
  expect(
    new URLSearchParams(legacyWorkSearch('?workOrderId=w&incidentId=i', 'maintenance')).get(
      'workOrderId',
    ),
  ).toBe('w');
  expect(new URLSearchParams(legacyWorkSearch('?taskId=t', 'tasks')).get('taskId')).toBe('t');
});
it('creates a task through the backend with UTC deadline and a retry key', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo công việc' }));
  expect(screen.getByRole('dialog').querySelectorAll('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Công việc thông thường/ }));
  const dialog = screen.getByRole('dialog');
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  await within(dialog).findByText(/Staff phụ trách: Staff phụ trách mẫu/);
  fireEvent.change(within(dialog).getByLabelText(/Tên công việc/), {
    target: { value: 'Synthetic new task' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Yêu cầu/), {
    target: { value: 'Synthetic requirements' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Thời điểm/), {
    target: { value: '2099-11-10T10:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu công việc' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  const post = mocks.request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toBe('/api/v1/operational-tasks');
  expect(JSON.parse(post[1].body)).toEqual({
    locationId: location.id,
    work: {
      title: 'Synthetic new task',
      requirements: 'Synthetic requirements',
      priority: 'Normal',
      dueAt: '2099-11-10T03:00:00.000Z',
      evidenceRequired: false,
    },
  });
  expect(post[1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
});
it('preserves Owner verification and recurring templates in the actual route', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch công việc định kỳ' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(([p]) => p.startsWith('/api/v1/operational-task-templates?')),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Danh sách công việc' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Nghiệm thu' }));
  fireEvent.click(await screen.findByLabelText('Đã kiểm tra kết quả và bằng chứng'));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-tasks/task/verify',
      expect.objectContaining({
        body: JSON.stringify({ version: 3, note: null }),
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    ),
  );
});

it('shows the currently assigned Staff as soon as a task Location is selected', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo công việc' }));
  fireEvent.click(screen.getByRole('button', { name: /Công việc thông thường/ }));
  const dialog = screen.getByRole('dialog');
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));

  expect(
    await within(dialog).findByText(/Staff phụ trách: Staff phụ trách mẫu/),
  ).toBeInTheDocument();
});

it('creates an interval template with explicit Vietnam run time', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch công việc định kỳ' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo lịch định kỳ' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/Tên công việc/), {
    target: { value: 'Kiểm tra khu chung' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Yêu cầu/), {
    target: { value: 'Chụp bằng chứng' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Mỗi bao nhiêu ngày/), { target: { value: '7' } });
  fireEvent.change(within(dialog).getByLabelText(/Thời điểm sinh việc/), {
    target: { value: '2099-01-30T08:00' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu mẫu' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([path, init]) => path === '/api/v1/operational-task-templates' && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const post = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/operational-task-templates' && init?.method === 'POST',
  )!;
  expect(JSON.parse(post[1].body)).toMatchObject({
    scheduleType: 'IntervalDays',
    dayOfWeek: null,
    dayOfMonth: null,
    intervalDays: 7,
    nextRunAt: '2099-01-30T01:00:00.000Z',
  });
});

it('creates a calendar weekly template with a matching Vietnam weekday', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch công việc định kỳ' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo lịch định kỳ' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/Tên công việc/), {
    target: { value: 'Kiểm tra tuần' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Yêu cầu/), {
    target: { value: 'Kiểm tra khu chung' },
  });
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Chu kỳ' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Hằng tuần' }));
  fireEvent.change(within(dialog).getByLabelText(/Thời điểm sinh việc/), {
    target: { value: '2099-02-01T08:00' },
  });
  expect(within(dialog).getByRole('button', { name: 'Lưu mẫu' })).toBeDisabled();
  // 2099-02-02 is Monday (ISO day 1).
  fireEvent.change(within(dialog).getByLabelText(/Thời điểm sinh việc/), {
    target: { value: '2099-02-02T08:00' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu mẫu' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-task-templates',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const [, init] = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/operational-task-templates' && init?.method === 'POST',
  )!;
  expect(JSON.parse(init.body)).toMatchObject({
    scheduleType: 'Weekly',
    intervalDays: 7,
    dayOfWeek: 1,
    dayOfMonth: null,
    nextRunAt: '2099-02-02T01:00:00.000Z',
  });
});

it('uses server counts and verification filter, preserving other filters', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path.startsWith('/api/v1/operational-work?')
      ? Promise.resolve({
          items: [],
          totalCount: 100,
          counts: {
            total: 100,
            needsOwner: 80,
            active: 0,
            closed: 20,
            overdue: 2,
            verification: 10,
          },
        })
      : base(path, init),
  );
  mount();
  expect(await screen.findByRole('tab', { name: 'Cần xử lý (80)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Chờ nghiệm thu/ }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-work?view=work&verification=true&page=1&pageSize=20',
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc nâng cao' }));
  fireEvent.change(screen.getByLabelText('Hạn từ (giờ Việt Nam)'), {
    target: { value: '2099-11-01T08:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc nâng cao' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([path]) => path.includes('dueFrom=2099-11-01T01'))).toBe(
      true,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  expect(screen.getByRole('tab', { name: /Tất cả/ })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([path]) => path === '/api/v1/operational-work?view=work&page=1&pageSize=20',
      ),
    ).toBe(true),
  );
});

it('opens deep-link in a drawer and closes without losing filters', async () => {
  mount('/tasks?taskId=task');
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  expect(await within(drawer).findByText('Check evidence')).toBeInTheDocument();
  expect(within(drawer).getByText('Synthetic result')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng chi tiết' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Xem chi tiết' })).toBeInTheDocument();
});

it.each(['Completed', 'Cancelled'])('renders %s as read-only', async (status) => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path === '/api/v1/operational-tasks/task'
      ? Promise.resolve({ ...task, status })
      : base(path, init),
  );
  mount('/tasks?taskId=task');
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  await within(drawer).findByText('Check evidence');
  expect(within(drawer).queryByRole('button', { name: 'Chỉnh sửa' })).not.toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: 'Hủy công việc' })).not.toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: 'Nghiệm thu' })).not.toBeInTheDocument();
});

it('blocks create without a currently assigned staff and links to assignments', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path.startsWith('/api/v1/staff-location-assignments?') ? Promise.resolve([]) : base(path, init),
  );
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo công việc' }));
  fireEvent.click(screen.getByRole('button', { name: /Công việc thông thường/ }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  expect(await screen.findByRole('link', { name: 'Mở phân công cơ sở' })).toHaveAttribute(
    'href',
    '/staff-assignments',
  );
  expect(screen.getByRole('button', { name: 'Lưu công việc' })).toBeDisabled();
});

it.each(['coordinate', 'cancel', 'assign'])(
  'performs %s with version and stable idempotency key',
  async (op) => {
    const base = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string, init?: RequestInit) =>
      path === '/api/v1/operational-tasks/task' && !init?.method
        ? Promise.resolve({ ...task, status: 'Assigned' })
        : base(path, init),
    );
    mount('/tasks?taskId=task');
    const label = {
      coordinate: 'Ghi chú phối hợp',
      cancel: 'Hủy công việc',
      assign: 'Đồng bộ người phụ trách',
    }[op]!;
    fireEvent.click(await screen.findByRole('button', { name: 'Thao tác khác' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    const input = await screen.findByLabelText(/Ghi chú \/ lý do/);
    if (op !== 'assign') expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Synthetic note' } });
    fireEvent.submit(document.getElementById('task-action')!);
    fireEvent.submit(document.getElementById('task-action')!);
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.filter(
          ([path, init]) => path.endsWith('/' + op) && init?.method === 'POST',
        ),
      ).toHaveLength(1),
    );
    const call = mocks.request.mock.calls.find(
      ([path, init]) => path.endsWith('/' + op) && init?.method === 'POST',
    )!;
    expect(JSON.parse(call[1].body)).toEqual({ version: 3, note: 'Synthetic note' });
    expect(call[1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  },
);

it('retains note on a conflict and requires loading new data before retry', async () => {
  const base = mocks.request.getMockImplementation()!;
  let version = 3;
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      version = 8;
      return Promise.reject(new ApiError(409, { code: 'stale_version' }));
    }
    if (path === '/api/v1/operational-tasks/task') return Promise.resolve({ ...task, version });
    return base(path, init);
  });
  mount('/tasks?taskId=task');
  fireEvent.click(
    await screen.findByRole('button', { name: 'Yêu cầu làm lại' }, { timeout: 10000 }),
  );
  fireEvent.change(await screen.findByLabelText(/Lý do yêu cầu làm lại/), {
    target: { value: 'Cần bổ sung' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  const reload = await screen.findByRole('button', { name: 'Tải dữ liệu mới' });
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
  expect(screen.getByLabelText(/Lý do yêu cầu làm lại/)).toHaveValue('Cần bổ sung');
  fireEvent.click(reload);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Xác nhận' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(posts[1][1].body).version).toBe(8);
});

it('shows unknown current staff explicitly and does not substitute recorded staff', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path.startsWith('/api/v1/operational-work?')
      ? Promise.resolve({
          items: [{ ...workRow, staffName: 'Không tải được tên nhân viên' }],
          totalCount: 1,
          counts: workCounts,
        })
      : base(path, init),
  );
  mount();
  expect(await screen.findByText('Không tải được tên nhân viên')).toBeInTheDocument();
});

it('downloads private thumbnails, opens an image dialog and revokes object URLs', async () => {
  const create = vi.fn(() => 'blob:synthetic'),
    revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  mocks.request.mockResolvedValue(new Blob(['synthetic'], { type: 'image/png' }));
  const view = render(
    <TaskEvidenceGallery
      taskId="task"
      evidence={[
        {
          id: 'evidence',
          contentType: 'image/png',
          length: 9,
          createdAt: '2026-01-01T00:00:00Z',
          submissionId: 'submission',
        },
      ]}
    />,
  );
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(await screen.findByRole('button', { name: 'Tải xuống ảnh 1' }));
  expect(anchorClick).toHaveBeenCalledOnce();
  anchorClick.mockRestore();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem ảnh bằng chứng 1' }));
  expect(screen.getByRole('img', { name: 'Bằng chứng 1 phóng lớn' })).toHaveAttribute(
    'src',
    'blob:synthetic',
  );
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/operational-tasks/task/evidence/evidence',
    expect.objectContaining({ signal: expect.anything() }),
    'blob',
  );
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  vi.unstubAllGlobals();
});

it('shows evidence download failure with retry', async () => {
  mocks.request.mockRejectedValue(new ApiError(404, { title: 'Evidence unavailable' }));
  render(
    <TaskEvidenceGallery
      taskId="task"
      evidence={[
        {
          id: 'evidence',
          contentType: 'image/png',
          length: 9,
          createdAt: '2026-01-01T00:00:00Z',
          submissionId: null,
        },
      ]}
    />,
  );
  expect(await screen.findByRole('button', { name: 'Tải lại ảnh 1' })).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('does not expose generic mutations for meter tasks or invalid states', () => {
  expect(taskActions({ ...task, kind: 'MeterReading' } as OwnerTask)).toEqual([]);
  expect(taskActions({ ...task, status: 'Completed' } as OwnerTask)).toEqual([]);
  expect(taskActions({ ...task, status: 'PendingVerification' } as OwnerTask)).not.toContain(
    'edit',
  );
});

it.each(['Tắt lịch', 'Xóa'])(
  'confirms recurring %s and preserves the existing calendar contract',
  async (label) => {
    const template = {
      id: 'template',
      locationId: location.id,
      title: 'Synthetic schedule',
      requirements: 'Inspect',
      priority: 'Normal',
      evidenceRequired: false,
      intervalDays: 1,
      nextRunAt: '2099-01-30T01:00:00Z',
      dueAfterHours: 24,
      isActive: true,
      version: 7,
      scheduleType: 'Monthly',
      dayOfWeek: null,
      dayOfMonth: 30,
    };
    const base = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path: string, init?: RequestInit) =>
      path.startsWith('/api/v1/operational-task-templates?')
        ? Promise.resolve([template])
        : base(path, init),
    );
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Lịch công việc định kỳ' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
    fireEvent.click(await screen.findByRole('option', { name: location.name }));
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Thao tác lịch Synthetic schedule' },
        { timeout: 10000 },
      ),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    expect(
      mocks.request.mock.calls.some(([, init]) => ['PUT', 'DELETE'].includes(init?.method)),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some(([, init]) => ['PUT', 'DELETE'].includes(init?.method)),
      ).toBe(true),
    );
    const call = mocks.request.mock.calls.find(([, init]) =>
      ['PUT', 'DELETE'].includes(init?.method),
    )!;
    if (label === 'Xóa')
      expect(call[0]).toBe(
        `/api/v1/operational-task-templates/template?locationId=${location.id}&version=7`,
      );
    else
      expect(JSON.parse(call[1].body)).toMatchObject({
        version: 7,
        isActive: false,
        scheduleType: 'Monthly',
        dayOfMonth: 30,
      });
  },
);

it('rework removes a task from the pending list without deleting evidence', async () => {
  const base = mocks.request.getMockImplementation()!;
  let state = 'PendingVerification';
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/rework') && init?.method === 'POST') {
      state = 'InProgress';
      return Promise.resolve({ ...task, status: state });
    }
    if (path === '/api/v1/operational-tasks/task')
      return Promise.resolve({ ...task, status: state });
    if (path.startsWith('/api/v1/operational-work?') && path.includes('verification=true'))
      return Promise.resolve({
        items: state === 'PendingVerification' ? [workRow] : [],
        totalCount: state === 'PendingVerification' ? 1 : 0,
        counts: { ...workCounts, verification: state === 'PendingVerification' ? 1 : 0 },
      });
    return base(path, init);
  });
  mount();
  fireEvent.click(screen.getByRole('tab', { name: /Chờ nghiệm thu/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }, { timeout: 10000 }));
  fireEvent.click(await screen.findByRole('button', { name: 'Yêu cầu làm lại' }));
  fireEvent.change(await screen.findByLabelText(/Lý do yêu cầu làm lại/), {
    target: { value: 'Bổ sung kết quả' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Xác nhận' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết' }));
  expect(await screen.findByText('Không có dữ liệu phù hợp với bộ lọc.')).toBeInTheDocument();
  expect(
    mocks.request.mock.calls.some(
      ([path, init]) => path.includes('/evidence') && init?.method === 'DELETE',
    ),
  ).toBe(false);
});
