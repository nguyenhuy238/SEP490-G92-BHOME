import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import {
  sharedConfigurationClient,
  type SharedDocument,
} from '../../../../../packages/client-core/src/sharedConfiguration';
import type { LocationSetupInput } from '../../../../../packages/client-core/src/locationSetup';
import { createSeed } from '../../services/mock/seed';
import type { DemoDatabase } from '../../types/portal';
import { theme } from '../../theme/theme';
import { LocationsListPage } from './pages/LocationsListPage';
import { RoomTypesApiPage } from '../room-types/pages/RoomTypesApiPage';
import { LocationSetupWizard } from './setup/LocationSetupWizard';

type SetupRequest = (path: string, init?: RequestInit) => Promise<unknown>;
type SetupRequestCall = Parameters<SetupRequest>;

const state = vi.hoisted(() => ({
  request: vi.fn<SetupRequest>(),
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

const documentId = '4938fdbe-58b8-4c01-af87-fc8f900b8056';
const template: SharedDocument = {
  id: documentId,
  resource: 'room-type-templates',
  familyId: documentId,
  edition: 1,
  version: 7,
  name: 'Synthetic published template',
  description: 'Reference only',
  status: 'Published',
  managementScope: 'BHOME',
  createdBy: 'owner',
  createdAt: '2026-11-09T01:00:00Z',
  updatedBy: 'owner',
  updatedAt: '2026-11-09T02:00:00Z',
  data: { capacity: 2, area: 25, amenities: ['Window'], referenceRent: 3000000 },
};
const localDocument = {
  id: 'local-defaults',
  locationId: 'native-location',
  kind: 'RoomDefaults',
  status: 'Recorded',
  version: 1,
  createdAt: '2026-11-09T01:00:00Z',
  updatedAt: '2026-11-09T02:00:00Z',
  data: {
    name: 'Synthetic applied defaults',
    description: '',
    defaults: {
      capacity: 3,
      area: 20,
      amenities: ['Synthetic amenity'],
      referenceRent: 1234567,
    },
  },
};
const response = {
  location: {
    id: 'native-location',
    name: 'Synthetic native setup',
    address: 'Synthetic address',
    isActive: true,
    version: 1,
  },
  createdReferences: ['native-location', 'local-defaults', 'native-room'],
};
const draftKey = 'bhome-location-setup-v2:synthetic-user';
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function mount(element: React.ReactNode, route = '/locations') {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
function defaultsPage() {
  return mount(
    <Routes>
      <Route path="/locations/:locationId/room-types" element={<RoomTypesApiPage />} />
    </Routes>,
    '/locations/native-location/room-types',
  );
}
function mockReads(path: string) {
  if (path.startsWith('/api/v1/shared-configuration/room-type-templates?'))
    return {
      items: [
        template,
        {
          ...template,
          id: 'draft-template',
          name: 'Synthetic unpublished template',
          status: 'Draft',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    };
  if (path.startsWith('/api/v1/shared-configuration/'))
    return { items: [], total: 0, page: 1, pageSize: 100 };
  if (path.endsWith('/setup-metadata')) return null;
  if (path === '/api/v1/locations/native-location/room-defaults') return [localDocument];
  if (path.startsWith('/api/v1/locations?') || path.startsWith('/api/v1/rooms?'))
    return { items: [], totalCount: 0, page: 1, pageSize: 20 };
  throw new Error('Unexpected read: ' + path);
}
function button(name: string | RegExp, scope = screen) {
  return scope.getByRole('button', { name });
}
function fill(label: string | RegExp, value: string, scope = screen) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
}
function next() {
  fireEvent.click(button(/^Tiếp tục \(/));
}
function enterInfo() {
  fill(/Tên cơ sở/, 'Synthetic native setup');
  fill(/Mã cơ sở/, 'SYN-01');
  fill(/Địa chỉ/, 'Synthetic address');
  fill(/Số tầng/, '2');
  next();
}
async function manualType() {
  fireEvent.click(button('Thêm loại phòng'));
  const d = within(screen.getByRole('dialog', { name: 'Thêm loại phòng riêng' }));
  fireEvent.change(d.getByLabelText(/Tên loại phòng/), {
    target: { value: 'Synthetic local type' },
  });
  fireEvent.change(d.getByLabelText(/Sức chứa mặc định/), { target: { value: '3' } });
  fireEvent.change(d.getByLabelText(/Diện tích/), { target: { value: '20' } });
  fireEvent.change(d.getByLabelText(/Giá thuê mặc định/), { target: { value: '1234567' } });
  fireEvent.click(d.getByRole('button', { name: 'Lưu loại phòng' }));
  await screen.findByText('Synthetic local type');
  await screen.findByRole('button', { name: /^Tiếp tục \(/ });
}
function generate(count = '1') {
  fill('Số lượng phòng', count);
  fireEvent.click(button('Sinh phòng xem trước'));
  expect(screen.getByText('Danh sách phòng nháp (' + count + ')')).toBeInTheDocument();
  next();
}
function finishSteps() {
  next();
  next();
  next();
  expect(screen.getByText('7. Xem lại và hoàn tất')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ }));
}
const writes = () => state.request.mock.calls.filter(([, init]) => init?.method === 'POST');
const payload = ([, init]: SetupRequestCall): LocationSetupInput => {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON setup request body');
  return JSON.parse(init.body) as LocationSetupInput;
};
const key = ([, init]: SetupRequestCall) => new Headers(init?.headers).get('Idempotency-Key');
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  state.db = createSeed();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method === 'POST' && path === '/api/v1/location-setup' ? response : mockReads(path),
  );
});
afterEach(cleanup);

it('reads versioned local RoomDefaults from the location-scoped endpoint', async () => {
  defaultsPage();
  expect((await screen.findAllByText('Synthetic applied defaults')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/3 người/).length).toBeGreaterThan(0);
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/locations/native-location/room-defaults',
    expect.anything(),
  );
  expect(state.request.mock.calls.some(([path]) => path.startsWith('/api/v1/room-types'))).toBe(
    false,
  );
});

it('keeps Owner configuration unavailable to Staff without querying it', () => {
  state.roles = ['Staff'];
  defaultsPage();
  expect(screen.getByText('Owner quản lý cấu hình gợi ý tạo phòng.')).toBeInTheDocument();
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('creates local defaults and rooms using a single atomic setup write from the real wizard', async () => {
  mount(
    <Routes>
      <Route path="/locations" element={<LocationsListPage />} />
      <Route path="/locations/:id/overview" element={<h1>Cơ sở được lưu</h1>} />
    </Routes>,
  );
  fireEvent.click(button('Thêm cơ sở'));
  next();
  expect(screen.getByText(/Nhập tên,.*địa chỉ.*số tầng hợp lệ/)).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
  enterInfo();
  await manualType();
  next();
  generate();
  finishSteps();
  expect(writes()).toHaveLength(0);
  fireEvent.click(button('Xác nhận hoàn tất thiết lập'));
  expect(await screen.findByRole('heading', { name: 'Cơ sở được lưu' })).toBeInTheDocument();
  expect(writes()).toHaveLength(1);
  const call = writes()[0];
  expect(call[0]).toBe('/api/v1/location-setup');
  const data = payload(call);
  expect(data.location).toMatchObject({
    name: 'Synthetic native setup',
    code: 'SYN-01',
    address: 'Synthetic address',
    floors: 2,
  });
  expect(data.roomTypes[0]).toMatchObject({
    name: 'Synthetic local type',
    capacity: 3,
    area: 20,
    referenceRent: 1234567,
    sourceId: null,
  });
  expect(data.rooms[0]).toMatchObject({
    roomNumber: 'P.101',
    floor: '1',
    roomTypeKey: data.roomTypes[0].key,
    rent: 1234567,
  });
  expect(data.rentEffectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(data.rooms[0]).not.toHaveProperty('roomTypeId');
  expect(key(call)).toMatch(/^[a-f0-9-]{36}$/);
  await waitFor(() => expect(sessionStorage.getItem(draftKey)).toBeNull());
}, 20000);

it('loads only Published templates, saves provenance, and retries an uncertain response with the same key', async () => {
  let attempts = 0;
  const completed = vi.fn();
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/location-setup' && init?.method === 'POST') {
      if (++attempts === 1) throw new Error('Synthetic connection failure');
      return response;
    }
    return mockReads(path);
  });
  mount(
    <LocationSetupWizard
      locations={state.db!.records.locations}
      onClose={vi.fn()}
      onComplete={completed}
    />,
  );
  enterInfo();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Synthetic published template' }));
  expect(
    screen.queryByRole('button', { name: 'Thêm Synthetic unpublished template' }),
  ).not.toBeInTheDocument();
  next();
  generate('2');
  finishSteps();
  fireEvent.click(button('Xác nhận hoàn tất thiết lập'));
  expect(await screen.findByText('Synthetic connection failure')).toBeInTheDocument();
  expect(completed).not.toHaveBeenCalled();
  expect(writes()).toHaveLength(1);
  expect(sessionStorage.getItem(draftKey)).not.toBeNull();
  expect(payload(writes()[0]).roomTypes[0]).toMatchObject({
    sourceKind: 'SharedTemplate',
    sourceId: documentId,
    sourceVersion: 7,
    capacity: 2,
    referenceRent: 3000000,
  });
  fireEvent.click(button('Xác nhận hoàn tất thiết lập'));
  await waitFor(() => expect(completed).toHaveBeenCalledWith(response));
  expect(writes()).toHaveLength(2);
  expect(key(writes()[0])).toBe(key(writes()[1]));
  expect(payload(writes()[0])).toEqual(payload(writes()[1]));
}, 20000);
