import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ContractClient } from '../../../../../packages/client-core/src/contracts';
import { OwnerMoveOutReviewPanel } from './OwnerMoveOutReviewPanel';

const mutation = vi.fn();
const inspection = {
  id: 'inspection-1',
  version: 2,
  baselineContractId: 'contract-1',
  baselineVersion: 1,
  baseline: null,
  observed: {
    electricity: { id: '', value: '1234' },
    water: { id: '', value: '567' },
    assets: [],
    roomChecks: [
      { code: 'cleanliness', status: 'Issue', notes: 'Cần vệ sinh', evidenceIds: [] },
      { code: 'bathroom_toilet', status: 'Passed', notes: null, evidenceIds: [] },
    ],
    accessItems: [{ type: 'RoomKey', quantity: 5 }],
    keyEvidenceIds: [],
  },
  staffId: 'staff-1',
  inspectedAt: '2026-11-22T10:00:00Z',
  ownerDecision: null,
  ownerReason: null,
  reviewedAt: null,
};
const review = {
  contractId: 'contract-1',
  reference: 'source-reference-1',
  inspectionId: 'inspection-1',
  inspectionVersion: 2,
  verifiedDeposit: '1200000',
  availableDeposit: '1000000',
  existingOutstanding: '100000',
  items: [
    {
      kind: 'RoomCheck',
      roomCheckCode: 'cleanliness',
      label: 'Vệ sinh và hiện trạng phòng',
      baseline: null,
      observed: 'Có vấn đề · Cần vệ sinh',
      chargeable: true,
      evidenceIds: [],
    },
    {
      kind: 'RoomCheck',
      roomCheckCode: 'bathroom_toilet',
      label: 'Nhà vệ sinh và thiết bị vệ sinh',
      baseline: null,
      observed: 'Tốt',
      chargeable: true,
      evidenceIds: [],
    },
  ],
  latestProposal: null,
  status: 'None',
};
const api = {
  moveOut: vi.fn(),
  inspections: vi.fn(),
  inspectionPreparation: vi.fn(),
  transport: vi.fn(),
  handoverEvidence: vi.fn(),
  evidence: vi.fn(),
  readingEvidence: vi.fn(),
  mutate: mutation,
} as unknown as ContractClient;

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OwnerMoveOutReviewPanel api={api} id="contract-1" onChanged={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.inspectionPreparation).mockReset().mockResolvedValue({
    baseline: null,
    baselineContractId: null,
    finalReadings: [],
    otherTenantsRemain: false,
  });
  vi.mocked(api.moveOut)
    .mockReset()
    .mockResolvedValue({ status: 'Inspected' } as never);
  vi.mocked(api.inspections)
    .mockReset()
    .mockResolvedValue([inspection] as never);
  vi.mocked(api.transport)
    .mockReset()
    .mockResolvedValue(review as never);
  vi.mocked(api.handoverEvidence).mockReset();
  vi.mocked(api.evidence).mockReset();
  vi.mocked(api.readingEvidence).mockReset();
  const photo = () =>
    new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70])], { type: 'image/jpeg' });
  vi.mocked(api.handoverEvidence).mockImplementation(async () => photo());
  vi.mocked(api.evidence).mockImplementation(async () => photo());
  vi.mocked(api.readingEvidence).mockImplementation(async () => photo());
  mutation.mockReset().mockResolvedValue({ id: 'proposal-1' });
});

it('shows saved partial inspection during staff work without enabling financial approval', async () => {
  vi.mocked(api.moveOut).mockResolvedValue({ status: 'Approved' } as never);
  vi.mocked(api.transport).mockImplementation(async (path) => {
    if (path.endsWith('/move-out/inspection-draft')) {
      return {
        contractId: 'contract-1',
        roomCondition: 'Tường đã kiểm tra',
        keysAndAccess: '',
        notes: '',
        assets: [],
        roomChecks: [
          { code: 'cleanliness', status: 'Issue', notes: 'Cần vệ sinh', evidenceIds: [] },
        ],
        accessItems: [{ type: 'RoomKey', quantity: 0 }],
        evidenceIds: [],
        keyEvidenceIds: [],
        electricityReadingId: null,
        waterReadingId: null,
      } as never;
    }
    return review as never;
  });
  mount();
  expect(await screen.findByText('Hiện trạng chung: Tường đã kiểm tra')).toBeInTheDocument();
  expect(screen.getByText('Cần vệ sinh')).toBeInTheDocument();
  expect(screen.getByText('Số lượng: 0')).toBeInTheDocument();
  expect(screen.getByText('Điện: Chưa xác nhận')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Gửi.*duyệt/ })).not.toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
});

