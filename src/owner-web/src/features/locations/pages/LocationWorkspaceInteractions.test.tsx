import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { propertySetupClient } from '../../../../../../packages/client-core/src/propertySetup';
import { invoiceClient } from '../../../../../../packages/client-core/src/invoices';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { BulkRoomsDialog } from '../components/BulkRoomsDialog';
import { LocationPricingWorkspace } from './LocationPricingWorkspace';
import { RoomTypesApiPage } from '../../room-types/pages/RoomTypesApiPage';
import { PortalProvider } from '../../../app/PortalProvider';
import { LocationWorkspaceSettings } from './LocationWorkspaceSettings';
import { EndPolicyDialog } from '../components/EndPolicyDialog';
import { ScheduleForm } from '../../invoices/BillingConfigurationPage';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('../../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () => propertySetupClient(state.request),
}));
vi.mock('../../invoices/useInvoiceApi', () => ({
  useInvoiceApi: () => ({ request: state.request, ...invoiceClient(state.request) }),
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: state.roles } }),
}));
const roomType = {
  id: 'studio',
  locationId: 'location',
  kind: 'RoomDefaults',
  status: 'Recorded',
  data: {
    name: 'Studio tổng hợp',
    description: 'Mô tả tổng hợp',
    defaults: { capacity: 2, area: 25, amenities: ['Ban công'], referenceRent: 3500000 },
    sourceId: 'shared-studio',
    sourceVersion: 2,
  },
  version: 3,
};
beforeEach(() => {
  state.roles = ['Owner'];
  state.request.mockReset();
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) return {};
    if (path.endsWith('/room-defaults') || path.endsWith('/history')) return [roomType];
    if (path.includes('/utility-tariffs')) return [];
    if (path.includes('/asset-templates?')) return [];
    if (path.endsWith('/rooms')) return [{ id: 'room', label: 'P.101' }];
    return { items: [], totalCount: 0 };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('always saves the agreed contract rent source even for a legacy room-price schedule', async () => {
  const onSaved = vi.fn();
  mount(
    <ScheduleForm
      location="location"
      current={{
        locationId: 'location',
        rateDate: 1,
        rentSource: 0,
        partialMonth: 0,
        rounding: 0,
        draftDay: 1,
        draftMonthOffset: 0,
        finalDay: 2,
        finalMonthOffset: 0,
        dueDay: 5,
        dueMonthOffset: 0,
        version: 2,
      }}
      onSaved={onSaved}
    />,
  );
  expect(screen.getByLabelText('Nguồn tiền thuê cả phòng')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu quy tắc hóa đơn' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const write = state.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/billing-schedules' && init?.method === 'PUT',
  );
  expect(JSON.parse(write![1].body)).toMatchObject({ rentSource: 1, expectedVersion: 2 });
});
it('opens utility configuration within pricing and keeps billing policy creation separate', async () => {
  mount(<LocationPricingWorkspace locationId="location" />);
  fireEvent.click(screen.getByRole('tab', { name: 'Điện & nước' }));
  expect(await screen.findByRole('tab', { name: 'Công tơ & Chỉ số' })).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'Thêm biểu giá điện nước' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thêm khoản thu' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Giá thuê' }));
  expect(screen.getByRole('button', { name: 'Thêm khoản thu' })).toBeInTheDocument();
});

