import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type {
  ContractClient,
  SettlementReceivables,
} from '../../../../../packages/client-core/src/contracts';
import { MoveOutFinancialClosePanel } from './components/settlement/MoveOutFinancialClosePanel';

vi.mock('../../components/common/ConfirmActionButton', () => ({
  ConfirmActionButton: ({
    children,
    disabled,
    onConfirm,
  }: {
    children: React.ReactNode;
    disabled: boolean;
    onConfirm: () => Promise<void>;
  }) => (
    <button type="button" disabled={disabled} onClick={() => void onConfirm()}>
      {children}
    </button>
  ),
}));

function setup(
  noAdditionalCharges = false,
  overage = false,
  refundOverrides: Record<string, unknown> = {},
  tenantProposalStatus: 'PendingTenant' | 'Disputed' | 'Accepted' | null = null,
  tenantSettlementStatus: string | null = null,
) {
  const transport = vi.fn().mockImplementation(async (path: string) =>
    path.endsWith('/move-out/receivables/proposal')
      ? {
          latestProposal: tenantProposalStatus
            ? {
                id: 'proposal-1',
                tenantFeedback: {
                  settlement: tenantSettlementStatus ? { status: tenantSettlementStatus } : null,
                },
              }
            : null,
          status: tenantProposalStatus ?? 'None',
        }
      : {
          financialReference: 'DEPOSIT-123',
          availableAmount: '100000',
          blockers: [],
          beneficiaries: [{ id: 'resident-1', label: 'Người thuê được xác minh' }],
          requests: [],
          ...refundOverrides,
        },
  );
  const settlementChargeReview = vi.fn().mockResolvedValue({
    reference: 'CHARGES-123',
    isCurrent: !noAdditionalCharges,
    missingInputs: [],
    review: noAdditionalCharges ? null : { id: 'review-1' },
  });
  const mutate = vi.fn().mockResolvedValue({
    contractId: 'contract-1',
    reference: 'CHARGE-123',
    offsetIds: ['offset-1'],
    refundRequestId: overage ? null : 'refund-1',
    refundStatus: overage ? null : 'REQUESTED',
    outstandingAmount: overage ? '100000' : '0',
    remainingDeposit: overage ? '0' : '100000',
  });
  const saved = vi.fn().mockResolvedValue(undefined);
  const api = { transport, settlementChargeReview, mutate } as unknown as ContractClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MoveOutFinancialClosePanel
        api={api}
        id="contract-1"
        data={
          {
            reference: 'CHARGE-123',
            noAdditionalCharges,
            availableDeposit: '100000',
            receivables: overage
              ? [{ charge: { kind: 'TenantDamage' }, outstanding: '200000' }]
              : [],
          } as SettlementReceivables
        }
        issues={
          noAdditionalCharges || overage
            ? overage
              ? [{ key: 'asset:bed-1', label: 'Giường đã định giá', charged: true }]
              : []
            : [
                { key: 'room:walls_ceiling_floor', label: 'Tường, trần và sàn', charged: false },
                { key: 'asset:bed-1', label: 'Giường đã định giá', charged: true },
              ]
        }
        saved={saved}
      />
    </QueryClientProvider>,
  );
  return { mutate, saved };
}

