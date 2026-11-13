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
const source: LocationSetupSource = {
  roomTypes: [],
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
});
afterEach(cleanup);

it('copies only selected configuration, requires asset assignment and new-room fee mapping, and submits exact source provenance', async () => {
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

  fireEvent.click(await screen.findByRole('checkbox', { name: /Synthetic rent/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Synthetic package/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Synthetic room fee/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Nạp cấu hình đã chọn (3)' }));
  expect(
    await screen.findByText(/Một số thư viện chưa tải được: danh mục tài sản/),
  ).toBeInTheDocument();
  fill(/Tên cơ sở/, 'Synthetic copy');
  fill(/Mã cơ sở/, 'COPY-1');
  fill(/Địa chỉ/, 'Synthetic address');
  fireEvent.click(screen.getByRole('checkbox', { name: /Kích hoạt cơ sở/ }));
  next();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm loại phòng' }));
  const editor = within(screen.getByRole('dialog', { name: 'Thêm loại phòng riêng' }));
  expect(editor.getByLabelText(/Giá thuê mặc định/)).toHaveValue(2500000);
  fireEvent.change(editor.getByLabelText('Tên loại phòng'), {
    target: { value: 'Synthetic destination type' },
  });
  fireEvent.click(editor.getByRole('button', { name: 'Lưu loại phòng' }));
  await screen.findByRole('button', { name: /^Tiếp tục \(/ });
  next();
  fill('Số lượng phòng', '1');
  fireEvent.click(screen.getByRole('button', { name: 'Sinh phòng xem trước' }));
  next();
  next();
  expect(screen.getByText(/Hãy gán từng gói tài sản/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gán cho Synthetic destination type' }));
  expect(screen.getByLabelText('Tên tài sản')).toHaveValue('Synthetic desk');
  next();
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
  expect(screen.getByText(/7. Xem lại và hoàn tất/)).toBeInTheDocument();
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
    sourceLocationId: sourceId,
    sourceState: source.sourceState,
    policy: null,
  });
  expect(payload.roomTypes[0]).toMatchObject({
    referenceRent: 2500000,
    sourceId: null,
    assets: [
      { name: 'Synthetic desk', category: 'Furniture', trackingMode: 'BulkQuantity', quantity: 2 },
    ],
  });
  expect(payload.roomTypes[0].assets[0]).not.toHaveProperty('references');
  expect(payload.rooms[0]).toMatchObject({ roomNumber: 'P.101', rent: 2500000 });
  expect(payload.fees).toEqual([
    expect.objectContaining({ chargeCode: 'WIFI', roomKey: payload.rooms[0].key, rate: 50000 }),
  ]);
  expect(payload.fees[0]).not.toHaveProperty('sourceRoomId');
  expect(payload.fees[0]).not.toHaveProperty('reference');
  expect(JSON.stringify(payload)).not.toContain(sourceRoomId);
  expect(payload.sourceReferences).toHaveLength(3);
  expect(payload.sourceReferences).toEqual(
    expect.arrayContaining([
      { id: rentId, version: 2, kind: 'BillingPolicy' },
      { id: feeId, version: 4, kind: 'BillingPolicy' },
      { id: packageId, version: 3, kind: 'AssetTemplate' },
    ]),
  );
}, 30000);