it('opens the utility section directly for legacy utility navigation', async () => {
  mount(<LocationPricingWorkspace locationId="location" initialTab={3} />);
  expect(await screen.findByRole('tab', { name: 'Biểu giá' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Điện & nước' })).toHaveAttribute('aria-selected', 'true');
});
it('filters rent, service fees and legacy utility rates at the server before paging', async () => {
  mount(<LocationPricingWorkspace locationId="location" />);
  await waitFor(() =>
    expect(state.request.mock.calls.some(([path]) => path.includes('chargeCategory=0'))).toBe(true),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Phí dịch vụ' }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path]) =>
          path.includes('chargeCategory=3') &&
          path.includes('page=1') &&
          path.includes('locationId=location'),
      ),
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Hiệu lực'), { target: { value: 'current' } });
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path]) => path.includes('chargeCategory=3') && path.includes('effectiveOn='),
      ),
    ).toBe(true),
  );
  expect(screen.getByRole('option', { name: 'Tất cả' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tìm khoản thu'), { target: { value: 'Giặt' } });
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(([path]) => {
        const query = new URLSearchParams(path.split('?')[1]);
        return (
          query.get('search') === 'Giặt' &&
          query.get('chargeCategory') === '3' &&
          query.has('effectiveOn') &&
          query.get('page') === '1'
        );
      }),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Điện & nước' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Đơn giá điện trực tiếp' }));
  await waitFor(() =>
    expect(state.request.mock.calls.some(([path]) => path.includes('chargeCategory=1'))).toBe(true),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Đơn giá nước trực tiếp' }));
  await waitFor(() =>
    expect(state.request.mock.calls.some(([path]) => path.includes('chargeCategory=2'))).toBe(true),
  );
});
function mount(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}

it('previews bulk rooms without writing, then persists the reviewed room numbers and Location scope', async () => {
  mount(<BulkRoomsDialog locationId="location" close={vi.fn()} />);
  fireEvent.mouseDown(screen.getByLabelText(/Gợi ý tạo phòng/));
  fireEvent.click(await screen.findByRole('option', { name: /Studio tổng hợp/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tạo danh sách xem trước' }));
  expect(state.request.mock.calls.some(([, init]) => init?.method)).toBe(false);
  fireEvent.change(screen.getByLabelText('Số phòng 1'), { target: { value: 'P.201' } });
  const rent = screen.getByLabelText('Giá thuê phòng 1');
  fireEvent.change(rent, { target: { value: '3.500.000,1250' } });
  expect(rent).toHaveValue('3.500.000,1250');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo 5 phòng' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/locations/location/configured-rooms',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const body = JSON.parse(
    state.request.mock.calls.find(([, init]) => init?.method === 'POST')![1].body,
  );
  expect(body).toMatchObject({
    effectiveFrom: expect.any(String),
    rooms: [
      {
        roomNumber: 'P.201',
        floor: '1',
        roomDefaultsId: 'studio',
        expectedVersion: 3,
        rent: '3500000.1250',
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        roomNumber: `P.${102 + i}`,
        floor: '1',
        roomDefaultsId: 'studio',
        expectedVersion: 3,
        rent: '3500000',
      })),
    ],
  });
});

it('blocks duplicate room numbers and preserves the preview when the backend rejects a bulk write', async () => {
  state.request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method) throw new ApiError(409, { code: 'room_number_exists' });
    return [roomType];
  });
  mount(<BulkRoomsDialog locationId="location" close={vi.fn()} />);
  fireEvent.mouseDown(screen.getByLabelText(/Gợi ý tạo phòng/));
  fireEvent.click(await screen.findByRole('option', { name: /Studio tổng hợp/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tạo danh sách xem trước' }));
  fireEvent.change(screen.getByLabelText('Số phòng 1'), { target: { value: 'P.102' } });
  expect(screen.getByRole('button', { name: 'Xác nhận tạo 5 phòng' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Số phòng 1'), { target: { value: 'P.201' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo 5 phòng' }));
  await screen.findByText(/Danh sách được giữ lại/);
  expect(screen.getByLabelText('Số phòng 1')).toHaveValue('P.201');
});

it('creates a policy with an exact rate and retained form on conflict from the Location pricing dialog', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) throw new ApiError(409, { code: 'stale_version' });
    return path.endsWith('/rooms') ? [] : { items: [], totalCount: 0 };
  });
  mount(<LocationPricingWorkspace locationId="location" />);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm khoản thu' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Tên khoản thu/), {
    target: { value: 'Điện thử nghiệm' },
  });
  fireEvent.change(dialog.getByLabelText(/Đơn giá VND/), { target: { value: '3.000,1234' } });
  fireEvent.change(dialog.getByLabelText(/Hiệu lực từ ngày/), { target: { value: '2027-01-01' } });
  fireEvent.change(dialog.getByLabelText(/Lý do/), { target: { value: 'Đối chiếu giá' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Lưu biểu giá' }));
  await dialog.findByText(/Cấu hình đã thay đổi/);
  expect(dialog.getByLabelText(/Đơn giá VND/)).toHaveValue('3.000,1234');
  const post = state.request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1].body)).toMatchObject({
    locationId: 'location',
    roomId: null,
    rate: '3000.1234',
  });
});

