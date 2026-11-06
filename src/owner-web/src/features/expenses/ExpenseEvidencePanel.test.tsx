import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExpenseEvidencePanel } from './ExpenseEvidencePanel';
const api = vi.hoisted(() => ({
  expenseEvidence: vi.fn(),
  uploadExpenseEvidence: vi.fn(),
  expenseEvidenceFile: vi.fn(),
}));
vi.mock('./useFinanceApi', () => ({ useFinanceApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const bytes = new Uint8Array([1, 2, 3]);
const evidence = {
  id: 'file',
  operationKey: '00000000-0000-0000-0000-000000000001',
  status: 'Uploaded',
  contentType: 'image/png',
  length: 3,
  sha256: '',
  recordedAt: '2026-11-06T01:00:00Z',
};
beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');
  vi.resetAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  evidence.sha256 = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  api.expenseEvidence.mockResolvedValue([]);
});
function file(type = 'image/png') {
  const value = new File([bytes], 'synthetic.png', { type });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return value;
}
async function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ExpenseEvidencePanel expenseId="expense" disabled={false} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Chọn ảnh chứng từ khoản chi')).not.toBeDisabled(),
  );
}
it('locks duplicate uploads, preserves retry key and reports success only after server confirmation/readback', async () => {
  api.uploadExpenseEvidence.mockRejectedValueOnce({ status: 503 });
  await mount();
  fireEvent.change(screen.getByLabelText('Chọn ảnh chứng từ khoản chi'), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lên chứng từ' }));
  await screen.findByText(/Không thể tải hoặc lưu/);
  expect(screen.queryByText('Đã lưu chứng từ riêng tư.')).toBeNull();
  const firstKey = api.uploadExpenseEvidence.mock.calls[0][3];
  let finish!: (value: typeof evidence) => void;
  api.uploadExpenseEvidence.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tải lên chứng từ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đang xử lý chứng từ…' }));
  await waitFor(() => expect(api.uploadExpenseEvidence).toHaveBeenCalledTimes(2));
  expect(api.uploadExpenseEvidence.mock.calls[1][3]).toBe(firstKey);
  expect(screen.queryByText('Đã lưu chứng từ riêng tư.')).toBeNull();
  api.expenseEvidence.mockResolvedValue([evidence]);
  await act(async () => finish(evidence));
  await screen.findByText('Đã lưu chứng từ riêng tư.');
  await screen.findByRole('button', { name: 'Tải chứng từ 1' });
});
it('recovers a persisted PendingUpload using its key after reopening and rejects invalid file types', async () => {
  api.expenseEvidence.mockResolvedValue([{ ...evidence, status: 'PendingUpload' }]);
  api.uploadExpenseEvidence.mockResolvedValue(evidence);
  await mount();
  expect(screen.queryByRole('button', { name: 'Tải chứng từ 1' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Chọn ảnh chứng từ khoản chi'), {
    target: { files: [file('text/html')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lên chứng từ' }));
  await screen.findByText(/Chọn ảnh PNG\/JPEG/);
  expect(api.uploadExpenseEvidence).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Chọn ảnh chứng từ khoản chi'), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lên chứng từ' }));
  await waitFor(() =>
    expect(api.uploadExpenseEvidence).toHaveBeenCalledWith(
      'expense',
      expect.any(Uint8Array),
      'image/png',
      evidence.operationKey,
    ),
  );
});
it('does not download when the server rejects private evidence access or integrity', async () => {
  api.expenseEvidence.mockResolvedValue([evidence]);
  api.expenseEvidenceFile.mockRejectedValue({ status: 409 });
  const create = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  await mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tải chứng từ 1' }));
  await screen.findByText(/Dữ liệu hoặc yêu cầu đã thay đổi/);
  expect(create).not.toHaveBeenCalled();
});
