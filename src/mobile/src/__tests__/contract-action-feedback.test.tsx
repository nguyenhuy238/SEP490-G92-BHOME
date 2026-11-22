// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../packages/client-core/src/api';
import {
  mutationKeys,
  type ContractAction,
  type ContractClient,
  type ContractView,
} from '../../../../packages/client-core/src/contracts';
vi.mock('../../../../packages/client-core/src/useSigningCertificates', () => ({
  useSigningCertificates: () => ({ certificates: [], loading: false, reload: vi.fn() }),
}));
vi.mock('../features/contracts/SigningSetup', () => ({
  SignatureImageSection: () => null,
  SignaturePlacementField: () => null,
}));
vi.mock('../features/contracts/ContractNotice', () => ({
  ContractNotice: ({ message }: { message: string }) => <span>{message}</span>,
}));
vi.mock('../lib/useFeedbackState', () => ({ useFeedbackState: () => React.useState('') }));
vi.mock('../components/IdentityDateField', () => ({
  IdentityDateField: ({
    label,
    value,
    onChange,
    error,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    error: boolean;
  }) => (
    <input
      aria-label={label}
      aria-invalid={error}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  focusOnError?: boolean;
  options?: { id: string; label: string }[];
};
vi.mock('../components/WorkflowControls', () => ({
  Input: ({ label, value, onChange, error, focusOnError }: FieldProps) => (
    <label>
      {label}
      <input
        aria-label={label}
        data-focus-invalid={focusOnError}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  ),
  ChoiceField: ({ label, value, onChange, error, options }: FieldProps) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Chọn</option>
        {options?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </label>
  ),
}));
type ButtonProps = { children: React.ReactNode; disabled?: boolean; onPress: () => void };
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({ children, disabled, onPress }: ButtonProps) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  HelperText: ({ children }: { children: React.ReactNode }) => <span role="alert">{children}</span>,
  Button: ({ children, disabled, onPress }: ButtonProps) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Checkbox: {
    Item: ({ label, status, onPress }: { label: string; status: string; onPress: () => void }) => (
      <label>
        <input type="checkbox" checked={status === 'checked'} onChange={onPress} />
        {label}
      </label>
    ),
  },
}));
import { ContractActionForm } from '../features/contracts/ContractActionForm';
afterEach(cleanup);
const contract = {
  id: 'c0000000-0000-4000-8000-000000000001',
  startDate: '2099-01-01',
  endDate: '2100-01-01',
} as ContractView;
function form(action: ContractAction, errors: Record<string, string[]>) {
  const mutate = vi.fn().mockRejectedValue(new ApiError(400, { code: 'validation_error', errors }));
  render(
    <ContractActionForm
      api={{ mutate, transport: vi.fn() } as unknown as ContractClient}
      action={action}
      contract={contract}
      evidenceIds={[]}
      keys={mutationKeys(() => 'test-key')}
      onSuccess={vi.fn()}
    />,
  );
  return mutate;
}
function confirm() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
}
it('maps backend selector/text errors, preserves the draft and clears only the edited error', async () => {
  const mutate = form(
    {
      operation: 'holding-cancellation',
      label: 'Hủy giữ chỗ',
      fields: [{ name: 'reason', label: 'Lý do', type: 'multiline' }],
    } as ContractAction,
    { Cause: ['Vui lòng chọn lại nguyên nhân.'], Reason: ['Kiểm tra lý do.'] },
  );
  fireEvent.change(screen.getByLabelText('Nguyên nhân hủy giữ chỗ'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Lý do bản nháp' } });
  confirm();
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(await screen.findByText('Vui lòng chọn lại nguyên nhân.')).toBeTruthy();
  expect(screen.getByLabelText('Lý do')).toHaveProperty('value', 'Lý do bản nháp');
  expect(screen.getByLabelText('Lý do').getAttribute('data-focus-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText('Nguyên nhân hủy giữ chỗ'), { target: { value: '1' } });
  expect(screen.queryByText('Vui lòng chọn lại nguyên nhân.')).toBeNull();
  expect(screen.getByText('Kiểm tra lý do.')).toBeTruthy();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

it('shows a server date error beside the date field and keeps the selected date', async () => {
  const mutate = form(
    {
      operation: 'termination-requests',
      label: 'Trả phòng trước hạn',
      fields: [{ name: 'proposedDate', label: 'Ngày trả phòng', type: 'date' }],
    } as ContractAction,
    { ProposedDate: ['Ngày đã thay đổi. Hãy kiểm tra lại.'] },
  );
  fireEvent.change(screen.getByLabelText('Ngày trả phòng'), { target: { value: '05-11-2099' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Ngày đã thay đổi. Hãy kiểm tra lại.',
  );
  expect(screen.getByLabelText('Ngày trả phòng')).toHaveProperty('value', '05-11-2099');
  fireEvent.change(screen.getByLabelText('Ngày trả phòng'), { target: { value: '06-11-2099' } });
  expect(screen.queryByRole('alert')).toBeNull();
});