it('shows a completed move-out instead of the stale negative provisional balance', async () => {
  vi.mocked(api.moveOut).mockResolvedValue({ status: 'Completed' } as never);
  vi.mocked(api.transport).mockResolvedValue({ ...review, status: 'Outdated' } as never);
  mount();
  expect(await screen.findByText(/Máy chủ đã xác minh đủ khoản thanh toán/)).toBeInTheDocument();
  expect(await screen.findByText('Số còn cần thu hoặc hoàn')).toBeInTheDocument();
  expect(screen.getByText('Phí trả phòng đã chốt')).toBeInTheDocument();
  expect(screen.queryByText('Chênh lệch dự kiến')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Dữ liệu tài chính hoặc kết quả kiểm tra đã thay đổi/),
  ).not.toBeInTheDocument();
});

it('shows whole-number meter readings, Vietnamese item details and private opening/return photos without downloads', async () => {
  vi.mocked(api.inspections).mockResolvedValue([
    {
      ...inspection,
      baselineContractId: 'move-in-contract',
      baseline: {
        roomChecks: [
          {
            code: 'cleanliness',
            status: 'Passed',
            notes: 'Sạch khi bàn giao',
            evidenceIds: ['opening-photo'],
          },
        ],
        assets: [],
      },
      observed: {
        ...inspection.observed,
        electricity: { value: '100.0000', id: '' },
        water: { value: '200.0000', id: '' },
        roomChecks: [
          {
            code: 'cleanliness',
            status: 'Issue',
            notes: 'Hỏng rồi',
            evidenceIds: ['return-photo'],
          },
        ],
      },
    },
  ] as never);
  vi.mocked(api.transport).mockResolvedValue({
    ...review,
    baselineContractId: 'move-in-contract',
    items: [
      {
        ...review.items[0],
        baseline: 'Passed: Sạch khi bàn giao',
        observed: 'Issue: Hỏng rồi',
        baselineEvidenceIds: ['opening-photo'],
        evidenceIds: ['return-photo'],
      },
    ],
  } as never);
  mount();
  expect(await screen.findByText('Sạch khi bàn giao')).toBeInTheDocument();
  expect(screen.getByText('Hỏng rồi')).toBeInTheDocument();
  expect(screen.getAllByText('Tình trạng:').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('Passed')).not.toBeInTheDocument();
  expect(screen.queryByText('Issue')).not.toBeInTheDocument();
  expect(screen.queryByText('100.0000')).not.toBeInTheDocument();
  expect(screen.getByText('100 kWh')).toBeInTheDocument();
  expect(screen.getByText('200 m³')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xem ảnh bàn giao' })).not.toBeInTheDocument();
  expect(screen.queryByText('Chưa có phí')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tải xuống/ })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Xem ảnh' })).toHaveLength(2));
  const previews = screen.getAllByRole('button', { name: 'Xem ảnh' });
  await waitFor(() => expect(previews[0]).toBeEnabled());
  expect(screen.getByRole('img', { name: /Ảnh bàn giao/ })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Ảnh trả phòng/ })).toBeInTheDocument();
  fireEvent.click(previews[0]);
  await waitFor(() =>
    expect(api.handoverEvidence).toHaveBeenCalledWith(
      'move-in-contract',
      'opening-photo',
      expect.anything(),
    ),
  );
});

it('uses the same stored handover draft photos as the Bàn giao tab even when final snapshot has no photo IDs', async () => {
  vi.mocked(api.transport).mockImplementation(async (path) =>
    path.includes('/handover/draft/evidence/')
      ? (new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70])], {
          type: 'image/jpeg',
        }) as never)
      : path.endsWith('/handover/draft')
        ? ({
            status: 'Confirmed',
            contractId: 'contract-1',
            evidenceIds: ['general-draft'],
            roomChecks: [{ code: 'cleanliness', evidenceIds: ['room-draft-photo'] }],
            assets: [],
            keyEvidenceIds: [],
          } as never)
        : (review as never),
  );
  mount();
  await screen.findByText('Ảnh bàn giao chung');
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Xem ảnh' })).toHaveLength(2));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Xem ảnh' })[1]).toBeEnabled());
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem ảnh' })[1]);
  await waitFor(() =>
    expect(api.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/contract-1/handover/draft/evidence/room-draft-photo',
      expect.objectContaining({ signal: expect.anything() }),
      'blob',
    ),
  );
});

