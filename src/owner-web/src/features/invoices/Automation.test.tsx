import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import { LiveAutomationPage } from './AutomationPage';
const mocks = vi.hoisted(() => ({ request: vi.fn(), schedule: vi.fn() }));
vi.mock('./useInvoiceApi', () => ({ useInvoiceApi: () => mocks }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount() {
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <LiveAutomationPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
async function choose() {
  fireEvent.mouseDown(await screen.findByLabelText('Cơ sở tự động'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic' }));
  fireEvent.change(screen.getByLabelText('Kỳ hóa đơn'), { target: { value: '2026-11' } });
}
function respond(developerActionsEnabled = true) {
  mocks.schedule.mockResolvedValue({ version: 3 });
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return [{ id: 'loc', label: 'Synthetic' }];
    if (path.includes('/history')) return [];
    if (path.includes('/preview?'))
      return {
        developerActionsEnabled,
        timeZone: 'Asia/Ho_Chi_Minh',
        businessDate: '2026-11-02',
        phases: [
          { phase: 'Meter', scheduledDate: '2026-11-01', eligible: true },
          { phase: 'Final', scheduledDate: '2026-11-20', eligible: false },
        ],
      };
    if (path.includes('/executions?'))
      return [
        {
          id: 'exec',
          phase: 'Draft',
          status: 'PendingInputs',
          attempts: 2,
          createdCount: 1,
          existingCount: 0,
          exceptionsJson: '[{"code":"missing_water_meter"}]',
          lastStartedAt: '2026-11-02T00:00:00Z',
        },
      ];
    if (path.includes('/delivery-status'))
      return {
        configured: false,
        enabled: false,
        maxAttempts: 4,
        deliveries: { items: [], totalCount: 0 },
      };
    return [];
  });
}
it('shows real exceptions, gates run-now and submits an explicit versioned authorization', async () => {
  respond();
  mount();
  await choose();
  expect(await screen.findByText('missing_water_meter')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chạy ngay: Phát hành hóa đơn' })).toBeDisabled();
  expect(screen.queryByLabelText(/Ngày giao việc ghi số/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cấu hình lịch hóa đơn' }));
  fireEvent.change(screen.getByLabelText(/Ngày giao việc ghi số/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Ngày hết hạn ghi số/), { target: { value: '4' } });
  fireEvent.mouseDown(screen.getByLabelText(/Tháng cộng thêm cho hạn ghi số/));
  fireEvent.click(await screen.findByRole('option', { name: '0' }));
  fireEvent.click(screen.getByLabelText('Bật tự động cho cơ sở'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu phiên bản tự động' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const call = mocks.request.mock.calls.find((c) => c[0] === '/api/v1/billing-automation')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    expectedVersion: 0,
    expectedBillingScheduleVersion: 3,
    enabled: true,
    authorizeAutomaticFinalization: false,
    meterDay: 2,
    meterDueDay: 4,
    effectiveFrom: '2026-11-01',
  });
});
it('hides developer actions outside the permitted runtime', async () => {
  respond(false);
  mount();
  await choose();
  await screen.findByText('missing_water_meter');
  expect(screen.queryByRole('button', { name: /Chạy ngay:/ })).not.toBeInTheDocument();
});
it('shows API failure and permits refresh', async () => {
  mocks.request.mockRejectedValue(new Error('offline'));
  mount();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeEnabled();
});
