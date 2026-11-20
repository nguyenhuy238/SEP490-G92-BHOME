import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ContractClient } from '../../../../../packages/client-core/src/contracts';
import { OwnerHandoverDraftPanel } from './OwnerHandoverDraftPanel';

vi.mock('../../components/common/PrivateEvidenceViewer', () => ({
  PrivateEvidenceViewer: ({
    label,
    fetchBlob,
  }: {
    label: string;
    fetchBlob: (signal: AbortSignal) => Promise<Blob>;
  }) => (
    <button type="button" onClick={() => void fetchBlob(new AbortController().signal)}>
      {label}
    </button>
  ),
}));

const draft = {
  version: 4,
  status: 'Draft',
  contractId: 'contract-1',
  roomNumber: 'TEST-101',
  locationName: 'Cơ sở kiểm thử',
  locationAddress: 'Địa chỉ mẫu',
  startDate: '2026-11-19',
  endDate: '2027-11-18',
  monthlyRent: '3000000',
  requiredDeposit: '3000000',
  terms: 'Giữ gìn tài sản được bàn giao.',
  electricity: {
    id: 'electric',
    meterCode: 'E',
    utilityType: 1,
    value: '120',
    date: '2026-11-19',
    evidenceId: 'photo-e',
    evidenceHash: 'test',
  },
  water: {
    id: 'water',
    meterCode: 'W',
    utilityType: 2,
    value: '32',
    date: '2026-11-19',
    evidenceId: 'photo-w',
    evidenceHash: 'test',
  },
  assets: [],
  roomCondition: 'Đã vệ sinh',
  keysAndAccess: 'Hai chìa khóa',
  notes: '',
  evidenceIds: [],
  noAssetsConfirmed: true,
  roomChecks: [
    'walls_ceiling_floor',
    'doors_windows_locks',
    'electrical_lighting_outlets',
    'water_plumbing_drainage',
    'bathroom_toilet',
    'cleanliness',
    'safety_equipment',
  ].map((code) => ({ code, status: 'Passed', notes: '', evidenceIds: [] as string[] })),
  accessItems: [{ type: 'RoomKey', quantity: 2, notes: 'Đã giao đủ' }],
  outstandingIssues: [] as {
    code: string;
    description: string;
    responsibleParty: string;
    dueDate: string;
  }[],
  ownerReadyAt: null,
  tenantConfirmedAt: null,
  missing: [] as string[],
  requests: [] as {
    id: string;
    version: number;
    reason: string;
    status: string;
    createdAt: string;
    decisionReason?: string;
  }[],
};

function client(value: object = draft, mutate = vi.fn().mockResolvedValue({})) {
  const transport = vi.fn().mockResolvedValue(value);
  const readingEvidence = vi.fn().mockResolvedValue(new Blob());
  const handoverDocuments = vi.fn().mockResolvedValue([]);
  const handoverDocument = vi.fn().mockResolvedValue(new Blob());
  return {
    api: {
      transport,
      mutate,
      readingEvidence,
      handoverDocuments,
      handoverDocument,
    } as unknown as ContractClient,
    mutate,
    transport,
    readingEvidence,
    handoverDocuments,
    handoverDocument,
  };
}

const confirmedDocument = {
  id: 'move-in-pdf',
  contractId: 'contract-1',
  kind: 'MoveInReport',
  snapshotHash: 'hash',
  templateId: 'handover-MoveIn',
  templateVersion: 6,
  developmentOnly: false,
  recordedAt: '2026-11-19T06:00:00Z',
};

const inspectedAsset = {
  id: 'asset-1',
  name: 'Ghế',
  inventoryCondition: 'Tốt',
  observedCondition: 'Tốt',
  ownerChecked: true,
  checked: true,
  configuredQuantity: 2,
  observedQuantity: 2,
  handedOverQuantity: 2,
  goodQuantity: 2,
  wornQuantity: 0,
  damagedQuantity: 0,
  missingQuantity: 0,
  physicalAssets: [
    { id: 'physical-1', version: 1, quantity: 2, condition: 'Tốt', status: 'Active' },
  ],
  evidenceIds: [],
};

