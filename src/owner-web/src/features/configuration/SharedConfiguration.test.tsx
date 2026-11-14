import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  if (path.includes('asset-templates?'))
    return {
      items: [{ ...doc, resource: 'asset-templates', data: { items: [] } }],
      total: 1,
    };
  if (path.includes('fee-templates?'))
    return {
      items: [
        {
          ...doc,
          resource: 'fee-templates',
          data: {
            category: 'ServiceFee',
            chargeCode: 'CLEANING',
            method: 'FixedPerPersonPerMonth',
            referenceRate: '3000000',
            unit: 'VND/person/month',
            scope: 'Location',
            effectiveFrom: '2026-12-01',
            effectiveTo: null,
          },
        },
      ],
      total: 1,
    };
  if (path.includes('policy-templates?'))
    return {
      items: [
        {
          ...doc,
          resource: 'policy-templates',
          data: { content: 'Synthetic policy', effectiveFrom: '2026-12-01' },
        },
      ],
      total: 1,
    };
  if (path.includes('?')) return { items: [doc], total: 1, page: 1, pageSize: 20 };
  return doc;
}
beforeEach(() => {
  vi.resetAllMocks();
  setViewport(1440);
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method ? doc : reads(path),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const maxWidth = query.match(/max-width:\s*([\d.]+)px/);
    const minWidth = query.match(/min-width:\s*([\d.]+)px/);
    return {
      matches:
        (!maxWidth || width <= Number(maxWidth[1])) && (!minWidth || width >= Number(minWidth[1])),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
  });
}

