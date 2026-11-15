import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
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
      : path.startsWith('/api/v1/operational-tasks/targets/common-areas?')
        ? ['Hall', 'Laundry']
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
  expect(screen.getByRole('link', { name: 'Cấu hình mẫu phòng' })).toHaveAttribute(
    'href',
    '/locations/location/room-types',
  );
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
  expect(state.request.mock.calls.some(([path]) => path.includes('/api/v1/room-types'))).toBe(
    false,
  );
});
it('keeps the selected room defaults revision until the Owner explicitly reloads and confirms it', async () => {
  let version = 3;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/room-defaults'))
      return [
        {
          id: 'defaults',
          locationId: 'location',
          kind: 'RoomDefaults',
          status: 'Recorded',
          version,
          data: {
            name: 'Studio',
            defaults: {
              capacity: version === 3 ? 2 : 4,
              area: 25,
              amenities: [],
              referenceRent: version === 3 ? '3500000' : '4200000',
            },
          },
        },
      ];
    if (path.endsWith('/room-provenance')) return [];
    if (path.endsWith('/configured-rooms') && init?.method === 'POST') {
      if (version === 3) {
        version = 4;
        throw new ApiError(409);
      }
      return {
        rooms: [
          {
            id: 'new-room',
            locationId: 'location',
            roomNumber: 'A101',
            floor: null,
            capacity: 4,
            status: 0,
            version: 1,
          },
        ],
      };
    }
    return { items: [], totalCount: 0 };
  });
  mount('rooms');
  await chooseLocation();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm phòng' }));
  fireEvent.mouseDown(screen.getByLabelText('Gợi ý tạo phòng'));
  fireEvent.click(await screen.findByRole('option', { name: 'Studio · v3' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByLabelText('Sức chứa')).toBeDisabled();
  expect(dialog.queryByLabelText('Trạng thái')).toBeNull();
  fireEvent.change(dialog.getByLabelText(/Số phòng/), { target: { value: 'A101' } });
  const rent = dialog.getByLabelText(/Giá thuê xác nhận/);
  expect(rent).toHaveValue('3.500.000');
  fireEvent.change(rent, { target: { value: '3600000' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Lưu cấu hình' }));
  fireEvent.click(await dialog.findByRole('button', { name: 'Tải lại gợi ý' }));
  const reload = await dialog.findByRole('button', { name: 'Nạp phiên bản mới' });
  expect(dialog.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled();
  expect(rent).toHaveValue('3.600.000');
  expect(dialog.getByLabelText(/Số phòng/)).toHaveValue('A101');
  fireEvent.click(reload);
  expect(dialog.getByLabelText('Sức chứa')).toHaveValue('4');
  expect(rent).toHaveValue('4.200.000');
  fireEvent.click(dialog.getByRole('button', { name: 'Lưu cấu hình' }));
  await screen.findByText('Máy chủ đã lưu cấu hình.');
  const writes = state.request.mock.calls.filter(
    ([path, init]) => path.endsWith('/configured-rooms') && init?.method === 'POST',
  );
  expect(writes.map(([, init]) => JSON.parse(init.body).rooms[0])).toEqual([
    expect.objectContaining({ expectedVersion: 3, rent: '3600000', roomNumber: 'A101' }),
    expect.objectContaining({ expectedVersion: 4, rent: '4200000', roomNumber: 'A101' }),
  ]);
});
it('reads physical Asset fields through the scoped native list and pagination', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.includes('/targets/common-areas?')) return ['Hall'];
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/rooms')) return [];
    if (path.endsWith('/common-asset-requirements')) return null;
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
  const commonGroup = screen.getByRole('button', { name: 'Tài sản khu vực chung' });
  expect(commonGroup).toHaveAttribute('aria-expanded', 'false');
  expect(state.request.mock.calls.some(([path]) => path.startsWith('/api/v1/assets?'))).toBe(false);
  fireEvent.click(commonGroup);
  await screen.findByText('Synthetic chair');
  expect(screen.queryByText(/CHAIR-01/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thao tác tài sản Synthetic chair' })).toBeVisible();
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/assets?locationId=location&page=1&pageSize=20&commonAreaOnly=true',
    expect.anything(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tới trang tiếp theo' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/assets?locationId=location&page=2&pageSize=20&commonAreaOnly=true',
      expect.anything(),
    ),
  );
});

it('groups Owner asset edit and retirement actions in an accessible overflow menu', async () => {
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/capture/locations'
      ? [{ id: 'location', label: 'Synthetic Location' }]
      : path.startsWith('/api/v1/operational-tasks/targets/common-areas?')
        ? ['Hall']
        : path.endsWith('/common-asset-requirements')
          ? null
          : path.endsWith('/rooms')
            ? []
            : {
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
                totalCount: 1,
              },
  );
  mount('assets');
  await chooseLocation();
  fireEvent.click(screen.getByRole('button', { name: 'Tài sản khu vực chung' }));
  await screen.findByText('Synthetic chair');
  fireEvent.click(screen.getByRole('button', { name: 'Thao tác tài sản Synthetic chair' }));
  expect(await screen.findByRole('menuitem', { name: 'Chỉnh sửa' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Ngừng sử dụng' })).toBeVisible();
});

it('offers persisted common areas and saves a new area with the first physical asset', async () => {
  let submitted: Record<string, unknown> | null = null;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/rooms')) return [];
    if (path.startsWith('/api/v1/operational-tasks/targets/common-areas?'))
      return ['Hall', 'Laundry'];
    if (path === '/api/v1/assets' && init?.method === 'POST') {
      submitted = JSON.parse(String(init.body));
      return {
        id: 'new-asset',
        locationId: 'location',
        roomId: null,
        commonArea: 'Rooftop',
        code: null,
        name: 'Synthetic chair',
        category: 'Khác',
        condition: 'Good',
        status: 0,
        version: 1,
      };
    }
    if (path.startsWith('/api/v1/assets?')) return { items: [], totalCount: 0 };
    throw new Error(`Unexpected request: ${path}`);
  });

  mount('assets');
  await chooseLocation();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm tài sản' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Tên tài sản/), { target: { value: 'Synthetic chair' } });
  fireEvent.change(dialog.getByLabelText(/Tình trạng/), { target: { value: 'Good' } });
  expect(dialog.queryByLabelText('Cách quản lý')).toBeNull();
  fireEvent.change(dialog.getByLabelText(/Số lượng/), { target: { value: '4' } });
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: 'Khu vực chung' }));
  expect(await screen.findByRole('option', { name: 'Hall' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /Tạo khu vực mới/ }));
  expect(dialog.getByLabelText(/Tên khu vực mới/)).toBeVisible();
  fireEvent.change(dialog.getByLabelText(/Tên khu vực mới/), { target: { value: 'Rooftop' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Lưu cấu hình' }));
  await screen.findByText('Máy chủ đã lưu cấu hình.');

  expect(submitted).toMatchObject({
    locationId: 'location',
    roomId: null,
    commonArea: 'Rooftop',
    name: 'Synthetic chair',
    initialUnit: 'Cái',
    initialTrackingMode: 'BulkQuantity',
    initialQuantity: 4,
  });
});

it('requests server-side physical asset filtering for rooms and shared areas', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/rooms'))
      return [{ id: 'room-a', label: 'A101' }, { id: 'room-b', label: 'A102' }];
    if (path.endsWith('/common-asset-requirements')) return null;
    if (path.includes('/common-areas?')) return [];
    return { items: [], totalCount: 0 };
  });
  mount('assets');
  await chooseLocation();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Vị trí tài sản' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Tất cả tài sản trong phòng' }));
  const room = await screen.findByRole('button', { name: 'A101' });
  expect(room).toHaveAttribute('aria-expanded', 'false');
  fireEvent.change(screen.getByLabelText('Tìm kiếm'), { target: { value: 'Ghế' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Đang sử dụng' }));
  fireEvent.click(room);
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/assets?locationId=location&page=1&pageSize=20&search=Gh%E1%BA%BF&assetStatus=0&roomId=room-a',
      expect.anything(),
    ),
  );
  expect(screen.getByRole('button', { name: 'A102' })).toHaveAttribute('aria-expanded', 'false');
  expect(state.request.mock.calls.some(([path]) => path.includes('roomId=room-b'))).toBe(false);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Vị trí tài sản' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Tài sản chung cơ sở' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tài sản khu vực chung' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/assets?locationId=location&page=1&pageSize=20&search=Gh%E1%BA%BF&assetStatus=0&commonAreaOnly=true',
      expect.anything(),
    ),
  );
});

