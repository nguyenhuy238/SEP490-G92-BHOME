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
  type SharedWrite,
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
function fill(
  label: string | RegExp,
  value: string,
  scope: Pick<typeof screen, 'getByLabelText'> = screen,
) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } });
}
function next() {
  fireEvent.click(button(/^Tiếp tục \(/));
}
function enterInfo() {
  fill(/Tên cơ sở/, 'Synthetic native setup');
  expect(screen.getByRole('textbox', { name: /Mã cơ sở \(tự động\)/ })).toHaveValue('SNS');
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
async function generate(count = '1') {
  fill('Số lượng phòng', count);
  fireEvent.click(button('Sinh phòng xem trước'));
  await waitFor(() =>
    expect(screen.getByText('Danh sách phòng nháp (' + count + ')')).toBeInTheDocument(),
  );
  next();
}
function finishSteps() {
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

it('atomically creates usable templates, retries a failed save and keeps the setup draft', async () => {
  const documents: SharedDocument[] = [];
  let failAssetSave = true;
  const prefix = '/api/v1/shared-configuration/';
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (!path.startsWith(prefix)) return mockReads(path);
    const [resource, id, action] = path.slice(prefix.length).split('?')[0].split('/');
    const current = documents.find((doc) => doc.id === id);
    if (action === 'publish') throw new Error('Unexpected separate publish request');
    if (init?.method === 'POST' || init?.method === 'PUT') {
      const input = JSON.parse(String(init.body)) as SharedWrite;
      expect(input.publishImmediately).toBe(true);
      if (resource === 'asset-catalog' && failAssetSave) {
        failAssetSave = false;
        throw new Error('Synthetic save failure');
      }
      const doc: SharedDocument = {
        ...template,
        ...input,
        resource: resource as SharedResource,
        id: current?.id ?? resource + '-created',
        familyId: current?.familyId ?? resource + '-family',
        version: (current?.version ?? 0) + 1,
        status: 'Published',
      };
      expect(input.expectedVersion).toBe(current?.version ?? 0);
      if (current) documents.splice(documents.indexOf(current), 1, doc);
      else documents.push(doc);
      return { ...doc };
    }
    if (current) return { ...current };
    const items = documents.filter((doc) => doc.resource === resource).map((doc) => ({ ...doc }));
    return { items, total: items.length, page: 1, pageSize: 100 };
  });
  mount(<LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={vi.fn()} />);
  enterInfo();
  const open = async (action: string, title: string) => {
    const trigger = await screen.findByRole('button', { name: action });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    return within(await screen.findByRole('dialog', { name: title }));
  };
  const publish = (dialog: ReturnType<typeof within>) =>
    fireEvent.click(dialog.getByRole('button', { name: 'Lưu mẫu' }));
  const room = await open('Thêm loại phòng mẫu', 'Tạo loại phòng mẫu');
  expect(screen.queryByRole('button', { name: 'Làm mới mẫu' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Mở thư viện mẫu' })).not.toBeInTheDocument();
  fill(/Tên mẫu/, 'New room template', room);
  fill(/Sức chứa/, '2', room);
  fill(/Diện tích/, '25', room);
  fill(/Giá thuê tham khảo/, '3000000', room);
  publish(room);
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm New room template' }));
  expect(screen.getByText('Cấu hình riêng (1)')).toBeInTheDocument();
  next();
  const asset = await open('Thêm loại tài sản mới', 'Tạo loại tài sản');
  fill(/Tên mẫu/, 'New desk', asset);
  fill(/Giá tham khảo/, '300000', asset);
  publish(asset);
  expect(await screen.findByText(/Chưa hoàn thành yêu cầu/)).toBeInTheDocument();
  expect(documents.filter((doc) => doc.resource === 'asset-catalog')).toHaveLength(0);
  publish(within(screen.getByRole('dialog', { name: 'Tạo loại tài sản' })));
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm New desk' }));
  expect(
    within(screen.getByRole('list', { name: 'Tài sản đã chọn' })).getByText('New desk'),
  ).toBeVisible();
  next();
  await generate();
  const fee = await open('Thêm mẫu biểu phí', 'Tạo mẫu giá & biểu phí');
  fill(/Tên mẫu/, 'New wifi', fee);
  fill(/Mã khoản thu/, 'WIFI', fee);
  fill(/Đơn giá tham khảo/, '30000', fee);
  const effectiveFrom = JSON.parse(sessionStorage.getItem(draftKey)!).rentEffectiveFrom;
  fill(/Hiệu lực từ/, effectiveFrom, fee);
  publish(fee);
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm New wifi' }));
  next();
  const rule = await open('Thêm mẫu nội quy', 'Tạo mẫu chính sách');
  fill(/Tên mẫu/, 'New rule', rule);
  fill(/Nội dung nội quy/, 'Giữ yên tĩnh.', rule);
  fill(/Hiệu lực từ/, effectiveFrom, rule);
  publish(rule);
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm New rule' }));
  expect(documents).toHaveLength(4);
  expect(documents.every((doc) => doc.status === 'Published')).toBe(true);
  expect(
    state.request.mock.calls.filter(
      ([path, init]) => path === prefix + 'asset-catalog' && init?.method === 'POST',
    ),
  ).toHaveLength(2);
  const draft = JSON.parse(sessionStorage.getItem(draftKey)!);
  expect(draft.location.name).toBe('Synthetic native setup');
  expect(draft.roomTypes[0].assets[0].name).toBe('New desk');
  expect(draft.fees[0].sourceId).toBe('fee-templates-created');
  expect(draft.rules[0].sourceId).toBe('policy-templates-created');
}, 60000);

it('resumes the draft, reads the four selectable libraries and loads the whole asset catalog once', async () => {
  let published = false;
  const catalog = {
    ...template,
    id: 'new-catalog',
    familyId: 'new-catalog-family',
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
      familyId: 'second-catalog-family',
      name: 'Giường đôi',
      data: { ...catalog.data, scope: 'Room' },
    },
    {
      ...catalog,
      id: 'common-catalog',
      familyId: 'common-catalog-family',
      name: 'Camera hành lang',
      data: { ...catalog.data, scope: 'Location', unit: 'Bộ' },
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
  await screen.findByText('Phòng mới · Bản nháp, chưa cho phép áp dụng');
  expect(writes()).toHaveLength(0);
  first.unmount();
  published = true;
  const resumed = mount(wizard());
  expect(screen.getByText('Synthetic native setup · Bản nháp')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Phòng mới' }));
  const pickerFilter = screen.getByRole('combobox', { name: 'Lọc loại phòng mẫu' });
  fireEvent.mouseDown(pickerFilter);
  fireEvent.click(screen.getByRole('option', { name: 'Chưa chọn' }));
  expect(screen.getByText('Không tìm thấy mẫu phù hợp với bộ lọc.')).toBeInTheDocument();
  fireEvent.mouseDown(pickerFilter);
  fireEvent.click(screen.getByRole('option', { name: 'Đã chọn' }));
  expect(screen.getByText('Đã chọn', { selector: '.MuiChip-label' })).toBeInTheDocument();
  next();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Bàn học' }));
  // A manually edited quantity must survive reopening and idempotent catalog selection.
  resumed.unmount();
  const legacyDraft = JSON.parse(sessionStorage.getItem(draftKey)!);
  legacyDraft.roomTypes[0].assets[0].quantity = 4;
  sessionStorage.setItem(draftKey, JSON.stringify(legacyDraft));
  // A new edition must be the only selectable library item, without replacing the draft snapshot.
  const nextCatalog = {
    ...catalog,
    id: 'next-catalog',
    edition: catalog.edition + 1,
    name: 'Bàn học mới',
  };
  docs.push(nextCatalog);
  mount(wizard());
  await screen.findByText('Bàn học', { selector: '[role="listitem"] .MuiTypography-root' });
  expect(JSON.parse(sessionStorage.getItem(draftKey)!).roomTypes[0].assets[0].quantity).toBe(4);
  expect(screen.queryByRole('button', { name: 'Thêm Bàn học mới' })).not.toBeInTheDocument();
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
  expect(selectedAssets.getAllByLabelText('Số lượng', { exact: true })).toHaveLength(2);
  expect(screen.queryByLabelText('Theo dõi', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thêm Camera hành lang' })).not.toBeInTheDocument();
  fireEvent.click(button('Tài sản chung cơ sở'));
  expect(screen.queryByLabelText('Cách quản lý')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thêm Giường đôi' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Camera hành lang' }));
  expect(screen.getByText('Đơn vị: Bộ')).toBeVisible();
  // An already-added common catalog item must no longer offer an Add action.
  expect(screen.queryByRole('button', { name: 'Thêm Camera hành lang' })).not.toBeInTheDocument();
  expect(screen.getByText('Đã chọn', { selector: '.MuiChip-label' })).toBeVisible();
  fill(/Khu vực sử dụng/, 'Hành lang tầng 1');
  fill('Số lượng', '3');
  fireEvent.click(button('Tài sản theo phòng'));
  expect(
    within(screen.getByRole('list', { name: 'Tài sản đã chọn' })).getAllByRole('listitem'),
  ).toHaveLength(2);
  fireEvent.click(button('Tài sản chung cơ sở'));
  expect(screen.getByLabelText(/Khu vực sử dụng/)).toHaveValue('Hành lang tầng 1');
  expect(screen.queryByRole('button', { name: 'Thêm Camera hành lang' })).not.toBeInTheDocument();
  next();
  await generate('1');
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
      docs
        .filter((doc) => doc.id !== nextCatalog.id)
        .map((doc) => ({ id: doc.id, kind: doc.resource, version: doc.version })),
    ),
  );
  expect(payload(writes()[0]).sourceReferences).not.toContainEqual(
    expect.objectContaining({ id: nextCatalog.id }),
  );
  expect(payload(writes()[0]).fees[0]).toMatchObject({ method: 2, rate: '30000' });
  expect(payload(writes()[0]).roomTypes[0].assets).toEqual([
    expect.objectContaining({ name: 'Bàn học', quantity: 4, trackingMode: 'BulkQuantity' }),
    expect.objectContaining({ name: 'Giường đôi', quantity: 1, trackingMode: 'BulkQuantity' }),
  ]);
  expect(payload(writes()[0]).commonAssets).toEqual([
    {
      id: expect.any(String),
      name: 'Camera hành lang',
      category: 'Nội thất',
      quantity: 3,
      trackingMode: 'BulkQuantity',
      unit: 'Bộ',
      commonArea: 'Hành lang tầng 1',
      referencePrice: 500000,
    },
  ]);
}, 60000);

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

it('edits generated rooms from the floor matrix and deletes a room or the remaining draft rooms', async () => {
  mount(<LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={vi.fn()} />);
  enterInfo();
  await manualType();
  next(); // Configure room assets before generating rooms.
  next();
  fill('Số lượng phòng', '2');
  fireEvent.click(button('Sinh phòng xem trước'));
  await screen.findByText('Danh sách phòng nháp (2)');
  fireEvent.click(button('Xem phòng P.101'));
  const details = within(screen.getByRole('dialog', { name: 'Thông tin phòng P.101' }));
  expect(details.getByRole('textbox', { name: 'Mã phòng' })).toHaveValue('P.101');
  expect(details.getByRole('textbox', { name: 'Sức chứa' })).toHaveValue('3 người');
  expect(details.getByRole('textbox', { name: 'Diện tích' })).toHaveValue('20 m²');
  fireEvent.change(details.getByLabelText('Giá riêng (đ/tháng)'), { target: { value: '2800000' } });
  fireEvent.click(details.getByRole('button', { name: 'Hoàn tất' }));
  fireEvent.click(button('Xem phòng P.101'));
  expect(
    within(screen.getByRole('dialog', { name: 'Thông tin phòng P.101' })).getByLabelText(
      'Giá riêng (đ/tháng)',
    ),
  ).toHaveValue('2.800.000');
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Thông tin phòng P.101' })).getByRole('button', {
      name: 'Xóa phòng',
    }),
  );
  expect(screen.queryByRole('button', { name: 'Xem phòng P.101' })).not.toBeInTheDocument();
  fireEvent.click(button('Xóa hết phòng'));
  const confirmation = within(screen.getByRole('dialog', { name: 'Xóa hết phòng nháp?' }));
  fireEvent.click(confirmation.getByRole('button', { name: 'Xóa hết phòng' }));
  expect(screen.getByText('Danh sách phòng nháp (0)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xem phòng P.102' })).not.toBeInTheDocument();
}, 60000);

