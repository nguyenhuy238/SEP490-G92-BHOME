import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { DemoClockWorkspace } from './DemoClockPanel';
import { ApiError } from '../../../../../packages/client-core/src/api';
import {
  getDemoClockState,
  setDemoBusinessDate,
} from '../../../../../packages/client-core/src/demoClock';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'test-owner' } }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  setDemoBusinessDate(null);
});

function mount(environment = 'Staging') {
  vi.stubEnv('VITE_DEPLOYMENT_ENVIRONMENT', environment);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DemoClockWorkspace>
        <div>Workspace content</div>
      </DemoClockWorkspace>
    </QueryClientProvider>,
  );
}

const clock = { enabled: true, simulated: false, businessDate: '2026-11-24', version: 0 };

it('allows an ordinary Staging workspace to render when the optional endpoint is absent', async () => {
  mocks.request.mockRejectedValue(new ApiError(404));
  mount();
  expect(await screen.findByText('Workspace content')).toBeInTheDocument();
  expect(screen.queryByText(/Demo Clock/)).not.toBeInTheDocument();
  expect(getDemoClockState()).toBeNull();
});

it('shows the shared date but hides mutating controls from other Owners', async () => {
  mocks.request.mockResolvedValue({ ...clock, canChange: false });
  mount();
  expect(await screen.findByText('Workspace content')).toBeInTheDocument();
  expect(screen.getByText('Demo Clock · 24/11/2026')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mở Demo Clock' }));
  expect(screen.getByText(/Chỉ xem/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ngày thực' })).not.toBeInTheDocument();
});

it('uses the versioned API for the designated Owner and displays a shared Staging warning', async () => {
  mocks.request.mockResolvedValueOnce({ ...clock, canChange: true }).mockResolvedValueOnce({
    ...clock,
    canChange: true,
    simulated: true,
    businessDate: '2026-11-25',
    version: 1,
  });
  mount();
  await screen.findByText('Workspace content');
  fireEvent.click(screen.getByRole('button', { name: 'Mở Demo Clock' }));
  expect(screen.getByText(/Đổi ngày sẽ áp dụng cho toàn bộ Staging/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '+1 ngày' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/demo-clock', {
      method: 'PUT',
      body: JSON.stringify({ businessDate: '2026-11-25', expectedVersion: 0 }),
    }),
  );
  expect(await screen.findByText('Demo Clock · 25/11/2026')).toBeInTheDocument();
  expect(getDemoClockState()?.version).toBe(1);
});

it('provides date controls in the Production academic portal', async () => {
  mocks.request.mockResolvedValue({ ...clock, canChange: true });
  mount('Production');
  await screen.findByText('Workspace content');
  fireEvent.click(screen.getByRole('button', { name: 'Mở Demo Clock' }));
  expect(screen.getByText(/Đổi ngày sẽ áp dụng cho toàn bộ Production/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
});

it('keeps the page mounted while expanding and minimizing the floating controls', async () => {
  mocks.request.mockResolvedValue({ ...clock, canChange: true });
  mount();
  const content = await screen.findByText('Workspace content');
  expect(screen.queryByRole('region', { name: 'Điều khiển Demo Clock' })).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Mở Demo Clock' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  const panel = screen.getByRole('region', { name: 'Điều khiển Demo Clock' });
  expect(panel).toBeInTheDocument();
  expect(screen.getByText('Workspace content')).toBe(content);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Điều khiển Demo Clock' })).not.toBeInTheDocument();
  expect(screen.getByText('Workspace content')).toBe(content);
  expect(toggle).toHaveFocus();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
