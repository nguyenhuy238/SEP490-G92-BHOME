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
  mutation.mockReset().mockResolvedValue({ id: 'proposal-1' });
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
  expect(screen.getByText('100 kW')).toBeInTheDocument();
  expect(screen.getByText('200 m³')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xem ảnh bàn giao' })).not.toBeInTheDocument();
  expect(screen.queryByText('Chưa có phí')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tải xuống/ })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Xem ảnh' })).toHaveLength(2));
  const previews = screen.getAllByRole('button', { name: 'Xem ảnh' });
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
    path.endsWith('/handover/draft')
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
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem ảnh' })[1]);
  await waitFor(() =>
    expect(api.transport).toHaveBeenCalledWith(
      '/api/v1/contracts/contract-1/handover/draft/evidence/room-draft-photo',
      expect.objectContaining({ signal: expect.anything() }),
      'blob',
    ),
  );
});

it('allows pricing each Staff-inspected item without Owner review, then sends a described proposal to Tenant', async () => {
  mount();
  expect(await screen.findByText(/1\.200\.000/)).toBeInTheDocument();
  expect(screen.getByText(/100\.000/)).toBeInTheDocument();
  expect(screen.queryByText('Xác minh kết quả Staff')).not.toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi Tenant duyệt' }));
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
