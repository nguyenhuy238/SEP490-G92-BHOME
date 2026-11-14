import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../../packages/client-core/src/propertySetup';
import { roomStatusColors, theme } from '../../../theme/theme';
import { NativeLocationsListPage } from './NativeLocationsListPage';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));

vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'synthetic-user', roles: state.roles } }),
}));
vi.mock('../../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../setup/LocationSetupWizard', () => ({
  LocationSetupWizard: ({ initialSource }: { initialSource?: string }) => (
    <div role="dialog" aria-label="Thiết lập cơ sở">
      {initialSource ?? 'Tạo mới'}
    </div>
  ),
}));

const first = { id: 'location-a', name: 'Cơ sở A', address: 'Địa chỉ A', isActive: true };
const second = { id: 'location-b', name: 'Cơ sở B', address: 'Địa chỉ B', isActive: false };

beforeEach(() => {
  vi.resetAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/setup-metadata')) return null;
    if (path.endsWith('/occupancy-summary'))
      return {
        snapshot: {
          totalRooms: 12,
          occupiedRooms: 7,
          availableRooms: 3,
          onHoldRooms: 1,
          unavailableRooms: 1,
        },
      };
    const params = new URLSearchParams(path.split('?')[1]);
    const page = Number(params.get('page'));
    if (params.get('search')) return { items: [first], totalCount: 1 };
    return { items: page === 1 ? [first] : [second], totalCount: 2 };
  });
});
afterEach(cleanup);

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <NativeLocationsListPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

it('requires an explicit source for top-level copy and loads source options beyond the filtered page', async () => {
  mount();
  await screen.findByRole('link', { name: 'Cơ sở A' });
  fireEvent.change(screen.getByLabelText('Tìm theo tên hoặc địa chỉ'), {
    target: { value: 'Cơ sở A' },
  });
  await screen.findByText('1 cơ sở phù hợp');
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép cấu hình' }));
  const dialog = screen.getByRole('dialog', { name: 'Chọn cơ sở nguồn' });
  expect(within(dialog).getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(([path]) => {
        const params = new URLSearchParams(path.split('?')[1]);
        return params.get('page') === '2' && !params.get('search');
      }),
    ).toBe(true),
  );
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Cơ sở nguồn' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở B' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
  expect(await screen.findByRole('dialog', { name: 'Thiết lập cơ sở' })).toHaveTextContent(
    'location-b',
  );
});

it('keeps the open link and makes row edit and copy actions explicit', async () => {
  mount();
  const table = await screen.findByRole('table', { name: 'Danh sách cơ sở' });
  expect(within(table).getByRole('link', { name: 'Xem cơ sở' })).toHaveAttribute(
    'href',
    '/locations/location-a/overview',
  );
  fireEvent.click(within(table).getByRole('button', { name: 'Thao tác cho Cơ sở A' }));
  expect(await screen.findByRole('menuitem', { name: 'Sửa thông tin' })).toHaveAttribute(
    'href',
    '/locations/location-a/settings',
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sao chép cấu hình' }));
  expect(await screen.findByRole('dialog', { name: 'Thiết lập cơ sở' })).toHaveTextContent(
    'location-a',
  );
});

it('keeps Owner-only create, copy, edit and metadata queries unavailable to Staff', async () => {
  state.roles = ['Staff'];
  mount();
  await screen.findByRole('link', { name: 'Cơ sở A' });
  expect(screen.queryByRole('button', { name: 'Thêm cơ sở' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sao chép cấu hình' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thao tác cho Cơ sở A' })).not.toBeInTheDocument();
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/setup-metadata'))).toBe(false);
});

it('keeps distinct location rows, exact server room counts, and unavailable counts visible only once', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/setup-metadata')) return null;
    if (path.includes('/location-a/occupancy-summary'))
      return {
        snapshot: {
          totalRooms: 12,
          occupiedRooms: 7,
          availableRooms: 3,
          onHoldRooms: 1,
          unavailableRooms: 1,
        },
      };
    if (path.includes('/location-b/occupancy-summary')) throw new Error('Unavailable');
    return { items: [first, second], totalCount: 2 };
  });
  mount();
  const table = await screen.findByRole('table', { name: 'Danh sách cơ sở' });
  const a = within(table).getByRole('row', { name: /Cơ sở A/ });
  const b = within(table).getByRole('row', { name: /Cơ sở B/ });
  expect(await within(a).findByRole('link', { name: '12 phòng' })).toHaveAttribute(
    'href',
    '/locations/location-a/rooms',
  );
  expect(a).toHaveTextContent('7 thuê');
  expect(a).toHaveTextContent('3 trống');
  expect(a).toHaveTextContent('1 giữ chỗ');
  expect(a).toHaveTextContent('1 ngừng KT');
  expect(within(a).getByText('7 thuê')).toHaveStyle({ color: roomStatusColors.occupied.fill });
  expect(within(a).getByText('3 trống')).toHaveStyle({ color: roomStatusColors.available.fill });
  expect(within(a).getByText('1 giữ chỗ')).toHaveStyle({
    color: roomStatusColors.onHold.foreground,
  });
  expect(within(a).getByTitle('ngừng khai thác').parentElement).toHaveStyle({
    color: roomStatusColors.unavailable.foreground,
  });
  expect(within(a).getByTitle('ngừng khai thác')).toHaveTextContent('ngừng KT');
  expect(within(a).getAllByRole('link', { name: '12 phòng' })).toHaveLength(1);
  expect(within(a).getByText('Đang hoạt động')).toBeInTheDocument();
  expect(within(b).getByText('Ngừng hoạt động')).toBeInTheDocument();
  expect(await within(b).findByText('Chưa tải được số liệu phòng.')).toBeInTheDocument();
  expect(b).not.toHaveTextContent('0 phòng');
  expect(within(b).getByRole('link', { name: 'Xem cơ sở' })).toHaveAttribute(
    'href',
    '/locations/location-b/overview',
  );
});

it('retains all four compact room statuses even when some counts are zero', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/setup-metadata')) return null;
    if (path.endsWith('/occupancy-summary'))
      return {
        snapshot: {
          totalRooms: 17,
          occupiedRooms: 0,
          availableRooms: 17,
          onHoldRooms: 0,
          unavailableRooms: 0,
        },
      };
    return { items: [first], totalCount: 1 };
  });
  mount();
  const row = await screen.findByRole('row', { name: /Cơ sở A/ });
  expect(await within(row).findByRole('link', { name: '17 phòng' })).toBeInTheDocument();
  expect(row).toHaveTextContent('0 thuê');
  expect(row).toHaveTextContent('17 trống');
  expect(row).toHaveTextContent('0 giữ chỗ');
  expect(row).toHaveTextContent('0 ngừng KT');
  expect(within(row).getByText('0 thuê')).toHaveStyle({ color: roomStatusColors.unavailable.fill });
  expect(within(row).getByText('17 trống')).toHaveStyle({ color: roomStatusColors.available.fill });
  expect(within(row).getByText('0 giữ chỗ')).toHaveStyle({
    color: roomStatusColors.unavailable.fill,
  });
});
