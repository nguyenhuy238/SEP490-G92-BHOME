import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ContractClient } from '../../../../../packages/client-core/src/contracts';
import { OwnerHandoverDraftPanel } from './components/handover/OwnerHandoverDraftPanel';

vi.mock('../../components/common/PrivateEvidenceViewer', () => ({
  PrivateEvidenceViewer: ({
    label,
    fetchBlob,
    compactActions,
    previewButtonLabel,
  }: {
    label: string;
    fetchBlob: (signal: AbortSignal) => Promise<Blob>;
    compactActions?: boolean;
    previewButtonLabel?: string;
  }) => (
    <>
      <button type="button" onClick={() => void fetchBlob(new AbortController().signal)}>
        {previewButtonLabel ?? (compactActions ? 'Xem PDF' : label)}
      </button>
      {compactActions && <button type="button">Tải xuống</button>}
    </>
  ),
}));

const handInk = {
  width: 320,
  height: 140,
  strokes: [
    [
      [10, 10],
      [20, 25],
      [30, 20],
      [40, 40],
      [50, 35],
    ],
  ],
};
vi.mock('./components/signing/OwnerSigningPanel', () => ({
  DrawPad: ({
    onChange,
    disabled,
  }: {
    onChange: (ink: typeof handInk) => void;
    disabled: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(handInk)}>
      Vẽ chữ ký
    </button>
  ),
}));

vi.mock('./components/handover/InlineHandoverEvidence', () => ({
  InlineHandoverEvidence: ({
    label,
    fetchBlob,
  }: {
    label: string;
    fetchBlob: (signal: AbortSignal) => Promise<Blob>;
  }) => (
    <button
      type="button"
      aria-label={`Ảnh trực tiếp: ${label}`}
      onClick={() => void fetchBlob(new AbortController().signal)}
    >
      <img alt={label} src="blob:test-inline" />
    </button>
  ),
}));

const draft = {
  version: 4,
  ownerInkSigningSupported: true,
  status: 'PendingOwnerReview',
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

const ownerSignature = {
  certificateId: '00000000-0000-0000-0000-000000000000',
  method: 'OWNER_SESSION',
  consent: true,
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
  expect(screen.getByText('Điện: Chờ nhân viên xác nhận')).toBeInTheDocument();
  expect(
    screen.getByText('Chưa có chỉ số điện ban đầu được xác nhận, kèm ảnh'),
  ).toBeInTheDocument();
  expect(screen.getByText(/Tiền thuê: 3.000.000/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledWith('/api/v1/contracts/contract-1/handover/draft', {
    signal: expect.any(AbortSignal),
  });
});

it('summarizes the Staff inspection and its actual task status for Owner review', async () => {
  const { api } = client({
    ...draft,
    staffPreparedAt: '2026-11-20T08:30:00Z',
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'walls_ceiling_floor' ? { ...check, status: 'Issue' } : check,
    ),
    moveInTask: {
      id: 'task-1',
      status: 'PendingVerification',
      inventoryTaskId: null,
      inventoryStatus: 'Completed',
    },
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Kết quả nhân viên kiểm tra')).toBeInTheDocument();
  expect(screen.getByText('Hiện trạng phòng 7/7 mục')).toBeInTheDocument();
  expect(screen.getByText('1 mục có vấn đề')).toBeInTheDocument();
  expect(screen.getByText(/Nhiệm vụ bàn giao: Chờ xác minh/)).toBeInTheDocument();
  expect(screen.getByText(/Nhân viên lưu kiểm tra gần nhất:/)).toBeInTheDocument();
});

it('renders a compact review with integer meter readings and prioritizes canonical inventory issues even if draft assets are empty', async () => {
  const inventoryTaskId = '11111111-1111-4111-8111-111111111111';
  const current = {
    ...draft,
    electricity: { ...draft.electricity, value: '120.75' },
    water: { ...draft.water, value: '32.9' },
    noAssetsConfirmed: false,
    assets: [],
    inventoryHasIssues: true,
    moveInTask: {
      id: 'main-task',
      status: 'PendingVerification',
      inventoryTaskId,
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: inventoryTaskId,
          status: 'Completed',
          items: [
            {
              id: 'chair',
              name: 'Ghế bị hỏng',
              expectedQuantity: 2,
              actualQuantity: 1,
              condition: 'Damaged',
              notes: 'Gãy chân ghế',
              evidenceIds: [],
            },
          ],
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);

  expect(await screen.findByText('Điện và nước ban đầu')).toBeInTheDocument();
  expect(screen.getByText('Hiện trạng phòng và 7 hạng mục')).toBeInTheDocument();
  expect(screen.getByText('Kiểm kê tài sản')).toBeInTheDocument();
  expect(screen.getByText('Chìa khóa và vật dụng ra vào')).toBeInTheDocument();
  expect(await screen.findByText('Nhân viên đã kiểm kê 1/1')).toBeInTheDocument();
  expect(screen.queryByText(/nhóm\/hạng mục cần chủ trọ chú ý/)).not.toBeInTheDocument();
  expect(await screen.findByText('Ghế bị hỏng')).toBeInTheDocument();
  expect(screen.getByText(/Hư hỏng · Dự kiến 2, thực tế 1/)).toBeInTheDocument();
  expect(screen.getByText('Gãy chân ghế')).toBeInTheDocument();
  expect(screen.getByText('Điện: 120 kWh')).toBeInTheDocument();
  expect(screen.getByText('Nước: 32 m³')).toBeInTheDocument();
  expect(screen.queryByText('Điện: 120.75')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: /Xem đầy đủ nội dung biên bản/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ảnh bằng chứng/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tải xuống.*Ảnh/ })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Ảnh công tơ điện ban đầu' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Ảnh công tơ nước ban đầu' })).toBeInTheDocument();
});