it('edits only a Draft with its loaded version and retains exact defaults', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method
      ? doc
      : path.startsWith(base + '?')
        ? { items: [{ ...doc, status: 'Draft' }], total: 1 }
        : reads(path),
  );
  mount();
  await chooseRowAction('Sửa');
  expect(screen.getByLabelText(/Giá thuê tham khảo/)).toHaveValue('12.345.678.901.234,0001');
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
  await chooseRowAction('Sửa');
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
  await chooseRowAction('Nhân bản');
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
async function chooseRowAction(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Thao tác cho ${doc.name}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
async function select(label: string, value: string) {
  fireEvent.mouseDown(await screen.findByLabelText(new RegExp(label)));
  fireEvent.click(await screen.findByRole('option', { name: value }));
}
it('creates exact room defaults through the real client and refreshes persisted state', async () => {
  mount();
  await screen.findByText(doc.name);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'New defaults');
  fill('Sức chứa', '4');
  fill('Diện tích', '25.0001');
  fill('Giá thuê tham khảo', '12.345.678.901.234,0001');
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
  fireEvent.click(await screen.findByRole('button', { name: 'Áp dụng' }));
  await screen.findByText('Áp dụng tại cơ sở');
  await select('Cơ sở đích', 'Target Location');
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước áp dụng' }));
  await screen.findByText('Server planned change');
  const preview = screen.getByRole('region', { name: 'Bản xem trước' });
  expect(
    within(preview).getByText(/Nguồn: Synthetic room defaults · Phiên bản 2 · Lần cập nhật 7/),
  ).toBeVisible();
  expect(within(preview).getByText(/Target Location/)).toBeVisible();
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận áp dụng' }));
  await screen.findByText(/Chưa hoàn thành yêu cầu/);
  expect(screen.getByRole('region', { name: 'Bản xem trước' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Xem trước lại' })).toBeNull();
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
it('shows exact source metadata and history in details and invalidates preview when the target changes', async () => {
  setViewport(390);
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/apply-preview')) {
      const input = JSON.parse(String(init?.body));
      return {
        sourceId: doc.id,
        targetLocationId: input.locationId,
        targetState: 'state-' + input.locationId,
        canProceed: true,
        changes: ['Create reference defaults with exact rate 12.345.678.901.234,0001'],
        conflicts: [],
        unsupportedReferences: [],
      };
    }
    return reads(path);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Áp dụng' }));
  const dialog = await screen.findByRole('dialog', { name: doc.name });
  const title = within(dialog).getByRole('heading', { name: /Synthetic room defaults/ });
  expect(within(title).getByText('Đã công bố')).toBeVisible();
  expect(within(dialog).getByText('Phiên bản 2 · Lần cập nhật 7')).toBeVisible();
  expect(within(dialog).getByText('12.345.678.901.234,0001 đ/tháng')).toBeVisible();
  expect(state.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  fireEvent.click(within(dialog).getByText('Phiên bản và lịch sử'));
  expect(await within(dialog).findByRole('table', { name: 'Lịch sử cập nhật mẫu' })).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Xem trước áp dụng' })).toBeDisabled();
  await select('Cơ sở đích', 'Target Location');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xem trước áp dụng' }));
  expect(
    await within(dialog).findByText(/Create reference defaults with exact rate/),
  ).toBeVisible();
  await within(dialog).findByText('Đã nhận bản xem trước từ máy chủ.');
  await select('Cơ sở đích', 'Source Location');
  expect(within(dialog).queryByRole('region', { name: 'Bản xem trước' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Xác nhận áp dụng' })).toBeNull();
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(false);
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
  await chooseRowAction('Công bố');
  await screen.findByText('Đã công bố phiên bản trên máy chủ.');
  expect(state.request).toHaveBeenCalledWith(
    base + '/' + doc.id + '/publish',
    expect.objectContaining({ body: JSON.stringify({ expectedVersion: 7 }) }),
  );
});
it('shows room comparison columns, exact reference rent and status-specific actions', async () => {
  state.request.mockImplementation(async (path: string) =>
    path.startsWith(base + '?')
      ? {
          items: [
            doc,
            { ...doc, id: 'draft', name: 'Draft room', status: 'Draft' },
            { ...doc, id: 'archived', name: 'Archived room', status: 'Archived' },
          ],
          total: 3,
        }
      : reads(path),
  );
  mount();
  const table = await screen.findByRole('table', { name: 'Mẫu loại phòng' });
  expect(within(table).getByRole('columnheader', { name: 'Diện tích' })).toBeVisible();
  expect(within(table).getByRole('columnheader', { name: 'Sức chứa' })).toBeVisible();
  expect(within(table).queryByRole('columnheader', { name: 'Phiên bản' })).toBeNull();
  expect(within(table).queryByText(/Lần cập nhật/)).toBeNull();
  const published = within(table).getByRole('row', { name: /Synthetic room defaults/ });
  expect(within(published).getByText('12.345.678.901.234,0001 đ/tháng')).toBeVisible();
  expect(within(published).getByText('Đã công bố')).toBeVisible();
  expect(within(published).getByRole('button', { name: 'Áp dụng' })).toBeVisible();
  const draft = within(table).getByRole('row', { name: /Draft room/ });
  expect(within(draft).queryByRole('button', { name: 'Áp dụng' })).toBeNull();
  const archived = within(table).getByRole('row', { name: /Archived room/ });
  expect(within(archived).queryByRole('button', { name: 'Áp dụng' })).toBeNull();
  fireEvent.click(within(archived).getByRole('button', { name: 'Thao tác cho Archived room' }));
  expect(await screen.findByRole('menuitem', { name: 'Hoàn tác lưu trữ' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Công bố' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Lưu trữ' })).toBeNull();
});
it('displays fee units and does not offer apply directly on catalog entries', async () => {
  const { unmount } = mount(<ApiConfigurationLibraryPage kind="fee" />);
  expect(await screen.findByText('3.000.000 đ/người/tháng')).toBeVisible();
  expect(screen.getByText('Cơ sở')).toBeVisible();
  expect(screen.getByText('Người/tháng')).toBeVisible();
  unmount();
  mount(<ApiConfigurationLibraryPage kind="asset" />);
  const catalog = await screen.findByRole('table', { name: 'Danh mục tài sản' });
  expect(within(catalog).getByText('Furniture')).toBeVisible();
  expect(within(catalog).queryByRole('button', { name: 'Áp dụng' })).toBeNull();
});
it('keeps room prices and status without version clutter, with accessible actions at 390px', async () => {
  setViewport(390);
  const longName = 'Mẫu loại phòng có tên rất dài không được che mất các thao tác';
  state.request.mockImplementation(async (path: string) =>
    path.startsWith(base + '?')
      ? {
          items: [
            { ...doc, name: longName },
            { ...doc, id: 'draft', name: 'Draft room', status: 'Draft' },
            { ...doc, id: 'archived', name: 'Archived room', status: 'Archived' },
          ],
          total: 3,
        }
      : reads(path),
  );
  mount();
  const table = await screen.findByRole('table', { name: 'Mẫu loại phòng' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Tên mẫu', 'Thao tác']);
  const published = within(table).getByRole('row', { name: new RegExp(longName) });
  const identity = within(published).getByRole('rowheader');
  expect(within(identity).getByText('Đã công bố')).toBeVisible();
  expect(within(identity).getByText('25,0001 m² · 3 người')).toBeVisible();
  expect(
    within(identity).getByText('Giá thuê tham khảo: 12.345.678.901.234,0001 đ/tháng'),
  ).toBeVisible();
  expect(within(identity).queryByText(/Lần cập nhật/)).toBeNull();
  expect(within(identity).queryByText(/^v2$/)).toBeNull();
  const actions = within(published).getByRole('cell');
  expect(within(actions).getByRole('button', { name: 'Áp dụng' })).toBeVisible();
  fireEvent.click(within(actions).getByRole('button', { name: `Thao tác cho ${longName}` }));
  expect(await screen.findByRole('menuitem', { name: 'Phiên bản mới' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Nhân bản' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Lưu trữ' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Sửa' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  const draft = within(table).getByRole('row', { name: /Draft room/ });
  const archived = within(table).getByRole('row', { name: /Archived room/ });
  expect(within(draft).getByText('Bản nháp')).toBeVisible();
  expect(within(archived).getByText('Đã lưu trữ')).toBeVisible();
  expect(within(draft).queryByRole('button', { name: 'Áp dụng' })).toBeNull();
  expect(within(archived).queryByRole('button', { name: 'Áp dụng' })).toBeNull();
  fireEvent.click(within(draft).getByRole('button', { name: 'Thao tác cho Draft room' }));
  expect(await screen.findByRole('menuitem', { name: 'Công bố' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Sửa' })).toBeVisible();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sửa' }));
  expect(await screen.findByRole('button', { name: 'Lưu bản nháp' })).toBeVisible();
});
it('keeps each resource summary and its allowed actions visible on a 390px viewport', async () => {
  setViewport(390);
  const fee = mount(<ApiConfigurationLibraryPage kind="fee" />);
  const feeTable = await screen.findByRole('table', { name: 'Mẫu giá & biểu phí' });
  expect(within(feeTable).getByText('Dịch vụ · Phạm vi: Cơ sở')).toBeVisible();
  expect(within(feeTable).getByText('Cách tính: Người/tháng')).toBeVisible();
  expect(within(feeTable).getByText('Mức phí tham khảo: 3.000.000 đ/người/tháng')).toBeVisible();
  expect(within(feeTable).getByRole('button', { name: 'Áp dụng' })).toBeVisible();
  fee.unmount();
  const assets = mount(<ApiConfigurationLibraryPage kind="asset" />);
  const catalog = await screen.findByRole('table', { name: 'Danh mục tài sản' });
  expect(within(catalog).getByText('Furniture')).toBeVisible();
  expect(within(catalog).getByText('Giá tham khảo: 123,0001 đ/item')).toBeVisible();
  expect(within(catalog).queryByRole('button', { name: 'Áp dụng' })).toBeNull();
  expect(within(catalog).getByRole('button', { name: `Thao tác cho ${doc.name}` })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Gói tài sản' }));
  const packages = await screen.findByRole('table', { name: 'Mẫu tài sản' });
  expect(within(packages).getByText('0 loại tài sản')).toBeVisible();
  expect(within(packages).getByRole('button', { name: 'Áp dụng' })).toBeVisible();
  assets.unmount();
  mount(<ApiConfigurationLibraryPage kind="policy" />);
  const policy = await screen.findByRole('table', { name: 'Nội quy & chính sách' });
  expect(within(policy).getByText('Hiệu lực từ: 01/12/2026')).toBeVisible();
  expect(within(policy).getByRole('button', { name: 'Áp dụng' })).toBeVisible();
});
it('selects real catalog versions and submits optional and tracking flags', async () => {
  mount(<ApiConfigurationLibraryPage kind="asset" />);
  fireEvent.click(screen.getByRole('tab', { name: 'Gói tài sản' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'New package');
  await waitFor(() =>
    expect(screen.getByLabelText('Tài sản trong danh mục')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
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
  fill('Đơn giá tham khảo', '12.345.678.901.234,0001');
  expect(screen.getByLabelText(/Đơn giá tham khảo/)).toHaveValue('12.345.678.901.234,0001');
  expect(screen.getByLabelText(/Đơn vị/)).toHaveValue('VND/month');
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
it('resets fee identity and rate on category changes and saves water with its canonical unit', async () => {
  mount(<ApiConfigurationLibraryPage kind="fee" />);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'Water rate');
  fill('Đơn giá tham khảo', '3000000');
  await select('Nhóm phí', 'Điện');
  expect(screen.getByLabelText(/Mã khoản thu/)).toHaveValue('ELECTRICITY');
  expect(screen.getByLabelText(/Đơn vị/)).toHaveValue('kWh');
  await select('Nhóm phí', 'Nước');
  expect(screen.getByLabelText(/Mã khoản thu/)).toHaveValue('WATER');
  expect(screen.getByLabelText(/Đơn vị/)).toHaveValue('m³');
  expect(screen.getByLabelText(/Đơn giá tham khảo/)).toHaveValue('');
  fill('Đơn giá tham khảo', '15000');
  fill('Hiệu lực từ', '2026-12-01');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path.endsWith('/fee-templates') && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body).data).toMatchObject({
    category: 'Water',
    chargeCode: 'WATER',
    method: 'Metered',
    unit: 'm³',
    referenceRate: '15000',
  });
});
it('selects a service code and rejects reserved codes before submitting', async () => {
  mount(<ApiConfigurationLibraryPage kind="fee" />);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'Internet fee');
  await select('Nhóm phí', 'Dịch vụ');
  await select('Loại dịch vụ gợi ý', 'Internet');
  expect(screen.getByLabelText(/Mã khoản thu/)).toHaveValue('INTERNET');
  fill('Đơn giá tham khảo', '100000');
  fill('Hiệu lực từ', '2026-12-01');
  fill('Mã khoản thu', 'RENT');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Mã khoản thu hoặc cách tính không phù hợp với nhóm phí.');
  expect(
    state.request.mock.calls.some(
      ([path, init]) => path.endsWith('/fee-templates') && init?.method === 'POST',
    ),
  ).toBe(false);
  fill('Mã khoản thu', 'internet');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path.endsWith('/fee-templates') && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body).data).toMatchObject({
    category: 'ServiceFee',
    chargeCode: 'INTERNET',
    method: 'FixedPerRoomPerMonth',
    unit: 'VND/month',
  });
});
it('creates a per-person monthly service fee with live grouping and canonical payload', async () => {
  mount(<ApiConfigurationLibraryPage kind="fee" />);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo mẫu' }));
  fill('Tên mẫu', 'Phí vệ sinh theo người');
  await select('Nhóm phí', 'Dịch vụ');
  await select('Loại dịch vụ gợi ý', 'Vệ sinh');
  await select('Cách tính', 'Cố định mỗi người/tháng');
  expect(screen.getByLabelText(/Đơn vị/)).toHaveValue('VND/person/month');
  fill('Đơn giá tham khảo', '3000000');
  expect(screen.getByLabelText(/Đơn giá tham khảo/)).toHaveValue('3.000.000');
  fill('Hiệu lực từ', '2026-12-01');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  await screen.findByText('Đã lưu bản nháp trên máy chủ.');
  const call = state.request.mock.calls.find(
    ([path, init]) => path.endsWith('/fee-templates') && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body).data).toMatchObject({
    category: 'ServiceFee',
    chargeCode: 'CLEANING',
    method: 'FixedPerPersonPerMonth',
    unit: 'VND/person/month',
    referenceRate: '3000000',
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
it('copies independent selected groups, resets a stale fee date and retries the confirmed snapshot', async () => {
  setViewport(390);
  let attempts = 0;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/copy-preview')) {
      const input = JSON.parse(String(init?.body));
      return {
        sourceLocationId: input.sourceLocationId,
        targetLocationId: input.targetLocationId,
        groups: input.groups,
        sourceState: 'source-token',
        targetState: 'target-token',
        canProceed: true,
        changes: ['Server copy change'],
        conflicts: [],
        unsupportedReferences: [],
      };
    }
    if (path.endsWith('/copy')) {
      if (++attempts === 1) throw new ApiError(503, {});
      return { id: 'copy' };
    }
    return reads(path);
  });
  mount(<ApiConfigurationCopy />);
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép cấu hình cơ sở' }));
  const dialog = screen.getByRole('dialog', { name: 'Sao chép cấu hình giữa các cơ sở' });
  await select('Cơ sở nguồn', 'Source Location');
  await select('Cơ sở đích', 'Source Location');
  fireEvent.click(screen.getByLabelText('Nội quy (bản nháp)'));
  expect(screen.getByText('Chọn cơ sở khác cơ sở nguồn.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Xem trước sao chép' })).toBeDisabled();
  await select('Cơ sở đích', 'Target Location');
  fireEvent.click(screen.getByLabelText('Biểu phí có hiệu lực tại ngày đã chọn'));
  expect(screen.getByRole('button', { name: 'Xem trước sao chép' })).toBeDisabled();
  fill('Ngày bắt đầu biểu phí tại cơ sở đích', '2026-12-01');
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước sao chép' }));
  const firstPreview = await within(dialog).findByRole('region', { name: 'Bản xem trước' });
  expect(within(firstPreview).getByText(/01\/12\/2026/)).toBeVisible();
  fireEvent.click(screen.getByLabelText('Biểu phí có hiệu lực tại ngày đã chọn'));
  expect(within(dialog).queryByRole('region', { name: 'Bản xem trước' })).toBeNull();
  expect(screen.getByLabelText('Nội quy (bản nháp)')).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Xác nhận sao chép' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước sao chép' }));
  await screen.findByText('Server copy change');
  const previews = state.request.mock.calls.filter(([path]) => path.endsWith('/copy-preview'));
  expect(JSON.parse(previews[1][1].body)).toMatchObject({
    groups: ['OperatingPolicies'],
    effectiveFrom: null,
  });
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/copy'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận sao chép' }));
  await screen.findByText(/Chưa hoàn thành yêu cầu/);
  expect(screen.queryByRole('button', { name: 'Xem trước lại' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận sao chép' }));
  await screen.findByText('Máy chủ đã lưu các cấu hình được sao chép.');
  const copies = state.request.mock.calls.filter(([path]) => path.endsWith('/copy'));
  expect(copies).toHaveLength(2);
  expect(copies[1][1]).toEqual(copies[0][1]);
  expect(JSON.parse(copies[0][1].body)).toMatchObject({
    groups: ['OperatingPolicies'],
    effectiveFrom: null,
    sourceState: 'source-token',
    targetState: 'target-token',
  });
});
