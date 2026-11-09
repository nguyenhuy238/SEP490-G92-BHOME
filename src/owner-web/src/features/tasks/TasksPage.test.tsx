import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TasksPage from './pages/TasksPage';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const location = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic API Location' };
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
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return task;
    if (path.startsWith('/api/v1/locations?')) return { items: [location], totalCount: 1 };
    if (path === '/api/v1/operational-tasks/task') return task;
    if (path.endsWith('/evidence') || path.startsWith('/api/v1/operational-task-templates?'))
      return [];
    return { items: path.startsWith('/api/v1/operational-tasks?') ? [task] : [], totalCount: 1 };
  });
});
afterEach(cleanup);
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
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
  fireEvent.change(within(dialog).getByLabelText(/Tên công việc/), {
    target: { value: 'Synthetic new task' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Yêu cầu/), {
    target: { value: 'Synthetic requirements' },
  });
  fireEvent.change(within(dialog).getByLabelText(/Thời điểm/), {
    target: { value: '2026-11-10T10:00' },
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
      dueAt: '2026-11-10T03:00:00.000Z',
      evidenceRequired: false,
    },
  });
  expect(post[1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
});
it('preserves Owner verification and recurring templates in the actual route', async () => {
  mount();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(([p]) => p.startsWith('/api/v1/operational-task-templates?')),
    ).toBe(true),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Nghiệm thu' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
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
