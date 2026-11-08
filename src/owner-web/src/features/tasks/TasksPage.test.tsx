import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import TasksPage from './pages/TasksPage';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), history: vi.fn(), evidence: vi.fn(), evidenceFile: vi.fn(),
  create: vi.fn(), update: vi.fn(), act: vi.fn(), locations: vi.fn(),
}));
vi.mock('./useOperationalTasksApi', async (original) => ({
  ...(await original()), useOperationalTasksApi: () => mocks,
}));
vi.mock('../property-api/propertyApi', () => ({ usePropertyApi: () => ({ locations: mocks.locations }) }));

const task = {
  id: '10000000-0000-0000-0000-000000000001', locationId: '20000000-0000-0000-0000-000000000001',
  kind: 'AdHoc', title: 'Kiểm tra máy bơm', requirements: 'Đối chiếu hoạt động và chụp ảnh',
  priority: 'High', dueAt: '2026-11-09T03:00:00Z', evidenceRequired: true,
  status: 'PendingVerification', isOverdue: false,
  currentResponsibleStaffUserId: '30000000-0000-0000-0000-000000000001',
  recordedStaffUserId: null, responsibilityAvailable: true, result: 'Đã kiểm tra', version: 3,
  verifiedByUserId: null, verifiedAt: null, createdAt: '2026-11-08T01:00:00Z', updatedAt: '2026-11-08T02:00:00Z',
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><TasksPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locations.mockResolvedValue({ items: [{ id: task.locationId, name: 'Cơ sở Tổng hợp' }] });
  mocks.list.mockResolvedValue({ items: [task], page: 1, pageSize: 20, totalCount: 1 });
  mocks.get.mockResolvedValue(task);
  mocks.history.mockResolvedValue({ items: [{ id: 'history', action: 'submit', note: 'Hoàn tất', occurredAt: task.updatedAt, taskVersion: 3 }], page: 1, pageSize: 100, totalCount: 1 });
  mocks.evidence.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ ...task, status: 'Assigned', version: 1 });
  mocks.act.mockResolvedValue({ ...task, status: 'Completed', version: 4 });
});

it('creates an operational task with the selected Location and Backend work contract', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo công việc' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở Tổng hợp' }));
  fireEvent.change(within(dialog).getByLabelText(/Tiêu đề/), { target: { value: 'Kiểm tra tủ điện' } });
  fireEvent.change(within(dialog).getByLabelText(/Yêu cầu thực hiện/), { target: { value: 'Kiểm tra an toàn' } });
  fireEvent.change(within(dialog).getByLabelText(/Hạn hoàn thành/), { target: { value: '2026-11-09T10:00' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create.mock.calls[0][0]).toBe(task.locationId);
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ title: 'Kiểm tra tủ điện', requirements: 'Kiểm tra an toàn', priority: 'Normal' });
  expect(mocks.create.mock.calls[0][2]).toMatch(/^[0-9a-f-]{36}$/i);
});

it('loads detail, evidence history and submits an Owner verification using the current version', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  expect(await screen.findByText(/Hoàn tất ·/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hoàn thành' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(mocks.act).toHaveBeenCalledTimes(1));
  expect(mocks.act.mock.calls[0].slice(0, 4)).toEqual([task.id, 'verify', 3, '']);
  expect(mocks.act.mock.calls[0][4]).toMatch(/^[0-9a-f-]{36}$/i);
});
