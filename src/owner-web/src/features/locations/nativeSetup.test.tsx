import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import {
  sharedConfigurationClient,
  type SharedDocument,
  type SharedResource,
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
vi.mock('../../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
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
  expect(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ })).toBeInTheDocument();
  expect(screen.queryByText('7. Xem lại và hoàn tất')).not.toBeInTheDocument();
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
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  sessionStorage.clear();
  state.db = createSeed();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method === 'POST' && path === '/api/v1/location-setup' ? response : mockReads(path),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('refreshes newly published templates without losing the current setup draft', async () => {
  let published = false;
  state.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/shared-configuration/room-type-templates?')) {
      const item = {
        ...template,
        name: 'New room template',
        status: published ? 'Published' : 'Draft',
      };
      return { items: [item], total: 1, page: 1, pageSize: 100 };
    }
    return mockReads(path);
  });
  mount(<LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={vi.fn()} />);
  enterInfo();
  expect(await screen.findByText('New room template · Bản nháp, cần công bố')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thêm New room template' })).not.toBeInTheDocument();
  published = true;
  fireEvent.click(button('Làm mới mẫu'));
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm New room template' }));
  expect(screen.getByText('Cấu hình riêng (1)')).toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem(draftKey)!).location.name).toBe(
    'Synthetic native setup',
  );
});

it('resumes the draft, reads the four selectable libraries and loads the whole asset catalog once', async () => {
  let published = false;
  const catalog = {
    ...template,
    id: 'new-catalog',
    resource: 'asset-catalog' as const,
    name: 'Bàn học',
    data: { category: 'Nội thất', unit: 'cái', referencePrice: 500000 },
  };
  const docs: SharedDocument[] = [
    { ...template, name: 'Phòng mới' },
    catalog,
    {
      ...catalog,
      id: 'second-catalog',
      name: 'Giường đôi',
    },
    {
      ...template,
      id: 'new-fee',
      resource: 'fee-templates',
      name: 'Phí vệ sinh',
      data: {
        category: 'ServiceFee',
        chargeCode: 'CLEANING',
        method: 'FixedPerPersonPerMonth',
        referenceRate: '30000',
        unit: 'VND/person/month',
        scope: 'Location',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    },
    {
      ...template,
      id: 'new-policy',
      resource: 'policy-templates',
      name: 'Giờ yên tĩnh',
      data: { content: 'Giữ yên tĩnh sau 22 giờ.', effectiveFrom: '2026-01-01' },
    },
  ];
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/location-setup' && init?.method === 'POST') return response;
    if (path.startsWith('/api/v1/shared-configuration/')) {
      const resource = path.split('/').pop()?.split('?')[0] as SharedResource;
      const items = docs
        .filter((doc) => doc.resource === resource)
        .map((doc) => ({ ...doc, status: published ? 'Published' : 'Draft' }));
      return { items, total: items.length, page: 1, pageSize: 100 };
    }
    return mockReads(path);
  });
  const complete = vi.fn();
  const wizard = () => (
    <LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={complete} />
  );
  const first = mount(wizard());
  enterInfo();
  await screen.findByText('Phòng mới · Bản nháp, cần công bố');
  expect(writes()).toHaveLength(0);
  first.unmount();
  published = true;
  const resumed = mount(wizard());
  expect(screen.getByText('Synthetic native setup · Bản nháp')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Phòng mới' }));
  const pickerFilter = screen.getByRole('combobox', { name: 'Lọc mẫu loại phòng' });
  fireEvent.mouseDown(pickerFilter);
  fireEvent.click(screen.getByRole('option', { name: 'Chưa chọn' }));
  expect(screen.getByText('Không tìm thấy mẫu phù hợp với bộ lọc.')).toBeInTheDocument();
  fireEvent.mouseDown(pickerFilter);
  fireEvent.click(screen.getByRole('option', { name: 'Đã chọn' }));
  expect(screen.getByText('Đã chọn', { selector: '.MuiChip-label' })).toBeInTheDocument();
  next();
  generate('1');
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Bàn học' }));
  // A draft from before duplicate selections were idempotent contains an inflated quantity.
  resumed.unmount();
  const legacyDraft = JSON.parse(sessionStorage.getItem(draftKey)!);
  legacyDraft.roomTypes[0].assets[0].quantity = 4;
  sessionStorage.setItem(draftKey, JSON.stringify(legacyDraft));
  mount(wizard());
  await screen.findByText('Bàn học', { selector: '[role="listitem"] .MuiTypography-root' });
  expect(JSON.parse(sessionStorage.getItem(draftKey)!).roomTypes[0].assets[0].quantity).toBe(1);
  expect(screen.queryByRole('combobox', { name: 'Gói tài sản' })).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+ mẫu đã công bố/)).not.toBeInTheDocument();
  expect(
    screen.queryByText('Chọn tài sản dự kiến cho từng loại phòng.', { exact: false }),
  ).not.toBeInTheDocument();
  fill('Tìm danh mục tài sản', 'Bàn');
  await waitFor(() => expect(button('Nạp toàn bộ danh mục')).toBeEnabled());
  fireEvent.click(button('Nạp toàn bộ danh mục'));
  const selectedAssets = within(screen.getByRole('list', { name: 'Tài sản đã chọn' }));
  expect(selectedAssets.getByText('Bàn học')).toBeVisible();
  expect(selectedAssets.getByText('Giường đôi')).toBeVisible();
  expect(selectedAssets.getAllByRole('listitem')).toHaveLength(2);
  expect(button('Nạp toàn bộ danh mục')).toBeDisabled();
  expect(screen.queryByLabelText('Số lượng', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Theo dõi', { exact: true })).not.toBeInTheDocument();
  next();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Phí vệ sinh' }));
  const preview = within(
    screen.getByRole('region', { name: 'Mô phỏng chi phí hàng tháng của phòng' }),
  );
  expect(preview.getByText('3.030.000 đ')).toBeVisible();
  fireEvent.change(preview.getByLabelText('Số người ở giả định'), { target: { value: '2' } });
  expect(preview.getByText('3.060.000 đ')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa Phí vệ sinh' }));
  expect(screen.getByLabelText('Đơn giá (VND/người/tháng)')).toHaveValue('30.000');
  next();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Giờ yên tĩnh' }));
  expect(
    within(screen.getByRole('list', { name: 'Điều khoản nội quy' })).getByText(
      'Giữ yên tĩnh sau 22 giờ.',
    ),
  ).toBeVisible();
  expect(screen.queryByLabelText('Nội dung điều khoản')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa Giờ yên tĩnh' }));
  expect(screen.getByLabelText('Nội dung điều khoản')).toHaveValue('Giữ yên tĩnh sau 22 giờ.');
  next();
  expect(screen.getByRole('table', { name: 'Giá thuê từng phòng' })).toBeInTheDocument();
  expect(screen.getByText('Giữ yên tĩnh sau 22 giờ.')).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
  expect(button('Xác nhận hoàn tất thiết lập')).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ }));
  fireEvent.click(button('Xác nhận hoàn tất thiết lập'));
  await waitFor(() => expect(complete).toHaveBeenCalledWith(response));
  expect(writes()).toHaveLength(1);
  expect(payload(writes()[0]).sourceReferences).toEqual(
    expect.arrayContaining(
      docs.map((doc) => ({ id: doc.id, kind: doc.resource, version: doc.version })),
    ),
  );
  expect(payload(writes()[0]).fees[0]).toMatchObject({ method: 2, rate: '30000' });
  expect(payload(writes()[0]).roomTypes[0].assets).toEqual([
    expect.objectContaining({ name: 'Bàn học', quantity: 1, trackingMode: 'BulkQuantity' }),
    expect.objectContaining({ name: 'Giường đôi', quantity: 1, trackingMode: 'BulkQuantity' }),
  ]);
}, 30000);

