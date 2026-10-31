// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractActions,
  contractClient,
  mutationKeys,
  type Certificate,
  type ContractView,
} from '../../../packages/client-core/src/contracts';

type ButtonProps = { children: React.ReactNode; onPress: () => void; disabled?: boolean };
vi.mock('react-native-paper', () => ({
  Button: ({ children, onPress, disabled }: ButtonProps) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={status === 'checked'}
          onChange={onPress}
          disabled={disabled}
        />
        {label}
      </label>
    ),
  },
}));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
  Action: ({ children, onPress, disabled }: ButtonProps) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h1>{title}</h1>,
  ui: {},
}));
vi.mock('../../../src/mobile/src/components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
  ChoiceField: ({
    label,
    value,
    onChange,
    disabled,
    options,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    options: { id: string; label: string }[];
  }) => (
    <label>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Chọn</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
import {
  ContractActionForm,
  SigningCertificates,
} from '../../../src/mobile/src/features/contracts/ContractActionForm';

afterEach(cleanup);
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
function setup() {
  const api = contractClient(vi.fn());
  api.certificates = vi.fn().mockResolvedValue([certificate]);
  api.lockCertificate = vi.fn().mockResolvedValue(undefined);
  api.declareCertificate = vi.fn().mockResolvedValue(certificate);
  api.mutate = vi.fn().mockRejectedValue({ status: 503 });
  return api;
}
function mountForm(api: ReturnType<typeof setup>) {
  const onSuccess = vi.fn();
  render(
    <ContractActionForm
      api={api}
      action={action}
      contract={contract}
      keys={mutationKeys(() => id)}
      evidenceIds={[]}
      onCancel={vi.fn()}
      onSuccess={onSuccess}
    />,
  );
  return onSuccess;
}
it('blocks signing during loading or failure, then requires a usable certificate and consent after retry', async () => {
  const api = setup();
  let fail!: (error: unknown) => void;
  vi.mocked(api.certificates).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const success = mountForm(api);
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fail({ status: 503 });
  await screen.findByText(/Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng/);
  expect(screen.queryByText(/Chưa có chứng thư dùng được/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại chứng thư' }));
  await screen.findByRole('option', { name: /SYNTHETIC-CERT/ });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
  expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(1));
  expect(api.mutate).toHaveBeenCalledWith(id, 'signing', { certificateId: id }, id);
  expect(success).not.toHaveBeenCalled();
});
it('clears the previous selection and consent when a refreshed certificate is locked', async () => {
  const api = setup();
  mountForm(api);
  await screen.findByRole('option', { name: /SYNTHETIC-CERT/ });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  vi.mocked(api.certificates).mockResolvedValue([{ ...certificate, locked: true }]);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại chứng thư' }));
  await screen.findByText(/Chưa có chứng thư dùng được/);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(api.mutate).not.toHaveBeenCalled();
});
it('manages the own certificate and reloads the authoritative lock status', async () => {
  const api = setup();
  render(<SigningCertificates api={api} />);
  expect(api.certificates).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Khai báo chứng thư MySign của bạn' }));
  await screen.findByText(/SYNTHETIC-CERT/);
  vi.mocked(api.certificates).mockResolvedValue([{ ...certificate, locked: true, usable: false }]);
  fireEvent.click(screen.getByRole('button', { name: 'Khóa chứng thư' }));
  await screen.findByRole('button', { name: 'Mở khóa chứng thư' });
  expect(api.lockCertificate).toHaveBeenCalledWith(id, true);
  vi.mocked(api.certificates).mockResolvedValue([certificate]);
  fireEvent.click(screen.getByRole('button', { name: 'Mở khóa chứng thư' }));
  await screen.findByRole('button', { name: 'Khóa chứng thư' });
  expect(api.lockCertificate).toHaveBeenCalledWith(id, false);
});
it('does not show success when declaring fails and allows retry without losing input', async () => {
  const api = setup();
  vi.mocked(api.declareCertificate).mockRejectedValueOnce({ status: 503 });
  render(<SigningCertificates api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Khai báo chứng thư MySign của bạn' }));
  fireEvent.change(screen.getByLabelText('Mã thuê bao MySign của bạn'), {
    target: { value: 'SYNTHETIC-SUBSCRIBER' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tra cứu và lưu chứng thư' }));
  await screen.findByText(/Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng/);
  expect(screen.queryByText('Đã truy vấn và lưu chứng thư từ nhà cung cấp.')).toBeNull();
  expect((screen.getByLabelText('Mã thuê bao MySign của bạn') as HTMLInputElement).value).toBe(
    'SYNTHETIC-SUBSCRIBER',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tra cứu và lưu chứng thư' }));
  await screen.findByText('Đã truy vấn và lưu chứng thư từ nhà cung cấp.');
  expect((screen.getByLabelText('Mã thuê bao MySign của bạn') as HTMLInputElement).value).toBe('');
});
