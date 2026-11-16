import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(screen.queryByText('Bắt đầu với nhiệm vụ cần kiểm tra')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Mã tác vụ cần tra cứu')).not.toBeInTheDocument();
  expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
  const pending = within(table).getByRole('row', { name: /P101/ });
  expect(within(pending).getByText('Chờ xác minh')).toBeVisible();
  expect(within(pending).getByText('1.234,0001')).toBeVisible();
  expect(within(table).getByRole('row', { name: /P102/ })).toHaveTextContent('Đang thực hiện');
  fireEvent.click(within(pending).getByRole('button', { name: 'Xem chi tiết' }));
  const detail = await screen.findByRole('dialog', { name: 'Chi tiết nhiệm vụ ghi số' });
  expect(await within(detail).findByText('Chưa có chỉ số được Staff xác nhận.')).toBeVisible();
  expect(mock.reading).not.toHaveBeenCalled();
  expect(mock.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  fireEvent.click(within(detail).getByRole('button', { name: 'Đóng chi tiết nhiệm vụ' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Chi tiết nhiệm vụ ghi số' }),
    ).not.toBeInTheDocument(),
  );
  expect(within(table).getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(2);
  fireEvent.mouseDown(screen.getByLabelText('Trạng thái tác vụ'));
  fireEvent.click(await screen.findByRole('option', { name: 'Chờ xác minh' }));
  await waitFor(() =>
    expect(mock.tasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: '4', page: 1 }),
    ),
  );
  expect(screen.queryByRole('button', { name: 'Công cụ bổ sung' })).not.toBeInTheDocument();
  expect(screen.queryByText('Quản lý nhiệm vụ ghi số')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Giao nhiệm vụ' })).not.toBeInTheDocument();
});
it('presents page-scoped work summaries and quick views without changing the server task workflow', async () => {
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
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(
    screen.getByText('Bộ lọc nhanh và số lượng chỉ áp dụng cho trang 1 · 2 nhiệm vụ đang tải'),
  ).toBeVisible();
  expect(screen.queryByText('Quản lý nhiệm vụ ghi số')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Cần xử lý' }));
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  expect(within(table).getByRole('row', { name: /P101/ })).toBeVisible();
  expect(within(table).queryByRole('row', { name: /P102/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đang thực hiện' }));
  expect(within(table).getByRole('row', { name: /P102/ })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(mock.tasks).toHaveBeenCalledTimes(1);
});
it('fetches meter reading evidence only for preview/download actions through the authenticated request', async () => {
  mock.task.mockResolvedValue({ ...task, status: 2, confirmedReadingId: 'reading-1' });
  mock.reading.mockResolvedValue({
    id: 'reading-1',
    confirmedValue: '1244.0001',
    consumption: '10.0000',
    confirmedAt: '2026-11-10T05:00:00Z',
  });
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])], {
    type: 'image/png',
  });
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  Object.defineProperty(png, 'slice', {
    value: () => ({ arrayBuffer: async () => signature.buffer }),
  });
  mock.request.mockImplementation(async (path, _init, type) => {
    if (String(path).endsWith('/evidence')) {
      expect(type).toBe('blob');
      return png;
    }
    return [];
  });
  const createUrl = vi.fn(() => 'blob:private-meter');
  const revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
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
    fireEvent.click(within(table).getByRole('row', { name: /P101/ }).querySelector('button')!);
    const detail = await screen.findByRole('dialog', { name: 'Chi tiết nhiệm vụ ghi số' });
    const preview = await within(detail).findByRole('button', {
      name: 'Xem Bằng chứng chỉ số đã xác nhận',
    });
    expect(mock.request.mock.calls.some(([path]) => String(path).endsWith('/evidence'))).toBe(
      false,
    );
    fireEvent.click(preview);
    const evidenceDialog = await screen.findByRole('dialog', {
      name: 'Xem Bằng chứng chỉ số đã xác nhận',
    });
    await within(evidenceDialog).findByRole('img', { name: 'Bằng chứng chỉ số đã xác nhận' });
    expect(mock.request).toHaveBeenCalledWith(
      '/api/v1/capture/readings/reading-1/evidence',
      { signal: expect.any(AbortSignal) },
      'blob',
    );
    fireEvent.click(within(evidenceDialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:private-meter'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Tải xuống Bằng chứng chỉ số đã xác nhận' }),
    );
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  } finally {
    click.mockRestore();
  }
});
it('shows meter evidence permission errors without embedding private files', async () => {
  mock.task.mockResolvedValue({ ...task, status: 2, confirmedReadingId: 'reading-1' });
  mock.reading.mockResolvedValue({
    id: 'reading-1',
    confirmedValue: '1244.0001',
    consumption: '10.0000',
    confirmedAt: '2026-11-10T05:00:00Z',
  });
  mock.request.mockImplementation(async (path) => {
    if (String(path).endsWith('/evidence')) throw { status: 403 };
    return [];
  });
  const createUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
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
  fireEvent.click(within(table).getByRole('row', { name: /P101/ }).querySelector('button')!);
  const detail = await screen.findByRole('dialog', { name: 'Chi tiết nhiệm vụ ghi số' });
  fireEvent.click(
    await within(detail).findByRole('button', { name: 'Xem Bằng chứng chỉ số đã xác nhận' }),
  );
  const evidenceDialog = await screen.findByRole('dialog', {
    name: 'Xem Bằng chứng chỉ số đã xác nhận',
  });
  expect(await within(evidenceDialog).findByRole('alert')).toBeInTheDocument();
  expect(createUrl).not.toHaveBeenCalled();
});
it('guides the Owner to the existing schedule on an empty task list and clears task filters', async () => {
  mock.tasks.mockResolvedValue([]);
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
  expect(await screen.findByText('Chưa có nhiệm vụ ghi chỉ số')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở lịch xử lý' })).toHaveAttribute(
    'href',
    '/billing-automation',
  );
  fireEvent.mouseDown(screen.getByLabelText('Trạng thái tác vụ'));
  fireEvent.click(await screen.findByRole('option', { name: 'Chờ xác minh' }));
  expect(await screen.findByText('Không có nhiệm vụ phù hợp bộ lọc')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc nhiệm vụ' }));
  await waitFor(() =>
    expect(mock.tasks).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: '', page: 1 }),
    ),
  );
  expect(mock.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