it('does not offer pricing mutations to Staff', async () => {
  state.roles = ['Staff'];
  mount(<LocationPricingWorkspace locationId="location" />);
  await screen.findByText('Chưa có khoản thu phù hợp');
  expect(screen.queryByRole('button', { name: 'Thêm khoản thu' })).toBeNull();
});

it('repairs only the known malformed RENT display across the list, detail, editor and end dialog without writing on open', async () => {
  const broken = {
    id: 'broken-rent',
    locationId: 'location',
    roomId: null,
    category: 0,
    chargeCode: 'RENT',
    name: 'Gi? thu? ph?ng',
    method: 0,
    rate: '3500000.1251',
    effectiveFrom: '2099-01-01',
    effectiveTo: null,
    version: 7,
  };
  const custom = { ...broken, id: 'custom-rent', name: 'Tiền thuê căn hộ sân vườn' };
  state.request.mockImplementation(async (path: string) =>
    path.endsWith('/rooms') ? [] : { items: [broken, custom], totalCount: 2 },
  );
  mount(<LocationPricingWorkspace locationId="location" />);
  const row = await screen.findByRole('row', { name: /Giá thuê phòng/ });
  expect(within(row).getByText('3.500.000,1251 đ')).toBeInTheDocument();
  expect(within(row).getByText('/phòng/tháng')).toBeInTheDocument();
  expect(within(row).getByText('Toàn cơ sở')).toBeInTheDocument();
  expect(within(row).getByText('01/01/2099 → Không thời hạn')).toBeInTheDocument();
  expect(screen.getByText(custom.name)).toBeInTheDocument();
  expect(screen.queryByText(broken.name)).not.toBeInTheDocument();

  fireEvent.click(within(row).getByRole('button', { name: 'Chi tiết' }));
  let dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole('heading', { name: 'Giá thuê phòng' })).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Kết thúc áp dụng' }));
  await screen.findByRole('heading', { name: 'Kết thúc áp dụng: Giá thuê phòng' });
  fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(within(row).getByRole('button', { name: 'Sửa giá tương lai' }));
  dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByLabelText(/Tên khoản thu/)).toHaveValue('Giá thuê phòng');
  expect(dialog.getByLabelText(/Đơn giá VND/)).toHaveValue('3.500.000,1251');
  fireEvent.click(dialog.getByRole('button', { name: 'Đóng biểu giá' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  const customRow = screen.getByRole('row', { name: /Tiền thuê căn hộ sân vườn/ });
  fireEvent.click(within(customRow).getByRole('button', { name: 'Tạo giá kế tiếp' }));
  dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByLabelText(/Tên khoản thu/)).toHaveValue(custom.name);
  expect(broken.name).toBe('Gi? thu? ph?ng');
  expect(state.request.mock.calls.some(([, init]) => init?.method)).toBe(false);
});

it('keeps a service fee name untouched and shows the exact per-person monthly unit', async () => {
  state.request.mockImplementation(async (path: string) =>
    path.endsWith('/rooms')
      ? []
      : {
          items: [
            {
              id: 'service',
              locationId: 'location',
              roomId: null,
              category: 3,
              chargeCode: 'PERSON_FEE',
              name: 'Gi? thu? ph?ng',
              method: 2,
              rate: '120000.1251',
              effectiveFrom: '2099-01-01',
              effectiveTo: null,
              version: 1,
            },
          ],
          totalCount: 1,
        },
  );
  mount(<LocationPricingWorkspace locationId="location" initialTab={1} />);
  const row = await screen.findByRole('row', { name: /PERSON_FEE/ });
  expect(within(row).getByText('Gi? thu? ph?ng')).toBeInTheDocument();
  expect(within(row).getByText('120.000,1251 đ')).toBeInTheDocument();
  expect(within(row).getByText('/người/tháng')).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Tạo giá kế tiếp' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByLabelText(/Tên khoản thu/)).toHaveValue('Gi? thu? ph?ng');
  expect(dialog.getByLabelText('Cách tính phí dịch vụ')).toHaveTextContent('Cố định/người/tháng');
  expect(state.request.mock.calls.some(([, init]) => init?.method)).toBe(false);
});

