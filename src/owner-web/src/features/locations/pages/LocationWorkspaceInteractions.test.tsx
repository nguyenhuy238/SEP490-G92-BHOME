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
    if (path.includes('/asset-templates?')) return [];
    if (path.endsWith('/rooms')) return [{ id: 'room', label: 'P.101' }];
    return { items: [], totalCount: 0 };
  });
});
afterEach(cleanup);
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
        rent: 3500000,
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        roomNumber: `P.${102 + i}`,
        floor: '1',
        roomDefaultsId: 'studio',
        expectedVersion: 3,
        rent: 3500000,
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
  fireEvent.change(dialog.getByLabelText(/Đơn giá VND/), { target: { value: '3000.1234' } });
  fireEvent.change(dialog.getByLabelText(/Hiệu lực từ ngày/), { target: { value: '2027-01-01' } });
  fireEvent.change(dialog.getByLabelText(/Lý do/), { target: { value: 'Đối chiếu giá' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Lưu biểu giá' }));
  await dialog.findByText(/Cấu hình đã thay đổi/);
  expect(dialog.getByLabelText(/Đơn giá VND/)).toHaveValue('3000.1234');
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
  fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: 'Kiểm tra phiên bản' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await screen.findByText(/Dữ liệu đang nhập được giữ nguyên/);
  expect(screen.getByLabelText(/Tên gợi ý/)).toHaveValue('Studio đã chỉnh');
  expect(
    JSON.parse(state.request.mock.calls.find(([, init]) => init?.method === 'PUT')![1].body),
  ).toMatchObject({
    expectedVersion: 3,
    defaults: { capacity: 2, amenities: ['Ban công'] },
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
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: 'Lần đầu' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await screen.findByText('Đã lưu thông tin cơ sở.');
  expect(
    JSON.parse(state.request.mock.calls.find(([, init]) => init?.method === 'PUT')![1].body)
      .version,
  ).toBe(4);
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

it('checks open Location obligations and asks for confirmation before a closure write', async () => {
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
