import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  sharedConfigurationClient,
  type SharedDocument,
} from '../../../../../packages/client-core/src/sharedConfiguration';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { theme } from '../../theme/theme';
import { ApiConfigurationLibraryPage } from './pages/ApiConfigurationLibraryPage';
import { ApiConfigurationCopy } from './ApiConfigurationCopy';
import { LocationRoomDefaultsPicker } from './LocationRoomDefaultsPicker';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('./useSharedConfigurationApi', () => ({
  useSharedConfigurationApi: () =>
    sharedConfigurationClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: state.roles } }),
}));
const doc: SharedDocument = {
  id: '4938fdbe-58b8-4c01-af87-fc8f900b8056',
  resource: 'room-type-templates',
  familyId: '20e5ff05-2bba-493c-800f-501fa4c46cf8',
  edition: 2,
  version: 7,
  name: 'Synthetic room defaults',
  description: 'Persisted source',
  status: 'Published',
  managementScope: 'BHOME',
  createdBy: 'owner',
  createdAt: '2026-11-09T01:00:00Z',
  updatedBy: 'owner',
  updatedAt: '2026-11-09T02:00:00Z',
  data: {
    capacity: 3,
    area: '25.0001',
    amenities: ['Balcony'],
    referenceRent: '12345678901234.0001',
  },
};
const base = '/api/v1/shared-configuration/room-type-templates';
function reads(path: string) {
  if (path === '/api/v1/capture/locations')
    return [
      { id: 'location-a', label: 'Source Location' },
      { id: 'location-b', label: 'Target Location' },
    ];
  if (path.includes('/applications?'))
    return { items: [], total: 0, locationsUsing: 0, page: 1, pageSize: 20 };
  if (path.endsWith('/versions') || path.endsWith('/history')) return [doc];
  if (path.includes('asset-catalog?'))
    return {
      items: [
        {
          ...doc,
          id: 'catalog',
          resource: 'asset-catalog',
          data: { category: 'Furniture', unit: 'item', referencePrice: '123.0001' },
        },
      ],
      total: 1,
    };
  if (path.includes('?')) return { items: [doc], total: 1, page: 1, pageSize: 20 };
  return doc;
}
beforeEach(() => {
  vi.resetAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method ? doc : reads(path),
  );
});
afterEach(cleanup);

