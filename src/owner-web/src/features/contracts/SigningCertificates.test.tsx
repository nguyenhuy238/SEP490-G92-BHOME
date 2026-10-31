import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractActions,
  contractClient,
  mutationKeys,
  type Certificate,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { useSigningCertificates } from '../../../../../packages/client-core/src/useSigningCertificates';
import { SigningCertificates } from './SigningCertificates';
import { ContractActionDialog } from './ContractActionDialog';

const id = '00000000-0000-0000-0000-000000000003';
const certificate: Certificate = {
  id,
  provider: 'MySign',
  serialNumber: 'SYNTHETIC-CERT',
  providerUserIdHint: '***001',
  subject: 'Synthetic',
  validFrom: '2020-01-01T00:00:00Z',
  validTo: '2099-01-01T00:00:00Z',
  locked: false,
  usable: true,
};
function setup() {
  const api = contractClient(vi.fn());
  api.certificates = vi.fn().mockResolvedValue([certificate]);
  api.lockCertificate = vi.fn().mockResolvedValue(undefined);
  api.declareCertificate = vi.fn().mockResolvedValue(certificate);
  api.mutate = vi.fn();
  return api;
}
it('loads only when opened, locks and unlocks the own certificate, and reloads server state', async () => {
  const api = setup();
  render(<SigningCertificates api={api} />);
  expect(api.certificates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Khai báo chứng thư MySign của bạn' }));
  await screen.findByText(/SYNTHETIC-CERT/);
  vi.mocked(api.certificates).mockResolvedValue([{ ...certificate, locked: true, usable: false }]);
  fireEvent.click(screen.getByRole('button', { name: 'Khóa chứng thư' }));
  await screen.findByText(/Đã khóa chứng thư cho các yêu cầu ký mới/);
  expect(api.lockCertificate).toHaveBeenCalledWith(id, true);
  const unlock = await screen.findByRole('button', { name: 'Mở khóa chứng thư' });
  vi.mocked(api.certificates).mockResolvedValue([certificate]);
  fireEvent.click(unlock);
  await screen.findByText(/Đã mở khóa chứng thư/);
  expect(api.lockCertificate).toHaveBeenCalledWith(id, false);
  await screen.findByRole('button', { name: 'Khóa chứng thư' });
});
it('clears subscriber input after declaring and uses the returned directory for subsequent actions', async () => {
  const api = setup();
  render(<SigningCertificates api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Khai báo chứng thư MySign của bạn' }));
  await screen.findByText(/SYNTHETIC-CERT/);
  fireEvent.change(screen.getByLabelText('Mã thuê bao MySign của bạn'), {
    target: { value: ' SYNTHETIC-SUBSCRIBER ' },
  });
  fireEvent.change(screen.getByLabelText('Số serial (tùy chọn)'), {
    target: { value: ' SYNTHETIC-CERT ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tra cứu và lưu chứng thư' }));
  await screen.findByText('Đã truy vấn và lưu chứng thư từ nhà cung cấp.');
  expect(api.declareCertificate).toHaveBeenCalledWith('SYNTHETIC-SUBSCRIBER', 'SYNTHETIC-CERT');
  expect(screen.getByLabelText('Mã thuê bao MySign của bạn')).toHaveValue('');
  await waitFor(() => expect(api.certificates).toHaveBeenCalledTimes(2));
});
it('shows a failed directory request and retries without interpreting failure as an empty list', async () => {
  const api = setup();
  vi.mocked(api.certificates).mockRejectedValueOnce({ status: 503 });
  render(<SigningCertificates api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Khai báo chứng thư MySign của bạn' }));
  await screen.findByText(/Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng/);
  expect(screen.queryByText('Bạn chưa khai báo chứng thư MySign.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại chứng thư' }));
  await screen.findByText(/SYNTHETIC-CERT/);
});
it('rechecks state after an uncertain lock response without showing success', async () => {
  const api = setup();
  vi.mocked(api.lockCertificate).mockRejectedValue({ status: 0 });
  render(<SigningCertificates api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Khai báo chứng thư MySign của bạn' }));
  await screen.findByText(/SYNTHETIC-CERT/);
  fireEvent.click(screen.getByRole('button', { name: 'Khóa chứng thư' }));
  await screen.findByText(/Kết quả thao tác chưa được xác nhận/);
  expect(screen.queryByText('Đã khóa chứng thư cho các yêu cầu ký mới.')).not.toBeInTheDocument();
  await waitFor(() => expect(api.certificates).toHaveBeenCalledTimes(2));
});
it('discards late certificate responses when the authenticated client changes', async () => {
  const first = setup(),
    second = setup();
  let resolve!: (certificates: Certificate[]) => void;
  vi.mocked(first.certificates).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.mocked(second.certificates).mockResolvedValue([]);
  const { result, rerender } = renderHook(({ api }) => useSigningCertificates(api), {
    initialProps: { api: first },
  });
  rerender({ api: second });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => resolve([certificate]));
  expect(result.current.certificates).toEqual([]);
  expect(vi.mocked(first.certificates).mock.calls[0][0]?.aborted).toBe(true);
});
it('requires a fresh usable selection after a certificate is locked between reads', async () => {
  const api = setup();
  const contract = {
    id,
    ownerSignerId: id,
    tenantUserId: 'tenant',
    status: 'Draft',
    signatures: [],
  } as unknown as ContractView;
  const action = contractActions(contract, null, 'Owner', id).find(
    (value) => value.operation === 'signing',
  )!;
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <ContractActionDialog
        api={api}
        contract={contract}
        action={action}
        keys={mutationKeys(() => id)}
        actorId={id}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Tải lại chứng thư' })).toBeEnabled(),
  );
  fireEvent.mouseDown(screen.getByRole('combobox'), { button: 0 });
  fireEvent.click(await screen.findByRole('option', { name: /SYNTHETIC-CERT/ }));
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeEnabled();
  vi.mocked(api.certificates).mockResolvedValue([{ ...certificate, usable: false, locked: true }]);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại chứng thư' }));
  await screen.findByText(/Chưa có chứng thư dùng được/);
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
  expect(api.mutate).not.toHaveBeenCalled();
});
