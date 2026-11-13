import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { sharedConfigurationClient } from '../../../../../packages/client-core/src/sharedConfiguration';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { theme } from '../../theme/theme';
import { PortalProvider } from '../../app/PortalProvider';
import { PropertyApiPage } from './PropertyApiPages';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('../configuration/useSharedConfigurationApi', () => ({
  useSharedConfigurationApi: () =>
    sharedConfigurationClient(<T,>(path: string, init?: RequestInit) =>
      path.endsWith('/room-defaults')
        ? (Promise.resolve([]) as Promise<T>)
        : (state.request(path, init) as Promise<T>),
    ),
}));
vi.mock('./usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'synthetic-user', roles: state.roles } }),
}));
const location = {
  id: 'location',
  name: 'Synthetic Location',
  address: 'Synthetic address',
  isActive: true,
  version: 4,
};
beforeEach(() => {
  vi.resetAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/capture/locations'
      ? [{ id: 'location', label: 'Synthetic Location' }]
      : path.endsWith('/rooms')
        ? [{ id: 'room', label: 'A101' }]
        : { items: [location], totalCount: 1, page: 1, pageSize: 20 },
  );
});
afterEach(cleanup);
function mount(kind: 'locations' | 'rooms' | 'assets') {
  return render(
    <ThemeProvider theme={theme}>
      <PortalProvider>
        <MemoryRouter>
          <PropertyApiPage kind={kind} />
        </MemoryRouter>
      </PortalProvider>
    </ThemeProvider>,
  );
}
async function chooseLocation() {
  fireEvent.mouseDown(screen.getByLabelText('Cơ sở quản lý'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic Location' }));
}
it('creates a Location with native fields and refreshes the persisted server list', async () => {
  let created = false;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      created = true;
      return { ...location, name: 'Persisted Location' };
    }
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    return {
      items: [{ ...location, name: created ? 'Persisted Location' : location.name }],
      totalCount: 1,
    };
  });
  mount('locations');
  await screen.findByText('Synthetic Location');
  fireEvent.click(screen.getByRole('button', { name: 'Thêm cơ sở' }));
  fireEvent.change(screen.getByLabelText(/Tên cơ sở/), { target: { value: 'Persisted Location' } });
  fireEvent.change(screen.getByLabelText(/Địa chỉ cơ sở/), {
    target: { value: 'Synthetic address' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await screen.findByText('Máy chủ đã lưu cấu hình.');
  await screen.findByText('Persisted Location');
  expect(state.request).toHaveBeenCalledWith('/api/v1/locations', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Persisted Location',
      address: 'Synthetic address',
      isActive: true,
      version: 0,
      reason: '',
    }),
  });
});
it('updates Location using the loaded version and requires a reason', async () => {
  mount('locations');
  await screen.findByText('Synthetic Location');
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
  fireEvent.change(screen.getByLabelText(/Lý do \/ ghi chú/), {
    target: { value: 'Synthetic correction' },
  });
  fireEvent.change(screen.getByLabelText(/Địa chỉ cơ sở/), {
    target: { value: 'Updated address' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/locations/location',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: location.name,
          address: 'Updated address',
          isActive: true,
          version: 4,
          reason: 'Synthetic correction',
        }),
      }),
    ),
  );
});
it.each([400, 409, 403])(
  'shows write rejection %s without a persistence success message',
  async (status) => {
    state.request.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new ApiError(status);
      return { items: [location], totalCount: 1 };
    });
    mount('locations');
    await screen.findByText('Synthetic Location');
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(screen.getByLabelText(/Lý do \/ ghi chú/), {
      target: { value: 'Synthetic correction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await screen.findAllByRole('alert');
    expect(screen.queryByText('Máy chủ đã lưu cấu hình.')).toBeNull();
  },
);
it('does not offer Owner mutations to Staff', async () => {
  state.roles = ['Staff'];
  mount('locations');
  await screen.findByText('Synthetic Location');
  expect(screen.queryByRole('button', { name: 'Thêm cơ sở' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
});
it('requires confirmation before deactivating an existing Location', async () => {
  mount('locations');
  await screen.findByText('Synthetic Location');
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
  fireEvent.mouseDown(screen.getByLabelText('Hoạt động'));
  fireEvent.click(await screen.findByRole('option', { name: 'Ngừng hoạt động' }));
  fireEvent.change(screen.getByLabelText(/Lý do \/ ghi chú/), {
    target: { value: 'Synthetic closure review' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await screen.findByText('Ngừng hoạt động cơ sở?');
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([, init]) => init?.method === 'PUT' && JSON.parse(init.body).isActive === false,
      ),
    ).toBe(true),
  );
});
it('creates a native Room while loading local defaults and provenance', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/room-defaults') || path.endsWith('/room-provenance')) return [];
    return { items: [], totalCount: 0 };
  });
  mount('rooms');
  await chooseLocation();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm phòng' }));
  fireEvent.change(screen.getByLabelText(/Số phòng/), { target: { value: 'A101' } });
  fireEvent.change(screen.getByLabelText(/Sức chứa/), { target: { value: '2' } });
  expect(screen.queryByLabelText(/Loại phòng/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('/api/v1/rooms', {
      method: 'POST',
      body: JSON.stringify({
        locationId: 'location',
        roomNumber: 'A101',
        floor: null,
        capacity: 2,
        status: 0,
        version: 0,
        reason: '',
      }),
    }),
  );
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/room-defaults'))).toBe(true);
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/room-provenance'))).toBe(true);
  expect(state.request.mock.calls.some(([path]) => path.includes('/api/v1/room-types'))).toBe(false);
});
it('reads physical Asset fields through the scoped native list and pagination', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/rooms')) return [];
    return {
      items: [
        {
          id: 'asset',
          locationId: 'location',
          roomId: null,
          commonArea: 'Hall',
          code: 'CHAIR-01',
          name: 'Synthetic chair',
          category: 'Furniture',
          condition: 'Good',
          status: 0,
          version: 1,
        },
      ],
      totalCount: 21,
    };
  });
  mount('assets');
  await chooseLocation();
  await screen.findByText('Synthetic chair');
  expect(screen.getByText(/CHAIR-01/)).toBeInTheDocument();
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/assets?locationId=location&page=1&pageSize=20',
    expect.anything(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tới trang tiếp theo' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/assets?locationId=location&page=2&pageSize=20',
      expect.anything(),
    ),
  );
});

it('sends room status filtering to the backend instead of filtering a paginated subset', async () => {
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/capture/locations'
      ? [{ id: 'location', label: 'Synthetic Location' }]
      : path.endsWith('/room-defaults') || path.endsWith('/room-provenance')
        ? []
        : { items: [], totalCount: 0 },
  );
  mount('rooms');
  await chooseLocation();
  fireEvent.mouseDown(screen.getByLabelText('Trạng thái'));
  fireEvent.click(await screen.findByRole('option', { name: 'Đang có khách thuê' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/rooms?locationId=location&page=1&pageSize=20&roomStatus=2',
      expect.anything(),
    ),
  );
});