it('includes rooms past the room options limit without preloading their assets', async () => {
  const firstRooms = Array.from({ length: 100 }, (_, index) => ({
    id: `room-${index}`,
    label: `Phòng ${index}`,
  }));
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/rooms')) return firstRooms;
    if (path.endsWith('/common-asset-requirements')) return null;
    if (path.includes('/common-areas?')) return [];
    if (path.startsWith('/api/v1/rooms?')) {
      const items = path.includes('page=1&')
        ? firstRooms.map(({ id, label }) => ({ id, roomNumber: label }))
        : [{ id: 'room-100', roomNumber: 'Phòng 100' }];
      return { items, totalCount: 101 };
    }
    return { items: [], totalCount: 0 };
  });
  mount('assets');
  await chooseLocation();
  const lastRoom = await screen.findByRole('button', { name: 'Phòng 100' });
  expect(state.request.mock.calls.some(([path]) => path.startsWith('/api/v1/assets?'))).toBe(false);
  fireEvent.click(lastRoom);
  await screen.findByText('Vị trí này chưa có tài sản thực tế.');
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/assets?locationId=location&page=1&pageSize=20&roomId=room-100',
    expect.anything(),
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

function ScopedRoomRoute() {
  const { search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route-query">{search}</output>
      <button onClick={() => navigate('/locations/location/rooms?roomStatus=2')}>
        Điều hướng trạng thái
      </button>
      <button onClick={() => navigate('/locations/other/rooms?roomStatus=2')}>
        Điều hướng cơ sở
      </button>
      <button onClick={() => navigate('/locations/location/rooms?action=create&roomStatus=0')}>
        Điều hướng tạo phòng
      </button>
      <button onClick={() => navigate(-1)}>Quay lại lịch sử</button>
      <PropertyApiPage kind="rooms" />
    </>
  );
}

