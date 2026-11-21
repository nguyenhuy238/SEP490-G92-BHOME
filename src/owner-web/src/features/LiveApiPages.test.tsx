import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../packages/client-core/src/api';
import StaffPage from './staff/pages/StaffPage';
import TasksPage from './tasks/pages/TasksPage';
import IncidentsPage from './incidents/pages/IncidentsPage';
import MaintenancePage from './maintenance/pages/MaintenancePage';
import PublicContentPage from './public-content/pages/PublicContentPage';
import SchedulesPage from './schedules/pages/SchedulesPage';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('../components/common/ResourcePage', () => ({
  ResourcePage: () => <span>DEMO_MARKER</span>,
}));
const location = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Synthetic API Location',
  version: 1,
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/locations?')) return { items: [location], totalCount: 1 };
    if (path.startsWith('/api/v1/public-content/locations/'))
      return {
        locationId: location.id,
        name: location.name,
        summary: 'Approved public description',
        amenities: [],
        photos: [],
        published: false,
        publishedAt: null,
      };
    return { items: [], totalCount: 0, page: 1, pageSize: 20 };
  });
});
afterEach(cleanup);
function mount(Page: React.ComponentType) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it.each([
  [StaffPage, '/api/v1/staff?'],
  [TasksPage, '/api/v1/operational-tasks?'],
  [IncidentsPage, '/api/v1/incidents?'],
  [MaintenancePage, '/api/v1/work-orders?'],
] as const)('loads the actual API branch of %s after merge', async (Page, path) => {
  mount(Page);
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([url]) => url.startsWith(path))).toBe(true),
  );
  expect(screen.queryByText('DEMO_MARKER')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Backend đang chạy chưa cung cấp contract API/),
  ).not.toBeInTheDocument();
});
it('loads Owner public content from the selected backend Location', async () => {
  mount(PublicContentPage);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Cơ sở/ }));
  fireEvent.click(await screen.findByRole('option', { name: location.name }));
  await screen.findByDisplayValue('Approved public description');
  expect(mocks.request).toHaveBeenCalledWith(
    `/api/v1/public-content/locations/${location.id}`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.queryByText('DEMO_MARKER')).not.toBeInTheDocument();
});
it('shows a backend failure instead of silently supplying demo records', async () => {
  const request = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string, init?: RequestInit) =>
    path.startsWith('/api/v1/staff?') ? Promise.reject(new ApiError(503)) : request(path, init),
  );
  mount(StaffPage);
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  expect(screen.queryByText('DEMO_MARKER')).not.toBeInTheDocument();
});
it('discloses the unsupported shift workflow without rendering demo schedules', () => {
  mount(SchedulesPage);
  expect(screen.getByText(/Phân ca chưa thuộc phạm vi MVP/)).toBeInTheDocument();
  expect(screen.queryByText('DEMO_MARKER')).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
});
