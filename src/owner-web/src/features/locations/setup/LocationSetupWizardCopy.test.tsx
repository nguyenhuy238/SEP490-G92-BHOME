import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../../packages/client-core/src/propertySetup';
import { sharedConfigurationClient } from '../../../../../../packages/client-core/src/sharedConfiguration';
import type {
  LocationSetupInput,
  LocationSetupSource,
} from '../../../../../../packages/client-core/src/locationSetup';
import { theme } from '../../../theme/theme';
import { LocationSetupWizard } from './LocationSetupWizard';

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'copy-test-owner', roles: ['Owner'] } }),
}));
vi.mock('../../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () => propertySetupClient(state.request),
}));
vi.mock('../../configuration/useSharedConfigurationApi', () => ({
  useSharedConfigurationApi: () => sharedConfigurationClient(state.request),
}));

const sourceId = '00000000-0000-4000-8000-000000000001';
const sourceRoomId = '00000000-0000-4000-8000-000000000002';
const rentId = '00000000-0000-4000-8000-000000000003';
const feeId = '00000000-0000-4000-8000-000000000004';
const packageId = '00000000-0000-4000-8000-000000000005';
const ruleId = '00000000-0000-4000-8000-000000000006';
const typeId = '00000000-0000-4000-8000-000000000007';
const duplicateFeeId = '00000000-0000-4000-8000-000000000008';
const source: LocationSetupSource = {
  roomTypes: [
    {
      id: typeId,
      locationId: sourceId,
      kind: 'RoomDefaults',
      status: 'Published',
      version: 5,
      data: {
        name: 'Synthetic source type',
        description: 'Linked source room type',
        defaults: {
          capacity: 2,
          area: '25',
          amenities: ['Balcony'],
          referenceRent: null,
        },
        assetTemplateId: packageId,
      },
    },
  ],
  assetTemplates: [
    {
      id: packageId,
      locationId: sourceId,
      kind: 'AssetTemplate',
      status: 'Published',
      version: 3,
      data: {
        name: 'Synthetic package',
        locationId: sourceId,
        items: [
          {
            id: 'item',
            name: 'Synthetic desk',
            category: 'Furniture',
            trackingMode: 'BulkQuantity',
            quantity: 2,
            unit: 'Cái',
          },
        ],
      },
    },
  ],
  fees: [
    {
      id: rentId,
      locationId: sourceId,
      roomId: null,
      category: 0,
      chargeCode: 'RENT',
      name: 'Synthetic rent',
      method: 0,
      rate: '2500000',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      version: 2,
    },
    {
      id: feeId,
      locationId: sourceId,
      roomId: sourceRoomId,
      category: 3,
      chargeCode: 'WIFI',
      name: 'Synthetic room fee',
      method: 0,
      rate: '50000',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      version: 4,
    },
    {
      id: duplicateFeeId,
      locationId: sourceId,
      roomId: sourceRoomId,
      category: 3,
      chargeCode: 'WIFI',
      name: 'Synthetic duplicate room fee',
      method: 0,
      rate: '50000',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      version: 5,
    },
  ],
  policies: [
    {
      id: ruleId,
      locationId: sourceId,
      kind: 'OperatingPolicy',
      status: 'Published',
      version: 1,
      data: { title: 'Unselected rule', content: 'Do not copy this', effectiveFrom: '2020-01-01' },
    },
  ],
  sourceState: 'synthetic-source-state',
};

