import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IncidentDetail, WorkOrderDetail } from './IncidentWorkspace';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const incident = {
  id: 'incident',
  code: 'INC-SYN',
  locationId: 'location',
  description: 'Synthetic incident',
  status: 'Submitted',
  severity: 'Emergency',
  type: null,
  category: null,
  version: 7,
};
function mount(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/incidents/incident') return incident;
    if (
      path.includes('/history?') ||
      path.includes('/maintenance-history?') ||
      path.startsWith('/api/v1/work-orders?')
    )
      return { items: [], totalCount: 0 };
    return [];
  });
});
afterEach(cleanup);
it('posts the reviewed incident version once and preserves fields and retry key after uncertain failure', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('Synthetic network failure');
    return original(path, init);
  });
  mount(<IncidentDetail id="incident" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Phân loại' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/Loại sự cố/), { target: { value: 'Plumbing' } });
  fireEvent.change(within(dialog).getByLabelText(/Nhóm xử lý/), { target: { value: 'Water' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  await within(dialog).findByText(
    'Chưa hoàn thành yêu cầu. Tải lại dữ liệu để kiểm tra trước khi thử lại.',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  const writes = mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[0][1].body)).toEqual({
    version: 7,
    type: 'Plumbing',
    category: 'Water',
  });
  expect(writes[0][1].headers['Idempotency-Key']).toBe(writes[1][1].headers['Idempotency-Key']);
  expect(screen.queryByRole('button', { name: 'Tiếp nhận khẩn cấp' })).toBeNull();
});
it('offers Owner approval but no Staff execution for a proposed work order', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/work-orders/work'
      ? {
          id: 'work',
          incidentId: 'incident',
          locationId: 'location',
          expectedOutcome: 'Repair pipe',
          status: 'PendingApproval',
          proposalVersion: 3,
          version: 8,
          targetCompletionAt: '2026-11-10T03:00:00Z',
        }
      : original(path),
  );
  mount(<WorkOrderDetail id="work" />);
  expect(await screen.findByRole('button', { name: 'Duyệt phương án' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Bắt đầu sửa chữa' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác minh hoàn tất' })).toBeNull();
});
