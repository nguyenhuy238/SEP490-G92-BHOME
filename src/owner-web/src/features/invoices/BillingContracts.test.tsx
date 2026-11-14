import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoiceClient, type PolicyInput } from '../../../../../packages/client-core/src/invoices';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { theme } from '../../theme/theme';
import { BillingConfigurationPage } from './BillingConfigurationPage';

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./useInvoiceApi', () => ({
  useInvoiceApi: () => ({ request: state.request, ...client() }),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
function client() {
  return invoiceClient(
    <T,>(path: string, init?: RequestInit) => state.request(path, init) as Promise<T>,
  );
}
const input: PolicyInput = {
  locationId: 'location',
  roomId: null,
  category: 0,
  chargeCode: 'RENT',
  name: 'Synthetic rent',
  method: 0,
  rate: '12345678901234.1234',
  effectiveFrom: '2026-12-01',
  effectiveTo: null,
  reason: 'Synthetic approval',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.request.mockResolvedValue({ id: 'policy' });
});
afterEach(cleanup);

it.each([null, 'room'])(
  'serializes the exact strict BillingPolicy payload for scope %s without losing decimals',
  async (roomId) => {
    await client().createPolicy({
      ...input,
      roomId,
      roomTypeId: null,
      obsolete: true,
    } as PolicyInput);
    expect(state.request).toHaveBeenCalledWith('/api/v1/billing-policies', {
      method: 'POST',
      body: JSON.stringify({ ...input, roomId }),
    });
    expect(JSON.parse(state.request.mock.calls[0][1].body).rate).toBe(input.rate);
  },
);

it('serializes replacement with the source concurrency version and no obsolete fields', async () => {
  await client().replacePolicy('policy', { ...input, roomId: 'room' }, 7);
  expect(state.request).toHaveBeenCalledWith('/api/v1/billing-policies/policy/replacement', {
    method: 'POST',
    body: JSON.stringify({ policy: { ...input, roomId: 'room' }, expectedVersion: 7 }),
  });
});

function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <BillingConfigurationPage />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
async function fillForm(room = false) {
  fireEvent.mouseDown(await screen.findByLabelText('Cơ sở cấu hình'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic Location' }));
  await screen.findByLabelText(/Tên khoản thu/);
  if (room) {
    fireEvent.mouseDown(screen.getByLabelText('Phạm vi biểu giá'));
    fireEvent.click(await screen.findByRole('option', { name: 'Phòng A101' }));
  }
  fireEvent.change(screen.getByLabelText(/Tên khoản thu/), {
    target: { value: 'Synthetic electricity' },
  });
  fireEvent.change(screen.getByLabelText(/Đơn giá VND/), { target: { value: '3.000,1250' } });
  fireEvent.change(screen.getByLabelText(/Hiệu lực từ ngày/), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText(/Lý do \/ ghi chú/), {
    target: { value: 'Synthetic approval' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu biểu giá' }));
}
function serveReads(failure?: number) {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (failure) throw new ApiError(failure, { status: failure, title: 'Synthetic rejection' });
      return { id: 'policy' };
    }
    if (path === '/api/v1/capture/locations')
      return [{ id: 'location', label: 'Synthetic Location' }];
    if (path.endsWith('/rooms')) return [{ id: 'room', label: 'Phòng A101' }];
    if (path.includes('/billing-policies?')) return { items: [], totalCount: 0 };
    return undefined;
  });
}
it.each([false, true])(
  'posts the actual pricing form through the strict client with room scope %s',
  async (room) => {
    serveReads();
    mount();
    await fillForm(room);
    await waitFor(() =>
      expect(state.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const [, init] = state.request.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({
      locationId: 'location',
      roomId: room ? 'room' : null,
      category: 1,
      chargeCode: 'ELECTRICITY',
      name: 'Synthetic electricity',
      method: 1,
      rate: '3000.1250',
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      reason: 'Synthetic approval',
    });
  },
);

it.each([400, 409])(
  'keeps rejected values and shows server rejection %s without claiming success',
  async (status) => {
    serveReads(status);
    mount();
    await fillForm();
    await screen.findByText(
      status === 409 ? /Cấu hình đã thay đổi hoặc bị xung đột/ : /Dữ liệu chưa hợp lệ/,
    );
    expect(screen.getByLabelText(/Đơn giá VND/)).toHaveValue('3.000,1250');
    expect(screen.queryByText('Đã lưu cấu hình.')).toBeNull();
  },
);
