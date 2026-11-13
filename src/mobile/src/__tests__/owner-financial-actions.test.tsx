// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Adjustment } from '../../../../packages/client-core/src/adjustments';
import type { BankTransfer } from '../../../../packages/client-core/src/payments';
const state = vi.hoisted(() => ({
  role: 'Owner',
  request: vi.fn(),
  saved: vi.fn(),
  paid: false,
  empty: false,
  queryError: '',
}));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  invoiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  payer = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const api = { request: state.request };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api, session: { roles: [state.role] } }),
}));
vi.mock('react-native-paper', () => {
  const content = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Text: content,
    Portal: content,
    Button: ({
      children,
      onPress,
      disabled,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
    Dialog: Object.assign(
      ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: content, Content: content, Actions: content },
    ),
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
        disabled: boolean;
      }) => (
        <input
          aria-label={label}
          disabled={disabled}
          type="checkbox"
          checked={status === 'checked'}
          onChange={onPress}
        />
      ),
    },
  };
});
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../components/WorkspaceQueryState', () => ({
  QueryState: () => null,
  Pagination: () => null,
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => ({
    loading: false,
    error: state.queryError,
    reload: vi.fn(),
    data: !path
      ? null
      : path.includes('payment-invoices')
        ? {
            items: state.empty
              ? []
              : [
                  {
                    invoiceId,
                    locationName: 'Cơ sở mẫu',
                    roomNumber: '101',
                    billingPeriod: '2026-11-01',
                    outstandingAmount: '100000',
                  },
                ],
            totalCount: state.empty ? 0 : 1,
          }
        : path.includes('eligible-payers')
          ? [{ userId: payer, displayLabel: 'Người trả tổng hợp' }]
          : {
              invoiceId,
              paymentStatus: state.paid ? 'Paid' : 'Unpaid',
              payableAmount: '100000',
              paidAmount: '0',
              outstandingAmount: '100000',
            },
  }),
}));
import {
  OwnerAdjustmentDecision,
  OwnerPaymentDecision,
} from '../features/owner/OwnerFinancialActions';
const adjustment = {
  id,
  locationName: 'Cơ sở mẫu',
  roomNumber: '101',
  status: 'Pending',
  version: 3,
  invoiceVersion: 1,
  financialVersion: 2,
  proposedAmount: '90000',
  chargeCode: null,
  currentFinancialVersion: 8,
  currentInvoice: {
    version: 7,
    status: 'Final',
    lines: [{ id, chargeCode: 'RENT', name: 'Tiền phòng' }],
  },
} as unknown as Adjustment;
const transfer = {
  id,
  status: 'PendingReview',
  amount: '50000',
  bankReference: 'SYNTHETIC',
  proposedInvoiceId: invoiceId,
} as BankTransfer;
beforeEach(() => {
  state.role = 'Owner';
  state.paid = false;
  state.empty = false;
  state.queryError = '';
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function approve() {
  change('Lý do quyết định', 'Đã kiểm tra bằng chứng');
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra hóa đơn, số dư và bằng chứng'));
  fireEvent.click(screen.getByText('Phê duyệt'));
}
it('confirms approval with current invoice/financial versions, leaving finalized totals to the backend', async () => {
  state.request.mockResolvedValue({ status: 'Approved' });
  render(<OwnerAdjustmentDecision item={adjustment} onChanged={state.saved} />);
  approve();
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Xác nhận quyết định'));
  await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
  const [path, init] = state.request.mock.calls[0]!;
  expect(path).toBe(`/api/v1/invoice-adjustments/${id}/approve`);
  expect(init.method).toBe('POST');
  expect(init.headers['Idempotency-Key']).toBeTruthy();
  expect(JSON.parse(init.body)).toEqual({
    expectedVersion: 3,
    expectedInvoiceVersion: 7,
    expectedFinancialVersion: 8,
    correctedAmount: '90000',
    chargeCode: null,
    reason: 'Đã kiểm tra bằng chứng',
    humanConfirmed: true,
  });
});
it('rejects without changing the amount and requires a reason and confirmation', async () => {
  state.request.mockResolvedValue({});
  render(<OwnerAdjustmentDecision item={adjustment} onChanged={state.saved} />);
  expect((screen.getByText('Từ chối') as HTMLButtonElement).disabled).toBe(true);
  change('Lý do quyết định', 'Bằng chứng không phù hợp');
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra hóa đơn, số dư và bằng chứng'));
  fireEvent.click(screen.getByText('Từ chối'));
  fireEvent.click(screen.getByText('Xác nhận quyết định'));
  await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
  expect(state.request.mock.calls[0]![0]).toContain('/reject');
  expect(JSON.parse(state.request.mock.calls[0]![1].body).correctedAmount).toBeNull();
});
it('rejects invalid VND and forces a new review after stale financial data', async () => {
  state.request.mockRejectedValue({ status: 409, code: 'adjustment_invoice_changed' });
  render(<OwnerAdjustmentDecision item={adjustment} onChanged={state.saved} />);
  change('Giá trị sau điều chỉnh (VND)', '-100');
  approve();
  fireEvent.click(screen.getByText('Xác nhận quyết định'));
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Quay lại'));
  change('Giá trị sau điều chỉnh (VND)', '80000');
  approve();
  fireEvent.click(screen.getByText('Xác nhận quyết định'));
  await screen.findByText('Hóa đơn hoặc số dư đã thay đổi. Tải lại, kiểm tra và xác nhận lại.');
  expect(state.saved).not.toHaveBeenCalled();
  expect((screen.getByText('Phê duyệt') as HTMLButtonElement).disabled).toBe(true);
});
it('allocates only after invoice and actual payer review, blocks repeat taps and reloads server state', async () => {
  let finish!: () => void;
  state.request.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<OwnerPaymentDecision item={transfer} onChanged={state.saved} />);
  expect((screen.getByText('Phân bổ vào hóa đơn') as HTMLButtonElement).disabled).toBe(true);
  change('Người thực trả', payer);
  fireEvent.click(screen.getByLabelText('Tôi đã đối chiếu sao kê, nghĩa vụ và người thực trả'));
  fireEvent.click(screen.getByText('Phân bổ vào hóa đơn'));
  const confirm = screen.getByText('Xác nhận quyết định');
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(state.request).toHaveBeenCalledOnce();
  expect(state.request.mock.calls[0]![0]).toBe(`/api/v1/payment-transactions/${id}/allocate`);
  expect(JSON.parse(state.request.mock.calls[0]![1].body)).toEqual({
    invoiceId,
    paidByUserId: payer,
    humanVerified: true,
  });
  expect(state.request.mock.calls[0]![1].headers['Idempotency-Key']).toBeTruthy();
  expect(screen.queryByText('Đã thanh toán')).toBeNull();
  finish();
  await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
});
it('does not offer allocation for a paid invoice, lookup failure or a decided transfer', () => {
  state.paid = true;
  let view = render(<OwnerPaymentDecision item={transfer} onChanged={state.saved} />);
  expect((screen.getByText('Phân bổ vào hóa đơn') as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  state.paid = false;
  state.queryError = 'Không có quyền';
  view = render(<OwnerPaymentDecision item={transfer} onChanged={state.saved} />);
  expect((screen.getByText('Phân bổ vào hóa đơn') as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  render(
    <OwnerPaymentDecision item={{ ...transfer, status: 'Allocated' }} onChanged={state.saved} />,
  );
  expect(screen.queryByRole('button')).toBeNull();
});
it('allows a reasoned rejection without an invoice and never exposes decisions to Tenant', async () => {
  state.request.mockResolvedValue({});
  state.empty = true;
  const view = render(
    <OwnerPaymentDecision
      item={{ ...transfer, proposedInvoiceId: null }}
      onChanged={state.saved}
    />,
  );
  change('Lý do không phân bổ', 'Không khớp nghĩa vụ');
  fireEvent.click(screen.getByLabelText('Tôi đã đối chiếu sao kê, nghĩa vụ và người thực trả'));
  fireEvent.click(screen.getByText('Không phân bổ giao dịch'));
  fireEvent.click(screen.getByText('Xác nhận quyết định'));
  await waitFor(() => expect(state.saved).toHaveBeenCalledOnce());
  expect(state.request.mock.calls[0]![0]).toContain('/reject');
  view.unmount();
  state.role = 'Tenant';
  render(
    <>
      <OwnerPaymentDecision item={transfer} onChanged={state.saved} />
      <OwnerAdjustmentDecision item={adjustment} onChanged={state.saved} />
    </>,
  );
  expect(screen.queryByRole('button')).toBeNull();
});
