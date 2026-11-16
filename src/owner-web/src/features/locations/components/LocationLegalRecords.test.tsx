import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocationLegalRecords } from './LocationLegalRecords';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../meters/useMeterApi', () => ({ useMeterApi: () => ({ request }) }));
beforeEach(() => request.mockReset());
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <LocationLegalRecords locationId="synthetic-location" />
    </QueryClientProvider>,
  );
}
it('shows an empty legal workspace and retains form data after a rejected save', async () => {
  request.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 20 });
  mount();
  expect(await screen.findByText('Chưa có hồ sơ pháp lý.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm hồ sơ' }));
  fireEvent.change(screen.getByLabelText(/Tên tài liệu/), { target: { value: 'Hồ sơ tổng hợp' } });
  request.mockRejectedValueOnce({ status: 409 });
  const form = screen.getByRole('button', { name: 'Lưu phiên bản' }).closest('form')!;
  fireEvent.submit(form);
  expect(await screen.findByText(/Dữ liệu đã thay đổi/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Tên tài liệu/)).toHaveValue('Hồ sơ tổng hợp');
});
it('shows a recoverable query error and reloads the server page', async () => {
  request
    .mockRejectedValueOnce({ status: 503 })
    .mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 20 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Chưa có hồ sơ pháp lý.')).toBeInTheDocument();
});
