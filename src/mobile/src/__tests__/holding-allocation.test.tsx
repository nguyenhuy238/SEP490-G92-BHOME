// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Checkbox: {
    Item: ({
      label,
      onPress,
      status,
      disabled,
    }: {
      label: string;
      onPress: () => void;
      status: string;
      disabled?: boolean;
    }) => (
      <button
        role="checkbox"
        aria-checked={status === 'checked'}
        disabled={disabled}
        onClick={onPress}
      >
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
import { HoldingDepositAllocation } from '../features/contracts/HoldingDepositAllocation';
const contract = { id: 'contract', kind: 'Holding' } as ContractView;
const state = { problems: [] as string[], status: 'Allocated', fail: false };
const request = vi.fn();
beforeEach(() => {
  state.problems = [];
  state.status = 'Allocated';
  state.fail = false;
  request.mockReset();
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (state.fail) throw new Error('network');
      return { status: state.status, reason: 'verified' };
    }
    if (path.includes('/deposit-context'))
      return {
        transferId: 'transfer',
        contractId: 'contract',
        reference: 'receipt-snapshot',
        depositReference: 'contract-reference',
        required: '1000000',
        received: '0',
        remaining: '1000000',
        proposedAllocation: '1000000',
        excess: '0',
        payers: [{ residentId: 'resident', userId: 'tenant', label: 'Người chuyển tiền' }],
        externalPayer: null,
        problems: state.problems,
      };
    return {
      items: [{ id: 'transfer', bankReference: 'BANK-001', amount: '1000000' }],
      page: 1,
      pageSize: 20,
      totalCount: 1,
    };
  });
});
afterEach(cleanup);
async function selectTransfer() {
  fireEvent.click(screen.getByText('Phân bổ giao dịch ngân hàng'));
  await screen.findByText(/BANK-001/);
  fireEvent.change(screen.getByLabelText('Giao dịch ngân hàng'), { target: { value: 'transfer' } });
  await screen.findByText('Người chuyển tiền');
}
async function confirm() {
  await selectTransfer();
  fireEvent.change(screen.getByLabelText('Người thực chuyển tiền'), {
    target: { value: 'resident' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}
it('does not expose or fetch Owner payment APIs for Staff', () => {
  render(
    <HoldingDepositAllocation
      api={contractClient(request)}
      role="Staff"
      contract={contract}
      onChanged={vi.fn()}
    />,
  );
  expect(screen.queryByText('Phân bổ giao dịch ngân hàng')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it('requires human verification and sends actual context, payer and an idempotency key', async () => {
  const changed = vi.fn();
  render(
    <HoldingDepositAllocation
      api={contractClient(request)}
      role="Owner"
      contract={contract}
      onChanged={changed}
    />,
  );
  await selectTransfer();
  expect((screen.getByText('Xác nhận phân bổ cọc') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Người thực chuyển tiền'), {
    target: { value: 'resident' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Xác nhận phân bổ cọc'));
  await screen.findByText('Máy chủ đã xác nhận phân bổ cọc.');
  const mutation = request.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(mutation?.[0]).toBe('/api/v1/payment-transactions/transfer/allocate-holding-deposit');
  expect(JSON.parse(mutation?.[1].body)).toEqual({
    contractId: 'contract',
    paidByUserId: 'tenant',
    paidByResidentId: 'resident',
    expectedReference: 'receipt-snapshot',
    humanVerified: true,
  });
  expect(mutation?.[1].headers['Idempotency-Key']).toBeTruthy();
  expect(changed).toHaveBeenCalledOnce();
});
it('blocks allocation when the backend reports problems', async () => {
  state.problems = ['reference_mismatch'];
  render(
    <HoldingDepositAllocation
      api={contractClient(request)}
      role="Owner"
      contract={contract}
      onChanged={vi.fn()}
    />,
  );
  await selectTransfer();
  expect((screen.getByText('Xác nhận phân bổ cọc') as HTMLButtonElement).disabled).toBe(true);
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
});
it('reuses the same idempotency key after an unconfirmed network failure', async () => {
  state.fail = true;
  const changed = vi.fn();
  render(
    <HoldingDepositAllocation
      api={contractClient(request)}
      role="Owner"
      contract={contract}
      onChanged={changed}
    />,
  );
  await confirm();
  fireEvent.click(screen.getByText('Xác nhận phân bổ cọc'));
  await waitFor(() =>
    expect((screen.getByText('Xác nhận phân bổ cọc') as HTMLButtonElement).disabled).toBe(false),
  );
  expect(changed).not.toHaveBeenCalled();
  state.fail = false;
  fireEvent.click(screen.getByText('Xác nhận phân bổ cọc'));
  await screen.findByText('Máy chủ đã xác nhận phân bổ cọc.');
  const mutations = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(mutations).toHaveLength(2);
  expect(mutations[0][1].headers['Idempotency-Key']).toBe(
    mutations[1][1].headers['Idempotency-Key'],
  );
});
it('does not claim payment success for an unresolved backend result', async () => {
  state.status = 'PendingReview';
  render(
    <HoldingDepositAllocation
      api={contractClient(request)}
      role="Owner"
      contract={contract}
      onChanged={vi.fn()}
    />,
  );
  await confirm();
  fireEvent.click(screen.getByText('Xác nhận phân bổ cọc'));
  await screen.findByText('Giao dịch chưa được phân bổ. Vui lòng đối chiếu lại trên hệ thống.');
  expect(screen.queryByText('Máy chủ đã xác nhận phân bổ cọc.')).toBeNull();
});
