import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import TenantRefundRequestsPage from './TenantRefundRequestsPage';

const mocks = vi.hoisted(() => ({
  ownerList: vi.fn(),
  decide: vi.fn(),
  execute: vi.fn(),
  ownerEvidence: vi.fn(),
  roles: ['Owner'],
}));

vi.mock('../useTenantRefundRequestsApi', () => ({
  useTenantRefundRequestsApi: () => mocks,
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner-test', roles: mocks.roles } }),
}));
vi.mock('../../../services/config', () => ({ isMockMode: false }));

type TestRow = {
  id: string;
  amount: string;
  reason: string;
  status: string;
  sourcePaymentId: string | null;
  sourceContractId: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  executedAt: string | null;
  externalReference: string | null;
  hasEvidence: boolean;
  version: number;
  tenantLabel: string;
  moveOutProposalId?: string | null;
};

const baseRow: TestRow = {
  id: 'petition-1',
  amount: '75000',
  reason: 'Chuyển dư tiền phòng, xin hoàn lại.',
  status: 'REQUESTED',
  sourcePaymentId: null,
  sourceContractId: null,
  createdAt: '2026-11-15T03:30:00Z',
  decidedAt: null,
  decisionReason: null,
  executedAt: null,
  externalReference: null,
  hasEvidence: false,
  version: 1,
  tenantLabel: 'Khách thuê thử nghiệm',
};

function page(items: TestRow[], totalCount = items.length) {
  return { items, page: 1, pageSize: 20, totalCount };
}

function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <TenantRefundRequestsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.roles = ['Owner'];
  mocks.ownerList.mockResolvedValue(page([baseRow]));
});

it('lists tenant petitions without requiring payment or contract and opens related records only when linked', async () => {
  mocks.ownerList.mockResolvedValue(
    page([
      baseRow,
      {
        ...baseRow,
        id: 'petition-2',
        sourcePaymentId: 'payment-2',
        sourceContractId: 'contract-2',
        status: 'APPROVED',
      },
    ]),
  );
  mount();
  const table = await screen.findByRole('table', { name: 'Danh sách đơn hoàn tiền từ Tenant' });
  expect(within(table).getAllByText('75.000 ₫')).toHaveLength(2);
  expect(within(table).getByText('Không gắn nguồn')).toBeInTheDocument();
  fireEvent.click(within(table).getAllByRole('button', { name: 'Xem và xử lý' })[0]!);
  expect(screen.getByText('Không liên kết giao dịch thanh toán.')).toBeVisible();
  expect(screen.getByText('Không liên kết hợp đồng.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết' }));
  await vi.waitFor(() =>
    expect(within(table).getAllByRole('button', { name: 'Xem và xử lý' })).toHaveLength(2),
  );
  fireEvent.click(within(table).getAllByRole('button', { name: 'Xem và xử lý' })[1]!);
  expect(screen.getByRole('link', { name: 'Xem thanh toán liên quan' })).toHaveAttribute(
    'href',
    '/payments?transferId=payment-2',
  );
  expect(screen.getByRole('link', { name: 'Xem hợp đồng liên quan' })).toHaveAttribute(
    'href',
    '/contracts?contractId=contract-2',
  );
});

it('requires an explicit review and reason, then approves with the server version and idempotency key', async () => {
  let current = baseRow;
  mocks.ownerList.mockImplementation(async () => page([current]));
  mocks.decide.mockImplementation(async (_id, body) => {
    current = {
      ...baseRow,
      status: body.approve ? 'APPROVED' : 'REJECTED',
      version: 2,
      decidedAt: '2026-11-15T04:00:00Z',
      decisionReason: body.reason,
    };
    return current;
  });
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem và xử lý' }))[0]!);
  const approve = screen.getByRole('button', { name: 'Duyệt yêu cầu' });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Lý do quyết định/), {
    target: { value: 'Đã xác minh chứng từ nguồn tiền' },
  });
  expect(approve).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText('Tôi đã xem yêu cầu và xác minh thông tin trước khi quyết định'),
  );
  fireEvent.click(approve);
  await vi.waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
  expect(mocks.decide).toHaveBeenCalledWith(
    'petition-1',
    {
      expectedVersion: 1,
      approve: true,
      reason: 'Đã xác minh chứng từ nguồn tiền',
      humanConfirmed: true,
    },
    expect.stringMatching(/^[\da-f-]{36}$/i),
  );
  expect(await screen.findByText('Đã duyệt đơn hoàn tiền.')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Xác nhận đã chuyển khoản và lưu chứng từ' }),
  ).toBeDisabled();
});