it('renders contract-filled draft and blocks readiness while Staff checklist is incomplete', async () => {
  const { api, mutate, transport } = client({
    ...draft,
    monthlyRent: 3000000,
    electricity: null,
    missing: ['electricity'],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);

  expect(await screen.findByText('Cơ sở: Cơ sở kiểm thử')).toBeInTheDocument();
  expect(screen.getByText('Điện: Chờ Staff xác nhận')).toBeInTheDocument();
  expect(
    screen.getByText('Chưa có chỉ số điện ban đầu được xác nhận, kèm ảnh'),
  ).toBeInTheDocument();
  expect(screen.getByText(/Tiền thuê: 3.000.000/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledWith('/api/v1/contracts/contract-1/handover/draft', {
    signal: expect.any(AbortSignal),
  });
});

it('shows Staff saved inventory from the task rather than stale draft assets and loads private evidence', async () => {
  const inventoryTaskId = '11111111-1111-4111-8111-111111111111';
  const fileId = '22222222-2222-4222-8222-222222222222';
  const response = {
    ...draft,
    noAssetsConfirmed: false,
    moveInTask: {
      id: 'main-task',
      status: 'InProgress',
      inventoryTaskId,
      inventoryStatus: 'InProgress',
    },
    assets: [
      { ...inspectedAsset, checked: false, observedQuantity: null, handedOverQuantity: null },
    ],
  };
  const { api, transport } = client(response);
  transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/move-in-inventory'))
      return {
        taskId: inventoryTaskId,
        status: 'InProgress',
        items: [
          {
            id: 'item-one',
            name: 'Bàn học',
            expectedQuantity: 1,
            actualQuantity: 1,
            condition: 'Good',
            notes: null,
            evidenceIds: [],
          },
          {
            id: 'item-two',
            name: 'Ghế',
            expectedQuantity: 2,
            actualQuantity: 1,
            condition: 'Missing',
            notes: 'Thiếu một chiếc',
            evidenceIds: [fileId],
          },
        ],
      };
    if (path.endsWith(`/evidence/${fileId}`)) return new Blob(['image'], { type: 'image/jpeg' });
    return response;
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Đã kiểm kê 2/2')).toBeInTheDocument();
  expect(screen.getByText('Bàn học')).toBeInTheDocument();
  expect(screen.getByText('Thiếu một chiếc')).toBeInTheDocument();
  expect(screen.getByText('Dự kiến 2 · Thực tế 1')).toBeInTheDocument();
  expect(screen.queryByText(/Ghế.*Chờ kiểm kê/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ghế · Ảnh minh chứng 1' }));
  expect(transport).toHaveBeenCalledWith(
    `/api/v1/operational-tasks/${inventoryTaskId}/evidence/${fileId}`,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
});

it('translates invalid asset quantities or evidence and blocks Owner Ready even when all asset groups are checked', async () => {
  const { api, mutate } = client({
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, checked: true, ownerChecked: true }],
    missing: ['asset_quantities_or_evidence'],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);

  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Số lượng, đối chiếu tài sản hoặc ảnh bằng chứng kiểm kê chưa hợp lệ; Staff cần kiểm tra và bổ sung',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('asset_quantities_or_evidence')).not.toBeInTheDocument();

  const review = screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ });
  const ready = screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' });
  expect(review).toBeDisabled();
  expect(ready).toBeDisabled();
  fireEvent.click(review);
  fireEvent.click(ready);
  expect(mutate).not.toHaveBeenCalled();
});

it('shows room checklist, physical keys and issue handling; requires Owner exception decision', async () => {
  const evidenceId = 'photo-wall';
  const { api, mutate, transport } = client({
    ...draft,
    keyEvidenceIds: ['photo-keys'],
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'walls_ceiling_floor'
        ? { ...check, status: 'Issue', notes: 'Vết nứt sẵn có gần cửa', evidenceIds: [evidenceId] }
        : check,
    ),
    outstandingIssues: [
      {
        code: 'walls_ceiling_floor',
        description: 'Trám tường',
        responsibleParty: 'Staff',
        dueDate: '2026-12-01',
      },
    ],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Tường, trần, sàn: Cần xử lý')).toBeInTheDocument();
  expect(screen.getByText('Vết nứt sẵn có gần cửa')).toBeInTheDocument();
  expect(screen.getByText('Số lượng thực giao: 2')).toBeInTheDocument();
  expect(screen.getByText('Ảnh chìa khóa: 1')).toBeInTheDocument();
  expect(
    screen.getByText(/Owner quyết định chấp thuận tình trạng thực tế hoặc phương án xử lý/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Trám tường · Staff xử lý/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tường, trần, sàn · Ảnh kiểm tra 1' }));
  await waitFor(() =>
    expect(transport).toHaveBeenCalledWith(
      '/api/v1/contracts/contract-1/handover/draft/evidence/photo-wall',
      { signal: expect.any(AbortSignal) },
      'blob',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh chìa khóa bàn giao 1' }));
  await waitFor(() =>
    expect(transport).toHaveBeenCalledWith(
      '/api/v1/contracts/contract-1/handover/draft/evidence/photo-keys',
      { signal: expect.any(AbortSignal) },
      'blob',
    ),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ }));
  expect(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it('requires Owner handling plan when Staff recorded damaged inventory even if the draft asset appears Good', async () => {
  const { api, mutate } = client({
    ...draft,
    noAssetsConfirmed: false,
    inventoryHasIssues: true,
    assets: [inspectedAsset],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText(/Staff ghi nhận tài sản thiếu hoặc hư hỏng trong phiếu kiểm kê/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ }));
  expect(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/), {
    target: { value: 'Tài sản hỏng đã được Staff chụp và mô tả đầy đủ.' },
  });
  fireEvent.change(screen.getByLabelText(/Phương án xử lý ngoại lệ bàn giao/), {
    target: { value: 'Owner sẽ xử lý sau khi bàn giao theo biên bản.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'contract-1',
      'handover/draft/ready',
      {
        version: 4,
        reason: 'Tài sản hỏng đã được Staff chụp và mô tả đầy đủ.',
        handlingPlan: 'Owner sẽ xử lý sau khi bàn giao theo biên bản.',
      },
      expect.any(String),
    ),
  );
});

it('translates missing room checklist and blocks Owner Ready', async () => {
  const { api } = client({
    ...draft,
    roomChecks: [],
    missing: ['room_checklist', 'access_inventory'],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText('Staff chưa hoàn tất 7 hạng mục kiểm tra hiện trạng phòng'),
  ).toBeInTheDocument();
  expect(screen.getByText('Chưa ghi nhận số lượng chìa khóa bàn giao')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' })).toBeDisabled();
});

it('requires Owner review and Active contract, then submits the exact displayed version once', async () => {
  let resolve!: () => void;
  const mutate = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const { api } = client(draft, mutate);
  const { rerender } = render(
    <OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="PendingActivation" />,
  );
  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  const ready = screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' });
  expect(ready).toBeDisabled();

  rerender(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(ready).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ }));
  fireEvent.click(ready);
  fireEvent.click(ready);
  expect(mutate).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith(
    'contract-1',
    'handover/draft/ready',
    { version: 4 },
    expect.any(String),
  );
  resolve();
  await waitFor(() => expect(screen.getByText(/Đã ghi nhận thao tác/)).toBeVisible());
});

it('keeps normal fully approved inventory Ready as a checkbox with version-only payload', async () => {
  const { api, mutate } = client({ ...draft, noAssetsConfirmed: false, assets: [inspectedAsset] });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  expect(screen.queryByLabelText('Lý do chấp thuận ngoại lệ bàn giao')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Phương án xử lý ngoại lệ bàn giao')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'contract-1',
      'handover/draft/ready',
      { version: 4 },
      expect.any(String),
    ),
  );
});

it('requires both exception fields, sends trimmed approval details, and clears them after success', async () => {
  const { api, mutate } = client({
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, ownerChecked: false, missingQuantity: 1, damagedQuantity: 1 }],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  expect(screen.getByText(/Nhập lý do và phương án xử lý ngoại lệ/)).toBeInTheDocument();
  const reason = screen.getByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/);
  const plan = screen.getByLabelText(/Phương án xử lý ngoại lệ bàn giao/);
  expect(reason).toHaveAttribute('maxLength', '2000');
  expect(plan).toHaveAttribute('maxLength', '2000');
  const ready = screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' });
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ }));
  expect(ready).toBeDisabled();
  fireEvent.change(reason, { target: { value: '    ' } });
  fireEvent.change(plan, { target: { value: '  Kiểm tra ảnh minh chứng.   ' } });
  expect(ready).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(reason, { target: { value: '  Ghế bị hỏng và thiếu số lượng.  ' } });
  fireEvent.click(ready);
  expect(mutate).toHaveBeenCalledWith(
    'contract-1',
    'handover/draft/ready',
    {
      version: 4,
      reason: 'Ghế bị hỏng và thiếu số lượng.',
      handlingPlan: 'Kiểm tra ảnh minh chứng.',
    },
    expect.any(String),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/)).toHaveValue(''),
  );
  expect(screen.getByLabelText(/Phương án xử lý ngoại lệ bàn giao/)).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' })).toBeDisabled();
});

it.each([
  ['Owner chưa duyệt tài sản', { ownerChecked: false }],
  ['thiếu tài sản', { missingQuantity: 1 }],
  ['tài sản hỏng', { damagedQuantity: 1 }],
  ['số lượng kiểm kê lệch', { observedQuantity: 3 }],
  ['số lượng bàn giao ít hơn thực tế', { handedOverQuantity: 1 }],
] as const)('recognizes the Ready exception for %s', async (_label, variation) => {
  const { api } = client({
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, ...variation }],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  expect(screen.getByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/)).toBeRequired();
  expect(screen.getByLabelText(/Phương án xử lý ngoại lệ bàn giao/)).toBeRequired();
});

it.each([
  ['Chấp thuận yêu cầu', true],
  ['Từ chối yêu cầu', false],
] as const)(
  'Owner %s with a reason and prevents marking disputed draft ready',
  async (button, accepted) => {
    const request = {
      id: 'request-1',
      version: 4,
      reason: 'Ảnh điều hòa chưa chính xác',
      status: 'Pending',
      createdAt: '2026-11-19T03:00:00Z',
    };
    const { api, mutate } = client({ ...draft, status: 'ChangesRequested', requests: [request] });
    render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
    expect(await screen.findByText(request.reason)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' }),
    ).not.toBeInTheDocument();

    const decision = screen.getByRole('button', { name: button });
    expect(decision).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Lý do quyết định / hướng xử lý'), {
      target: { value: 'Kiểm tra lại bằng chứng trước khi xác nhận.' },
    });
    fireEvent.click(decision);
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        'contract-1',
        'handover/draft/requests/request-1/decision',
        { version: 4, accepted, reason: 'Kiểm tra lại bằng chứng trước khi xác nhận.' },
        expect.any(String),
      ),
    );
  },
);

