import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { theme } from '../../theme/theme';
import { UtilityWorkspace } from './UtilityWorkspace';

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
const tariff = {
  id: 'tariff',
  version: 2,
  status: 'Verified',
  data: {
    locationId: 'location',
    utilityType: 0,
    supplier: 'Synthetic supplier',
    classification: 'Synthetic class',
    sourceReference: 'Synthetic source',
    effectiveFrom: '2026-11-01',
    effectiveTo: null,
    tiers: [{ through: null, rate: '3000.1250' }],
    rounding: 0,
    verified: true,
  },
};
const meter = {
  id: 'source',
  version: 1,
  data: {
    locationId: 'location',
    code: 'TOTAL-01',
    utilityType: 0,
    scope: 'Source',
    parentMeterId: null,
  },
};
const bill = {
  id: 'bill',
  version: 1,
  data: {
    locationId: 'location',
    meterId: 'source',
    utilityType: 0,
    period: '2026-11-01',
    consumption: '1200',
    amount: '9007199254740993',
    reference: 'SYN-BILL',
    evidenceObjectKey: 'setup/location/evidence/synthetic',
  },
};
function reads(path: string) {
  if (path.endsWith('/rooms')) return [{ id: 'room', label: 'A101' }];
  if (path.includes('utility-tariffs?')) return [tariff];
  if (path.includes('utility-source-meters?')) return [meter];
  if (path.includes('utility-source-bills?')) return [bill];
  return [];
}
beforeEach(() => {
  vi.resetAllMocks();
  state.roles = ['Owner'];
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    init?.method ? { id: 'created', objectKey: 'setup/location/evidence/synthetic' } : reads(path),
  );
});
afterEach(cleanup);
function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <UtilityWorkspace locationId="location" />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
async function select(label: string, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByLabelText(new RegExp(label)));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
}

it('creates an exact tiered tariff without browser charge calculation', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm biểu giá điện nước' }));
  fill('Nhà cung cấp', 'New supplier');
  fill('Nhóm áp dụng', 'Owner class');
  fill('Căn cứ giá do Owner kiểm tra', 'Owner source');
  fill('Biểu giá hiệu lực từ', '2026-12-01');
  fill('Đơn giá bậc 1', '1234.56789');
  fireEvent.click(screen.getByLabelText('Đã xác minh căn cứ giá'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu biểu giá điện nước' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('/api/v1/utility-tariffs', {
      method: 'POST',
      body: JSON.stringify({
        locationId: 'location',
        utilityType: 0,
        rounding: 0,
        supplier: 'New supplier',
        classification: 'Owner class',
        sourceReference: 'Owner source',
        effectiveFrom: '2026-12-01',
        effectiveTo: null,
        verified: true,
        tiers: [{ through: null, rate: '1234.56789' }],
      }),
    }),
  );
});
it('replaces a tariff through the immutable-source replacement route', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tạo biểu giá thay thế' }));
  fill('Biểu giá hiệu lực từ', '2026-12-01');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu biểu giá điện nước' }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path, init]) =>
          path === '/api/v1/utility-tariffs/tariff/replacement' && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  expect(state.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
it('sends all required utility profile flags and current Location/Room scope', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Cấu hình phòng' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Gán biểu giá cho phòng' }));
  await select('Phòng áp dụng biểu giá', 'A101');
  await select('Biểu giá áp dụng', /Synthetic supplier/);
  fill('Cấu hình phòng hiệu lực từ', '2026-12-01');
  fireEvent.click(screen.getByLabelText('Yêu cầu định mức miễn phí đã xác minh'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình điện nước phòng' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith('/api/v1/utility-profiles', {
      method: 'POST',
      body: JSON.stringify({
        locationId: 'location',
        roomId: 'room',
        utilityType: 0,
        tariffId: 'tariff',
        effectiveFrom: '2026-12-01',
        effectiveTo: null,
        requireQuota: true,
        requireReconciliation: false,
        expectedVersion: 0,
      }),
    }),
  );
});
it('retains exact bill amounts, evidence and idempotency key after an uncertain supplier-bill write', async () => {
  let attempts = 0;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/setup-evidence')) return { objectKey: 'setup/location/evidence/synthetic' };
    if (path === '/api/v1/utility-source-bills' && init?.method === 'POST') {
      if (++attempts === 1) throw new ApiError(0);
      return { id: 'created' };
    }
    return reads(path);
  });
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn nguồn & Đối soát' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm hóa đơn nhà cung cấp' }));
  await select('Công tơ tổng của hóa đơn', 'TOTAL-01');
  fill('Tháng hóa đơn nguồn', '2026-12');
  fill('Sản lượng trên hóa đơn nguồn', '123.0001');
  fill('Tổng tiền hóa đơn nguồn VND', '9007199254740993');
  fill('Số tham chiếu hóa đơn nhà cung cấp', 'SYN-NEW');
  fireEvent.change(screen.getByLabelText('Ảnh bằng chứng'), {
    target: { files: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu hóa đơn nhà cung cấp' }));
  await screen.findByText(/Chưa hoàn thành yêu cầu/);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu hóa đơn nhà cung cấp' }));
  await waitFor(() => expect(attempts).toBe(2));
  const calls = state.request.mock.calls.filter(
    ([path, init]) => path === '/api/v1/utility-source-bills' && init?.method === 'POST',
  );
  expect(calls[0][1]).toEqual(calls[1][1]);
  expect(
    state.request.mock.calls.filter(([path]) => path.endsWith('/setup-evidence')),
  ).toHaveLength(1);
  expect(JSON.parse(calls[1][1].body)).toMatchObject({
    amount: '9007199254740993',
    consumption: '123.0001',
    period: '2026-12-01',
    utilityType: 0,
  });
});
it('shows authoritative reconciliation preview and never saves until explicitly requested', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) =>
    path.endsWith('/preview')
      ? {
          sourceBillId: 'bill',
          sourceConsumption: '1200',
          roomConsumption: '100',
          commonConsumption: '10',
          variance: '1090',
          tolerance: '0',
          status: 'NeedsReview',
          reason: 'Review',
          inputsHash: 'synthetic',
        }
      : init?.method
        ? { id: 'reconciliation' }
        : reads(path),
  );
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn nguồn & Đối soát' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đối soát hóa đơn nguồn' }));
  fill('Sai lệch cho phép do Owner chọn', '0');
  fill('Lý do đối soát', 'Synthetic review');
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước đối soát' }));
  await screen.findByText(/Chênh lệch: 1.090/);
  expect(
    state.request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([path]) => path),
  ).toEqual(['/api/v1/utility-reconciliations/preview']);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu kết quả đối soát' }));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(([path]) => path === '/api/v1/utility-reconciliations'),
    ).toBe(true),
  );
});
it('does not load or offer utility configuration to Staff', () => {
  state.roles = ['Staff'];
  mount();
  expect(screen.getByText('Chỉ Owner được quản lý cấu hình điện nước.')).toBeInTheDocument();
  expect(state.request).not.toHaveBeenCalled();
});