it('rejects with a written reason and does not offer payment execution', async () => {
  mocks.decide.mockResolvedValue({ ...baseRow, status: 'REJECTED' });
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem và xử lý' }))[0]!);
  fireEvent.change(screen.getByLabelText(/Lý do quyết định/), {
    target: { value: 'Thiếu hồ sơ xác minh khoản đã chuyển' },
  });
  fireEvent.click(
    screen.getByLabelText('Tôi đã xem yêu cầu và xác minh thông tin trước khi quyết định'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Từ chối và gửi lý do' }));
  await vi.waitFor(() =>
    expect(mocks.decide).toHaveBeenCalledWith(
      'petition-1',
      expect.objectContaining({
        expectedVersion: 1,
        approve: false,
        reason: 'Thiếu hồ sơ xác minh khoản đã chuyển',
      }),
      expect.any(String),
    ),
  );
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('allows approving a move-out refund petition but prevents double payout outside the deposit ledger', async () => {
  const row = {
    ...baseRow,
    status: 'APPROVED',
    version: 2,
    sourceContractId: 'contract-moveout',
    moveOutProposalId: 'proposal-moveout',
  };
  mocks.ownerList.mockResolvedValue(page([row]));
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem và xử lý' }))[0]!);
  expect(screen.getByText(/việc chuyển khoản hoàn cọc và lưu chứng từ phải được xử lý trong luồng hoàn cọc của hợp đồng/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem hợp đồng liên quan' })).toHaveAttribute(
    'href', '/contracts?contractId=contract-moveout',
  );
  expect(screen.queryByRole('button', { name: 'Xác nhận đã chuyển khoản và lưu chứng từ' })).not.toBeInTheDocument();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('records bank transfer with a PNG/JPEG receipt only after Owner confirms the actual transfer', async () => {
  let current = { ...baseRow, status: 'APPROVED', version: 2 };
  mocks.ownerList.mockImplementation(async () => page([current]));
  mocks.execute.mockImplementation(async (_id, body, file) => {
    expect(file).toBeInstanceOf(File);
    current = { ...current, status: 'COMPLETED', version: 3, hasEvidence: true };
    return { ...current, executedAt: body.executedAt };
  });
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem và xử lý' }))[0]!);
  const submit = screen.getByRole('button', { name: 'Xác nhận đã chuyển khoản và lưu chứng từ' });
  fireEvent.change(screen.getByLabelText(/Ghi chú xác minh chuyển khoản/), {
    target: { value: 'Đã kiểm tra sao kê chuyển khoản' },
  });
  fireEvent.change(screen.getByLabelText(/Mã tham chiếu trên sao kê/), {
    target: { value: 'BANK-REF-123' },
  });
  fireEvent.change(screen.getByLabelText(/Thời điểm chuyển khoản \(giờ Việt Nam\)/), {
    target: { value: '2026-11-15T15:10' },
  });
  fireEvent.change(screen.getByLabelText('Ảnh chứng từ chuyển khoản'), {
    target: { files: [new File(['synthetic'], 'receipt.png', { type: 'image/png' })] },
  });
  expect(submit).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi xác nhận đã chuyển khoản đúng người nhận, đúng số tiền và kiểm tra sao kê',
    ),
  );
  fireEvent.click(submit);
  await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
  expect(mocks.execute).toHaveBeenCalledWith(
    'petition-1',
    {
      expectedVersion: 2,
      executedAt: '2026-11-15T08:10:00.000Z',
      externalReference: 'BANK-REF-123',
      reason: 'Đã kiểm tra sao kê chuyển khoản',
      humanConfirmed: true,
    },
    expect.any(File),
    expect.stringMatching(/^[\da-f-]{36}$/i),
  );
  expect(await screen.findByText('Đã ghi nhận chứng từ chuyển khoản hoàn tiền.')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Xem Chứng từ chuyển khoản hoàn' }),
  ).toBeInTheDocument();
});

it('recovers an interrupted transfer with its original server key, metadata and exact evidence', async () => {
  const content = new TextEncoder().encode('abc');
  const original = new File([content], 'original.png', { type: 'image/png' });
  Object.defineProperty(original, 'arrayBuffer', { value: async () => content.slice().buffer });
  // SHA-256 for "abc". Browser crypto is simulated with the correct digest for
  // that input so this test also verifies the replay checks the supplied bytes.
  const originalHash = 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD';
  const initial = {
    ...baseRow,
    status: 'APPROVED',
    version: 2,
    executionIntent: {
      key: '1bc840b1-220a-4c9e-963e-dc462843a219',
      contentType: 'image/png',
      length: content.byteLength,
      sha256: originalHash,
      executedAt: '2026-11-15T07:30:00Z',
      externalReference: 'BANK-PRIOR-TRANSFER',
      reason: 'Giao dịch đã đối chiếu trước đó',
    } as {
      key: string;
      contentType: string;
      length: number;
      sha256: string;
      executedAt: string;
      externalReference: string;
      reason: string;
    } | null,
  };
  let row = initial;
  mocks.ownerList.mockImplementation(async () => page([row]));
  mocks.execute.mockImplementation(async () => {
    row = { ...initial, status: 'COMPLETED', version: 3, executionIntent: null };
    return row;
  });
  const oldSubtle = Object.getOwnPropertyDescriptor(crypto, 'subtle');
  const digest = vi.fn(async (_algorithm: string, input: Uint8Array) => {
    const matches = new TextDecoder().decode(input) === 'abc';
    const hex = matches ? originalHash : '00'.repeat(32);
    return Uint8Array.from(hex.match(/../g)!.map((part) => parseInt(part, 16))).buffer;
  });
  Object.defineProperty(crypto, 'subtle', { configurable: true, value: { digest } });
  try {
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem và xử lý' }))[0]!);
    expect(screen.getByText(/chưa hoàn tất lưu chứng từ/i)).toBeVisible();
    expect(screen.getByLabelText(/Ghi chú xác minh chuyển khoản/)).toBeDisabled();
    expect(screen.getByLabelText(/Mã tham chiếu trên sao kê/)).toHaveValue('BANK-PRIOR-TRANSFER');
    expect(screen.queryByLabelText(/Thời điểm chuyển khoản \(giờ Việt Nam\)/)).toBeNull();
    const badFile = new File(['different'], 'other.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Ảnh chứng từ chuyển khoản'), {
      target: { files: [badFile] },
    });
    fireEvent.click(
      screen.getByLabelText(
        'Tôi xác nhận đã chuyển khoản đúng người nhận, đúng số tiền và kiểm tra sao kê',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Phục hồi chứng từ chuyển khoản' }));
    expect(await screen.findByText(/Chứng từ không khớp yêu cầu đang chờ/)).toBeInTheDocument();
    expect(mocks.execute).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Ảnh chứng từ chuyển khoản'), {
      target: { files: [original] },
    });
    fireEvent.click(
      screen.getByLabelText(
        'Tôi xác nhận đã chuyển khoản đúng người nhận, đúng số tiền và kiểm tra sao kê',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Phục hồi chứng từ chuyển khoản' }));
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.execute).toHaveBeenCalledWith(
      'petition-1',
      {
        expectedVersion: 2,
        executedAt: '2026-11-15T07:30:00Z',
        externalReference: 'BANK-PRIOR-TRANSFER',
        reason: 'Giao dịch đã đối chiếu trước đó',
        humanConfirmed: true,
      },
      original,
      initial.executionIntent!.key,
    );
    expect(digest).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Đã ghi nhận chứng từ chuyển khoản hoàn tiền.')).toBeVisible();
  } finally {
    if (oldSubtle) Object.defineProperty(crypto, 'subtle', oldSubtle);
    else Reflect.deleteProperty(crypto, 'subtle');
  }
});

it('does not post a future-dated transfer or unrecognized evidence type', async () => {
  mocks.ownerList.mockResolvedValue(page([{ ...baseRow, status: 'APPROVED', version: 2 }]));
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem và xử lý' }))[0]!);
  fireEvent.change(screen.getByLabelText(/Ghi chú xác minh chuyển khoản/), {
    target: { value: 'Đã đối chiếu khoản hoàn' },
  });
  fireEvent.change(screen.getByLabelText(/Mã tham chiếu trên sao kê/), {
    target: { value: 'BANK-REF-123' },
  });
  fireEvent.change(screen.getByLabelText(/Thời điểm chuyển khoản \(giờ Việt Nam\)/), {
    target: { value: '2099-01-01T01:00' },
  });
  fireEvent.change(screen.getByLabelText('Ảnh chứng từ chuyển khoản'), {
    target: { files: [new File(['synthetic'], 'receipt.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(
    screen.getByLabelText(
      'Tôi xác nhận đã chuyển khoản đúng người nhận, đúng số tiền và kiểm tra sao kê',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã chuyển khoản và lưu chứng từ' }));
  expect(await screen.findByText(/Chỉ chấp nhận ảnh PNG\/JPEG/)).toBeVisible();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('prevents Staff from viewing the Owner queue or triggering its API', () => {
  mocks.roles = ['Staff'];
  mount();
  expect(screen.getByText('Chỉ Owner được xem và xử lý đơn hoàn tiền của Tenant.')).toBeVisible();
  expect(mocks.ownerList).not.toHaveBeenCalled();
});

it('shows a recoverable loading error without inventing any refund rows', async () => {
  mocks.ownerList.mockRejectedValue({ status: 503 });
  mount();
  expect(await screen.findByText(/Không tải được đơn hoàn tiền/)).toBeVisible();
  expect(
    screen.queryByRole('table', { name: 'Danh sách đơn hoàn tiền từ Tenant' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeVisible();
});