function mountScopedRoom(search: string, totalCount = 0, fromOverview = false) {
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/capture/locations'
      ? [{ id: 'location', label: 'Synthetic Location' }]
      : path.endsWith('/room-defaults') || path.endsWith('/room-provenance')
        ? []
        : { items: [], totalCount },
  );
  return render(
    <ThemeProvider theme={theme}>
      <PortalProvider>
        <MemoryRouter
          initialEntries={[
            ...(fromOverview ? ['/locations/location/overview'] : []),
            `/locations/location/rooms${search}`,
          ]}
        >
          <Routes>
            <Route path="/locations/:locationId/rooms" element={<ScopedRoomRoute />} />
            <Route path="/locations/:locationId/overview" element={<div>Tổng quan cơ sở</div>} />
          </Routes>
        </MemoryRouter>
      </PortalProvider>
    </ThemeProvider>,
  );
}

it('opens a filtered room list from the overview and clears the URL filter with the control', async () => {
  mountScopedRoom('?roomStatus=0');
  expect(screen.getByRole('heading', { name: 'Quản lý phòng', level: 2 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thêm phòng' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo phòng hàng loạt' })).toBeInTheDocument();
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/rooms?locationId=location&page=1&pageSize=20&roomStatus=0',
      expect.anything(),
    ),
  );
  expect(screen.getByLabelText('Trạng thái')).toHaveTextContent('Trống khai thác');
  fireEvent.mouseDown(screen.getByLabelText('Trạng thái'));
  fireEvent.click(await screen.findByRole('option', { name: 'Tất cả trạng thái' }));
  await waitFor(() => expect(screen.getByTestId('route-query')).toHaveTextContent(/^$/));
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/rooms?locationId=location&page=1&pageSize=20',
    expect.anything(),
  );
});

it('opens the room creation form once from the overview without writing data', async () => {
  mountScopedRoom('?action=create');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText(/Số phòng/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('route-query')).toHaveTextContent(/^$/));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('does not allow a Staff deep link to open the Owner creation form', async () => {
  state.roles = ['Staff'];
  mountScopedRoom('?action=create&roomStatus=99');
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/rooms?locationId=location&page=1&pageSize=20',
      expect.anything(),
    ),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thêm phòng' })).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByTestId('route-query')).toHaveTextContent('?roomStatus=99'),
  );
});

it('resets pagination on URL status and location changes, including back navigation', async () => {
  mountScopedRoom('?roomStatus=0', 42);
  async function nextPage() {
    fireEvent.click(await screen.findByRole('button', { name: 'Tới trang tiếp theo' }));
    await screen.findByText('21–40 / 42 bản ghi');
  }
  await nextPage();
  state.request.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Điều hướng trạng thái' }));
  await screen.findByText('1–20 / 42 bản ghi');
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/rooms?locationId=location&page=1&pageSize=20&roomStatus=2',
    expect.anything(),
  );
  expect(state.request.mock.calls.some(([path]) => path.includes('page=2'))).toBe(false);
  await nextPage();
  state.request.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Điều hướng cơ sở' }));
  await screen.findByText('1–20 / 42 bản ghi');
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/rooms?locationId=other&page=1&pageSize=20&roomStatus=2',
    expect.anything(),
  );
  expect(state.request.mock.calls.some(([path]) => path.includes('page=2'))).toBe(false);
  await nextPage();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại lịch sử' }));
  await screen.findByText('1–20 / 42 bản ghi');
  expect(screen.getByLabelText('Trạng thái')).toHaveTextContent('Đang có khách thuê');
});

it('consumes a fresh create intent while mounted, preserves filters and replaces the history entry', async () => {
  mountScopedRoom('?roomStatus=0', 0, true);
  fireEvent.click(screen.getByRole('button', { name: 'Điều hướng tạo phòng' }));
  let dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(screen.getByTestId('route-query')).toHaveTextContent('?roomStatus=0'));
  fireEvent.change(within(dialog).getByLabelText(/Số phòng/), { target: { value: 'A101' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Điều hướng tạo phòng' }));
  dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText(/Số phòng/)).toHaveValue('');
  await waitFor(() => expect(screen.getByTestId('route-query')).toHaveTextContent('?roomStatus=0'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại lịch sử' }));
  expect(screen.getByTestId('route-query')).toHaveTextContent('?roomStatus=0');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại lịch sử' }));
  expect(screen.getByTestId('route-query')).toHaveTextContent('?roomStatus=0');
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại lịch sử' }));
  expect(await screen.findByText('Tổng quan cơ sở')).toBeInTheDocument();
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