it('requires Owner to explicitly waive unpriced damage and verify the refund beneficiary before automatic financial closing', async () => {
  const { mutate, saved } = setup();
  const finalize = screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' });
  expect(finalize).toBeDisabled();
  expect(await screen.findByText(/Cọc hiện có thể đối chiếu/)).toBeInTheDocument();
  expect(screen.getByText(/Còn 1 hạng mục cần nhập giá bồi thường/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Không thu bồi thường: Tường, trần và sàn' }),
  );
  expect(screen.queryByRole('checkbox', { name: /Giường đã định giá/ })).not.toBeInTheDocument();
  expect(finalize).toBeDisabled();
  fireEvent.mouseDown(screen.getByLabelText('Người nhận hoàn cọc theo thỏa thuận'));
  fireEvent.click(await screen.findByRole('option', { name: 'Người thuê được xác minh' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /đối chiếu người nhận hoàn cọc/ }));
  fireEvent.change(screen.getByLabelText('Lý do chốt quyết toán / căn cứ miễn thu'), {
    target: { value: 'Owner xác nhận miễn thu tường vì hao mòn thông thường.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /xác nhận đầy đủ mức bồi thường/ }));
  await waitFor(() => expect(finalize).toBeEnabled());
  fireEvent.click(finalize);
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate).toHaveBeenCalledWith(
    'contract-1',
    'move-out/receivables/final-close',
    {
      expectedReference: 'CHARGE-123',
      expectedChargeReviewId: 'review-1',
      beneficiaryResidentId: 'resident-1',
      beneficiaryVerified: true,
      waivedIssueKeys: ['room:walls_ceiling_floor'],
      reason: 'Owner xác nhận miễn thu tường vì hao mòn thông thường.',
      humanConfirmed: true,
    },
    expect.any(String),
  );
  expect(await screen.findByText(/Đã tạo đơn hoàn cọc, đang chờ Owner duyệt/)).toBeInTheDocument();
  expect(saved).toHaveBeenCalled();
});

it('sends a null charge-review id for a no-additional-damage inspection without inventing a review', async () => {
  const { mutate } = setup(true);
  expect(await screen.findByText(/Cọc hiện có thể đối chiếu/)).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText('Người nhận hoàn cọc theo thỏa thuận'));
  fireEvent.click(await screen.findByRole('option', { name: 'Người thuê được xác minh' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /đối chiếu người nhận hoàn cọc/ }));
  fireEvent.change(screen.getByLabelText('Lý do chốt quyết toán / căn cứ miễn thu'), {
    target: { value: 'Không phát sinh hư hỏng.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /xác nhận đầy đủ mức bồi thường/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).toMatchObject({
    expectedChargeReviewId: null,
    waivedIssueKeys: [],
    beneficiaryVerified: true,
  });
});

it('does not require a refund beneficiary when damage exceeds the deposit, and never claims a refund was created', async () => {
  const { mutate } = setup(false, true);
  expect(await screen.findByText(/Dự kiến còn dư sau cấn trừ thiệt hại/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Lý do chốt quyết toán / căn cứ miễn thu'), {
    target: { value: 'Đã xác nhận giường hư hỏng và sử dụng hết cọc.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /xác nhận đầy đủ mức bồi thường/ }));
  const finalize = screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' });
  await waitFor(() => expect(finalize).toBeEnabled());
  fireEvent.click(finalize);
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(mutate.mock.calls[0][2]).toMatchObject({
    beneficiaryResidentId: null,
    beneficiaryVerified: false,
    waivedIssueKeys: [],
  });
  expect(await screen.findByText(/Chưa có đơn hoàn cọc được tạo/)).toBeInTheDocument();
});

it('blocks closing when the refund source reports unresolved obligations, even if Owner has confirmed the form', async () => {
  const { mutate } = setup(true, false, { blockers: ['unpaid_final_invoice'] });
  expect(await screen.findByText(/Nguồn tiền cọc còn điều kiện chưa xử lý/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Lý do chốt quyết toán / căn cứ miễn thu'), {
    target: { value: 'Chốt sau khi kiểm tra.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /xác nhận đầy đủ mức bồi thường/ }));
  expect(screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it('prevents a duplicate refund request from being created after an existing request', async () => {
  const { mutate } = setup(true, false, { requests: [{ status: 'REQUESTED' }] });
  expect(await screen.findByText(/Đã có yêu cầu hoàn cọc đang chờ xử lý/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it.each(['PendingTenant', 'Disputed'] as const)(
  'blocks Owner financial closure while Tenant proposal is %s',
  async (status) => {
    const { mutate } = setup(true, false, {}, status);
    expect(
      await screen.findByText(/Tenant chưa đồng ý với đề xuất phí trả phòng hiện tại/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Lý do chốt quyết toán / căn cứ miễn thu'), {
      target: { value: 'Đã đối chiếu các khoản thu.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /xác nhận đầy đủ mức bồi thường/ }));
    expect(
      screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' }),
    ).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  },
);

it('blocks financial close even after Tenant accepts if materialization needs Owner review', async () => {
  const { mutate } = setup(true, false, {}, 'Accepted', 'PendingOwnerReview');
  expect(
    await screen.findByText(
      /Tenant đã đồng ý nhưng các khoản thu và cấn cọc chưa được máy chủ xác minh/,
    ),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Lý do chốt quyết toán / căn cứ miễn thu'), {
    target: { value: 'Chốt khi tài chính hoàn tất.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /xác nhận đầy đủ mức bồi thường/ }));
  expect(screen.getByRole('button', { name: 'Chốt quyết toán và xử lý tiền cọc' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});
