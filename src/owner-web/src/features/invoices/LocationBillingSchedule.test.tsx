import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { LocationBillingSchedule } from './LocationBillingSchedule';
import { businessToday } from '../../../../../packages/client-core/src/contracts';

const mocks = vi.hoisted(() => ({ request: vi.fn(), schedule: vi.fn() }));
vi.mock('./useInvoiceApi', () => ({ useInvoiceApi: () => mocks }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <LocationBillingSchedule location="loc" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue([]);
  mocks.schedule.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const labels = [
  'Ngày giao nhiệm vụ ghi số',
  'Ngày hạn ghi chỉ số',
  'Ngày lập hóa đơn nháp',
  'Ngày phát hành hóa đơn chính thức',
  'Ngày hạn thanh toán',
];
async function fill(days: number[]) {
  await screen.findByRole('spinbutton', { name: labels[0] });
  labels.forEach((name, i) =>
    fireEvent.change(screen.getByRole('spinbutton', { name }), {
      target: { value: String(days[i]) },
    }),
  );
}
it('saves only the five recurring dates and version tokens without a selectable starting period or calculation rules', async () => {
  mount();
  await fill([24, 26, 27, 28, 5]);
  expect(screen.getAllByRole('spinbutton')).toHaveLength(5);
  expect(screen.queryByLabelText(/Kỳ bắt đầu áp dụng|Mốc tham chiếu kỳ|Làm tròn/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình lịch' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([path, init]) =>
          path === '/api/v1/billing-automation/loc/schedule' && init?.method === 'PUT',
      ),
    ).toBe(true),
  );
  const [, init] = mocks.request.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(init.body)).toEqual({
    meterDay: 24,
    meterDueDay: 26,
    meterDueMonthOffset: 0,
    draftDay: 27,
    draftMonthOffset: 0,
    finalDay: 28,
    finalMonthOffset: 0,
    dueDay: 5,
    dueMonthOffset: 1,
    expectedVersion: 0,
    expectedBillingScheduleVersion: 0,
  });
});
it('rejects out-of-order milestones before saving', async () => {
  mount();
  await fill([24, 26, 25, 28, 5]);
  expect(screen.getByText('Lập hóa đơn nháp không được trước hạn ghi chỉ số.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lưu cấu hình lịch' })).toBeDisabled();
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  fireEvent.change(screen.getByRole('spinbutton', { name: labels[2] }), {
    target: { value: '27' },
  });
  expect(screen.getByRole('button', { name: 'Lưu cấu hình lịch' })).toBeEnabled();
});

it('offers only current and next period, and requires replacing a legacy two-period offset', async () => {
  mocks.schedule.mockResolvedValue({
    draftDay: 27,
    draftMonthOffset: 0,
    finalDay: 28,
    finalMonthOffset: 0,
    dueDay: 5,
    dueMonthOffset: 2,
    version: 1,
  });
  mount();
  await fill([24, 26, 27, 28, 5]);
  expect(screen.getByRole('button', { name: 'Lưu cấu hình lịch' })).toBeDisabled();
  expect(screen.getByText('Hạn thanh toán: chọn Trong kỳ hoặc Kỳ kế tiếp.')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Thời điểm hạn thanh toán' }));
  expect(screen.getByRole('option', { name: 'Trong kỳ' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Sau 2 kỳ' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Kỳ kế tiếp' }));
  expect(screen.getByRole('button', { name: 'Lưu cấu hình lịch' })).toBeEnabled();
});

it('keeps an inherited current plan immutable and previews the already scheduled next month', async () => {
  const [year, month] = businessToday().slice(0, 7).split('-').map(Number);
  const period = (delta: number) =>
    new Date(Date.UTC(year!, month! - 1 + delta, 1)).toISOString().slice(0, 10);
  const snapshot = JSON.stringify({
    draftDay: 27,
    draftMonthOffset: 0,
    finalDay: 28,
    finalMonthOffset: 0,
    dueDay: 5,
    dueMonthOffset: 1,
  });
  const common = {
    locationId: 'loc',
    enabled: true,
    authorizeAutomaticFinalization: true,
    meterDueDay: 26,
    meterDueMonthOffset: 0,
    billingSnapshot: snapshot,
    billingScheduleVersion: 1,
    timeZone: 'Asia/Ho_Chi_Minh',
  };
  mocks.schedule.mockResolvedValue({ version: 1 });
  mocks.request.mockResolvedValue([
    { ...common, id: 'later', version: 3, effectiveFrom: period(2), meterDay: 22 },
    { ...common, id: 'next', version: 2, effectiveFrom: period(1), meterDay: 23 },
    { ...common, id: 'inherited', version: 1, effectiveFrom: period(-1), meterDay: 24 },
  ]);
  mount();
  expect(await screen.findByRole('spinbutton', { name: labels[0] })).toHaveValue(23);
  expect(screen.getByText(/Lịch tháng đang chạy được giữ nguyên/)).toBeInTheDocument();
  expect(screen.getByText(/Có lịch đã lên trước từ kỳ/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('spinbutton', { name: labels[0] }), {
    target: { value: '21' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình lịch' }));
  await waitFor(() =>
    expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
  );
  const [, init] = mocks.request.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(init.body)).toMatchObject({
    meterDay: 21,
    expectedVersion: 3,
    expectedBillingScheduleVersion: 1,
  });
});