it('shows backend refusal instead of reporting success when readiness guard fails', async () => {
  const { api } = client(draft, vi.fn().mockRejectedValue(new Error('Bản nháp đã thay đổi')));
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  await screen.findByText('Phòng: TEST-101');
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra nội dung/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu sẵn sàng bàn giao' }));
  expect(await screen.findByText(/Kết quả thao tác chưa được xác nhận/)).toBeInTheDocument();
  expect(screen.queryByText(/Đã ghi nhận thao tác/)).not.toBeInTheDocument();
});

it('prefers the persisted confirmed MoveIn PDF over the watermarked draft and fetches it with authorization', async () => {
  const { api, handoverDocuments, handoverDocument, transport } = client({
    ...draft,
    status: 'Confirmed',
  });
  handoverDocuments.mockResolvedValue([
    { ...confirmedDocument, id: 'older-pdf', recordedAt: '2026-11-18T06:00:00Z' },
    { ...confirmedDocument, kind: 'AssetChangeReport', id: 'asset-report' },
    { ...confirmedDocument, contractId: 'related-contract', id: 'other-contract' },
    confirmedDocument,
  ]);
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('PDF biên bản bàn giao chính thức')).toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'PDF bàn giao đã xác nhận' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'PDF bàn giao đã xác nhận 2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /PDF bản nháp bàn giao/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Đây là phần tóm tắt dữ liệu/)).toBeInTheDocument();
  expect(handoverDocuments).toHaveBeenCalledWith('contract-1', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'PDF bàn giao đã xác nhận' }));
  expect(handoverDocument).toHaveBeenCalledWith(
    'contract-1',
    'move-in-pdf',
    expect.any(AbortSignal),
  );
  expect(transport).not.toHaveBeenCalledWith(
    '/api/v1/contracts/contract-1/handover/draft/pdf',
    expect.anything(),
    'blob',
  );
});

