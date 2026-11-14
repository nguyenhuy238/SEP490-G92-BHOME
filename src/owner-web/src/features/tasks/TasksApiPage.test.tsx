import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TasksApiPage } from './TasksApiPage';
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
afterEach(() => vi.unstubAllGlobals());
function mount() {
  render(
    <MemoryRouter>
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
  const staffFilter = await screen.findByRole('combobox', { name: 'Staff phụ trách' });
  fireEvent.mouseDown(staffFilter);
  fireEvent.click(await screen.findByRole('option', { name: 'Staff synthetic' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('staffUserId=staff'),
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