it('edits only a Draft with its loaded version and retains exact defaults', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method
      ? doc
      : path.startsWith(base + '?')
        ? { items: [{ ...doc, status: 'Draft' }], total: 1 }
        : reads(path),
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
  expect(screen.getByLabelText(/Giá thuê tham khảo/)).toHaveValue('12345678901234.0001');
  fill('Mô tả', 'Edited draft');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path === base + '/' + doc.id && init?.method === 'PUT',
  );
  expect(JSON.parse(call![1].body)).toMatchObject({
    expectedVersion: 7,
    description: 'Edited draft',
    data: { referenceRent: '12345678901234.0001' },
  });
});
it('accepts safe integer response quantities and writes them back as decimal strings', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method
      ? doc
      : path.startsWith(base + '?')
        ? {
            items: [
              {
                ...doc,
                status: 'Draft',
                data: { capacity: 3, area: 25, amenities: [], referenceRent: 3500000 },
              },
            ],
            total: 1,
          }
        : reads(path),
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
  expect(screen.getByLabelText(/Diện tích/)).toHaveValue('25');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path === base + '/' + doc.id && init?.method === 'PUT',
  );
  expect(JSON.parse(call![1].body).data).toMatchObject({ area: '25', referenceRent: '3500000' });
});
it('duplicates a persisted edition with a distinct name and concurrency version', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Nhân bản' }));
  fill('Tên bản sao', 'Independent copy');
  fireEvent.submit(screen.getByLabelText(/Tên bản sao/).closest('form')!);
  await screen.findByText('Đã lưu bản sao trên máy chủ.');
  expect(state.request).toHaveBeenCalledWith(
    base + '/' + doc.id + '/duplicate',
    expect.objectContaining({
      body: JSON.stringify({ name: 'Independent copy', expectedVersion: 7 }),
    }),
  );
});
it('loads persisted local defaults for explicit Room creation without writing a Room', async () => {
  const choose = vi.fn();
  state.request.mockResolvedValue([
    { id: 'defaults', data: { name: doc.name, defaults: doc.data } },
  ]);
  mount(<LocationRoomDefaultsPicker location="location-b" choose={choose} />);
  await select('Dùng cấu hình gợi ý', doc.name);
  expect(choose).toHaveBeenCalledWith(3);
  expect(state.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
function mount(element = <ApiConfigurationLibraryPage kind="room" />) {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {element}
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
}
async function select(label: string, value: string) {
  fireEvent.mouseDown(await screen.findByLabelText(label));
  fireEvent.click(await screen.findByRole('option', { name: value }));
}
it('creates exact room defaults through the real client and refreshes persisted state', async () => {
  mount();
  await screen.findByText(doc.name);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'New defaults');
  fill('Sức chứa', '4');
  fill('Diện tích', '25.0001');
  fill('Giá thuê tham khảo', '12345678901234.0001');
  fill('Tiện ích', 'Balcony\nWi-Fi');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path === base && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body)).toEqual({
    name: 'New defaults',
    description: '',
    expectedVersion: 0,
    data: {
      capacity: 4,
      area: '25.0001',
      amenities: ['Balcony', 'Wi-Fi'],
      referenceRent: '12345678901234.0001',
    },
  });
  expect(
    state.request.mock.calls.filter(([path]) => path.startsWith(base + '?')).length,
  ).toBeGreaterThan(1);
});
it('retains a failed form and never shows a persistence success', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) throw new ApiError(409, { code: 'stale_version' });
    return reads(path);
  });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'Retained defaults');
  fill('Sức chứa', '2');
  fill('Diện tích', '20');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText(/Cấu hình đã thay đổi/);
  expect(screen.getByLabelText(/Tên mẫu/)).toHaveValue('Retained defaults');
  expect(screen.queryByText('Đã lưu bản nháp trên máy chủ.')).toBeNull();
});
it('uses server preview, preserves its token and retries apply with the same durable key', async () => {
  let attempts = 0;
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/apply-preview'))
      return {
        sourceId: doc.id,
        targetLocationId: 'location-b',
        targetState: 'server-state',
        canProceed: true,
        changes: ['Server planned change'],
        conflicts: [],
        unsupportedReferences: [],
      };
    if (path.endsWith('/apply')) {
      if (++attempts === 1) throw new ApiError(503, {});
      return { id: 'application' };
    }
    return reads(path);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem và áp dụng' }));
  await screen.findByText('Áp dụng tại cơ sở');
  await select('Cơ sở đích', 'Target Location');
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước áp dụng' }));
  await screen.findByText('Server planned change');
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận áp dụng' }));
  await screen.findByText(/Chưa hoàn thành yêu cầu/);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận áp dụng' }));
  await screen.findByText('Máy chủ đã lưu cấu hình tại cơ sở.');
  const calls = state.request.mock.calls.filter(([path]) => path.endsWith('/apply'));
  expect(calls).toHaveLength(2);
  expect(calls[1][1]).toEqual(calls[0][1]);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({
    locationId: 'location-b',
    expectedVersion: 7,
    targetState: 'server-state',
    conflictStrategy: 'Reject',
  });
  expect(calls[0][1].headers['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/);
});
it('does not load the library for Staff', async () => {
  state.roles = ['Staff'];
  mount();
  await screen.findByText('Chỉ Chủ trọ được quản lý thư viện cấu hình.');
  expect(state.request).not.toHaveBeenCalled();
});
it('publishes using the loaded concurrency version', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method
      ? doc
      : path.includes('?')
        ? { items: [{ ...doc, status: 'Draft' }], total: 1 }
        : reads(path),
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Công bố' }));
  await screen.findByText('Đã công bố phiên bản trên máy chủ.');
  expect(state.request).toHaveBeenCalledWith(
    base + '/' + doc.id + '/publish',
    expect.objectContaining({ body: JSON.stringify({ expectedVersion: 7 }) }),
  );
});
it('selects real catalog versions and submits optional and tracking flags', async () => {
  mount(<ApiConfigurationLibraryPage kind="asset" />);
  fireEvent.click(screen.getByRole('tab', { name: 'Gói tài sản' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'New package');
  await select('Tài sản trong danh mục', doc.name + ' · phiên bản 2');
  fireEvent.click(screen.getByRole('button', { name: 'Thêm vào gói' }));
  fill('Số lượng mục 1', '3');
  fireEvent.click(screen.getByLabelText('Bắt buộc'));
  await select('Theo dõi mục 1', 'Theo số lượng');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path, init]) => path.endsWith('/asset-templates') && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const call = state.request.mock.calls.find(
    ([path, init]) => path.endsWith('/asset-templates') && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body).data.items[0]).toMatchObject({
    catalogId: 'catalog',
    catalogVersion: 7,
    quantity: 3,
    required: false,
    trackingMode: 'BulkQuantity',
  });
});
it('copies only after confirmed server preview and displays conflicts without execution', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    path.endsWith('/copy-preview')
      ? {
          sourceLocationId: 'location-a',
          targetLocationId: 'location-b',
          groups: ['OperatingPolicies'],
          sourceState: 'source',
          targetState: 'target',
          canProceed: false,
          changes: [],
          conflicts: ['Target conflict'],
          unsupportedReferences: [],
        }
      : init?.method
        ? { id: 'copy' }
        : reads(path),
  );
  mount(<ApiConfigurationCopy />);
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép cấu hình cơ sở' }));
  await select('Cơ sở nguồn', 'Source Location');
  await select('Cơ sở đích', 'Target Location');
  fireEvent.click(screen.getByLabelText('Nội quy (bản nháp)'));
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước sao chép' }));
  await screen.findByText('Target conflict');
  expect(screen.getByRole('button', { name: 'Xác nhận sao chép' })).toBeDisabled();
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/copy'))).toBe(false);
});
it('submits exact fee rates and effective dates without obsolete scope fields', async () => {
  mount(<ApiConfigurationLibraryPage kind="fee" />);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'Exact reference rent');
  fill('Đơn giá tham khảo', '12345678901234.0001');
  fill('Đơn vị', 'VND/month');
  fill('Hiệu lực từ', '2026-12-01');
  fill('Hiệu lực đến', '2027-12-01');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path.endsWith('/fee-templates') && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body).data).toEqual({
    category: 'Rent',
    chargeCode: 'RENT',
    method: 'FixedPerRoomPerMonth',
    referenceRate: '12345678901234.0001',
    unit: 'VND/month',
    scope: 'Location',
    effectiveFrom: '2026-12-01',
    effectiveTo: '2027-12-01',
  });
});
it('confirms copy using both server hashes and a durable request key', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    path.endsWith('/copy-preview')
      ? {
          sourceLocationId: 'location-a',
          targetLocationId: 'location-b',
          groups: ['OperatingPolicies'],
          sourceState: 'source-token',
          targetState: 'target-token',
          canProceed: true,
          changes: ['Confirmed server change'],
          conflicts: [],
          unsupportedReferences: [],
        }
      : init?.method
        ? { id: 'copy' }
        : reads(path),
  );
  mount(<ApiConfigurationCopy />);
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép cấu hình cơ sở' }));
  await select('Cơ sở nguồn', 'Source Location');
  await select('Cơ sở đích', 'Target Location');
  fireEvent.click(screen.getByLabelText('Nội quy (bản nháp)'));
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước sao chép' }));
  await screen.findByText('Confirmed server change');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận sao chép' }));
  await screen.findByText('Máy chủ đã lưu các cấu hình được sao chép.');
  const call = state.request.mock.calls.find(([path]) => path.endsWith('/copy'));
  expect(JSON.parse(call![1].body)).toMatchObject({
    groups: ['OperatingPolicies'],
    sourceState: 'source-token',
    targetState: 'target-token',
    conflictStrategy: 'Reject',
  });
  expect(call![1].headers['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/);
});