it('keeps exact price, effect and permitted actions visible in a mobile record', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width:599px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
  state.request.mockImplementation(async (path: string) =>
    path.endsWith('/rooms')
      ? []
      : {
          items: [
            {
              id: 'mobile-fee',
              locationId: 'location',
              roomId: null,
              category: 3,
              chargeCode: 'PERSON_FEE',
              name: 'Phí dịch vụ',
              method: 2,
              rate: '120000.1251',
              effectiveFrom: '2099-01-01',
              effectiveTo: null,
              version: 1,
            },
          ],
          totalCount: 1,
        },
  );
  mount(<LocationPricingWorkspace locationId="location" initialTab={1} />);
  const table = await screen.findByRole('table', { name: 'Biểu phí theo cơ sở' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(1);
  const record = within(table).getByRole('rowheader');
  expect(within(record).getByText('120.000,1251 đ')).toBeVisible();
  expect(within(record).getByText('/người/tháng')).toBeVisible();
  expect(within(record).getByText('Toàn cơ sở')).toBeVisible();
  expect(within(record).getByText('Sắp áp dụng')).toBeVisible();
  expect(within(record).getByText('01/01/2099 → Không thời hạn')).toBeVisible();
  expect(within(record).getByRole('button', { name: 'Tạo giá kế tiếp' })).toBeVisible();
  fireEvent.click(within(record).getByRole('button', { name: 'Chi tiết' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(state.request.mock.calls.some(([, init]) => init?.method)).toBe(false);
});

function mountRoomTypes() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PortalProvider>
        <MemoryRouter initialEntries={['/locations/location/room-types']}>
          <Routes>
            <Route path="/locations/:locationId/room-types" element={<RoomTypesApiPage />} />
          </Routes>
        </MemoryRouter>
      </PortalProvider>
    </QueryClientProvider>,
  );
}
it('updates the visible configuration panel when another RoomType is selected', async () => {
  state.request.mockResolvedValue([
    roomType,
    {
      ...roomType,
      id: 'large',
      data: {
        ...roomType.data,
        name: 'Phòng gia đình',
        defaults: { ...roomType.data.defaults, capacity: 5, amenities: ['Bếp riêng'] },
      },
    },
  ]);
  mountRoomTypes();
  await screen.findByRole('heading', { name: 'Studio tổng hợp' });
  fireEvent.click(screen.getByRole('button', { name: 'Phòng gia đình' }));
  expect(screen.getByRole('heading', { name: 'Phòng gia đình' })).toBeInTheDocument();
  expect(screen.getByText('Bếp riêng')).toBeInTheDocument();
  expect(screen.queryByText('Ban công')).toBeNull();
});
it('loads RoomType details, edits with its current version and retains values on conflict', async () => {
  state.request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') throw new ApiError(409, { code: 'stale_version' });
    return _path.includes('/asset-templates?') ? [] : [roomType];
  });
  mountRoomTypes();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  expect(within(screen.getByRole('dialog')).getByText('Mô tả tổng hợp')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Chỉnh sửa' }));
  await screen.findByLabelText(/Tên gợi ý/);
  fireEvent.change(screen.getByLabelText(/Tên gợi ý/), {
    target: { value: 'Studio đã chỉnh' },
  });
  const rent = screen.getByLabelText('Giá thuê tham khảo (VND)');
  expect(rent).toHaveValue('3.500.000');
  fireEvent.change(rent, { target: { value: '3.600.000,1234' } });
  fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: 'Kiểm tra phiên bản' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await screen.findByText(/Dữ liệu đang nhập được giữ nguyên/);
  expect(screen.getByLabelText(/Tên gợi ý/)).toHaveValue('Studio đã chỉnh');
  expect(rent).toHaveValue('3.600.000,1234');
  expect(
    JSON.parse(state.request.mock.calls.find(([, init]) => init?.method === 'PUT')![1].body),
  ).toMatchObject({
    expectedVersion: 3,
    defaults: { capacity: 2, amenities: ['Ban công'], referenceRent: '3600000.1234' },
  });
});

it('filters the scoped native RoomDefaults collection without calling retired RoomType APIs', async () => {
  state.request.mockResolvedValue([
    roomType,
    { ...roomType, id: 'large', data: { ...roomType.data, name: 'Phòng gia đình' } },
  ]);
  mountRoomTypes();
  await screen.findByRole('button', { name: 'Studio tổng hợp' });
  fireEvent.change(screen.getByLabelText('Tìm gợi ý tạo phòng'), { target: { value: 'Studio' } });
  expect(screen.queryByRole('button', { name: 'Phòng gia đình' })).not.toBeInTheDocument();
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/locations/location/room-defaults',
    expect.anything(),
  );
  expect(state.request.mock.calls.some(([path]) => path.includes('/api/v1/room-types'))).toBe(
    false,
  );
});

