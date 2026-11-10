import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MainDraftReleasePanel } from './MainDraftReleasePanel';
import type { MainDraftView } from '../../../../../packages/client-core/src/mainDrafts';
const mock = vi.hoisted(() => ({
  signingReview: vi.fn(),
  file: vi.fn(),
  release: vi.fn(),
  tenantAccounts: vi.fn(),
}));
vi.mock('./useContractsApi', () => ({ useMainDraftApi: () => mock, useContractsApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const draft = { id: 'draft', status: 'Draft', version: 3 } as MainDraftView;
beforeEach(() => {
  vi.resetAllMocks();
  mock.tenantAccounts.mockResolvedValue([{ id: 'tenant', label: 'Tenant tổng hợp' }]);
  mock.signingReview.mockResolvedValue({ id: 'review', developmentOnly: true });
  mock.file.mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:reviewed');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
function mount(disabled = false, onReleased = vi.fn()) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MainDraftReleasePanel draft={draft} disabled={disabled} onReleased={onReleased} />
    </QueryClientProvider>,
  );
  return onReleased;
}
async function review() {
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Tài khoản Tenant đại diện' })).not.toBeDisabled(),
  );
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Tài khoản Tenant đại diện' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Tenant tổng hợp' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tạo và xem PDF đưa đi ký' }));
  await screen.findByTitle('PDF được chọn để đưa đi ký');
  fireEvent.click(screen.getByRole('checkbox'));
}
it('requires the saved PDF and human review, submits its exact version and blocks duplicate releases', async () => {
  let finish!: (value: { id: string }) => void;
  mock.release.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onReleased = mount();
  expect(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' })).toBeDisabled();
  await review();
  expect(mock.file).toHaveBeenCalledWith('draft', 'review');
  expect(screen.getByText(/Tài liệu kiểm thử; mẫu chưa được duyệt/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' }));
  expect(mock.release).toHaveBeenCalledTimes(1);
  expect(mock.release).toHaveBeenCalledWith(
    'draft',
    { tenantUserId: 'tenant', expectedVersion: 3, reviewedFileId: 'review', humanReviewed: true },
    expect.any(String),
  );
  expect(onReleased).not.toHaveBeenCalled();
  await act(async () => finish({ id: 'draft' }));
  expect(onReleased).toHaveBeenCalledOnce();
});
it('preserves the release key across a network failure and waits for successful persistence', async () => {
  mock.release.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({ id: 'draft' });
  const done = mount();
  await review();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' }));
  await waitFor(() => expect(mock.release).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' })).not.toBeDisabled(),
  );
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(mock.release.mock.calls[0][2]).toBe(mock.release.mock.calls[1][2]);
});
it('blocks unsaved inputs', async () => {
  const mounted = mount(true);
  expect(screen.getByRole('button', { name: 'Tạo và xem PDF đưa đi ký' })).toBeDisabled();
  expect(mounted).not.toHaveBeenCalled();
});
it('releases a reviewed PDF for a new resident without creating or requiring an account', async () => {
  mock.tenantAccounts.mockResolvedValue([]);
  mock.release.mockResolvedValue({ id: 'draft' });
  const done = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo và xem PDF đưa đi ký' }));
  await screen.findByTitle('PDF được chọn để đưa đi ký');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(mock.release).toHaveBeenCalledWith(
    'draft',
    {
      tenantUserId: null,
      expectedVersion: 3,
      reviewedFileId: 'review',
      humanReviewed: true,
    },
    expect.any(String),
  );
});
it('shows a blocked template without fabricating a review file', async () => {
  mock.signingReview.mockRejectedValue({
    status: 503,
    code: 'main_draft_signing_template_not_approved',
  });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo và xem PDF đưa đi ký' }));
  await screen.findByText(
    'Mẫu này chỉ được phép kiểm thử. Chưa có mẫu hợp đồng được duyệt cho production.',
  );
  expect(mock.file).not.toHaveBeenCalled();
  expect(screen.queryByTitle('PDF được chọn để đưa đi ký')).not.toBeInTheDocument();
});
