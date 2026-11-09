import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { theme } from '../../theme/theme';
import { LocalAssetSetup } from './LocalAssetSetup';
import { OperatingPoliciesPanel } from './OperatingPoliciesPanel';
import { AssetOperationsPanel } from './AssetOperationsPanel';

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
async function room() {
  fireEvent.mouseDown(await screen.findByLabelText('Phòng kiểm kê'));
  fireEvent.click(await screen.findByRole('option', { name: 'A101' }));
  await screen.findByText('Định mức mong muốn');
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
  await screen.findByText(/A101: Đã tạo định mức/);
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
it('assigns a template with the server assignment version after reload', async () => {
  mount(<LocalAssetSetup locationId="location" />);
  await room();
  fireEvent.click(screen.getByRole('button', { name: 'Gán bộ mẫu cho phòng' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('/api/v1/rooms/room/asset-template', {
      method: 'PUT',
      body: JSON.stringify({ templateId: 'template', expectedVersion: 7 }),
    }),
  );
});
it('uploads private evidence and retries ambiguous verification with the same evidence and desired version', async () => {
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
  expect(screen.queryByRole('button', { name: 'Tạo bộ mẫu trang bị' })).toBeNull();
  expect(state.request.mock.calls.some(([path]) => path.includes('asset-templates'))).toBe(false);
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
  fireEvent.click(screen.getByRole('button', { name: 'Công bố nội quy' }));
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
    if (path.endsWith('/metadata'))
      return {
        id: 'physical',
        version: 5,
        data: {
          trackingMode: 'BulkQuantity',
          quantity: 2,
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
          quantity: 2,
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