it('counts only canonical damaged items alongside room issues when four stale draft assets look unchecked but Staff completed 4/4', async () => {
  const inventoryTaskId = '11111111-1111-4111-8111-111111111111';
  const assets = ['Giường ngủ', 'Bàn học', 'Ghế', 'Điều hòa'].map((name, index) => ({
    ...inspectedAsset,
    id: `asset-${index}`,
    name,
    checked: false,
    ownerChecked: false,
  }));
  const current = {
    ...draft,
    noAssetsConfirmed: false,
    inventoryHasIssues: true,
    assets,
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'walls_ceiling_floor'
        ? { ...check, status: 'Issue', notes: 'Tường bong tróc' }
        : check,
    ),
    moveInTask: {
      id: 'move-in',
      status: 'PendingVerification',
      inventoryTaskId,
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: inventoryTaskId,
          status: 'Completed',
          items: assets.map((asset, index) => ({
            id: asset.id,
            name: asset.name,
            expectedQuantity: 1,
            actualQuantity: 1,
            condition: index === 0 ? 'Damaged' : 'Good',
            notes: index === 0 ? 'Khung giường bị nứt' : '',
            evidenceIds: index === 0 ? ['photo-bed'] : [],
          })),
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);

  expect(await screen.findByText('Nhân viên đã kiểm kê 4/4')).toBeInTheDocument();
  expect(screen.getByText(/Tường bong tróc/)).toBeInTheDocument();
  expect(screen.getByText('Giường ngủ')).toBeInTheDocument();
  expect(screen.getByText(/Hư hỏng · Dự kiến 1, thực tế 1/)).toBeInTheDocument();
  expect(screen.getByText('Khung giường bị nứt')).toBeInTheDocument();
  expect(screen.queryByText(/Giường ngủ: Chưa kiểm kê/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Bàn học: Chưa kiểm kê/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Điều hòa: Chưa kiểm kê/)).not.toBeInTheDocument();
  expect(screen.queryByText('5 hạng mục cần chủ trọ chú ý')).not.toBeInTheDocument();
  expect(screen.queryByText(/Nhân viên đã hoàn tất · Phiếu kiểm kê gốc/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: /Chọn kiểm tra lại: Tài sản: Giường ngủ/ }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /công tơ/i })).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Ảnh trực tiếp: Giường ngủ · Ảnh kiểm kê 1' }),
  );
  expect(transport).toHaveBeenCalledWith(
    `/api/v1/operational-tasks/${inventoryTaskId}/evidence/photo-bed`,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
});

