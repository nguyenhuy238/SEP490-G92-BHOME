import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { RefundPanel } from './RefundPanel';
import { createApiClient } from '../../../../../packages/client-core/src/api';
const request = vi.hoisted(() => vi.fn());
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const source = {
  sourcePaymentId: 'source',
  excessAmount: '20000',
  refundedAmount: '0',
  reservedAmount: '0',
  availableAmount: '20000',
  isDevelopmentDemo: true,
  beneficiaries: [{ id: 'payer', label: 'Synthetic actual payer' }],
  requests: [],
};
const row = {
  id: 'refund',
  sourcePaymentId: 'source',
  beneficiaryResidentId: 'payer',
  beneficiaryLabel: 'Synthetic actual payer',
  amount: '20000',
  reason: 'Synthetic refund',
  status: 'REQUESTED',
  version: 1,
  requestedAt: '2026-11-06T00:00:00Z',
  decisionReason: null,
  decidedAt: null,
  executedAt: null,
  externalReference: null,
  isDevelopmentDemo: true,
  history: [],
  executionIntent: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  request.mockResolvedValue(source);
});
it('uses the agreed Security Deposit recipient, requires Owner consent, and resets consent/key when obligations change', async () => {
  let current = {
    ...source,
    sourcePaymentId: null,
    sourceDepositContractId: 'root',
    verifiedDepositAmount: '20000',
    beneficiaries: [
      ...source.beneficiaries,
      { id: 'agreed-recipient', label: 'Synthetic agreed recipient' },
    ],
    excessAmount: '0',
    financialReference: 'D1',
    blockers: [],
  };
  request.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') throw { status: 503 };
    return current;
  });
  mount('SecurityDeposit');
  await screen.findByText(/Cọc đã xác minh: 20.000/);
  expect(request).toHaveBeenCalledWith(
    '/api/v1/contracts/source/deposit-refunds',
    expect.anything(),
  );
  fireEvent.mouseDown(screen.getByLabelText('Người nhận hoàn đã xác minh'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic agreed recipient' }));
  fireEvent.change(screen.getByLabelText('Số tiền yêu cầu hoàn (VND)'), {
    target: { value: '20000' },
  });
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu hoàn'), {
    target: { value: 'Contract recipient checked by Owner' },
  });
  const create = screen.getByRole('button', { name: 'Lập yêu cầu hoàn tiền' });
  const general = 'Tôi xác nhận nguồn tiền và người nhận hoàn theo thỏa thuận hợp đồng';
  const depositor = 'Tôi đã đối chiếu thỏa thuận hợp đồng và xác nhận người nhận hoàn cọc';
  expect(
    screen.queryByLabelText(
      'Tôi đã đối chiếu bằng chứng nộp cọc và xác minh người nhận là người nộp',
    ),
  ).not.toBeInTheDocument();
  const deductions = 'Tôi xác nhận hoàn cọc không khấu trừ, không còn phí hoặc nghĩa vụ chờ xử lý';
  fireEvent.click(screen.getByLabelText(general));
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByLabelText(depositor));
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByLabelText(deductions));
  expect(create).toBeEnabled();
  fireEvent.click(create);
  await screen.findByText('Chưa ghi nhận hoàn tất. Tải lại để kiểm tra trước khi thử lại.');
  const first = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(first[0]).toBe('/api/v1/contracts/source/deposit-refunds');
  expect(JSON.parse(first[1].body)).toEqual({
    refund: {
      beneficiaryResidentId: 'agreed-recipient',
      amount: '20000',
      reason: 'Contract recipient checked by Owner',
      humanConfirmed: true,
    },
    expectedFinancialReference: 'D1',
    beneficiaryVerified: true,
    noDeductionsConfirmed: true,
  });
  current = { ...current, financialReference: 'D2' };
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại nguồn hoàn tiền' }));
  await vi.waitFor(() => expect(screen.getByLabelText(general)).not.toBeChecked());
  expect(screen.getByLabelText(depositor)).not.toBeChecked();
  expect(screen.getByLabelText(deductions)).not.toBeChecked();
  expect(create).toBeDisabled();
  for (const label of [general, depositor, deductions])
    fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(create);
  await vi.waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const last = request.mock.calls.filter(([, init]) => init?.method === 'POST')[1];
  expect(JSON.parse(last[1].body).expectedFinancialReference).toBe('D2');
  expect(last[1].headers['Idempotency-Key']).not.toBe(first[1].headers['Idempotency-Key']);
});
it('shows unknown deposit availability and blocks approval while still allowing rejection to release a reservation', async () => {
  request.mockResolvedValue({
    ...source,
    sourcePaymentId: null,
    sourceDepositContractId: 'root',
    verifiedDepositAmount: '20000',
    availableAmount: null,
    financialReference: 'D1',
    blockers: ['deposit_ledger_reconciliation_required'],
    requests: [{ ...row, sourcePaymentId: null, sourceDepositContractId: 'root' }],
  });
  mount('SecurityDeposit');
  await screen.findByText('Còn có thể lập yêu cầu: Chờ đối chiếu');
  expect(
    screen.getByText('Nguồn cọc và sổ phân bổ không khớp; cần Owner đối chiếu.'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Lập yêu cầu hoàn tiền' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lý do quyết định / xác minh hoàn'), {
    target: { value: 'Release for review' },
  });
  fireEvent.click(
    screen.getByLabelText('Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định'),
  );
  expect(screen.getByRole('button', { name: 'Duyệt yêu cầu hoàn' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Từ chối hoàn' })).toBeEnabled();
});
it('binds a remainder refund to the approved deduction instead of claiming there were no deductions', async () => {
  request.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') throw { status: 503 };
    return {
      ...source,
      sourcePaymentId: null,
      sourceDepositContractId: 'root',
      verifiedDepositAmount: '400000',
      availableAmount: '300000',
      financialReference: 'D-plan',
      depositDeductions: {
        id: 'plan-1',
        version: 2,
        total: '100000',
        items: [{ description: 'Synthetic damage', amount: '100000' }],
      },
    };
  });
  mount('SecurityDeposit');
  await screen.findByText('Khấu trừ đã duyệt phiên bản 2: 100.000 ₫');
  expect(
    screen.queryByLabelText(
      'Tôi xác nhận hoàn cọc không khấu trừ, không còn phí hoặc nghĩa vụ chờ xử lý',
    ),
  ).toBeNull();
  fireEvent.mouseDown(screen.getByLabelText('Người nhận hoàn đã xác minh'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic actual payer' }));
  fireEvent.change(screen.getByLabelText('Số tiền yêu cầu hoàn (VND)'), {
    target: { value: '300000' },
  });
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu hoàn'), {
    target: { value: 'Only return the remainder' },
  });
  for (const label of [
    'Tôi xác nhận nguồn tiền và người nhận hoàn theo thỏa thuận hợp đồng',
    'Tôi đã đối chiếu thỏa thuận hợp đồng và xác nhận người nhận hoàn cọc',
    'Tôi đã đọc quyết định khấu trừ đã duyệt và xác nhận chỉ hoàn phần còn lại',
  ])
    fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('button', { name: 'Lập yêu cầu hoàn tiền' }));
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  const body = JSON.parse(request.mock.calls.find(([, init]) => init?.method === 'POST')![1].body);
  expect(body).toMatchObject({
    noDeductionsConfirmed: false,
    deductionsConfirmed: true,
    expectedDeductionPlanId: 'plan-1',
    expectedFinancialReference: 'D-plan',
  });
  expect(body.refund.amount).toBe('300000');
});
it('requires confirmation of source-specific deposit offsets before refunding the remainder', async () => {
  request.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') throw { status: 503 };
    return {
      ...source,
      sourcePaymentId: null,
      sourceDepositContractId: 'root',
      verifiedDepositAmount: '400000',
      availableAmount: '300000',
      financialReference: 'D-offset',
      approvedDepositOffsets: '100000',
    };
  });
  mount('SecurityDeposit');
  await screen.findByText('Hoàn phần cọc còn lại sau cấn trừ');
  fireEvent.mouseDown(screen.getByLabelText('Người nhận hoàn đã xác minh'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic actual payer' }));
  fireEvent.change(screen.getByLabelText('Số tiền yêu cầu hoàn (VND)'), {
    target: { value: '300000' },
  });
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu hoàn'), {
    target: { value: 'Verified remaining deposit after approved offsets' },
  });
  for (const label of [
    'Tôi xác nhận nguồn tiền và người nhận hoàn theo thỏa thuận hợp đồng',
    'Tôi đã đối chiếu thỏa thuận hợp đồng và xác nhận người nhận hoàn cọc',
    'Tôi đã đối chiếu 100.000 ₫ cấn trừ đã duyệt và chỉ hoàn phần cọc còn lại',
  ])
    fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('button', { name: 'Lập yêu cầu hoàn tiền' }));
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  const body = JSON.parse(request.mock.calls.find(([, init]) => init?.method === 'POST')![1].body);
  expect(body).toMatchObject({
    noDeductionsConfirmed: false,
    deductionsConfirmed: true,
    expectedFinancialReference: 'D-offset',
  });
  expect(body.expectedDeductionPlanId).toBeUndefined();
});
it('keeps Holding depositor verification separate from the Security Deposit agreement policy', async () => {
  request.mockResolvedValue({
    ...source,
    sourcePaymentId: null,
    sourceDepositContractId: 'holding',
    verifiedDepositAmount: '20000',
    excessAmount: '0',
    financialReference: 'H1',
    blockers: [],
  });
  mount('HoldingDeposit');
  expect(
    await screen.findByLabelText(
      'Tôi đã đối chiếu bằng chứng nộp cọc và xác minh người nhận là người nộp',
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText('Tôi đã đối chiếu thỏa thuận hợp đồng và xác nhận người nhận hoàn cọc'),
  ).not.toBeInTheDocument();
});
function mount(kind: 'Receipt' | 'SecurityDeposit' | 'HoldingDeposit' = 'Receipt') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RefundPanel sourceId="source" sourceKind={kind} />
    </QueryClientProvider>,
  );
}
it('requires human confirmation and keeps an ambiguous create retry on the same key', async () => {
  request.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') throw { status: 503 };
    return source;
  });
  mount();
  await screen.findByText('Còn có thể lập yêu cầu: 20.000 ₫');
  fireEvent.mouseDown(screen.getByLabelText('Người nhận hoàn đã xác minh'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic actual payer' }));
  fireEvent.change(screen.getByLabelText('Số tiền yêu cầu hoàn (VND)'), {
    target: { value: '20000' },
  });
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu hoàn'), {
    target: { value: 'Synthetic request' },
  });
  const create = screen.getByRole('button', { name: 'Lập yêu cầu hoàn tiền' });
  expect(create).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText('Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn'),
  );
  fireEvent.click(create);
  await screen.findByText('Chưa ghi nhận hoàn tất. Tải lại để kiểm tra trước khi thử lại.');
  fireEvent.click(create);
  await vi.waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const calls = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(calls[0][1].headers['Idempotency-Key']).toEqual(calls[1][1].headers['Idempotency-Key']);
  expect(JSON.parse(calls[0][1].body)).toEqual({
    beneficiaryResidentId: 'payer',
    amount: '20000',
    reason: 'Synthetic request',
    humanConfirmed: true,
  });
});
it('requires a fresh human decision and does not show Completed after approval fails', async () => {
  request.mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') throw { code: 'refund_changed' };
    return { ...source, requests: [row] };
  });
  mount();
  await screen.findByText('Chờ duyệt · 20.000 ₫ · Synthetic actual payer');
  const approve = screen.getByRole('button', { name: 'Duyệt yêu cầu hoàn' });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lý do quyết định / xác minh hoàn'), {
    target: { value: 'Reviewed' },
  });
  fireEvent.click(
    screen.getByLabelText('Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định'),
  );
  fireEvent.click(approve);
  await screen.findByText('Yêu cầu đã thay đổi hoặc chưa ở bước phù hợp. Hãy tải lại.');
  expect(screen.queryByRole('button', { name: 'Tải chứng từ hoàn tiền' })).not.toBeInTheDocument();
});
it('hides actions on failed source lookup instead of supplying demo data', async () => {
  request.mockRejectedValue({ status: 403 });
  mount();
  await screen.findByText('Chỉ Owner được xử lý hoàn tiền.');
  expect(screen.queryByLabelText('Người nhận hoàn đã xác minh')).not.toBeInTheDocument();
});
it('refreshes approval and completion only from the server and sends execution as multipart', async () => {
  let current = row;
  request.mockImplementation(async (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/decision'))
      current = { ...row, status: 'APPROVED', version: 2 };
    if (init?.method === 'POST' && url.endsWith('/execution')) {
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('humanConfirmed')).toBe('true');
      current = { ...row, status: 'COMPLETED', version: 3 };
    }
    return init?.method === 'POST' ? current : { ...source, requests: [current] };
  });
  mount();
  await screen.findByText('Chờ duyệt · 20.000 ₫ · Synthetic actual payer');
  fireEvent.change(screen.getByLabelText('Lý do quyết định / xác minh hoàn'), {
    target: { value: 'Checked' },
  });
  fireEvent.click(
    screen.getByLabelText('Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt yêu cầu hoàn' }));
  await screen.findByText('Đã duyệt, chờ ghi nhận hoàn · 20.000 ₫ · Synthetic actual payer');
  fireEvent.change(screen.getByLabelText('Lý do quyết định / xác minh hoàn'), {
    target: { value: 'Statement checked' },
  });
  fireEvent.change(screen.getByLabelText('Tham chiếu giao dịch hoàn trên sao kê'), {
    target: { value: 'SYN-REFUND' },
  });
  fireEvent.change(screen.getByLabelText('Thời gian hoàn thực tế (giờ Việt Nam)'), {
    target: { value: '2026-11-06T12:00:00' },
  });
  fireEvent.change(screen.getByLabelText('Chứng từ giao dịch hoàn'), {
    target: { files: [new File(['synthetic'], 'test.png', { type: 'image/png' })] },
  });
  const execute = screen.getByRole('button', { name: 'Ghi nhận giao dịch hoàn đã thực hiện' });
  expect(execute).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận',
    ),
  );
  fireEvent.click(execute);
  await screen.findByText('Đã ghi nhận hoàn · 20.000 ₫ · Synthetic actual payer');
  expect(screen.getByRole('button', { name: 'Tải chứng từ hoàn tiền' })).toBeInTheDocument();
});
it('keeps an interrupted execution Approved and displays recovery metadata', async () => {
  request.mockResolvedValue({
    ...source,
    requests: [
      {
        ...row,
        status: 'APPROVED',
        version: 2,
        executionIntent: {
          key: 'pending-key',
          contentType: 'image/png',
          length: 100,
          sha256: 'ABC',
          executedAt: '2026-11-06T00:01:00Z',
          externalReference: 'SYNTHETIC-REFUND',
          reason: 'Checked statement',
        },
      },
    ],
  });
  mount();
  await screen.findByText(
    'Chưa hoàn tất lưu chứng từ. Dùng đúng ảnh đã gửi và thông tin đang chờ để phục hồi.',
  );
  expect(screen.getByLabelText('Tham chiếu giao dịch hoàn trên sao kê')).toHaveValue(
    'SYNTHETIC-REFUND',
  );
  expect(screen.getByLabelText('Tham chiếu giao dịch hoàn trên sao kê')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Ghi nhận giao dịch hoàn đã thực hiện' }),
  ).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Tải chứng từ hoàn tiền' })).not.toBeInTheDocument();
});
it('rebinds consent and pending fields when a server intent arrives without a version change', async () => {
  let pending = false;
  request.mockImplementation(async () => ({
    ...source,
    requests: [
      {
        ...row,
        status: 'APPROVED',
        version: 2,
        executionIntent: pending
          ? {
              key: 'server-key',
              contentType: 'image/png',
              length: 100,
              sha256: 'ABC',
              executedAt: '2026-11-06T00:01:00Z',
              externalReference: 'SYN-SERVER',
              reason: 'Confirmed server intent',
            }
          : null,
      },
    ],
  }));
  mount();
  await screen.findByText('Đã duyệt, chờ ghi nhận hoàn · 20.000 ₫ · Synthetic actual payer');
  fireEvent.change(screen.getByLabelText('Lý do quyết định / xác minh hoàn'), {
    target: { value: 'Old text' },
  });
  fireEvent.click(
    screen.getByLabelText(
      'Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận',
    ),
  );
  pending = true;
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại nguồn hoàn tiền' }));
  await vi.waitFor(() =>
    expect(screen.getByLabelText('Tham chiếu giao dịch hoàn trên sao kê')).toHaveValue(
      'SYN-SERVER',
    ),
  );
  expect(screen.getByLabelText('Lý do quyết định / xác minh hoàn')).toHaveValue(
    'Confirmed server intent',
  );
  expect(
    screen.getByLabelText(
      'Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận',
    ),
  ).not.toBeChecked();
});
it('lets fetch set multipart boundaries while keeping JSON request headers unchanged', async () => {
  const transport = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
  try {
    const api = createApiClient('https://api.test');
    const body = new FormData();
    body.append('evidence', new Blob(['synthetic'], { type: 'image/png' }), 'test.png');
    await api('/api/v1/refund-requests/id/execution', { method: 'POST', body });
    const headers = transport.mock.calls[0][1].headers as Headers;
    expect(headers.has('Content-Type')).toBe(false);
    expect(transport.mock.calls[0][1].body).toBe(body);
    await api('/api/v1/refund-requests/id/decision', { method: 'POST', body: '{}' });
    expect((transport.mock.calls[1][1].headers as Headers).get('Content-Type')).toBe(
      'application/json',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
it('requests a refund to the verified outside payer without inventing a Resident identifier', async () => {
  request.mockResolvedValue({
    ...source,
    beneficiaries: [],
    externalBeneficiary: { attestationId: 'outside', label: 'Synthetic outside payer' },
  });
  mount();
  fireEvent.mouseDown(await screen.findByLabelText('Người nhận hoàn đã xác minh'));
  fireEvent.click(await screen.findByRole('option', { name: /Synthetic outside payer/ }));
  fireEvent.change(screen.getByLabelText('Số tiền yêu cầu hoàn (VND)'), {
    target: { value: '20000' },
  });
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu hoàn'), {
    target: { value: 'Synthetic verified outside payer return' },
  });
  fireEvent.click(
    screen.getByLabelText('Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lập yêu cầu hoàn tiền' }));
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/api/v1/payment-transactions/source/refunds',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          beneficiaryResidentId: null,
          externalPayerAttestationId: 'outside',
          amount: '20000',
          reason: 'Synthetic verified outside payer return',
          humanConfirmed: true,
        }),
      }),
    ),
  );
});