it('uses compact step navigation on mobile and preserves validation when jumping ahead', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  try {
    mount(<LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={vi.fn()} />);
    const progress = screen.getByRole('navigation', { name: 'Tiến độ thiết lập cơ sở' });
    expect(within(progress).getByText('Bước 1/7')).toBeInTheDocument();
    expect(within(progress).queryByRole('button', { name: 'Loại phòng' })).not.toBeInTheDocument();
    fireEvent.mouseDown(within(progress).getByRole('combobox', { name: 'Đi đến bước' }));
    fireEvent.click(screen.getByRole('option', { name: '7. Xem lại & hoàn tất' }));
    expect(screen.getByText(/Nhập tên,.*địa chỉ.*số tầng hợp lệ/)).toBeInTheDocument();
    enterInfo();
    expect(within(progress).getByText('Bước 2/7')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

it('does not read or create setup data for Staff even when the wizard is mounted directly', () => {
  state.roles = ['Staff'];
  mount(<LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={vi.fn()} />);
  expect(screen.getByText('Chỉ Owner được thiết lập cơ sở mới.')).toBeInTheDocument();
  expect(state.request).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(draftKey)).toBeNull();
});

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
    if (path.startsWith('/api/v1/shared-configuration/fee-templates?')) {
      return {
        items: [
          {
            ...template,
            id: 'synthetic-person-fee',
            resource: 'fee-templates',
            name: 'Synthetic person service',
            data: {
              category: 'ServiceFee',
              chargeCode: 'CLEANING',
              method: 'FixedPerPersonPerMonth',
              unit: 'VND/person/month',
              scope: 'Location',
              referenceRate: '30000.1234',
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      };
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
  next();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Synthetic person service' }));
  next();
  next();
  expect(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ }));
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
  expect(payload(writes()[0]).fees).toEqual([
    expect.objectContaining({ category: 3, method: 2, chargeCode: 'CLEANING', rate: '30000.1234' }),
  ]);
  fireEvent.click(button('Xác nhận hoàn tất thiết lập'));
  await waitFor(() => expect(completed).toHaveBeenCalledWith(response));
  expect(writes()).toHaveLength(2);
  expect(key(writes()[0])).toBe(key(writes()[1]));
  expect(payload(writes()[0])).toEqual(payload(writes()[1]));
}, 20000);
