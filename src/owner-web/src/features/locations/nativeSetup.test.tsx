import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { sharedConfigurationClient } from '../../../../../packages/client-core/src/sharedConfiguration';
import { createSeed } from '../../services/mock/seed';
import type { DemoDatabase } from '../../types/portal';
import { theme } from '../../theme/theme';
import { LocationsListPage } from './pages/LocationsListPage';
import type { InitialLocationSetupResult } from './components/InitialLocationSetupWizard';
import { RoomTypesApiPage } from '../room-types/pages/RoomTypesApiPage';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  db: null as DemoDatabase | null,
  roles: ['Owner'],
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'synthetic-user', roles: state.roles } }),
}));
vi.mock('../configuration/useSharedConfigurationApi', () => ({
  useSharedConfigurationApi: () =>
    sharedConfigurationClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../../services/config', () => ({ isMockMode: false }));
vi.mock('../../app/PortalProvider', () => ({
  usePortal: () => ({ notify: vi.fn(), locationId: 'all' }),
}));
vi.mock('../../hooks/usePortalData', () => ({
  usePortalData: () => ({ data: state.db, isPending: false, isError: false }),
  usePortalAction: () => ({ mutate: vi.fn() }),
}));
vi.mock('../property-api/propertyApi', () => ({
  usePropertyApi: () => ({}),
  propertyError: String,
}));
vi.mock('../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('./components/CopyConfigurationWizard', () => ({ CopyConfigurationWizard: () => null }));
vi.mock('./components/InitialLocationSetupWizard', () => ({
  InitialLocationSetupWizard: ({
    open,
    onComplete,
  }: {
    open: boolean;
    onComplete: (...args: unknown[]) => Promise<unknown>;
  }) =>
    open ? (
      <button
        onClick={() =>
          void onComplete(
            {
              ...state.db!.records.locations[0],
              name: 'Synthetic native setup',
              attributes: { address: 'Synthetic address' },
            },
            {
              roomTypes: [
                {
                  id: 'local-draft',
                  name: 'Synthetic template',
                  code: 'SYN',
                  area: 20,
                  maxOccupants: 3,
                  defaultRate: 1234567,
                  description: '',
                  facilities: [],
                  status: 'ACTIVE',
                },
              ],
              rooms: [{ code: 'SYN-1', floor: 1, roomTypeId: 'local-draft', status: 'AVAILABLE' }],
              rateOverrides: {},
              roomTypeTemplates: {},
              assetCatalog: [],
              roomAssetAssignments: [],
              feePolicies: [],
              houseRules: [],
            } satisfies InitialLocationSetupResult,
          )
        }
      >
        Xác nhận thiết lập tổng hợp
      </button>
    ) : null,
}));

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  state.db = createSeed();
  state.roles = ['Owner'];
});

function defaultsPage() {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/locations/native-location/room-types']}>
          <Routes>
            <Route path="/locations/:locationId/room-types" element={<RoomTypesApiPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

it('reads the Location Room Types from the native API', async () => {
  state.request.mockResolvedValue({
    items: [
      {
        id: 'defaults',
        locationId: 'native-location',
        name: 'Synthetic applied defaults',
        description: null,
        defaultCapacity: 3,
        areaM2: 20,
        amenities: ['Synthetic amenity'],
        isActive: true,
        version: 1,
      },
    ],
    totalCount: 1,
  });
  defaultsPage();
  expect((await screen.findAllByText('Synthetic applied defaults')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/3 người/).length).toBeGreaterThan(0);
  expect(state.request.mock.calls[0][0]).toContain('/api/v1/room-types?');
});

it('keeps Owner configuration unavailable to Staff without querying it', () => {
  state.roles = ['Staff'];
  defaultsPage();
  expect(screen.getByText('Owner quản lý cấu hình gợi ý tạo phòng.')).toBeInTheDocument();
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('persists wizard capacity and rent through native Room APIs without retired catalogs or bulk RoomType writes', async () => {
  const rooms: unknown[] = [];
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path.startsWith('/api/v1/locations?')) return { items: [] };
    if (path === '/api/v1/locations' && init?.method === 'POST')
      return { id: 'native-location', ...body };
    if (path.startsWith('/api/v1/shared-configuration/room-type-templates?')) return { items: [] };
    if (path === '/api/v1/shared-configuration/room-type-templates' && init?.method === 'POST')
      return { id: 'shared-template' };
    if (path.startsWith('/api/v1/rooms?'))
      return { items: rooms, totalCount: rooms.length, pageSize: 20 };
    if (path === '/api/v1/rooms' && init?.method === 'POST') {
      const room = { id: 'native-room', ...body };
      rooms.push(room);
      return room;
    }
    if (path.startsWith('/api/v1/billing-policies?')) return { items: [] };
    if (path === '/api/v1/billing-policies' && init?.method === 'POST')
      return { id: 'rent-policy', ...body };
    if (
      path.startsWith('/api/v1/operating-policies?') ||
      path.startsWith('/api/v1/asset-templates?')
    )
      return [];
    throw new Error('Unexpected setup request: ' + path);
  });
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/locations']}>
          <Routes>
            <Route path="/locations" element={<LocationsListPage />} />
            <Route path="/locations/:id/overview" element={<h1>Cơ sở được lưu</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thêm cơ sở' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thiết lập tổng hợp' }));
  expect(await screen.findByRole('heading', { name: 'Cơ sở được lưu' })).toBeInTheDocument();
  await waitFor(() => expect(rooms).toHaveLength(1));
  expect(rooms[0]).toMatchObject({
    locationId: 'native-location',
    capacity: 3,
    roomNumber: 'SYN-1',
    status: 0,
  });
  expect(rooms[0]).not.toHaveProperty('roomTypeId');
  const writes = state.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  const rent = writes.find(([path]) => path === '/api/v1/billing-policies');
  expect(JSON.parse(rent![1].body)).toMatchObject({
    locationId: 'native-location',
    roomId: 'native-room',
    rate: 1234567,
    chargeCode: 'RENT',
  });
  expect(JSON.parse(rent![1].body)).not.toHaveProperty('roomTypeId');
  expect(
    state.request.mock.calls.some(
      ([path]) => path.startsWith('/api/v1/room-types') || path.includes('/rooms/bulk-create'),
    ),
  ).toBe(false);
  expect(sessionStorage.getItem('bhome-owner-location-setup-target-v1')).toBeNull();
});
