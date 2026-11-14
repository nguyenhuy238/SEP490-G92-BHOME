import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import { LiveMetersPage } from './pages/MetersPage';
import type { MeterTask } from '../../../../../packages/client-core/src/meter';

const mock = vi.hoisted(() => ({
  request: vi.fn(),
  tasks: vi.fn(),
  task: vi.fn(),
  reading: vi.fn(),
}));
vi.mock('./useMeterApi', () => ({ useMeterApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const task: MeterTask = {
  id: 'meter-task',
  meterId: 'meter',
  location: 'Cơ sở tổng hợp',
  room: 'P101',
  meterCode: 'E101',
  utilityType: 0,
  display: 0,
  decimalPlaces: 4,
  purpose: 0,
  readingDate: '2026-11-01',
  billingPeriod: '2026-11-01',
  status: 4,
  previousValue: '1234.0001',
  locationId: 'location',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches: query.includes('max-width:599px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mock.request.mockResolvedValue([]);
  mock.tasks.mockResolvedValue([task, { ...task, id: 'in-progress', room: 'P102', status: 1 }]);
  mock.task.mockResolvedValue(task);
});

it('shows the exact meter baseline and real task states with a reachable mobile detail action', async () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <LiveMetersPage />
        </QueryClientProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
  const table = await screen.findByRole('table', { name: 'Tác vụ ghi chỉ số' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
  const pending = within(table).getByRole('row', { name: /P101/ });
  expect(within(pending).getByText('Chờ xác minh')).toBeVisible();
  expect(within(pending).getByText('1.234,0001')).toBeVisible();
  expect(within(table).getByRole('row', { name: /P102/ })).toHaveTextContent('Đang thực hiện');
  fireEvent.click(within(pending).getByRole('button', { name: 'Xem chi tiết' }));
  expect(await screen.findByText('Chưa có chỉ số được Staff xác nhận.')).toBeVisible();
  expect(mock.reading).not.toHaveBeenCalled();
  expect(mock.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
