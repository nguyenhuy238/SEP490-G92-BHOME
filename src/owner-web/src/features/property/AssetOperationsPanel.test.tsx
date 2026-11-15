import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  propertySetupClient,
  type PhysicalAsset,
} from '../../../../../packages/client-core/src/propertySetup';
import { theme } from '../../theme/theme';
import { AssetOperationsPanel } from './AssetOperationsPanel';

const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
vi.mock('./usePropertySetupApi', () => ({
  usePropertySetupApi: () => propertySetupClient(state.request),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: state.roles } }),
}));

const asset: PhysicalAsset = {
  id: 'asset-group',
  locationId: 'location',
  roomId: 'room',
  commonArea: null,
  code: 'CHAIR-01',
  name: 'Ghế phòng 101',
  category: 'Furniture',
  condition: 'Tốt',
  status: 0,
  version: 3,
  quantity: 4,
  unit: 'Cái',
};
const incidentPath = (page = 1) =>
  `/api/v1/incidents?locationId=location&assetId=asset-group&page=${page}&pageSize=10`;
const workPath = (page = 1) =>
  `/api/v1/work-orders?locationId=location&assetId=asset-group&page=${page}&pageSize=10`;
const pageResult = (items: unknown[] = [], page = 1, totalCount = items.length) => ({
  items,
  page,
  pageSize: 10,
  totalCount,
});
const report = (id: string, code: string) => ({
  id,
  code,
  assetId: asset.id,
  locationId: asset.locationId,
  roomId: asset.roomId,
  status: 'InProgress',
  description: 'Ghế bị lỏng chân',
  createdAt: '2026-11-14T17:30:00Z',
});
const work = {
  id: 'work-1',
  incidentId: null,
  assetId: asset.id,
  locationId: asset.locationId,
  roomId: asset.roomId,
  source: 'Proactive',
  status: 'Verified',
  expectedOutcome: 'Kiểm tra và siết chân ghế',
  description: 'Kiểm tra định kỳ',
  verifiedAt: '2026-11-15T02:00:00Z',
  targetCompletionAt: '2026-11-15T06:00:00Z',
};
function assetReads(path: string) {
  if (path.endsWith('/metadata'))
    return {
      id: asset.id,
      version: 1,
      data: {
        trackingMode: 'BulkQuantity',
        quantity: 4,
        unit: 'Cái',
        purchaseCost: null,
        purchaseDate: null,
        usefulLifeMonths: null,
      },
    };
  if (path.endsWith('/history')) return [];
  return pageResult();
}
function Destination() {
  const location = useLocation();
  return (
    <div>
      {location.pathname}
      {location.search}
    </div>
  );
}
function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/assets']}>
          <Routes>
            <Route
              path="/assets"
              element={<AssetOperationsPanel asset={asset} onClose={vi.fn()} />}
            />
            <Route path="/incidents" element={<Destination />} />
            <Route path="/maintenance" element={<Destination />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string) => assetReads(path));
});
afterEach(cleanup);

it('loads asset-scoped incident and work-order pages independently and opens the actual detail route', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path === incidentPath()) return pageResult([report('incident-1', 'INC-001')], 1, 11);
    if (path === incidentPath(2)) return pageResult([report('incident-2', 'INC-011')], 2, 11);
    if (path === workPath()) return pageResult([work], 1, 12);
    return assetReads(path);
  });
  mount();
  const incidents = within(screen.getByRole('region', { name: 'Báo cáo sự cố' }));
  const works = within(screen.getByRole('region', { name: 'Lệnh sửa chữa' }));
  expect(await incidents.findByText('INC-001')).toBeVisible();
  expect(incidents.getByText('Đang xử lý')).toBeVisible();
  expect(incidents.getByText('Ghế bị lỏng chân')).toBeVisible();
  expect(incidents.getByText(/Ngày báo cáo:.*15\/11\/2026/)).toBeVisible();
  expect(await works.findByText('Kiểm tra định kỳ')).toBeVisible();
  expect(works.getByText('Đã xác minh')).toBeVisible();
  expect(works.getByText('Bảo trì chủ động')).toBeVisible();
  expect(works.getByText(/Ngày xác minh:.*15\/11\/2026/)).toBeVisible();
  expect(works.getByRole('link', { name: 'Xem chi tiết lệnh sửa chữa' })).toHaveAttribute(
    'href',
    '/maintenance?locationId=location&workOrderId=work-1',
  );
  expect(state.request).toHaveBeenCalledWith(
    incidentPath(),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(state.request).toHaveBeenCalledWith(
    workPath(),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fireEvent.click(incidents.getByRole('button', { name: 'Trang sau' }));
  expect(await incidents.findByText('INC-011')).toBeVisible();
  expect(incidents.getByRole('button', { name: 'Trang sau' })).toBeDisabled();
  expect(works.getByText('Trang 1 · 12 bản ghi')).toBeVisible();
  expect(incidents.getByRole('link', { name: 'Xem chi tiết sự cố' })).toHaveAttribute(
    'href',
    '/incidents?locationId=location&incidentId=incident-2',
  );
  fireEvent.click(incidents.getByRole('link', { name: 'Xem chi tiết sự cố' }));
  expect(
    await screen.findByText('/incidents?locationId=location&incidentId=incident-2'),
  ).toBeVisible();
});

it('hides internal asset codes and IDs from the Owner summary', async () => {
  mount();
  expect(await screen.findByText('Ghế phòng 101')).toBeVisible();
  expect(screen.queryByText('CHAIR-01')).not.toBeInTheDocument();
  expect(screen.queryByText('asset-group')).not.toBeInTheDocument();
});

it('distinguishes empty, loading and a failed incident query; retry does not replace work-order results', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  let fail = true;
  state.request.mockImplementation(async (path: string) => {
    if (path === incidentPath()) {
      if (fail) throw new Error('Không thể tải báo cáo');
      return pending;
    }
    if (path === workPath()) return pageResult();
    return assetReads(path);
  });
  mount();
  const incidents = within(screen.getByRole('region', { name: 'Báo cáo sự cố' }));
  const works = within(screen.getByRole('region', { name: 'Lệnh sửa chữa' }));
  expect(await incidents.findByText('Không thể tải báo cáo')).toBeVisible();
  expect(
    incidents.queryByText('Chưa có báo cáo sự cố liên kết với tài sản.'),
  ).not.toBeInTheDocument();
  expect(await works.findByText('Chưa có lệnh sửa chữa liên kết với tài sản.')).toBeVisible();
  fail = false;
  fireEvent.click(incidents.getByRole('button', { name: 'Thử lại' }));
  expect(await incidents.findByRole('status', { name: 'Đang tải dữ liệu' })).toBeVisible();
  resolve(pageResult());
  expect(await incidents.findByText('Chưa có báo cáo sự cố liên kết với tài sản.')).toBeVisible();
});

it('does not request incident or maintenance history when a Staff user opens the asset', async () => {
  state.roles = ['Staff'];
  mount();
  expect(await screen.findByText('Chưa có lịch sử được ghi nhận.')).toBeVisible();
  expect(screen.getByText('CHAIR-01')).toBeVisible();
  expect(screen.getByText('asset-group')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Báo cáo sự cố' })).not.toBeInTheDocument();
  expect(
    state.request.mock.calls.every(
      ([path]) =>
        !path.startsWith('/api/v1/incidents?') && !path.startsWith('/api/v1/work-orders?'),
    ),
  ).toBe(true);
});