it('shows reinspection checkboxes only for problematic items, never for passed room checks, Good assets, or recorded keys', async () => {
  const assets = [
    { ...inspectedAsset, id: 'bed-1', name: 'Giường ngủ' },
    { ...inspectedAsset, id: 'chair-1', name: 'Ghế', damagedQuantity: 1 },
  ];
  const current = {
    ...draft,
    noAssetsConfirmed: false,
    assets,
    inspectedAssets: [
      {
        id: 'bed-1',
        name: 'Giường ngủ',
        expectedQuantity: 1,
        actualQuantity: 1,
        condition: 'Good',
      },
      { id: 'chair-1', name: 'Ghế', expectedQuantity: 1, actualQuantity: 1, condition: 'Damaged' },
    ],
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'walls_ceiling_floor' ? { ...check, status: 'Issue' } : check,
    ),
    moveInTask: {
      id: 'move-in',
      status: 'PendingVerification',
      inventoryTaskId: 'inventory-task-1',
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: 'inventory-task-1',
          status: 'Completed',
          items: current.inspectedAssets.map((asset) => ({ ...asset, evidenceIds: [] })),
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  expect(await screen.findByText('Nhân viên đã kiểm kê 2/2')).toBeInTheDocument();
  const options = screen.getAllByRole('checkbox', { name: /Chọn kiểm tra lại:/ });
  expect(options).toHaveLength(2);
  expect(options[0]).toHaveAccessibleName(/Tường, trần, sàn · Có vấn đề/);
  expect(options[1]).toHaveAccessibleName(/Tài sản: Ghế/);
  expect(
    screen.queryByRole('checkbox', { name: /Chọn kiểm tra lại: Tài sản: Giường ngủ/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /Chọn kiểm tra lại: Cửa, cửa sổ, khóa/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /Chọn kiểm tra lại: Hiện trạng chung/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /Chọn kiểm tra lại: Chìa khóa/ }),
  ).not.toBeInTheDocument();
});

it('hides the reinspection CTA completely for an all-passed compact draft and keeps short PDF actions', async () => {
  const { api } = client(draft);
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  expect(await screen.findByText('Chìa khóa và vật dụng ra vào')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Yêu cầu kiểm tra lại \(/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xem PDF' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải xuống' })).toBeInTheDocument();
  expect(screen.queryByText('Máy chủ không báo thiếu mục kiểm tra nào.')).not.toBeInTheDocument();
  expect(screen.queryByText('Đã kiểm tra đủ nội dung bàn giao')).not.toBeInTheDocument();
});

it('does not offer handwritten Ready against older backend versions that silently ignore ink', async () => {
  const { api, mutate } = client({ ...draft, ownerInkSigningSupported: undefined });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  await screen.findByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
  expect(screen.queryByText('Đã kiểm tra đủ nội dung bàn giao')).not.toBeInTheDocument();
  expect(screen.getByText(/phiên bản chưa hỗ trợ ký tay trực tiếp/)).toBeInTheDocument();
  const ready = screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
  expect(ready).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Vẽ chữ ký' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it('still offers reinspection for not-applicable room checks and zero recorded keys', async () => {
  const current = {
    ...draft,
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'bathroom_toilet'
        ? { ...check, status: 'NotApplicable', notes: 'Cần xác minh' }
        : check,
    ),
    accessItems: [{ type: 'RoomKey', quantity: 0, notes: '' }],
  };
  const { api } = client(current);
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  expect(await screen.findByText('Hiện trạng phòng và 7 hạng mục')).toBeInTheDocument();
  const options = screen.getAllByRole('checkbox', { name: /Chọn kiểm tra lại:/ });
  expect(options).toHaveLength(2);
  expect(options[0]).toHaveAccessibleName(/Nhà vệ sinh và thiết bị vệ sinh/);
  expect(options[1]).toHaveAccessibleName(/Chìa khóa và vật dụng ra vào/);
});

