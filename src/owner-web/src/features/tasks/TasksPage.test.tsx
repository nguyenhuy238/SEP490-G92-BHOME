import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TasksPage from './pages/TasksPage';
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
it('creates a task through the backend with UTC deadline and a retry key', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo công việc' }));
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

it('uses server counts for summary and status=4 for verification, preserving other filters', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path.includes('pageSize=1') && !path.includes('pageSize=100')
      ? Promise.resolve({
          items: [],
          totalCount: path.includes('status=2')
            ? 15
            : path.includes('status=3')
              ? 5
              : path.includes('isOverdue')
                ? 2
                : 100,
        })
      : base(path, init),
  );
  mount();
  expect(await screen.findByText('80')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Chờ nghiệm thu/ }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-tasks?status=4&page=1&pageSize=20',
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
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  expect(screen.getByRole('tab', { name: /Chờ nghiệm thu/ })).toHaveAttribute(
    'aria-selected',
    'true',
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
    fireEvent.click(await screen.findByRole('button', { name: label }));
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
  fireEvent.click(await screen.findByRole('button', { name: 'Yêu cầu làm lại' }));
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
    path.startsWith('/api/v1/operational-tasks?')
      ? Promise.resolve({
          items: [{ ...task, currentResponsibleStaffUserId: 'unknown' }],
          totalCount: 1,
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
    fireEvent.click(await screen.findByRole('button', { name: label }));
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
    if (path.startsWith('/api/v1/operational-tasks?') && path.includes('status=4'))
      return Promise.resolve({
        items: state === 'PendingVerification' ? [task] : [],
        totalCount: state === 'PendingVerification' ? 1 : 0,
      });
    return base(path, init);
  });
  mount();
  fireEvent.click(screen.getByRole('tab', { name: /Chờ nghiệm thu/ }));
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
  expect(await screen.findByText('Không có công việc phù hợp.')).toBeInTheDocument();
  expect(
    mocks.request.mock.calls.some(
      ([path, init]) => path.includes('/evidence') && init?.method === 'DELETE',
    ),
  ).toBe(false);
});