it('uses the confirmed Location version for a subsequent settings save', async () => {
  state.request.mockResolvedValue({
    id: 'location',
    name: 'Cơ sở tổng hợp',
    address: 'Địa chỉ tổng hợp',
    isActive: true,
    version: 5,
  });
  mount(
    <LocationWorkspaceSettings
      location={{
        id: 'location',
        name: 'Cơ sở tổng hợp',
        address: 'Địa chỉ tổng hợp',
        isActive: true,
        version: 4,
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText(/Tên cơ sở/), { target: { value: 'Cơ sở mới' } });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Lần đầu' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await screen.findByText('Đã lưu thông tin cơ sở.');
  expect(
    JSON.parse(state.request.mock.calls.find(([, init]) => init?.method === 'PUT')![1].body)
      .version,
  ).toBe(4);
  fireEvent.change(screen.getByLabelText(/Tên cơ sở/), { target: { value: 'Cơ sở cập nhật' } });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Lần tiếp theo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await waitFor(() =>
    expect(state.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2),
  );
  expect(
    JSON.parse(state.request.mock.calls.filter(([, init]) => init?.method === 'PUT')[1][1].body)
      .version,
  ).toBe(5);
});

it('blocks closure when the server reports open Location obligations, then asks for confirmation after recheck', async () => {
  state.request.mockResolvedValue({
    canClose: false,
    blockers: [{ code: 'OPEN_CONTRACTS', count: 2 }],
  });
  mount(
    <LocationWorkspaceSettings
      location={{
        id: 'location',
        name: 'Cơ sở tổng hợp',
        address: 'Địa chỉ tổng hợp',
        isActive: true,
        version: 4,
      }}
    />,
  );
  fireEvent.mouseDown(screen.getByLabelText('Trạng thái hoạt động'));
  fireEvent.click(await screen.findByRole('option', { name: 'Ngừng hoạt động' }));
  await screen.findByText(/OPEN_CONTRACTS: 2/);
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), {
    target: { value: 'Kiểm tra nghĩa vụ' },
  });
  expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  state.request.mockResolvedValue({ canClose: true, blockers: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await screen.findByText('Ngừng hoạt động cơ sở?');
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});

it('ends policy applicability using its loaded version and a reason, without deleting its history', async () => {
  mount(
    <EndPolicyDialog
      policy={{
        id: 'policy',
        locationId: 'location',
        roomId: null,
        category: 0,
        chargeCode: 'RENT',
        name: 'Giá thuê tổng hợp',
        method: 0,
        rate: '3500000',
        effectiveFrom: '2026-12-01',
        effectiveTo: null,
        version: 8,
      }}
      close={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText(/Ngày kết thúc áp dụng/), {
    target: { value: '2027-01-31' },
  });
  fireEvent.change(screen.getByLabelText(/Lý do kết thúc/), {
    target: { value: 'Kết thúc thỏa thuận giá' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận kết thúc áp dụng' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('/api/v1/billing-policies/policy/end', {
      method: 'POST',
      body: JSON.stringify({
        effectiveTo: '2027-01-31',
        version: 8,
        reason: 'Kết thúc thỏa thuận giá',
      }),
    }),
  );
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});
