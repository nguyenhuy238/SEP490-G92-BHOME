import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type FinalInspection,
  type SettlementSummary,
} from '../../../../../packages/client-core/src/contracts';
import { DepositDeductionsPanel } from './DepositDeductionsPanel';

const summary: SettlementSummary = {
  contractId: 'contract',
  depositContractId: 'contract',
  roomNumber: 'Synthetic',
  verifiedSecurityDeposit: '400000',
  appliedHoldingDeposit: '0',
  contractSpecificOutstanding: '0',
  approvedFinalCharges: null,
  approvedDeductions: null,
  refundAmount: null,
  invoices: [],
  unresolvedItems: [
    'final_charges_and_damage_policy_pending',
    'deposit_deduction_refund_policy_required',
  ],
  otherActiveContracts: false,
  resolved: false,
  reference: 'review-1',
  calculation: {
    issuedTotal: '100000',
    approvedAdjustmentTotal: '0',
    payableTotal: '100000',
    verifiedInvoicePayments: '100000',
    roomOutstanding: '0',
    contractSpecificOutstanding: '0',
    potentialInvoiceExcess: '0',
    depositAllocated: '0',
    depositRefunded: '0',
    depositReserved: '0',
    availableSecurityDeposit: '400000',
    depositPositionConsistent: true,
  },
  transferVerificationStatus: 'PendingReview',
};
const inspection = {
  id: 'inspection',
  version: 1,
  ownerDecision: 'Confirmed',
  observed: { assets: [], evidenceIds: ['proof'] },
} as unknown as FinalInspection;
function mount(value = summary, succeed = false) {
  const request = vi.fn<ContractRequest>(async <T,>(): Promise<T> => {
    if (!succeed) throw { status: 503 };
    return { id: 'approved' } as T;
  });
  const api = contractClient(
      <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
    ),
    saved = vi.fn(async () => {});
  render(
    <DepositDeductionsPanel
      api={api}
      id="contract"
      summary={value}
      inspection={inspection}
      saved={saved}
    />,
  );
  return { request, saved };
}
const consent =
  'Tôi đã đối chiếu thiệt hại, chứng từ và xác nhận khoản này chưa tính trên hóa đơn trước khi duyệt khấu trừ';
function fill() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm khoản thiệt hại' }));
  fireEvent.change(screen.getByLabelText('Số tiền khấu trừ 1 (VND)'), {
    target: { value: '100000' },
  });
  fireEvent.change(screen.getByLabelText('Mô tả thiệt hại 1'), {
    target: { value: 'Synthetic room damage' },
  });
  fireEvent.click(screen.getByLabelText('Khoản 1: dùng ảnh biên bản 1'));
  fireEvent.change(screen.getByLabelText('Căn cứ quyết định khấu trừ'), {
    target: { value: 'Checked inspection and invoice' },
  });
}
it('requires human review and sends the exact source/version, with the same retry key after an ambiguous failure', async () => {
  const { request, saved } = mount();
  fill();
  const approve = screen.getByRole('button', { name: 'Duyệt quyết định khấu trừ' });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByLabelText(consent));
  fireEvent.click(approve);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(approve).toBeEnabled());
  fireEvent.click(approve);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[0][0]).toBe('/api/v1/contracts/contract/deposit-deductions');
  const first = request.mock.calls[0][1]!;
  expect(JSON.parse(first.body as string)).toEqual({
    expectedVersion: 0,
    expectedReference: 'review-1',
    reason: 'Checked inspection and invoice',
    humanConfirmed: true,
    items: [
      {
        assetId: null,
        reasonCode: 'TenantDamage',
        amount: '100000',
        description: 'Synthetic room damage',
        evidenceIds: ['proof'],
      },
    ],
  });
  expect(first.headers).toEqual(request.mock.calls[1][1]?.headers);
  expect(saved).not.toHaveBeenCalled();
});
it('never treats missing proof as approved and resets consent when the proposed damage changes', async () => {
  const { request } = mount();
  fill();
  fireEvent.click(screen.getByLabelText(consent));
  fireEvent.change(screen.getByLabelText('Số tiền khấu trừ 1 (VND)'), {
    target: { value: '200000' },
  });
  expect(screen.getByLabelText(consent)).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Khoản 1: dùng ảnh biên bản 1'));
  fireEvent.click(screen.getByLabelText(consent));
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt quyết định khấu trừ' }));
  await screen.findByText('Mỗi khoản cần mô tả và ảnh biên bản.');
  expect(request).not.toHaveBeenCalled();
});
it('keeps a reserved or unknown deposit read-only', () => {
  const { request } = mount({
    ...summary,
    calculation: {
      ...summary.calculation!,
      depositReserved: '300000',
      availableSecurityDeposit: null,
    },
  });
  expect(screen.getByRole('button', { name: 'Thêm khoản thiệt hại' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Duyệt quyết định khấu trừ' })).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
});
it('records an explicit zero-item decision only after reason and confirmation, then reloads server data', async () => {
  const { request, saved } = mount(summary, true);
  fireEvent.change(screen.getByLabelText('Căn cứ quyết định khấu trừ'), {
    target: { value: 'Owner explicitly declines the damage charge' },
  });
  expect(screen.getByRole('button', { name: 'Duyệt quyết định khấu trừ' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText(consent));
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt quyết định khấu trừ' }));
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(request.mock.calls[0][1]?.body as string).items).toEqual([]);
});