it('allows pricing Staff-inspected items and sending fees without a second Owner inspection approval', async () => {
  mount();
  expect(await screen.findByText(/1\.200\.000/)).toBeInTheDocument();
  expect(screen.getByText(/100\.000/)).toBeInTheDocument();
  expect(screen.queryByText('Xác minh kết quả nhân viên')).not.toBeInTheDocument();
  expect(screen.queryByText('Chờ chủ trọ xác nhận kiểm kê')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Xác nhận kết quả kiểm kê' }),
  ).not.toBeInTheDocument();
  const firstItem = await screen.findByRole('button', {
    name: 'Nhập phí · Vệ sinh và hiện trạng phòng',
  });
  const secondItem = screen.getByRole('button', {
    name: 'Nhập phí · Nhà vệ sinh và thiết bị vệ sinh',
  });
  expect(firstItem).toBeEnabled();
  expect(secondItem).toBeEnabled();
  fireEvent.click(firstItem);
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền cần thu (₫)' }), {
    target: { value: '250000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Lý do thu' }), {
    target: { value: 'Cần vệ sinh chuyên sâu' },
  });
  expect(screen.getByRole('textbox', { name: 'Lý do thu' })).toHaveValue('Cần vệ sinh chuyên sâu');
  expect(screen.getByRole('button', { name: 'Xong' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText(/\+650\.000/)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Sửa phí · Vệ sinh và hiện trạng phòng' }),
  ).toBeEnabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Mô tả bổ sung (nếu có)' }), {
    target: { value: 'Đề nghị người thuê xem chi tiết các khoản chi phí' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi khách thuê duyệt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận thực hiện' }));
  await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
  expect(mutation).toHaveBeenCalledWith(
    'contract-1',
    'move-out/receivables/proposal',
    expect.objectContaining({
      expectedReference: 'source-reference-1',
      inspectionId: 'inspection-1',
      inspectionVersion: 2,
      note: 'Đề nghị người thuê xem chi tiết các khoản chi phí',
      items: [
        {
          kind: 'RoomCheck',
          roomCheckCode: 'cleanliness',
          amount: '250000',
          reason: 'Cần vệ sinh chuyên sâu',
        },
      ],
    }),
    expect.any(String),
  );
});

it('shows the Tenant objection on the exact charge and lets Owner revise and resend it', async () => {
  vi.mocked(api.transport).mockResolvedValue({
    ...review,
    status: 'Disputed',
    latestProposal: {
      id: 'proposal-1',
      sourceReference: review.reference,
      items: [
        {
          kind: 'RoomCheck',
          roomCheckCode: 'cleanliness',
          amount: '250000',
          reason: 'Phí vệ sinh',
        },
      ],
      totalCharges: '250000',
      signedBalance: '650000',
      availableDeposit: '1000000',
      verifiedDeposit: '1200000',
      sentAt: '2026-11-22T10:00:00Z',
      tenantFeedback: {
        confirmed: false,
        reason: 'Mong chủ trọ kiểm tra lại ảnh',
        disputedItems: [
          {
            kind: 'RoomCheck',
            roomCheckCode: 'cleanliness',
            reason: 'Đã dọn sạch trước khi trả phòng',
          },
        ],
      },
    },
  } as never);
  mount();
  expect(await screen.findByText(/Khách thuê không đồng ý với đề xuất trước/)).toBeInTheDocument();
  expect(
    screen.getByText('Lý do khách thuê yêu cầu xem lại: Đã dọn sạch trước khi trả phòng'),
  ).toBeInTheDocument();
  expect(screen.getByText('Phản hồi chung: Mong chủ trọ kiểm tra lại ảnh')).toBeInTheDocument();
  expect(screen.getAllByText('Khách thuê không đồng ý phí')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Sửa phí · Vệ sinh và hiện trạng phòng' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền cần thu (₫)' }), {
    target: { value: '80000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Lý do thu' }), {
    target: { value: 'Giảm phí sau khi xem bằng chứng khách thuê' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi lại khách thuê duyệt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận thực hiện' }));
  await waitFor(() =>
    expect(mutation).toHaveBeenCalledWith(
      'contract-1',
      'move-out/receivables/proposal',
      expect.objectContaining({
        items: [
          {
            kind: 'RoomCheck',
            roomCheckCode: 'cleanliness',
            amount: '80000',
            reason: 'Giảm phí sau khi xem bằng chứng khách thuê',
          },
        ],
      }),
      expect.any(String),
    ),
  );
});

it('shows Staff final status and enables sending a proposal without redundant Owner confirmation', async () => {
  mount();
  expect(await screen.findByRole('button', { name: 'Gửi khách thuê duyệt' })).toBeEnabled();
  expect(screen.getByText('Chờ chủ trọ gửi phí')).toBeInTheDocument();
  expect(screen.queryByText('Chờ chủ trọ xác nhận kiểm kê')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Đã nhận kết quả nhân viên nhưng chủ trọ chưa xác nhận kiểm kê thực tế/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Xác nhận kết quả kiểm kê' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi khách thuê duyệt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thực hiện' }));
  await waitFor(() =>
    expect(mutation).toHaveBeenCalledWith(
      'contract-1',
      'move-out/receivables/proposal',
      expect.objectContaining({ inspectionId: 'inspection-1', items: [] }),
      expect.any(String),
    ),
  );
});