it('does not disguise a missing confirmed PDF as the official record, and can reload it', async () => {
  const { api, handoverDocuments } = client({ ...draft, status: 'Confirmed' });
  handoverDocuments.mockResolvedValueOnce([]).mockResolvedValueOnce([confirmedDocument]);
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText(/chưa tìm thấy PDF bàn giao chính thức đã lưu/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /PDF bản nháp bàn giao/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại biên bản' }));
  await waitFor(() => expect(handoverDocuments).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole('button', { name: 'PDF bàn giao đã xác nhận' }),
  ).toBeInTheDocument();
});

it('shows confirmed PDF list errors without falling back to draft watermark', async () => {
  const { api, handoverDocuments } = client({ ...draft, status: 'Confirmed' });
  handoverDocuments.mockRejectedValue(new Error('Không thể tải danh sách'));
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText(/Không tải được danh sách PDF bàn giao chính thức/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /PDF bản nháp bàn giao/ })).not.toBeInTheDocument();
});

it('uses private authorized routes for the draft PDF, room and asset photos, and initial meter proofs', async () => {
  const { api, transport, readingEvidence } = client({
    ...draft,
    evidenceIds: ['room-photo'],
    assets: [
      {
        id: 'asset-1',
        name: 'Ghế',
        inventoryCondition: 'Tốt',
        observedCondition: 'Tốt',
        observedQuantity: 1,
        handedOverQuantity: 1,
        goodQuantity: 1,
        wornQuantity: 0,
        damagedQuantity: 0,
        missingQuantity: 0,
        checked: true,
        evidenceIds: ['asset-photo'],
      },
    ],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  await screen.findByText('Phòng: TEST-101');
  fireEvent.click(screen.getByRole('button', { name: 'PDF bản nháp bàn giao (chưa xác nhận)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh hiện trạng phòng 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ghế · Ảnh kiểm kê 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh công tơ điện ban đầu' }));

  expect(transport).toHaveBeenCalledWith(
    '/api/v1/contracts/contract-1/handover/draft/pdf',
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(transport).toHaveBeenCalledWith(
    '/api/v1/contracts/contract-1/handover/draft/evidence/room-photo',
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(transport).toHaveBeenCalledWith(
    '/api/v1/contracts/contract-1/handover/draft/evidence/asset-photo',
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(readingEvidence).toHaveBeenCalledWith('electric', expect.any(AbortSignal));
});
