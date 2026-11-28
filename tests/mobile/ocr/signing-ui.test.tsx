// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractActions,
  contractClient,
  mutationKeys,
  type ContractView,
} from '../../../packages/client-core/src/contracts';

type ButtonProps = { children: React.ReactNode; onPress: () => void; disabled?: boolean };
vi.mock('react-native', () => ({
  View: ({
    children,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
  }) => <div aria-label={accessibilityLabel}>{children}</div>,
  Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
    <img alt={accessibilityLabel ?? ''} />
  ),
}));
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
vi.mock('../../../src/mobile/src/components/IdentityDateField', () => ({
  IdentityDateField: () => null,
}));
import { ContractActionForm } from '../../../src/mobile/src/features/contracts/ContractActionForm';

afterEach(cleanup);
const id = '00000000-0000-0000-0000-000000000003';
const contract = {
  id,
  ownerSignerId: id,
  tenantUserId: 'tenant',
  status: 'PendingSigning',
  signatures: [],
} as unknown as ContractView;
const demo = { ...contract, isDevelopmentDemo: true };
function setup() {
  const api = contractClient(vi.fn());
  api.mutate = vi.fn().mockRejectedValue({ status: 503 });
  return api;
}
function mountForm(api: ReturnType<typeof setup>, role = 'Owner') {
  const onSuccess = vi.fn();
  const action = contractActions(demo, null, role, role === 'Owner' ? id : 'tenant', [
    'SIMULATED',
  ]).find((value) => value.operation === 'signing')!;
  render(
    <ContractActionForm
      api={api}
      action={action}
      contract={demo}
      keys={mutationKeys(() => id)}
      onCancel={vi.fn()}
      onSuccess={onSuccess}
    />,
  );
  return onSuccess;
}
it('does not offer retired remote signing or certificate configuration for a real contract', () => {
  const api = setup();
  for (const methods of [undefined, ['VIETTEL_MYSIGN', 'UPLOAD_PROOF'], ['OWNER_SESSION', 'OTP']]) {
    expect(
      contractActions(contract, null, 'Owner', id, methods).some((a) => a.operation === 'signing'),
    ).toBe(false);
  }
  expect(api).not.toHaveProperty('certificates');
  expect(api).not.toHaveProperty('declareCertificate');
  expect(api).not.toHaveProperty('lockCertificate');
  expect(api.mutate).not.toHaveBeenCalled();
});
it('requires consent and does not report a successful signature after a failed request; retries with the same key', async () => {
  const api = setup();
  const success = mountForm(api);
  const submit = screen.getByRole('button', { name: 'Xác nhận' });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(submit);
  await screen.findByText(/Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng/);
  expect(success).not.toHaveBeenCalled();
  expect(api.mutate).toHaveBeenCalledOnce();
  vi.mocked(api.mutate).mockResolvedValue({ id });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(success).toHaveBeenCalledOnce());
  expect(api.mutate).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.mutate).mock.calls[0]).toEqual(vi.mocked(api.mutate).mock.calls[1]);
});
it('requires Tenant consent for a released demo and confirms only the server result without duplicate submissions', async () => {
  const api = setup();
  let complete!: (value: { id: string }) => void;
  vi.mocked(api.mutate).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve as typeof complete;
      }),
  );
  const success = mountForm(api, 'Tenant');
  expect(
    screen.queryByRole('button', { name: /Khai báo|Khóa chứng thư|Tra cứu và lưu/ }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(api.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đang xử lý…' }));
  expect(api.mutate).toHaveBeenCalledTimes(1);
  expect(api.mutate).toHaveBeenCalledWith(
    id,
    'signing',
    { certificateId: '00000000-0000-0000-0000-000000000000' },
    id,
  );
  expect(success).not.toHaveBeenCalled();
  complete({ id });
  await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
});
