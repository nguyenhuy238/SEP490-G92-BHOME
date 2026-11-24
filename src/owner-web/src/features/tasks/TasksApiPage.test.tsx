import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TasksApiPage } from './TasksApiPage';
import { TaskStatus } from './components/TaskDetailDrawer';
import type { OwnerTask } from './taskContracts';
import { ApiError } from '../../../../../packages/client-core/src/api';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const task = {
  id: 'task',
  title: 'Synthetic task',
  kind: 'AdHoc',
  requirements: 'Check evidence',
  locationId: 'location',
  priority: 'High',
  status: 'PendingVerification',
  responsibilityAvailable: true,
  currentResponsibleStaffUserId: 'staff',
  version: 9,
  result: 'Submitted',
  dueAt: '2026-11-10T00:00:00Z',
};
const staff = {
  userId: 'staff',
  fullName: 'Staff synthetic',
  email: 'staff@example.invalid',
  phone: null,
  isActive: true,
  accountVersion: 'v1',
  employment: null,
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/staff-location-assignments?'))
      return [
        {
          id: 'assignment',
          locationId: 'location',
          staffUserId: 'staff',
          startDate: '2000-01-01',
          endDate: '2099-12-31',
        },
      ];
    if (path.startsWith('/api/v1/rooms?'))
      return { items: [{ id: 'room', roomNumber: '101' }], totalCount: 1 };
    if (path.startsWith('/api/v1/operational-tasks/targets/common-areas?')) return ['Hành lang'];
    if (path.startsWith('/api/v1/operational-tasks/targets/assets?'))
      return { items: [{ id: 'asset', name: 'Đèn hành lang' }], totalCount: 1 };
    if (path.startsWith('/api/v1/locations'))
      return { items: [{ id: 'location', name: 'Cơ sở A', isActive: true }], totalCount: 1 };
    if (path === '/api/v1/staff?page=1&pageSize=100') return { items: [staff], totalCount: 1 };
    if (path === '/api/v1/operational-tasks/task/actors')
      return [{ userId: 'owner', displayName: 'Owner synthetic' }];
    return path.endsWith('/evidence')
      ? []
      : path === '/api/v1/operational-tasks/task'
        ? task
        : { items: path.startsWith('/api/v1/operational-tasks?') ? [task] : [], totalCount: 1 };
  });
});

it('creates work for an asset in a common area and keeps the assigned Staff derived from location', async () => {
  mount('/operational-tasks?locationId=location');
  fireEvent.click(await screen.findByRole('button', { name: /^Tạo công việc$/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Tạo công việc' });
  await within(dialog).findByText('Staff phụ trách: Staff synthetic');
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Phạm vi công việc' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Khu vực chung' }));
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Khu vực chung' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Hành lang' }));
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Tài sản liên quan' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Đèn hành lang' }));
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Tên công việc/ }), {
    target: { value: 'Kiểm tra đèn' },
  });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Yêu cầu/ }), {
    target: { value: 'Kiểm tra hoạt động' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Thời điểm hoàn thành/), {
    target: { value: '2099-12-31T10:00' },
  });
  const submit = within(dialog).getByRole('button', { name: 'Lưu công việc' });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-tasks',
      expect.objectContaining({ method: 'POST', body: expect.any(String) }),
    ),
  );
  const post = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/operational-tasks' && init?.method === 'POST',
  )!;
  expect(JSON.parse(post[1].body)).toMatchObject({
    locationId: 'location',
    work: { target: { commonArea: 'Hành lang', assetId: 'asset' }, title: 'Kiểm tra đèn' },
  });
  expect(mocks.request).toHaveBeenCalledWith(
    expect.stringContaining('commonArea=H%C3%A0nh+lang'),
    expect.anything(),
  );
});
afterEach(() => vi.unstubAllGlobals());
function mount(url = '/operational-tasks') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TasksApiPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('uses the reviewed task version for Owner verification and exposes no Staff execution', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Nghiệm thu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nghiệm thu' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Đã kiểm tra kết quả/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-tasks/task/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: 9, note: null }),
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    ),
  );
  expect(screen.queryByRole('button', { name: 'Bắt đầu công việc' })).not.toBeInTheDocument();
});
it('keeps the same command key on an uncertain verification retry', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new ApiError(0);
    return original(path, init);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Nghiệm thu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nghiệm thu' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Đã kiểm tra kết quả/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  await within(dialog).findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0][1].headers).toEqual(posts[1][1].headers);
});

it('forwards the selected Staff filter to the server', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Bộ lọc nâng cao' }));
  const staffFilter = await screen.findByRole('combobox', { name: 'Người phụ trách cơ sở' });
  fireEvent.mouseDown(staffFilter);
  fireEvent.click(await screen.findByRole('option', { name: 'Staff synthetic' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('staffUserId=staff'),
      expect.anything(),
    ),
  );
});

