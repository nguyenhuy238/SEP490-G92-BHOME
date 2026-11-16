import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { theme } from '../../theme/theme';
import { LocalAssetSetup } from './LocalAssetSetup';
import { OperatingPoliciesPanel } from './OperatingPoliciesPanel';
import { AssetOperationsPanel } from './AssetOperationsPanel';
import { CommonAssetRequirementsPanel } from './CommonAssetRequirementsPanel';
import type { SetupCommonAssetRequirement } from '../../../../../packages/client-core/src/locationSetup';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('./usePropertySetupApi', () => ({
  usePropertySetupApi: () =>
    propertySetupClient(
      <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
    ),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: state.roles } }),
}));
const item = {
  id: 'item',
  name: 'Synthetic chair',
  category: 'Furniture',
  trackingMode: 'BulkQuantity',
  quantity: 2,
};
const template = {
  id: 'template',
  locationId: 'location',
  kind: 'AssetTemplate',
  status: 'Published',
  version: 3,
  data: { locationId: 'location', name: 'Synthetic package', items: [item] },
};
const policy = {
  id: 'policy',
  locationId: 'location',
  kind: 'OperatingPolicy',
  status: 'Draft',
  version: 2,
  data: {
    locationId: 'location',
    title: 'Synthetic rules',
    content: 'Preserved rule text',
    effectiveFrom: '2026-12-01',
  },
};
function reads(path: string) {
  if (path.includes('/asset-catalog?')) return { items: [], total: 0 };
  if (path.endsWith('/asset-count-observations')) return [];
  if (path.endsWith('/configuration')) return { canEdit: true };
  if (path.endsWith('/room-defaults')) return [];
  if (path.endsWith('/rooms')) return [{ id: 'room', label: 'A101' }];
  if (path.includes('asset-templates?')) return [template];
  if (path.includes('/asset-inventory'))
    return {
      physical: [],
      desired: [
        {
          id: 'desired',
          locationId: 'location',
          kind: 'DesiredAssets',
          status: 'PendingVerification',
          version: 4,
          data: {
            templateId: 'template',
            templateVersion: 3,
            roomId: 'room',
            items: [item],
            status: 'PendingVerification',
          },
        },
      ],
      currentDesiredId: 'desired',
      assignmentVersion: 7,
      assignedTemplateId: 'template',
      metadata: {},
    };
  if (path.includes('operating-policies?')) return [policy];
  if (path.endsWith('/versions')) return [policy];
  return undefined;
}
beforeEach(() => {
  vi.resetAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method
      ? { assetId: 'physical', objectKey: 'setup/location/evidence/synthetic' }
      : reads(path),
  );
});
afterEach(cleanup);
function mount(child: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {child}
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

it('configures shared-area assets once per Location, inherits sample unit and edits/removes individual rows', async () => {
  let items: SetupCommonAssetRequirement[] = [];
  let version = 0;
  const writes: { items: SetupCommonAssetRequirement[]; expectedVersion: number }[] = [];
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes('/asset-catalog?'))
      return {
        items: [
          {
            id: 'pump',
            name: 'Máy bơm',
            data: { category: 'Thiết bị', unit: 'Bộ', scope: 'Location' },
          },
          { id: 'bed', name: 'Giường', data: { category: 'Nội thất', unit: 'Cái', scope: 'Room' } },
        ],
        total: 2,
      };
    if (path.endsWith('/common-asset-requirements')) {
      if (init?.method === 'PUT') {
        const input = JSON.parse(String(init.body));
        expect(input.expectedVersion).toBe(version);
        writes.push(input);
        items = input.items;
        version++;
      }
      return version
        ? {
            id: 'common',
            locationId: 'location',
            kind: 'CommonAssetRequirements',
            status: 'Recorded',
            version,
            data: { items },
          }
        : null;
    }
    throw new Error(`Unexpected ${path}`);
  });
  mount(<CommonAssetRequirementsPanel locationId="location" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm tài sản chung' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.mouseDown(dialog.getByRole('combobox', { name: /Chọn từ tài sản mẫu/ }));
  expect(screen.queryByRole('option', { name: 'Giường' })).toBeNull();
  fireEvent.click(await screen.findByRole('option', { name: 'Máy bơm' }));
  expect(dialog.getByLabelText(/Tên tài sản/)).toHaveValue('Máy bơm');
  expect(dialog.getByRole('combobox', { name: /Đơn vị/ })).toHaveTextContent('Bộ');
  fireEvent.change(dialog.getByLabelText(/Khu vực sử dụng/), { target: { value: 'Khu kỹ thuật' } });
  fireEvent.change(dialog.getByLabelText(/Số lượng/), { target: { value: '2' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Lưu tài sản chung' }));
  await screen.findByText('Khu kỹ thuật');
  expect(writes[0].items[0]).toMatchObject({
    name: 'Máy bơm',
    quantity: 2,
    unit: 'Bộ',
    commonArea: 'Khu kỹ thuật',
  });
  const id = writes[0].items[0].id;
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa Máy bơm' }));
  fireEvent.change(screen.getByLabelText(/Số lượng/), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tài sản chung' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].items[0]).toMatchObject({ id, quantity: 3, unit: 'Bộ' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bỏ Máy bơm' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ Máy bơm' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }));
  await screen.findByText(/Chưa cấu hình tài sản chung/);
  expect(writes[2]).toEqual({ items: [], expectedVersion: 2 });
  expect(state.request.mock.calls.some(([path]) => path === '/api/v1/assets')).toBe(false);
});

async function room() {
  fireEvent.mouseDown(await screen.findByLabelText('Phòng kiểm kê'));
  fireEvent.click(await screen.findByRole('option', { name: 'A101' }));
  await screen.findByText('Tài sản được cấu hình');
}

it('publishes a local Draft using its loaded version and shows per-Room sync outcomes', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/publish'))
      return {
        templateId: 'template',
        templateVersion: 4,
        rooms: [
          { roomId: 'room', status: 'Applied' },
          { roomId: 'other', status: 'SkippedNotEligible' },
        ],
      };
    return path.includes('asset-templates?') ? [{ ...template, status: 'Draft' }] : reads(path);
  });
  mount(<LocalAssetSetup locationId="location" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Công bố bộ mẫu' }));
  await screen.findByText(/A101: Đã cập nhật định mức/);
  await screen.findByText(/Chưa đủ điều kiện đồng bộ/);
  expect(state.request).toHaveBeenCalledWith('/api/v1/asset-templates/template/publish', {
    method: 'POST',
    body: JSON.stringify({ expectedVersion: 3 }),
  });
  expect(
    state.request.mock.calls.some(
      ([path, init]) => path === '/api/v1/assets' && init?.method === 'POST',
    ),
  ).toBe(false);
});
it('keeps the legacy room inventory workflow out of the Owner view', async () => {
  mount(<LocalAssetSetup locationId="location" mode="inventory" />);
  expect(
    await screen.findByText(/Owner xác nhận kiểm kê theo danh sách tài sản đã cấu hình/),
  ).toBeVisible();
  expect(screen.queryByLabelText('Phòng kiểm kê')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gán bộ mẫu cho phòng' })).toBeNull();
  expect(state.request.mock.calls.some(([path]) => path.includes('/asset-inventory'))).toBe(false);
});

it('edits the existing type requirements and applies only to the chosen type through the scoped API', async () => {
  const roomDefaults = {
    id: 'type',
    locationId: 'location',
    kind: 'RoomDefaults',
    status: 'Recorded',
    version: 5,
    data: {
      name: 'Studio',
      assetTemplateId: template.id,
      defaults: { capacity: 2, area: 20, amenities: [], referenceRent: '3000000' },
    },
  };
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/room-defaults')) return [roomDefaults];
    if (path.endsWith('/asset-requirements') && init?.method === 'POST')
      return {
        defaults: { ...roomDefaults, version: 6 },
        template,
        rooms: [
          { roomId: 'room', status: 'Applied' },
          { roomId: 'occupied', status: 'SkippedNotEligible' },
        ],
      };
    return reads(path);
  });
  mount(<LocalAssetSetup locationId="location" mode="templates" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa tài sản Studio' }));
  fireEvent.change(screen.getByLabelText(/Số lượng 1/), { target: { value: '3' } });
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Áp dụng cho các phòng hiện có thuộc loại này' }),
  );
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), {
    target: { value: 'Updated requirements' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu và áp dụng' }));
  await screen.findByText(/1 phòng đã áp dụng · 1 bỏ qua/);
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/locations/location/room-defaults/type/asset-requirements',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 5,
        items: [{ ...item, quantity: 3 }],
        applyToExistingRooms: true,
        reason: 'Updated requirements',
      }),
    },
  );
  expect(
    state.request.mock.calls.some(
      ([path, init]) =>
        init?.method && (path.includes('/asset-templates/') || path === '/api/v1/assets'),
    ),
  ).toBe(false);
});
it('uploads private evidence and retries ambiguous verification with the same evidence and desired version', async () => {
  state.roles = ['Staff'];
  let attempts = 0;
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/setup-evidence')) return { objectKey: 'setup/location/evidence/synthetic' };
    if (path.endsWith('/verify')) {
      if (++attempts === 1) throw new ApiError(0);
      return { assetId: 'physical' };
    }
    return reads(path);
  });
  mount(<LocalAssetSetup locationId="location" />);
  await room();
  fireEvent.change(screen.getByLabelText(/Mã tài sản kiểm kê/), { target: { value: 'CHAIR-01' } });
  fireEvent.change(screen.getByLabelText(/Tình trạng kiểm kê/), { target: { value: 'Good' } });
  const file = new File(['synthetic-evidence'], 'synthetic.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Ảnh bằng chứng'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã kiểm tra tài sản thực tế' }));
  await screen.findByText(/Chưa hoàn thành yêu cầu/);
  expect(screen.queryByText('Máy chủ đã xác nhận kiểm kê tài sản.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã kiểm tra tài sản thực tế' }));
  await screen.findByText('Máy chủ đã xác nhận kiểm kê tài sản.');
  expect(
    state.request.mock.calls.filter(([path]) => path.endsWith('/setup-evidence')),
  ).toHaveLength(1);
  const writes = state.request.mock.calls.filter(([path]) => path.endsWith('/verify'));
  expect(writes).toHaveLength(2);
  expect(writes[0][1].body).toBe(writes[1][1].body);
  expect(JSON.parse(writes[0][1].body)).toMatchObject({
    templateId: 'template',
    itemId: 'item',
    expectedVersion: 4,
    evidenceObjectKey: 'setup/location/evidence/synthetic',
  });
});
it('hides template management from Staff while keeping the scoped inventory entry point', async () => {
  state.roles = ['Staff'];
  mount(<LocalAssetSetup locationId="location" />);
  await screen.findByLabelText('Phòng kiểm kê');
  expect(screen.queryByRole('button', { name: 'Tạo danh sách tài sản phòng' })).toBeNull();
  expect(state.request.mock.calls.some(([path]) => path.includes('asset-templates'))).toBe(false);
});
it('records a physical shortage without creating or retiring physical assets', async () => {
  state.roles = ['Staff'];
  mount(<LocalAssetSetup locationId="location" mode="inventory" />);
  await room();
  fireEvent.click(await screen.findByRole('button', { name: /^Kiểm đếm$/ }));
  const dialog = await screen.findByRole('dialog', { name: /Ghi nhận số lượng/ });
  fireEvent.change(within(dialog).getByLabelText(/Số lượng đếm được/), { target: { value: '0' } });
  expect(within(dialog).getByText(/Thiếu 2/)).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText('Ảnh bằng chứng'), {
    target: { files: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })] },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu kết quả kiểm đếm' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/rooms/room/asset-count-observations/item',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          desiredId: 'desired',
          desiredVersion: 4,
          quantity: 0,
          evidenceObjectKey: 'setup/location/evidence/synthetic',
          note: '',
          expectedVersion: 0,
        }),
      }),
    ),
  );
  expect(
    state.request.mock.calls.some(
      ([path, init]) => init?.method && (path === '/api/v1/assets' || path.endsWith('/verify')),
    ),
  ).toBe(false);
});
it('publishes OperatingPolicy without overwriting a Contract and requests policy-specific history', async () => {
  mount(<OperatingPoliciesPanel locationId="location" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lịch sử sửa đổi' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/operating-policies/policy/versions',
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Công bố nội quy' }));
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/publish'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await screen.findByText('Máy chủ đã công bố nội quy. Hợp đồng đã ký được giữ nguyên.');
  expect(state.request).toHaveBeenCalledWith('/api/v1/operating-policies/policy/publish', {
    method: 'POST',
    body: JSON.stringify({ expectedVersion: 2 }),
  });
  expect(
    state.request.mock.calls.some(([path, init]) => path.includes('/contracts/') && init?.method),
  ).toBe(false);
});
it('retains edited policy content after a stale-version rejection', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') throw new ApiError(409, { code: 'stale_version' });
    return reads(path);
  });
  mount(<OperatingPoliciesPanel locationId="location" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa nội quy nháp' }));
  fireEvent.change(screen.getByLabelText(/Nội dung nội quy/), {
    target: { value: 'Reviewed content' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nội quy nháp' }));
  await screen.findByText(/Cấu hình đã thay đổi/);
  expect(screen.getByLabelText(/Nội dung nội quy/)).toHaveValue('Reviewed content');
  expect(screen.queryByText('Máy chủ đã lưu bản nháp nội quy.')).toBeNull();
});
it('updates physical metadata with its own document version and exact purchase cost', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { version: 6 };
    if (path.startsWith('/api/v1/incidents?') || path.startsWith('/api/v1/work-orders?'))
      return { items: [], page: 1, pageSize: 10, totalCount: 0 };
    if (path.endsWith('/metadata'))
      return {
        id: 'physical',
        version: 5,
        data: {
          trackingMode: 'Serialized',
          quantity: 1,
          purchaseCost: '9007199254740993',
          purchaseDate: null,
          usefulLifeMonths: null,
        },
      };
    return [];
  });
  mount(
    <AssetOperationsPanel
      asset={{
        id: 'physical',
        locationId: 'location',
        roomId: 'room',
        commonArea: null,
        code: 'CHAIR-01',
        name: 'Synthetic chair',
        category: 'Furniture',
        condition: 'Good',
        status: 0,
        version: 9,
      }}
      onClose={vi.fn()}
    />,
  );
  await screen.findByLabelText('Giá mua VND');
  expect(screen.queryByLabelText('Cách quản lý')).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Số lượng thực tế/)).toBeEnabled();
  fireEvent.change(screen.getByLabelText(/Số lượng thực tế/), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText(/Lý do cập nhật tài sản/), {
    target: { value: 'Synthetic metadata check' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thông tin tài sản' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('/api/v1/assets/physical/metadata', {
      method: 'PUT',
      body: JSON.stringify({
        metadata: {
          trackingMode: 'BulkQuantity',
          quantity: 4,
          purchaseCost: '9007199254740993',
          purchaseDate: null,
          usefulLifeMonths: null,
        },
        expectedVersion: 5,
        reason: 'Synthetic metadata check',
      }),
    }),
  );
});
