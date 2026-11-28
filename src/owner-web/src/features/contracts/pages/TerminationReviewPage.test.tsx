import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TerminationReview } from '../../../../../../packages/client-core/src/contracts';
import TerminationReviewPage from './TerminationReviewPage';

const api = vi.hoisted(() => ({ terminationReview: vi.fn(), mutate: vi.fn() }));
vi.mock('../hooks/useContractsApi', () => ({ useContractsApi: () => api }));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));

const id = 'bc050000-0000-4000-8000-000000004003';
const request: TerminationReview = {
  status: 'Requested',
  version: 1,
  locationName: 'Hòa Lạc',
  roomNumber: 'P.101',
  tenantName: 'Người thuê A',
  startDate: '2026-11-20',
  endDate: '2027-05-20',
  proposedDate: '2026-11-24',
  reason: 'Chuyển địa điểm làm việc',
  decidedAt: null,
  decidedBy: null,
  rejectionReason: null,
};
const decided = { decidedAt: '2026-11-21T10:00:00Z', decidedBy: 'Owner A' };

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/contracts/${id}/termination-review`]}>
        <Routes>
          <Route
            path="/contracts/:contractId/termination-review"
            element={<TerminationReviewPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.terminationReview.mockResolvedValue(request);
});

it('shows the request details and confirms acceptance exactly once', async () => {
  open();
  expect(await screen.findByText('Chờ phê duyệt')).toBeTruthy();
  for (const text of [
    'Hòa Lạc',
    'P.101',
    'Người thuê A',
    '20/11/2026 – 20/05/2027',
    '24/11/2026',
    request.reason,
  ]) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  expect(screen.queryByText(/quyết toán|biên bản|công nợ/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chấp nhận yêu cầu' }));
  expect(api.mutate).not.toHaveBeenCalled();
  api.mutate.mockImplementation(async () => {
    api.terminationReview.mockResolvedValue({ ...request, ...decided, status: 'Approved' });
    return { status: 'Approved', version: 2 };
  });
  const confirm = within(screen.getByRole('dialog')).getByRole('button', {
    name: 'Xác nhận chấp nhận',
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(await screen.findByText('Owner A')).toBeTruthy();
  expect(screen.getByText('Đã chấp nhận')).toBeTruthy();
  expect(api.mutate).toHaveBeenCalledExactlyOnceWith(
    id,
    'move-out/approve?expectedVersion=1',
    {},
    expect.any(String),
  );
  expect(screen.queryByRole('button', { name: 'Chấp nhận yêu cầu' })).toBeNull();
});

it('requires a reason and displays the persisted rejection after reopening', async () => {
  const view = open();
  fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
  const dialog = within(screen.getByRole('dialog'));
  const confirm = dialog.getByRole<HTMLButtonElement>('button', { name: 'Xác nhận từ chối' });
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: '   ' } });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(api.mutate).not.toHaveBeenCalled();
  api.mutate.mockImplementation(async () => {
    api.terminationReview.mockResolvedValue({
      ...request,
      ...decided,
      status: 'Rejected',
      rejectionReason: 'Cần trao đổi thêm',
    });
    return { status: 'Rejected', version: 2 };
  });
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: ' Cần trao đổi thêm ' } });
  fireEvent.click(confirm);
  expect(await screen.findByText('Cần trao đổi thêm')).toBeTruthy();
  expect(api.mutate).toHaveBeenCalledExactlyOnceWith(
    id,
    'move-out/reject',
    { reason: 'Cần trao đổi thêm', expectedVersion: 1 },
    expect.any(String),
  );
  view.unmount();
  open();
  expect(await screen.findByText('Đã từ chối')).toBeTruthy();
  expect(screen.getByText('Owner A')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Từ chối' })).toBeNull();
});

it('refreshes a competing decision when the API returns a conflict', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Chấp nhận yêu cầu' }));
  api.mutate.mockImplementation(async () => {
    api.terminationReview.mockResolvedValue({ ...request, ...decided, status: 'Approved' });
    throw { status: 409 };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chấp nhận' }));
  expect(await screen.findByText(/Yêu cầu đã thay đổi/)).toBeTruthy();
  expect(screen.getByText('Đã chấp nhận')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Chấp nhận yêu cầu' })).toBeNull();
});