it('does not redirect a Tenant-accepted fee back to redundant Owner inspection review', async () => {
  vi.mocked(api.transport).mockResolvedValue({
    ...review,
    status: 'Accepted',
    latestProposal: {
      id: 'old-proposal',
      sourceReference: review.reference,
      items: [
        { kind: 'RoomCheck', roomCheckCode: 'cleanliness', amount: '20000', reason: 'Hỏng tường' },
      ],
      totalCharges: '20000',
      signedBalance: '-20000',
      availableDeposit: '0',
      verifiedDeposit: '0',
      sentAt: '2026-11-22T10:00:00Z',
      tenantFeedback: {
        confirmed: true,
        reason: '',
        settlement: {
          status: 'PendingOwnerReview',
          payableAmount: '0',
          refundAmount: '0',
          reason: 'owner_confirmed_inspection_required',
        },
      },
    },
  } as never);
  mount();
  expect(await screen.findByText('Khách thuê đã đồng ý đề xuất.')).toBeInTheDocument();
  expect(screen.getByText('Khách thuê đã đồng ý · Đang đối chiếu')).toBeInTheDocument();
  expect(screen.queryByText('Đã nhận kết quả nhân viên')).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Chủ trọ chưa xác nhận kết quả kiểm kê thực tế của nhân viên/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Khách thuê đã đồng ý nhưng khoản phí chưa đủ điều kiện/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Xác nhận kết quả kiểm kê' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Gửi khách thuê duyệt' })).not.toBeInTheDocument();
});

it.each([
  ['PendingTenant', null, 'Chờ khách thuê xác nhận phí'],
  ['Disputed', null, 'Khách thuê yêu cầu điều chỉnh phí'],
  ['Accepted', 'Payable', 'Khách thuê đã đồng ý · Đã tạo khoản phải thu'],
  ['Accepted', 'RefundEligible', 'Khách thuê đã đồng ý · Có tiền cọc cần hoàn'],
  ['Accepted', 'Settled', 'Đã quyết toán phí trả phòng'],
  ['Outdated', null, 'Khách thuê đã đồng ý · Cần đối chiếu dữ liệu'],
] as const)(
  'shows the actual move-out progress for %s / %s',
  async (status, settlement, expected) => {
    vi.mocked(api.transport).mockResolvedValue({
      ...review,
      status,
      latestProposal: {
        id: 'proposal-1',
        sourceReference: review.reference,
        items: [],
        totalCharges: '20000',
        signedBalance: '-20000',
        availableDeposit: '0',
        verifiedDeposit: '0',
        sentAt: '2026-11-22T10:00:00Z',
        tenantFeedback:
          status === 'Accepted' || status === 'Outdated'
            ? {
                confirmed: true,
                reason: '',
                settlement: settlement
                  ? { status: settlement, payableAmount: '20000', refundAmount: '0' }
                  : null,
              }
            : null,
      },
    } as never);
    mount();
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText('Đã nhận kết quả nhân viên')).not.toBeInTheDocument();
  },
);
