import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { OwnerMoveOutInbox } from './OwnerMoveOutInbox';

const mocks = vi.hoisted(() => ({
  transport: vi.fn(),
  locations: vi.fn(),
}));

vi.mock('../contracts/useContractsApi', () => ({
  useContractsApi: () => ({ transport: mocks.transport, locations: mocks.locations }),
}));
vi.mock('./OwnerMoveOutReviewPanel', () => ({
  OwnerMoveOutReviewPanel: ({ id }: { id: string }) => <div>Kết quả kiểm kê {id}</div>,
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));

function mount(path = '/handovers?tab=move-out') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <OwnerMoveOutInbox />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.transport.mockReset().mockResolvedValue({
    items: [
      {
        contractId: 'contract-1',
        roomNumber: 'P.101',
        locationId: 'location-1',
        locationName: 'Cơ sở Trường Vũ',
        proposedDate: '2026-11-30',
        status: 'Inspected',
        proposalStatus: null,
        proposalSettlementStatus: null,
      },
    ],
    page: 1,
    pageSize: 20,
    totalCount: 1,
  });
  mocks.locations.mockReset().mockResolvedValue([{ id: 'location-1', label: 'Trường Vũ' }]);
});

it('loads the authorized MoveOut queue, opens its detail and preserves the contract link', async () => {
  mount();
  expect(await screen.findByText('1 yêu cầu trả phòng phù hợp')).toBeInTheDocument();
  expect(mocks.transport).toHaveBeenCalledWith(
    '/api/v1/contracts/move-out-inbox?page=1&pageSize=20',
    { signal: expect.any(AbortSignal) },
  );
  expect((await screen.findAllByText('Chờ Owner gửi phí')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem kết quả' })[0]);
  expect(await screen.findByText('Kết quả kiểm kê contract-1')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở hồ sơ hợp đồng' })).toHaveAttribute(
    'href',
    '/contracts?contractId=contract-1',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết trả phòng' }));
  expect(screen.queryByText('Kết quả kiểm kê contract-1')).not.toBeInTheDocument();
});

it.each([
  ['PendingTenant', null, 'Chờ Tenant xác nhận phí'],
  ['Disputed', null, 'Tenant yêu cầu điều chỉnh phí'],
  ['Accepted', 'PendingOwnerReview', 'Tenant đã đồng ý · Đang đối chiếu'],
  ['Accepted', 'Payable', 'Tenant đã đồng ý · Đã tạo khoản phải thu'],
  ['Accepted', 'RefundEligible', 'Tenant đã đồng ý · Có tiền cọc cần hoàn'],
  ['Accepted', 'Settled', 'Đã quyết toán phí trả phòng'],
] as const)(
  'shows the actual Tenant financial step in the inbox for %s / %s',
  async (proposalStatus, proposalSettlementStatus, label) => {
    mocks.transport.mockResolvedValue({
      items: [{
        contractId: 'contract-1',
        roomNumber: 'TEST-9A0205575A',
        locationId: 'location-1',
        locationName: 'Cơ sở Test',
        proposedDate: '2026-11-22',
        status: 'Inspected',
        proposalStatus,
        proposalSettlementStatus,
      }],
      page: 1,
      pageSize: 20,
      totalCount: 1,
    });
    mount();
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Đã có kết quả Staff')).not.toBeInTheDocument();
  },
);

it('recovers the accepted fee status from the existing proposal API while the inbox API is still old', async () => {
  const oldInbox = {
    items: [{
      contractId: 'contract-1',
      roomNumber: 'TEST-9A0205575A',
      locationId: 'location-1',
      locationName: 'Cơ sở Test',
      proposedDate: '2026-11-22',
      status: 'Inspected',
    }],
    page: 1,
    pageSize: 20,
    totalCount: 1,
  };
  mocks.transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-out/receivables/proposal')
      ? {
          status: 'Accepted',
          latestProposal: {
            tenantFeedback: {
              confirmed: true,
              settlement: { status: 'Payable' },
            },
          },
        }
      : oldInbox,
  );
  mount();
  expect((await screen.findAllByText('Tenant đã đồng ý · Đã tạo khoản phải thu')).length)
    .toBeGreaterThan(0);
  expect(mocks.transport).toHaveBeenCalledWith(
    '/api/v1/contracts/contract-1/move-out/receivables/proposal',
    { signal: expect.any(AbortSignal) },
  );
  expect(screen.queryByText('Đã có kết quả Staff')).not.toBeInTheDocument();
});

it('opens an authorized contract deep link even when that contract is outside the current list page', async () => {
  mount('/handovers?tab=move-out&contractId=contract-on-another-page');
  expect(await screen.findByText('Kết quả kiểm kê contract-on-another-page')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở hồ sơ hợp đồng' })).toHaveAttribute(
    'href',
    '/contracts?contractId=contract-on-another-page',
  );
});

it('filters the server-side queue by location/status and exposes location-load failure', async () => {
  mount();
  await screen.findByText('1 yêu cầu trả phòng phù hợp');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái trả phòng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Đã có kết quả Staff' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/move-out-inbox?page=1&pageSize=20&status=Inspected',
      { signal: expect.any(AbortSignal) },
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(screen.getByRole('option', { name: 'Trường Vũ' }));
  await waitFor(() =>
    expect(mocks.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/move-out-inbox?page=1&pageSize=20&locationId=location-1&status=Inspected',
      { signal: expect.any(AbortSignal) },
    ),
  );
});

it('explains failed location loading instead of silently hiding location filter options', async () => {
  mocks.locations.mockRejectedValueOnce(new Error('Network offline'));
  mount();
  expect(await screen.findByText(/Không tải được danh sách cơ sở/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(mocks.locations).toHaveBeenCalledTimes(2));
});