it('preloads configured sample assets from a room template before room generation', async () => {
  const roomWithAssets: SharedDocument = {
    ...template,
    name: 'Phòng có giường mẫu',
    data: {
      ...template.data,
      assetItems: [
        {
          catalogId: 'sample-bed',
          catalogVersion: 2,
          quantity: 2,
          required: true,
          trackingMode: 'BulkQuantity',
          catalog: {
            name: 'Giường đôi mẫu',
            category: 'Nội thất',
            unit: 'Cái',
            referencePrice: 2000000,
            scope: 'Room',
            familyId: 'sample-bed-family',
            edition: 1,
          },
        },
      ],
    },
  };
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/location-setup' && init?.method === 'POST') return response;
    if (path.startsWith('/api/v1/shared-configuration/room-type-templates?')) {
      return { items: [roomWithAssets], total: 1, page: 1, pageSize: 100 };
    }
    return mockReads(path);
  });
  mount(<LocationSetupWizard locations={[]} onClose={vi.fn()} onComplete={vi.fn()} />);
  enterInfo();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Phòng có giường mẫu' }));
  next();
  const assets = within(screen.getByRole('list', { name: 'Tài sản đã chọn' }));
  expect(assets.getByText('Giường đôi mẫu')).toBeInTheDocument();
  expect(assets.getByText('Đơn vị: Cái')).toBeInTheDocument();
  const persisted = JSON.parse(sessionStorage.getItem(draftKey)!) as {
    roomTypes: Array<{ assets: Array<{ quantity: number; referencePrice: number }> }>;
  };
  expect(persisted.roomTypes[0].assets[0]).toMatchObject({ quantity: 2, referencePrice: 2000000 });
  expect(writes()).toHaveLength(0);
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
  next();
  await generate();
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
    code: 'SNS',
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
  // The real seven-step MUI wizard performs multiple full accessibility-tree scans in jsdom.
  // Keep every assertion, but allow slower CI machines to finish the complete atomic-flow test.
}, 60000);

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
  next();
  await generate('2');
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm Synthetic person service' }));
  next();
  next();
  expect(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ }));
  fireEvent.click(button('Xác nhận hoàn tất thiết lập'));
  expect(await screen.findByText(/Máy chủ chưa xử lý được yêu cầu/)).toBeInTheDocument();
  expect(screen.queryByText('Synthetic connection failure')).not.toBeInTheDocument();
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
}, 60000);