it('opens a deep-linked location and recorded Staff responsibility filter on the server', async () => {
  mount('/operational-tasks?locationId=location&recordedStaffUserId=staff&hasResponsibility=false');
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringMatching(
        /locationId=location.*recordedStaffUserId=staff.*hasResponsibility=false/,
      ),
      expect.anything(),
    ),
  );
  expect(
    await screen.findByRole('combobox', { name: 'Người được giao trong hồ sơ' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/operational-tasks?page=1&pageSize=20',
      expect.anything(),
    ),
  );
});

it('keeps task status, due date and review action visible in the compact table', async () => {
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
  mount();
  const table = await screen.findByRole('table', { name: 'Danh sách công việc' });
  const row = await within(table).findByRole('row', { name: /Synthetic task/ });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Công việc', 'Thao tác']);
  expect(within(row).getByText(/Hạn:/)).toBeVisible();
  fireEvent.click(within(row).getByRole('button', { name: 'Xem chi tiết' }));
  expect(await screen.findByRole('button', { name: 'Nghiệm thu' })).toBeVisible();
});

it('shows Staff-completed move-in inventory and linked BF-07 incident with no Owner approval', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/v1/operational-tasks/task')
      return Promise.resolve({
        ...task,
        kind: 'MoveInInventory',
        status: 'Completed',
        title: 'Kiểm kê P.101',
      });
    if (path === '/api/v1/operational-tasks/task/move-in-inventory')
      return Promise.resolve({
        taskId: 'task',
        contractId: 'contract',
        locationId: 'location',
        roomId: 'room',
        status: 'Completed',
        version: 5,
        completedAt: '2026-11-18T05:00:00Z',
        items: [
          {
            id: 'item-1',
            assetId: 'asset-1',
            name: 'Giường đơn',
            expectedQuantity: 2,
            actualQuantity: 2,
            condition: 'Good',
            notes: '',
            evidenceIds: [],
            incidentId: null,
          },
          {
            id: 'item-2',
            assetId: 'asset-2',
            name: 'Bàn học',
            expectedQuantity: 2,
            actualQuantity: 1,
            condition: 'Missing',
            notes: 'Thiếu một bàn',
            evidenceIds: [],
            incidentId: 'incident-1',
          },
        ],
      });
    return base(path, init);
  });
  mount('/operational-tasks?taskId=task');
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  expect(await within(drawer).findByText('Báo cáo kiểm kê trước bàn giao')).toBeInTheDocument();
  expect(within(drawer).getByText(/2\/2 loại đã kiểm tra/)).toBeInTheDocument();
  expect(within(drawer).getByText(/Loại:\s*Kiểm kê trước bàn giao/)).toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: 'Nghiệm thu' })).not.toBeInTheDocument();
  fireEvent.click(within(drawer).getByText('Bàn học'));
  const incident = await within(drawer).findByRole('link', { name: 'Xem báo cáo sự cố BF-07' });
  expect(incident).toHaveAttribute('href', '/incidents?locationId=location&incidentId=incident-1');
});

it('labels an archived prior-Staff handover as Đã chuyển giao in task history', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/v1/operational-tasks/task/history?page=1&pageSize=20')
      return Promise.resolve({
        items: [
          {
            id: 'history-superseded',
            actorId: 'owner',
            action: 'responsibility_superseded',
            note: 'Đã lưu trữ checklist của đợt phân công trước.',
            occurredAt: '2026-11-20T04:00:00Z',
            taskVersion: 10,
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 1,
      });
    return original(path, init);
  });
  mount('/operational-tasks?taskId=task');
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  expect(await within(drawer).findByText('Đã chuyển giao')).toBeInTheDocument();
});

it('labels inherited checklist progress as Kế thừa tiến độ kiểm kê in task history', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/v1/operational-tasks/task/history?page=1&pageSize=20')
      return Promise.resolve({
        items: [
          {
            id: 'history-inherited',
            actorId: 'owner',
            action: 'location_asset_inventory_progress_inherited',
            note: 'Đã đối chiếu và kế thừa một phần checklist.',
            occurredAt: '2026-11-20T05:00:00Z',
            taskVersion: 2,
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 1,
      });
    return original(path, init);
  });
  mount('/operational-tasks?taskId=task');
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết công việc' });
  expect(await within(drawer).findByText('Kế thừa tiến độ kiểm kê')).toBeInTheDocument();
});

it('shows a superseded whole-Location handover as Đã chuyển giao instead of Đã hủy', () => {
  const archived = { ...task, kind: 'LocationAssetHandover', status: 'Cancelled' } as OwnerTask;
  render(<TaskStatus task={archived} />);
  expect(screen.getByText('Đã chuyển giao')).toBeInTheDocument();
  expect(screen.queryByText('Đã hủy')).not.toBeInTheDocument();
});