const next = () => fireEvent.click(screen.getByRole('button', { name: /^Tiếp tục \(/ }));
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  sessionStorage.clear();
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('copies a room type with its linked asset template and keeps rent in the single room-type price step', async () => {
  const complete = vi.fn();
  const result = {
    location: {
      id: 'destination',
      name: 'Synthetic copy',
      address: 'Synthetic address',
      isActive: false,
      version: 1,
    },
    createdReferences: [],
  };
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/location-setup/source/' + sourceId) return source;
    if (path.startsWith('/api/v1/shared-configuration/')) {
      if (path.includes('/asset-catalog?')) throw new Error('Synthetic library failure');
      return { items: [], total: 0, page: 1, pageSize: 100 };
    }
    if (path === '/api/v1/location-setup' && init?.method === 'POST') return result;
    throw new Error('Unexpected request: ' + path);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={client}>
        <LocationSetupWizard
          locations={[{ id: sourceId, name: 'Synthetic source' }]}
          initialSource={sourceId}
          onClose={vi.fn()}
          onComplete={complete}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByRole('checkbox', { name: /Synthetic source type/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Synthetic room fee/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Synthetic duplicate room fee/ }));
  expect(screen.queryByRole('checkbox', { name: /Synthetic rent/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Synthetic package/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nạp cấu hình đã chọn (3)' }));
  expect(
    await screen.findByText(/Một số thư viện chưa tải được: danh mục tài sản/),
  ).toBeInTheDocument();
  fill(/Tên cơ sở/, 'Synthetic copy');
  fill(/Mã cơ sở/, 'COPY-1');
  fill(/Địa chỉ/, 'Synthetic address');
  fill(/Số điện thoại liên hệ/, '0908123456');
  fireEvent.click(screen.getByRole('checkbox', { name: /Kích hoạt cơ sở/ }));
  next();
  expect(screen.getByText('Synthetic source type')).toBeVisible();
  expect(screen.queryByLabelText(/Giá thuê mặc định/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
  fill(/Giá thuê mặc định/, '2500000');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu loại phòng' }));
  next();
  fill('Số lượng phòng', '1');
  fireEvent.click(screen.getByRole('button', { name: 'Sinh phòng xem trước' }));
  next();
  expect(
    within(screen.getByRole('list', { name: 'Tài sản đã chọn' })).getByText('Synthetic desk'),
  ).toBeVisible();
  expect(
    within(screen.getByRole('list', { name: 'Tài sản đã chọn' })).getByText('Đơn vị: Cái'),
  ).toBeVisible();
  next();
  expect(screen.queryByLabelText(/Giá thuê\/tháng/)).not.toBeInTheDocument();
  next();
  expect(
    screen.getByText(/Biểu phí riêng của phòng nguồn cần chọn phòng đích/),
  ).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phạm vi áp dụng' }));
  expect(screen.getByRole('option', { name: 'Toàn cơ sở' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  fireEvent.click(screen.getByRole('option', { name: 'P.101' }));
  next();
  next();
  expect(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ })).toBeInTheDocument();
  expect(screen.queryByText('Unselected rule')).not.toBeInTheDocument();
  expect(state.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận giá thuê/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hoàn tất thiết lập' }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith(result));
  const writes = state.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1);
  const payload: LocationSetupInput = JSON.parse(String(writes[0][1].body));
  expect(payload).toMatchObject({
    activate: false,
    location: { contactPhone: '+84908123456' },
    sourceLocationId: sourceId,
    sourceState: source.sourceState,
    policy: null,
  });
  expect(payload.roomTypes[0]).toMatchObject({
    referenceRent: 2500000,
    sourceId: typeId,
    assets: [
      {
        name: 'Synthetic desk',
        category: 'Furniture',
        trackingMode: 'BulkQuantity',
        quantity: 2,
        unit: 'Cái',
      },
    ],
  });
  expect(payload.roomTypes[0].assets[0]).not.toHaveProperty('references');
  expect(payload.rooms[0]).toMatchObject({ roomNumber: 'P.101', rent: 2500000 });
  expect(payload.fees).toEqual([
    expect.objectContaining({
      chargeCode: 'WIFI',
      roomKey: payload.rooms[0].key,
      rate: source.fees.find((fee) => fee.id === feeId)?.rate,
    }),
  ]);
  expect(payload.fees).toHaveLength(1);
  expect(payload.fees[0]).not.toHaveProperty('sourceRoomId');
  expect(payload.fees[0]).not.toHaveProperty('reference');
  expect(JSON.stringify(payload)).not.toContain(sourceRoomId);
  expect(payload.sourceReferences).toHaveLength(3);
  expect(payload.sourceReferences).toEqual(
    expect.arrayContaining([
      { id: typeId, version: 5, kind: 'RoomDefaults' },
      { id: feeId, version: 4, kind: 'BillingPolicy' },
      { id: packageId, version: 3, kind: 'AssetTemplate' },
    ]),
  );
  expect(payload.sourceReferences).not.toContainEqual({
    id: duplicateFeeId,
    version: 5,
    kind: 'BillingPolicy',
  });
  expect(payload.sourceReferences).not.toContainEqual({
    id: rentId,
    version: 2,
    kind: 'BillingPolicy',
  });
}, 30000);