it('selects defective room and canonical asset items inline, confirms the reason once at the drawer end, and never sends Meter', async () => {
  const inventoryTaskId = 'inventory-task-1';
  const current = {
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, checked: false, damagedQuantity: 1 }],
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'walls_ceiling_floor'
        ? { ...check, status: 'Issue', notes: 'Tường hỏng' }
        : check,
    ),
    moveInTask: {
      id: 'move-in',
      status: 'PendingVerification',
      inventoryTaskId,
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport, mutate } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: inventoryTaskId,
          status: 'Completed',
          items: [
            {
              id: 'asset-1',
              name: 'Ghế',
              condition: 'Damaged',
              expectedQuantity: 2,
              actualQuantity: 1,
              notes: 'Ghế gãy',
              evidenceIds: [],
            },
          ],
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  expect(await screen.findByText('Nhân viên đã kiểm kê 1/1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Chọn kiểm tra lại: Tường, trần, sàn/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn kiểm tra lại: Tài sản: Ghế' }));
  expect(
    screen.queryByRole('checkbox', { name: /Meter|công tơ điện|công tơ nước/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Yêu cầu nhân viên kiểm tra lại từng hạng mục'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Xem đầy đủ nội dung biên bản')).not.toBeInTheDocument();
  expect(screen.queryByText(/Ảnh bằng chứng ·/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tải lại bản nháp' })).not.toBeInTheDocument();
  const requestReinspection = screen.getByRole('button', { name: 'Yêu cầu kiểm tra lại (2)' });
  const keysSection = screen.getByText('Chìa khóa và vật dụng ra vào').closest('section');
  expect(keysSection).not.toBeNull();
  expect(
    keysSection!.compareDocumentPosition(requestReinspection) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(requestReinspection);
  expect(
    screen.getByRole('dialog', { name: 'Xác nhận yêu cầu nhân viên kiểm tra lại' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gửi yêu cầu kiểm tra lại' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Nội dung nhân viên cần kiểm tra lại' }), {
    target: { value: '  Chụp lại tường và ghế đã sửa.  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu kiểm tra lại' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'contract-1',
      'handover/draft/reinspection',
      {
        version: 4,
        reason: 'Chụp lại tường và ghế đã sửa.',
        items: [
          { kind: 'RoomCheck', code: 'walls_ceiling_floor' },
          { kind: 'Asset', assetId: 'asset-1' },
        ],
      },
      expect.any(String),
    ),
  );
  expect(mutate).toHaveBeenCalledTimes(1);
});

it('does not fabricate an Asset reinspection ID when the canonical inventory item is absent from draft assets', async () => {
  const current = {
    ...draft,
    noAssetsConfirmed: false,
    assets: [],
    moveInTask: {
      id: 'move-in',
      status: 'PendingVerification',
      inventoryTaskId: 'inventory-1',
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport, mutate } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: 'inventory-1',
          status: 'Completed',
          items: [
            {
              id: 'canonical-bed-1',
              name: 'Giường ngủ',
              condition: 'Damaged',
              expectedQuantity: 1,
              actualQuantity: 1,
              notes: 'Hỏng khung',
              evidenceIds: [],
            },
          ],
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  // The canonical inventory is fetched after the draft and may take longer
  // when the entire Owner test suite is running in CI.
  expect(await screen.findByText('Giường ngủ', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(
    screen.getByText(/mã tài sản chưa được máy chủ xác nhận trong biên bản/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Tài sản: Giường ngủ/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Yêu cầu kiểm tra lại \(/ })).not.toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
});

it('uses server-inspected canonical asset IDs when the older draft.assets list is empty', async () => {
  const current = {
    ...draft,
    noAssetsConfirmed: false,
    assets: [],
    inspectedAssets: [
      {
        id: 'canonical-bed-1',
        name: 'Giường ngủ',
        condition: 'Damaged',
        expectedQuantity: 1,
        actualQuantity: 1,
        notes: 'Khung nứt',
      },
    ],
    moveInTask: {
      id: 'move-in',
      status: 'PendingVerification',
      inventoryTaskId: 'inventory-1',
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport, mutate } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: 'inventory-1',
          status: 'Completed',
          items: [
            {
              id: 'canonical-bed-1',
              name: 'Giường ngủ',
              condition: 'Damaged',
              expectedQuantity: 1,
              actualQuantity: 1,
              notes: 'Khung nứt',
              evidenceIds: [],
            },
          ],
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  expect(await screen.findByText('Nhân viên đã kiểm kê 1/1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn kiểm tra lại: Tài sản: Giường ngủ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu kiểm tra lại (1)' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nội dung nhân viên cần kiểm tra lại' }), {
    target: { value: 'Kiểm tra lại giường sau sửa chữa' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu kiểm tra lại' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'contract-1',
      'handover/draft/reinspection',
      {
        version: 4,
        reason: 'Kiểm tra lại giường sau sửa chữa',
        items: [{ kind: 'Asset', assetId: 'canonical-bed-1' }],
      },
      expect.any(String),
    ),
  );
});

it('allows compact Owner signing when a damaged asset is disclosed and the server reports no missing data', async () => {
  const current = {
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, checked: false }],
    missing: [],
    moveInTask: {
      id: 'task',
      status: 'PendingVerification',
      inventoryTaskId: 'inventory-1',
      inventoryStatus: 'Completed',
    },
  };
  const { api, transport, mutate } = client(current);
  transport.mockImplementation(async (path: string) =>
    path.endsWith('/move-in-inventory')
      ? {
          taskId: 'inventory-1',
          status: 'Completed',
          items: [
            {
              id: 'asset-1',
              name: 'Ghế',
              condition: 'Damaged',
              expectedQuantity: 2,
              actualQuantity: 2,
              notes: 'Ghế hỏng',
              evidenceIds: [],
            },
          ],
        }
      : current,
  );
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" compact />);
  expect(await screen.findByText('Nhân viên đã kiểm kê 1/1')).toBeInTheDocument();
  const ready = screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
  expect(ready).toBeDisabled(); // Ink and explicit consent are still required.
  expect(screen.queryByLabelText('Lý do chấp thuận ngoại lệ bàn giao')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Phương án xử lý ngoại lệ bàn giao')).not.toBeInTheDocument();
  expect(screen.getByText(/Một số hạng mục có vấn đề/)).toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
});

it('lets Owner request reinspection of only the selected room check and asset', async () => {
  const { api, mutate } = client({
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, damagedQuantity: 1 }],
    roomChecks: draft.roomChecks.map((check) =>
      check.code === 'walls_ceiling_floor' ? { ...check, status: 'Issue' } : check,
    ),
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText('Yêu cầu nhân viên kiểm tra lại từng hạng mục'),
  ).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Gửi yêu cầu nhân viên kiểm tra lại (0)' });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tường, trần, sàn · Có vấn đề/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tài sản: Ghế' }));
  expect(
    screen.getByRole('button', { name: 'Gửi yêu cầu nhân viên kiểm tra lại (2)' }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Nội dung nhân viên cần kiểm tra lại/), {
    target: { value: '  Kiểm tra lại phần tường và ghế.  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu nhân viên kiểm tra lại (2)' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'contract-1',
      'handover/draft/reinspection',
      {
        version: 4,
        reason: 'Kiểm tra lại phần tường và ghế.',
        items: [
          { kind: 'RoomCheck', code: 'walls_ceiling_floor' },
          { kind: 'Asset', assetId: 'asset-1' },
        ],
      },
      expect.any(String),
    ),
  );
});

it('does not offer Meter reinspection even with confirmed readings and keeps their evidence read-only', async () => {
  const { api, mutate, readingEvidence } = client(draft);
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);

  expect(
    await screen.findByText('Yêu cầu nhân viên kiểm tra lại từng hạng mục'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /Chỉ số và ảnh công tơ điện/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /Chỉ số và ảnh công tơ nước/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      'Chỉ số điện/nước đã xác nhận không thể yêu cầu kiểm tra lại qua bước này; kiểm tra qua quy trình công tơ riêng.',
    ),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Xem quản lý công tơ' })).not.toBeInTheDocument();
  expect(screen.getByText('Điện: 120 kWh')).toBeInTheDocument();
  expect(screen.getByText('Nước: 32 m³')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Ảnh công tơ điện ban đầu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh công tơ nước ban đầu' }));
  expect(readingEvidence).toHaveBeenCalledWith('electric', expect.any(AbortSignal));
  expect(readingEvidence).toHaveBeenCalledWith('water', expect.any(AbortSignal));
  expect(mutate).not.toHaveBeenCalled();
});

it('keeps the signing and reinspection actions unavailable before Staff submission', async () => {
  const { api, mutate } = client({ ...draft, status: 'Draft' });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText(/Đang kiểm tra bàn giao/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Yêu cầu nhân viên kiểm tra lại từng hạng mục'),
  ).not.toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
});

it('requires a fresh review when Staff submits a newer draft while Owner has the panel open', async () => {
  let serverDraft = { ...draft };
  const { api, mutate, transport } = client();
  transport.mockImplementation(async () => serverDraft);
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  const review = await screen.findByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ });
  const approve = screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
  fireEvent.click(review);
  expect(review).toBeChecked();
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ chữ ký' }));
  expect(approve).not.toBeDisabled();

  serverDraft = { ...draft, version: 5 };
  fireEvent.focus(window);
  // The compact Owner drawer deliberately no longer displays a "v5" chip.
  // A newer server draft must still invalidate the Owner's prior review.
  await waitFor(() => expect(review).not.toBeChecked());
  expect(review).not.toBeChecked();
  expect(approve).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it('shows the specific reinspection requests and prevents an Owner signature while Staff is correcting', async () => {
  const { api } = client({
    ...draft,
    status: 'ReinspectionRequested',
    reinspectionHistory: [
      {
        version: 4,
        reason: 'Cần kiểm tra lại khóa',
        ownerId: 'owner-1',
        requestedAt: '2026-11-20T08:30:00Z',
        items: [{ kind: 'RoomCheck', code: 'doors_windows_locks' }],
      },
    ],
    reinspectionItems: [{ kind: 'RoomCheck', code: 'doors_windows_locks' }],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Đã yêu cầu nhân viên kiểm tra lại')).toBeInTheDocument();
  expect(screen.getByText(/Cần kiểm tra lại khóa/)).toBeInTheDocument();
  expect(screen.getByText(/Cửa, cửa sổ, khóa · Đạt/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }),
  ).not.toBeInTheDocument();
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

it('shows the latest reinspection asset observations alongside a completed original inventory and keeps their evidence separate', async () => {
  const inventoryTaskId = '11111111-1111-4111-8111-111111111111';
  const oldPhoto = '22222222-2222-4222-8222-222222222222';
  const updatedPhoto = '33333333-3333-4333-8333-333333333333';
  const updated = {
    ...draft,
    version: 7,
    noAssetsConfirmed: false,
    moveInTask: {
      id: 'main-task',
      status: 'PendingVerification',
      inventoryTaskId,
      inventoryStatus: 'Completed',
    },
    reinspectionHistory: [
      {
        version: 5,
        reason: 'Kiểm tra lại ghế bị hỏng',
        ownerId: 'owner-1',
        requestedAt: '2026-11-20T08:30:00Z',
        items: [{ kind: 'Asset', assetId: inspectedAsset.id }],
      },
    ],
    assets: [
      {
        ...inspectedAsset,
        observedCondition: 'Chân ghế bị gãy',
        observedQuantity: 1,
        handedOverQuantity: 1,
        goodQuantity: 0,
        damagedQuantity: 1,
        missingQuantity: 1,
        notes: 'Ảnh chụp sau khi kiểm tra lại',
        evidenceIds: [updatedPhoto],
      },
    ],
  };
  const { api, transport } = client(updated);
  transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/move-in-inventory'))
      return {
        taskId: inventoryTaskId,
        status: 'Completed',
        items: [
          {
            id: inspectedAsset.id,
            name: 'Ghế',
            expectedQuantity: 2,
            actualQuantity: 2,
            condition: 'Good',
            notes: 'Kiểm kê lần đầu: hai ghế tốt',
            evidenceIds: [oldPhoto],
          },
        ],
      };
    if (path.endsWith(`/evidence/${oldPhoto}`) || path.endsWith(`/evidence/${updatedPhoto}`))
      return new Blob(['image'], { type: 'image/jpeg' });
    return updated;
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);

  expect(await screen.findByText('Kiểm kê gốc')).toBeInTheDocument();
  expect(screen.getByText('Kết quả cập nhật biên bản')).toBeInTheDocument();
  expect(
    screen.getByText(
      /Ghế \(đơn vị\): thực tế 1, bàn giao 1; tốt 0, hao mòn 0, hỏng 1, thiếu 1\. Chân ghế bị gãy/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Ghi chú cập nhật: Ảnh chụp sau khi kiểm tra lại')).toBeInTheDocument();
  expect(await screen.findByText('Kiểm kê lần đầu: hai ghế tốt')).toBeInTheDocument();
  expect(screen.getByText('Dự kiến 2 · Thực tế 2')).toBeInTheDocument();
  expect(screen.getByText('Nhân viên đã hoàn tất')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Ghế · Ảnh cập nhật 1' }));
  expect(transport).toHaveBeenCalledWith(
    `/api/v1/contracts/contract-1/handover/draft/evidence/${updatedPhoto}`,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ghế · Ảnh minh chứng 1' }));
  expect(transport).toHaveBeenCalledWith(
    `/api/v1/operational-tasks/${inventoryTaskId}/evidence/${oldPhoto}`,
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
      'Số lượng, đối chiếu tài sản hoặc ảnh bằng chứng kiểm kê chưa hợp lệ; nhân viên cần kiểm tra và bổ sung',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('asset_quantities_or_evidence')).not.toBeInTheDocument();

  const review = screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ });
  const ready = screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
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
    screen.getByText(/Chủ trọ quyết định chấp thuận tình trạng thực tế hoặc phương án xử lý/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Trám tường · nhân viên xử lý/)).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ }));
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it('requires explicit consent and ink before accepting a damaged inventory baseline', async () => {
  const { api, mutate } = client({
    ...draft,
    noAssetsConfirmed: false,
    inventoryHasIssues: true,
    assets: [inspectedAsset],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText(/Nhân viên ghi nhận tài sản thiếu hoặc hư hỏng trong phiếu kiểm kê/),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở quản lý sửa chữa' })).toHaveAttribute(
    'href',
    '/maintenance',
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ }));
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
  expect(screen.queryByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Phương án xử lý ngoại lệ bàn giao/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/Hạng mục có vấn đề sẽ được giữ nguyên trong biên bản/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }));
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
});

it('translates missing room checklist and blocks Owner Ready', async () => {
  const { api } = client({
    ...draft,
    roomChecks: [],
    missing: ['room_checklist', 'access_inventory'],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(
    await screen.findByText('Nhân viên chưa hoàn tất 7 hạng mục kiểm tra hiện trạng phòng'),
  ).toBeInTheDocument();
  expect(screen.getByText('Chưa ghi nhận số lượng chìa khóa bàn giao')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
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
  const ready = screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
  expect(ready).toBeDisabled();

  rerender(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(ready).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ chữ ký' }));
  expect(ready).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ }));
  fireEvent.click(ready);
  fireEvent.click(ready);
  expect(mutate).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith(
    'contract-1',
    'handover/draft/ready',
    { version: 4, signature: ownerSignature, ink: handInk },
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
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ chữ ký' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      'contract-1',
      'handover/draft/ready',
      { version: 4, signature: ownerSignature, ink: handInk },
      expect.any(String),
    ),
  );
});

it('shows recorded issues and still requires ink before signing', async () => {
  const { api, mutate } = client({
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, ownerChecked: false, missingQuantity: 1, damagedQuantity: 1 }],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  expect(
    screen.getByText(/Hạng mục có vấn đề sẽ được giữ nguyên trong biên bản/),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Phương án xử lý ngoại lệ bàn giao/)).not.toBeInTheDocument();
  const ready = screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' });
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ }));
  expect(ready).toBeDisabled();
  expect(ready).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(ready);
  expect(mutate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' })).toBeDisabled();
});

it.each([
  ['Chủ trọ chưa duyệt tài sản', { ownerChecked: false }],
  ['thiếu tài sản', { missingQuantity: 1 }],
  ['tài sản hỏng', { damagedQuantity: 1 }],
  ['số lượng kiểm kê lệch', { observedQuantity: 3 }],
  ['số lượng bàn giao ít hơn thực tế', { handedOverQuantity: 1 }],
] as const)('does not offer exception override for %s', async (_label, variation) => {
  const { api } = client({
    ...draft,
    noAssetsConfirmed: false,
    assets: [{ ...inspectedAsset, ...variation }],
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText('Phòng: TEST-101')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Lý do chấp thuận ngoại lệ bàn giao/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Phương án xử lý ngoại lệ bàn giao/)).not.toBeInTheDocument();
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
      screen.queryByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }),
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
  fireEvent.click(screen.getByRole('checkbox', { name: /đã kiểm tra PDF và đồng ý ký/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ chữ ký' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }));
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
    await screen.findByRole('button', { name: 'Xem biên bản bàn giao đã xác nhận' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Xem biên bản bàn giao đã xác nhận 2' }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Tải xuống' })).toHaveLength(2);
  expect(screen.queryByText(/Phiên bản 6/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /PDF bản nháp bàn giao/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Đây là phần tóm tắt dữ liệu/)).toBeInTheDocument();
  expect(handoverDocuments).toHaveBeenCalledWith('contract-1', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản bàn giao đã xác nhận' }));
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
    await screen.findByRole('button', { name: 'Xem biên bản bàn giao đã xác nhận' }),
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

it('previews the Owner-signed PDF rather than a draft when handover is Ready', async () => {
  const { api, transport, handoverDocuments } = client({
    ...draft,
    status: 'Ready',
    ownerSignedAt: '2026-11-20T09:00:00Z',
    ownerDocumentId: 'signed-doc-1',
  });
  render(<OwnerHandoverDraftPanel api={api} id="contract-1" contractStatus="Active" />);
  expect(await screen.findByText(/Chủ trọ đã ký và duyệt biên bản/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'PDF bàn giao chủ trọ đã ký' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'PDF bản nháp bàn giao (chưa xác nhận)' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Ký và duyệt biên bản bàn giao' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'PDF bàn giao chủ trọ đã ký' }));
  expect(transport).toHaveBeenCalledWith(
    '/api/v1/contracts/contract-1/handover/draft/pdf',
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(handoverDocuments).not.toHaveBeenCalled();
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
