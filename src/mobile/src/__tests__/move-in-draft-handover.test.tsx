// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContractClient, ContractView } from '../../../../packages/client-core/src/contracts';
import type { MoveInDraft } from '../services/moveInHandover';
import type { MoveInInventory } from '../services/moveInInventory';
import { roomHandoverChecks } from '../services/moveInHandover';

const state = vi.hoisted(() => ({
  location: '12345678-1234-4234-8234-123456789abc',
  transport: vi.fn(),
  documents: vi.fn(),
  updated: vi.fn(),
  draft: {} as MoveInDraft,
  inventory: null as MoveInInventory | null,
  viewportWidth: 320,
  resetScroll: vi.fn(),
  modalScrollTo: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: '/private-handover-cache' },
  Directory: class {
    create() {
      /* web-only test */
    }
  },
  File: class {
    create() {
      /* web-only test */
    }
    write() {
      /* web-only test */
    }
  },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  useWindowDimensions: () => ({ width: state.viewportWidth, height: 730 }),
  StyleSheet: { create: (styles: object) => styles },
  View: ({
    children,
    testID,
    style,
    accessibilityElementsHidden,
    onLayout,
  }: {
    children: React.ReactNode;
    testID?: string;
    style?: unknown;
    accessibilityElementsHidden?: boolean;
    onLayout?: (event: { nativeEvent: { layout: { y: number } } }) => void;
  }) => {
    React.useEffect(() => {
      onLayout?.({
        nativeEvent: { layout: { y: testID === 'inspection-photo-field' ? 360 : 200 } },
      });
    }, [onLayout, testID]);
    return (
      <div
        data-testid={testID}
        aria-hidden={accessibilityElementsHidden}
        data-rn-style={JSON.stringify(
          Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style,
        )}
      >
        {children}
      </div>
    );
  },
  ScrollView: React.forwardRef(({ children }: { children: React.ReactNode }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: state.modalScrollTo }));
    return <div>{children}</div>;
  }),
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
}));
vi.mock('../theme/theme', () => ({
  colors: {
    blue: '#1052cf',
    border: '#e2e8f0',
    tint: '#e8edff',
    green: '#168565',
    red: '#ba1a1a',
    amber: '#a86108',
    muted: '#64748b',
    navy: '#001637',
  },
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ staffLocationId: state.location, resetScroll: state.resetScroll }),
}));
vi.mock('../lib/randomUUID', () => ({
  randomUUID: () => '10000000-0000-4000-8000-000000000001',
}));
vi.mock('../lib/toast', () => ({ conciseMessage: (message: string) => message }));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <section>
      <h2>{title}</h2>
      <small>{detail}</small>
    </section>
  ),
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  ui: {},
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Icon: ({ source, color }: { source: string; color: string }) => (
    <span data-testid="paper-icon" data-source={source} data-color={color} />
  ),
  IconButton: ({
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel: string;
  }) => (
    <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      ×
    </button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityState,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityState?: { selected?: boolean };
  }) => (
    <button
      aria-label={accessibilityLabel}
      aria-pressed={accessibilityState?.selected}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  ProgressBar: ({ progress }: { progress: number }) => (
    <div role="progressbar" aria-valuenow={progress * 100} />
  ),
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  SegmentedButtons: ({
    value,
    onValueChange,
    buttons,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    buttons: { value: string; label: string; disabled?: boolean }[];
  }) => (
    <div>
      {buttons.map((button) => (
        <button
          key={button.value}
          aria-pressed={value === button.value}
          disabled={button.disabled}
          onClick={() => onValueChange(button.value)}
        >
          {button.label}
        </button>
      ))}
    </div>
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
      disabled?: boolean;
    }) => (
      <button
        aria-label={label}
        aria-pressed={status === 'checked'}
        disabled={disabled}
        onClick={onPress}
      >
        {label}
      </button>
    ),
  },
  RadioButton: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button
        role="radio"
        aria-label={label}
        aria-checked={status === 'checked'}
        disabled={disabled}
        onClick={onPress}
      >
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
    disabled,
    error,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    error?: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  ),
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({
    label,
    onCapture,
    disabled,
    presentation,
  }: {
    label: string;
    onCapture: (bytes: Uint8Array) => void;
    disabled: boolean;
    presentation: string;
  }) => (
    <button
      data-presentation={presentation}
      disabled={disabled}
      onClick={() => onCapture(new Uint8Array([1, 2, 3]))}
    >
      {label}
    </button>
  ),
}));
vi.mock('../features/contracts/handover/ContractInitialMeterTasks', () => ({
  ContractInitialMeterTasks: ({
    integrated,
    refreshRevision,
    onOpenTask,
  }: {
    integrated?: boolean;
    refreshRevision?: number;
    onOpenTask?: (taskId: string, label: string) => void;
  }) => (
    <>
      <span>
        {integrated ? 'Chụp điện nước trong công việc' : 'Nhiệm vụ chỉ số điện nước ban đầu'}
      </span>
      {integrated && (
        <>
          <span data-testid="meter-refresh-version">{refreshRevision}</span>
          <button onClick={() => onOpenTask?.('50000000-0000-4000-8000-000000000001', 'Điện')}>
            Mở OCR công tơ điện
          </button>
        </>
      )}
    </>
  ),
}));
vi.mock('../app/meter', () => ({
  MeterTaskScreen: ({ onReturn }: { onReturn: () => void }) => (
    <>
      <span>Biểu mẫu OCR điện nước</span>
      <button onClick={onReturn}>Đã xác nhận chỉ số trong OCR</button>
    </>
  ),
}));
vi.mock('../screens/StaffMoveInInventoryScreen', () => ({
  StaffMoveInInventoryScreen: ({ embeddedItemId }: { embeddedItemId?: string }) => (
    <span data-testid="inventory-editor" data-item-id={embeddedItemId}>
      Phiếu kiểm kê nội bộ
    </span>
  ),
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: ({
    label,
    handoverDocumentId,
    draftHandoverPdf,
    draftHandoverEvidence,
    thumbnail,
    localThumbnailUri,
  }: {
    label: string;
    handoverDocumentId?: string;
    draftHandoverPdf?: boolean;
    draftHandoverEvidence?: boolean;
    thumbnail?: boolean;
    localThumbnailUri?: string;
  }) => (
    <span
      data-preview-uri={localThumbnailUri}
      data-testid={
        thumbnail
          ? 'private-photo-thumbnail'
          : handoverDocumentId
            ? 'final-handover-pdf'
            : draftHandoverPdf
              ? 'draft-handover-pdf'
              : draftHandoverEvidence
                ? 'private-handover-photo'
                : undefined
      }
      data-document-id={handoverDocumentId}
    >
      {label}
    </span>
  ),
}));
vi.mock('../features/contracts/signing/SignaturePad', () => ({
  SignaturePad: ({ onChange }: { onChange: (drawing: object | null) => void }) => (
    <button
      onClick={() =>
        onChange({
          width: 320,
          height: 200,
          strokes: [
            [
              [10, 10],
              [15, 15],
              [30, 20],
              [35, 27],
              [60, 40],
            ],
          ],
        })
      }
    >
      Vẽ chữ ký khách thuê
    </button>
  ),
}));
vi.mock('../features/contracts/signing/SigningSetup', () => ({
  SignatureImageSection: () => <span>Ảnh chữ ký đã lưu</span>,
}));
vi.mock('../features/contracts/handover/HandoverAssetFields', () => ({
  HandoverAssetFields: ({
    asset,
    set,
    evidenceIds,
  }: {
    asset: { id: string; name: string };
    set: (key: string, value: string) => void;
    evidenceIds: string[];
  }) => (
    <button
      onClick={() => {
        set(`${asset.id}.checked`, 'true');
        if (evidenceIds[0]) set(`${asset.id}.evidence.${evidenceIds[0]}`, 'true');
      }}
    >{`Đã kiểm kê ${asset.name}`}</button>
  ),
}));

import { MoveInDraftHandoverPanel } from '../features/contracts/handover/MoveInDraftHandoverPanel';

const contract = {
  id: '00000000-0000-4000-8000-000000000001',
  locationId: state.location,
  kind: 'Main',
  status: 'PendingActivation',
} as ContractView;

const api = {
  transport: state.transport,
  handoverDocuments: state.documents,
} as unknown as ContractClient;

function draft(status: MoveInDraft['status'], missing: string[] = []): MoveInDraft {
  return {
    version: 7,
    status,
    contractId: contract.id,
    roomNumber: '101',
    locationName: 'Cơ sở thử nghiệm',
    locationAddress: 'Địa chỉ thử nghiệm',
    startDate: '2026-11-20',
    endDate: '2027-11-19',
    monthlyRent: 3200000,
    requiredDeposit: 3200000,
    terms: '',
    electricity: null,
    water: null,
    assets: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Quạt',
        inventoryCondition: 'Tốt',
        observedCondition: 'Tốt',
        checked: false,
      },
    ],
    roomCondition: 'Sạch',
    keysAndAccess: '1 chìa',
    notes: '',
    evidenceIds: [],
    roomChecks: [],
    accessItems: [],
    outstandingIssues: [],
    moveInTask: {
      id: '40000000-0000-4000-8000-000000000000',
      status: 'InProgress',
      version: 3,
      canInspect: true,
    },
    noAssetsConfirmed: false,
    requests: [],
    missing,
  };
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:unsaved-room-photo'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  state.location = contract.locationId;
  state.viewportWidth = 320;
  state.draft = draft('Draft', ['Chưa xác nhận điện']);
  state.inventory = null;
  state.documents.mockResolvedValue([]);
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/handover/draft/evidence'))
      return { id: '30000000-0000-4000-8000-000000000001' };
    if (path.endsWith('/move-in-inventory')) return state.inventory;
    if (path.endsWith('/handover/draft')) return state.draft;
    return { ...state.draft };
  });
});

function linkedInventory(status: string, checked = false): MoveInInventory {
  return {
    taskId: '60000000-0000-4000-8000-000000000001',
    contractId: contract.id,
    roomId: '70000000-0000-4000-8000-000000000001',
    locationId: contract.locationId,
    status,
    version: 2,
    dueAt: null,
    completedAt: status === 'Completed' ? '2026-11-20T00:00:00Z' : null,
    readyForHandover: false,
    items: [
      {
        id: state.draft.assets[0]!.id,
        assetId: null,
        name: state.draft.assets[0]!.name,
        expectedQuantity: 1,
        actualQuantity: checked ? 1 : null,
        condition: checked ? 'Good' : null,
        notes: '',
        evidenceIds: checked ? ['30000000-0000-4000-8000-000000000001'] : [],
        incidentId: null,
      },
    ],
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function captureProof(id = '30000000-0000-4000-8000-000000000001') {
  const existing = state.transport.getMockImplementation()!;
  state.transport.mockImplementation(async (path: string, init?: unknown) =>
    path.endsWith('/handover/draft/evidence') ? { id } : existing(path, init),
  );
  const count = screen.queryAllByTestId('private-photo-thumbnail').length;
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await waitFor(() =>
    expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(count + 1),
  );
}

function openSection(index: 1 | 2 | 3 | 4) {
  const titles = [
    'Ghi chỉ số điện nước',
    'Kiểm tra hiện trạng phòng',
    'Kiểm kê tài sản',
    'Chìa khóa bàn giao',
  ];
  fireEvent.click(screen.getByRole('button', { name: `${index}. ${titles[index - 1]}` }));
}
function openWork(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}
function closeWork() {
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
}
function home() {
  fireEvent.click(screen.getByRole('button', { name: 'Về 4 mục bàn giao' }));
}
function saveWork() {
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ' }));
}

it('automatically refreshes the embedded meter list when the OCR task returns', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '1. Ghi chỉ số điện nước' });
  openSection(1);
  expect(screen.getByTestId('meter-refresh-version').textContent).toBe('1');
  expect(screen.queryByRole('button', { name: 'Cập nhật trạng thái điện nước' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mở OCR công tơ điện' }));
  expect(screen.getByText('Biểu mẫu OCR điện nước')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đã xác nhận chỉ số trong OCR' }));
  expect(await screen.findByTestId('meter-refresh-version')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('meter-refresh-version').textContent).toBe('2'));
  expect(
    state.transport.mock.calls.filter(([path]) => path.endsWith('/handover/draft')).length,
  ).toBeGreaterThan(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Về 4 mục bàn giao' })).toBeTruthy();
});

it('at 320px selects room condition inline and resets outer scroll when switching sections', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  expect(screen.getByRole('progressbar')).toBeTruthy();
  openSection(2);
  expect(state.resetScroll).toHaveBeenCalledTimes(1);
  // The section has its own compact header: no duplicate progress/multi-line
  // explanation pushing the first work row under text at phone widths.
  expect(screen.queryByRole('progressbar')).toBeNull();
  openWork('Tường, trần và sàn');
  const options = screen.getAllByRole('radio');
  expect(options).toHaveLength(3);
  fireEvent.click(screen.getByRole('radio', { name: 'Có vấn đề' }));
  expect(screen.getByRole('radio', { name: 'Có vấn đề' }).getAttribute('aria-checked')).toBe(
    'true',
  );
  expect(screen.getByLabelText('Ghi chú (không bắt buộc)')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Có vấn đề' })).toBeNull();
  closeWork();
  home();
  expect(state.resetScroll).toHaveBeenCalledTimes(2);
});

it('keeps the existing segmented room choices at desktop widths', async () => {
  state.viewportWidth = 720;
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  expect(state.resetScroll).not.toHaveBeenCalled();
  openWork('Tường, trần và sàn');
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đạt' }));
  expect(screen.getByLabelText('Ghi chú (không bắt buộc)')).toBeTruthy();
});

it('allows Tenant to view Draft but hides both actions until Owner marks Ready', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Đang chuẩn bị')).toBeTruthy();
  expect(
    screen.getByText(/Biên bản đang được nhân viên kiểm tra hoặc chủ trọ xem xét/),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xác nhận biên bản bàn giao' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' })).toBeNull();
  expect(state.transport).toHaveBeenCalledTimes(1);
});

it('translates handover readiness blockers, including invalid asset quantities or evidence, into Vietnamese', async () => {
  state.draft = draft('Draft', [
    'contract_active',
    'electricity',
    'assets',
    'asset_quantities_or_evidence',
    'unknown_new_guard',
  ]);
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText(/Hợp đồng chưa được kích hoạt/)).toBeTruthy();
  expect(screen.getByText(/Chưa có chỉ số điện khởi tạo đã xác nhận/)).toBeTruthy();
  expect(screen.getByText(/Chưa kiểm kê đầy đủ các nhóm tài sản/)).toBeTruthy();
  expect(
    screen.getByText(/Số lượng, tình trạng hoặc ảnh bằng chứng tài sản chưa hợp lệ/),
  ).toBeTruthy();
  expect(screen.getByText(/Còn điều kiện bàn giao chưa đạt/)).toBeTruthy();
  expect(
    screen.queryByText(/asset_quantities_or_evidence|contract_active|unknown_new_guard/),
  ).toBeNull();
});

it('Tenant opens a correction modal without signing consent and sends a versioned reason', async () => {
  state.draft = draft('Ready');
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={contract}
      role="Tenant"
      onUpdated={state.updated}
    />,
  );
  const correction = await screen.findByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' });
  expect((correction as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByLabelText('Ghi chú / nội dung cần sửa')).toBeNull();
  expect(screen.queryByLabelText('Lý do yêu cầu chỉnh sửa')).toBeNull();
  fireEvent.click(correction);
  expect(screen.getByText('Yêu cầu chỉnh sửa biên bản')).toBeTruthy();
  const submit = screen.getByRole('button', { name: 'Gửi yêu cầu' });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu chỉnh sửa'), {
    target: { value: 'Sửa số lượng tài sản bàn giao' },
  });
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/requests`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: 7, reason: 'Sửa số lượng tài sản bàn giao' }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    ),
  );
  expect(state.updated).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByText('Yêu cầu chỉnh sửa biên bản')).toBeNull());
});

it('Tenant keeps the correction dialog and reason when sending fails, then retries', async () => {
  state.draft = draft('Ready');
  let attempts = 0;
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/handover/draft/requests') && ++attempts === 1)
      throw { status: 503, message: 'Server unavailable' };
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' }));
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu chỉnh sửa'), {
    target: { value: 'Kiểm tra lại cửa phòng' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
  await waitFor(() => expect(attempts).toBe(1));
  expect(screen.getByText('Yêu cầu chỉnh sửa biên bản')).toBeTruthy();
  expect((screen.getByLabelText('Lý do yêu cầu chỉnh sửa') as HTMLInputElement).value).toBe(
    'Kiểm tra lại cửa phòng',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
  await waitFor(() => expect(attempts).toBe(2));
  await waitFor(() => expect(screen.queryByText('Yêu cầu chỉnh sửa biên bản')).toBeNull());
});

it('Tenant directly signs the Owner-reviewed PDF in their account without OTP', async () => {
  state.draft = draft('Ready');
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/tenant-sign/session')) {
      state.draft = { ...state.draft, version: 8, status: 'Confirmed' };
      return state.draft;
    }
    return state.draft;
  });
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
    />,
  );
  const acknowledge = await screen.findByRole('button', {
    name: 'Tôi đã xem biên bản và đồng ý nhận phòng theo hiện trạng ghi nhận, kể cả các mục có vấn đề',
  });
  const drawing = screen.getByRole('button', { name: 'Vẽ chữ ký khách thuê' });
  expect(
    drawing.compareDocumentPosition(acknowledge) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByText(/Vẽ chữ ký vào khung\. Chữ ký sẽ/)).toBeNull();
  expect(screen.queryByText('Ghi chú / nội dung cần sửa')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Biên bản và chữ ký' }));
  expect(screen.getByTestId('draft-handover-pdf').textContent).toContain('chủ trọ đã ký');
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(
    (screen.getByRole('button', { name: 'Ký và hoàn tất bàn giao' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Vẽ chữ ký khách thuê' }));
  expect(
    (screen.getByRole('button', { name: 'Ký và hoàn tất bàn giao' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(acknowledge);
  fireEvent.click(screen.getByRole('button', { name: 'Ký và hoàn tất bàn giao' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/tenant-sign/session`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          version: 7,
          consent: true,
          ink: {
            width: 320,
            height: 200,
            strokes: [
              [
                [10, 10],
                [15, 15],
                [30, 20],
                [35, 27],
                [60, 40],
              ],
            ],
          },
          note: '',
        }),
      }),
    ),
  );
  expect(await screen.findByText('Đã xác nhận')).toBeTruthy();
  expect(state.transport.mock.calls.every(([path]) => !path.includes('/otp'))).toBe(true);
  expect(
    state.transport.mock.calls.every(([path]) => !path.includes('signature-image/drawn')),
  ).toBe(true);
});

it('verifies a committed Tenant signature by GET when the POST response times out, without sending another POST', async () => {
  state.draft = draft('Ready');
  let sessionSignPosts = 0;
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/tenant-sign/session')) {
      sessionSignPosts++;
      state.draft = {
        ...state.draft,
        status: 'Confirmed',
        tenantSignedAt: '2026-11-21T09:00:00Z',
        version: 8,
      };
      throw { status: 0, code: 'request_timeout', requestPath: path };
    }
    return state.draft;
  });
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Vẽ chữ ký khách thuê' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Tôi đã xem biên bản và đồng ý nhận phòng theo hiện trạng ghi nhận, kể cả các mục có vấn đề',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ký và hoàn tất bàn giao' }));
  expect(await screen.findByText('Đã xác nhận')).toBeTruthy();
  expect(sessionSignPosts).toBe(1);
});

it('does not claim signed or auto-retry when a timed-out Tenant signature is still unconfirmed', async () => {
  state.draft = draft('Ready');
  let sessionSignPosts = 0;
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/tenant-sign/session')) {
      sessionSignPosts++;
      throw { status: 0, code: 'request_timeout', requestPath: path };
    }
    return state.draft;
  });
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Vẽ chữ ký khách thuê' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Tôi đã xem biên bản và đồng ý nhận phòng theo hiện trạng ghi nhận, kể cả các mục có vấn đề',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ký và hoàn tất bàn giao' }));
  expect(await screen.findByText(/Máy chủ không phản hồi trong 15 giây/)).toBeTruthy();
  expect(screen.queryByText('Đã xác nhận')).toBeNull();
  expect(sessionSignPosts).toBe(1);
});

it('shows the confirmed handover without waiting for the separate signed PDF document request', async () => {
  state.draft = draft('Confirmed');
  let resolveDocuments!: (value: never[]) => void;
  state.documents.mockImplementationOnce(
    () =>
      new Promise<never[]>((resolve) => {
        resolveDocuments = resolve;
      }),
  );
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);

  expect(await screen.findByText('Đã xác nhận')).toBeTruthy();
  expect(state.documents).toHaveBeenCalledWith(contract.id, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Biên bản và chữ ký' }));
  expect(screen.queryByText(/Biên bản đã ký chưa có PDF cuối cùng/)).toBeNull();

  await act(async () => resolveDocuments([]));
  expect(await screen.findByText(/Biên bản đã ký chưa có PDF cuối cùng/)).toBeTruthy();
});

it('Tenant sees integer-only meter values and verified canonical asset counts in compact details', async () => {
  state.draft = draft('Ready');
  state.draft.electricity = {
    id: '60000000-0000-4000-8000-000000000001',
    meterCode: 'E-1',
    utilityType: 0,
    date: '2026-11-20',
    value: '2000.9900',
    evidenceId: 'e-photo',
    evidenceHash: 'e-hash',
  };
  state.draft.water = {
    id: '60000000-0000-4000-8000-000000000002',
    meterCode: 'W-1',
    utilityType: 1,
    date: '2026-11-20',
    value: '2.0000',
    evidenceId: 'w-photo',
    evidenceHash: 'w-hash',
  };
  state.draft.inspectedAssets = [
    {
      id: state.draft.assets[0]!.id,
      name: 'Quạt',
      expectedQuantity: 4,
      actualQuantity: 3,
      condition: 'Good',
    },
  ];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Sẵn sàng bàn giao')).toBeTruthy();
  expect(screen.getByText(/Điện: 2\.000 kWh · Nước: 2 m³/)).toBeTruthy();
  expect(screen.queryByText(/Biên bản phiên bản/)).toBeNull();
  expect(screen.getByText(/3 tài sản đã kiểm kê/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Điện và nước' }));
  const listPanel = screen.getByTestId('handover-list-panel');
  expect(JSON.parse(listPanel.parentElement?.getAttribute('data-rn-style') ?? '{}')).toMatchObject({
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Điện' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByTestId('handover-list-panel')).toBe(listPanel);
  expect(listPanel.parentElement?.getAttribute('aria-hidden')).toBe('true');
  expect(
    JSON.parse(
      screen.getByTestId('handover-detail-panel').parentElement?.getAttribute('data-rn-style') ??
        '{}',
    ),
  ).toMatchObject({ position: 'absolute', justifyContent: 'center', padding: 24 });
  expect(screen.getByText('Điện: 2.000 kWh')).toBeTruthy();
  expect(screen.queryByText('Nước: 2 m³')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại danh sách' }));
  fireEvent.click(screen.getByRole('button', { name: 'Nước' }));
  expect(screen.getByText('Nước: 2 m³')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByTestId('handover-detail-panel')).toBeNull();
  expect(screen.getByTestId('handover-list-panel')).toBe(listPanel);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tài sản' }));
  expect(screen.getByText(/kiểm kê 3 \/ dự kiến 4/)).toBeTruthy();
  expect(screen.queryByText(/Dữ liệu cũ chưa có số lượng/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Quạt' }));
  expect(
    within(screen.getByTestId('handover-detail-panel')).getByText(/kiểm kê 3 \/ dự kiến 4/),
  ).toBeTruthy();
});

it('Tenant may request correction while activation is pending but cannot confirm occupancy', async () => {
  state.draft = draft('Ready');
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' })).toBeTruthy();
  expect(
    screen.queryByRole('button', {
      name: 'Tôi đã xem biên bản và đồng ý nhận phòng theo hiện trạng ghi nhận, kể cả các mục có vấn đề',
    }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gửi mã OTP để ký biên bản' })).toBeNull();
  expect(screen.getByText(/Chờ hợp đồng được kích hoạt để ký nhận bàn giao/)).toBeTruthy();
});

it('uses the legacy panel when an older active contract has no handover draft', async () => {
  state.transport.mockRejectedValue({ status: 404 });
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
      legacyFallback={<span>Biên bản cũ</span>}
    />,
  );
  expect(await screen.findByText('Biên bản cũ')).toBeTruthy();
});

it('blocks confirmation when readiness still contains missing work and blocks Staff in another Location', async () => {
  state.draft = draft('Ready', ['Công tơ nước']);
  const page = render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Sẵn sàng bàn giao')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xác nhận biên bản bàn giao' })).toBeNull();
  page.unmount();
  state.transport.mockClear();
  state.location = '30000000-0000-4000-8000-000000000001';
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(screen.getByText(/Không thể mở biên bản của cơ sở/)).toBeTruthy();
  expect(state.transport).not.toHaveBeenCalled();
});

it('requires a successful server start before showing meter capture, inventory or evidence upload', async () => {
  state.draft.moveInTask = {
    id: '40000000-0000-4000-8000-000000000000',
    version: 3,
    status: 'Assigned',
    canInspect: false,
  };
  state.transport.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/start') && options?.method === 'POST') {
      state.draft.moveInTask = {
        ...state.draft.moveInTask!,
        status: 'InProgress',
        canInspect: true,
        version: 4,
      };
      return state.draft.moveInTask;
    }
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByRole('button', { name: 'Bắt đầu công việc' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '1. Ghi chỉ số điện nước' })).toBeNull();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chụp ảnh hiện trạng' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu công việc' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      '/api/v1/operational-tasks/40000000-0000-4000-8000-000000000000/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: 3 }),
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    ),
  );
  expect(await screen.findByRole('button', { name: '1. Ghi chỉ số điện nước' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '4. Chìa khóa bàn giao' })).toBeTruthy();
  openSection(1);
  expect(screen.getByText('Chụp điện nước trong công việc')).toBeTruthy();
  home();
  openSection(2);
  openWork('Tường, trần và sàn');
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getAllByRole('radio', { name: 'Đạt' })).toHaveLength(1);
});

it('Staff can submit only after the four saved inspections have been completed', async () => {
  state.draft = draft('Draft');
  const page = render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  const submit = await screen.findByRole('button', {
    name: 'Xác nhận hoàn thành',
  });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  page.unmount();

  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'E',
    utilityType: 0,
    date: '2026-11-20',
    value: '1',
    evidenceId: 'e-photo',
    evidenceHash: 'e-hash',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'W',
    utilityType: 1,
    date: '2026-11-20',
    value: '2',
    evidenceId: 'w-photo',
    evidenceHash: 'w-hash',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: 'Passed',
    notes: '',
    evidenceIds: ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.assets[0]!.checked = true;
  state.draft.assets[0]!.evidenceIds = ['asset-photo'];
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 2, notes: '' }];
  state.draft.keyEvidenceIds = ['key-photo'];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  const ready = await screen.findByRole('button', {
    name: 'Xác nhận hoàn thành',
  });
  expect((ready as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(ready);
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/submit`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: 7 }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    ),
  );
});

it('Staff can complete all four sections with damaged assets and a reported room issue despite pending Owner conditions', async () => {
  state.draft = draft('Draft', ['asset_quantities_or_evidence', 'contract_active']);
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'E',
    utilityType: 0,
    date: '2026-11-20',
    value: '123',
    evidenceId: 'e-photo',
    evidenceHash: 'e-hash',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'W',
    utilityType: 1,
    date: '2026-11-20',
    value: '45',
    evidenceId: 'w-photo',
    evidenceHash: 'w-hash',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: code === 'doors_windows_locks' ? 'Issue' : 'Passed',
    notes: code === 'doors_windows_locks' ? 'Ổ khóa bị kẹt' : '',
    evidenceIds: code === 'doors_windows_locks' ? ['room-issue-photo'] : ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.assets[0] = {
    ...state.draft.assets[0]!,
    checked: true,
    observedCondition: 'Hỏng cánh quạt',
    observedQuantity: 1,
    handedOverQuantity: 1,
    damagedQuantity: 1,
    missingQuantity: 0,
    evidenceIds: ['asset-damage-photo'],
  };
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 5, notes: '' }];
  state.draft.keyEvidenceIds = ['key-photo'];

  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  const submit = await screen.findByRole('button', { name: 'Xác nhận hoàn thành' });
  expect(screen.getByText('4/4 đã ghi nhận')).toBeTruthy();
  expect(screen.getByText('Sẵn sàng gửi chủ trọ duyệt.')).toBeTruthy();
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/submit`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 7 }) }),
    ),
  );
});

it('Staff sees which room check needs reinspection and submits the correction to Owner', async () => {
  state.draft = draft('ReinspectionRequested');
  state.draft.reinspectionHistory = [
    {
      version: 6,
      reason: 'Ổ khóa vẫn kẹt, đề nghị thử lại',
      ownerId: '44444444-4444-4444-8444-444444444444',
      requestedAt: '2026-11-20T00:00:00Z',
      items: [{ kind: 'RoomCheck', code: 'doors_windows_locks' }],
    },
  ];
  state.draft.reinspectionItems = [{ kind: 'RoomCheck', code: 'doors_windows_locks' }];
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'E',
    utilityType: 0,
    date: '2026-11-20',
    value: '1',
    evidenceId: 'e-photo',
    evidenceHash: 'e-hash',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'W',
    utilityType: 1,
    date: '2026-11-20',
    value: '2',
    evidenceId: 'w-photo',
    evidenceHash: 'w-hash',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: 'Passed',
    notes: '',
    evidenceIds: ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.assets[0]!.checked = true;
  state.draft.assets[0]!.evidenceIds = ['asset-photo'];
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 2, notes: '' }];
  state.draft.keyEvidenceIds = ['key-photo'];
  state.transport.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/handover/draft') && init?.method === 'POST') {
      state.draft.version += 1;
      state.draft.reinspectionItems = [
        {
          kind: 'RoomCheck',
          code: 'doors_windows_locks',
          rechecked: true,
        },
      ];
    }
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText('Ổ khóa vẫn kẹt, đề nghị thử lại')).toBeTruthy();
  const resubmit = screen.getByRole('button', { name: 'Xác nhận hoàn thành kiểm tra lại' });
  expect((resubmit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cửa, cửa sổ và ổ khóa · Mở kiểm tra' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Có vấn đề' }));
  expect(screen.getByLabelText('Ghi chú (không bắt buộc)')).toBeTruthy();
  // A recheck needs a fresh saved observation before Staff may resubmit.
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  if (screen.queryByRole('button', { name: 'Về 4 mục bàn giao' })) home();
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Xác nhận hoàn thành kiểm tra lại',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận hoàn thành kiểm tra lại' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/resubmit`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 8 }) }),
    ),
  );
});

it('opens canonical asset inventory for reinspection and requires fresh completed Good observations', async () => {
  state.draft = draft('ReinspectionRequested');
  state.draft.moveInTask = {
    ...state.draft.moveInTask!,
    inventoryTaskId: '60000000-0000-4000-8000-000000000001',
    inventoryStatus: 'Completed',
  };
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'E',
    utilityType: 0,
    date: '2026-11-20',
    value: '17',
    evidenceId: 'e-photo',
    evidenceHash: 'e-hash',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'W',
    utilityType: 1,
    date: '2026-11-20',
    value: '21',
    evidenceId: 'w-photo',
    evidenceHash: 'w-hash',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: 'Passed',
    notes: '',
    evidenceIds: ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 2, notes: '' }];
  state.draft.keyEvidenceIds = ['key-photo'];
  state.draft.reinspectionHistory = [
    {
      version: 6,
      reason: 'Quạt hỏng, yêu cầu kiểm kê lại sau sửa chữa',
      ownerId: '44444444-4444-4444-8444-444444444444',
      requestedAt: '2026-11-21T09:00:00Z',
      items: [{ kind: 'Asset', assetId: state.draft.assets[0]!.id }],
    },
  ];
  state.draft.reinspectionItems = [{ kind: 'Asset', assetId: state.draft.assets[0]!.id }];
  // A previously completed task does not satisfy a new Owner reinspection.
  state.inventory = linkedInventory('Completed', true);
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  const submit = await screen.findByRole('button', {
    name: 'Xác nhận hoàn thành kiểm tra lại',
  });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Quạt · Mở kiểm tra' }));
  expect(screen.getByText('Phiếu kiểm kê nội bộ')).toBeTruthy();
  state.inventory = {
    ...linkedInventory('Completed', true),
    completedAt: '2026-11-21T09:05:00Z',
    items: [{ ...linkedInventory('Completed', true).items[0]!, condition: 'Good' }],
  };
  closeWork(); // Parent reloads after the embedded, authenticated inventory task closes.
  if (screen.queryByRole('button', { name: 'Về 4 mục bàn giao' })) home();
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Xác nhận hoàn thành kiểm tra lại',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true),
  );
  // Even a freshly completed Good task cannot unlock submit until Backend
  // verifies that the selected item has a genuinely new evidence image.
  state.draft.reinspectionItems = [
    {
      kind: 'Asset',
      assetId: state.draft.assets[0]!.id,
      rechecked: true,
    },
  ];
  fireEvent.click(screen.getByRole('button', { name: 'Quạt · Mở kiểm tra' }));
  closeWork();
  if (screen.queryByRole('button', { name: 'Về 4 mục bàn giao' })) home();
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Xác nhận hoàn thành kiểm tra lại',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});

it('keeps four selectable sections and preserves unsaved input while switching inspection modals', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  openSection(2);
  openWork('Hiện trạng chung');
  expect(screen.getByLabelText('Ghi chú')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeNull();
  expect(screen.queryByLabelText('Số lượng chìa khóa bàn giao')).toBeNull();
  fireEvent.change(screen.getByLabelText('Ghi chú'), {
    target: { value: 'Trần và sàn đã kiểm tra' },
  });
  closeWork();
  home();
  openSection(3);
  openWork('Quạt');
  expect(screen.getByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeTruthy();
  expect(screen.queryByLabelText('Hiện trạng phòng *')).toBeNull();
  closeWork();
  home();
  openSection(4);
  openWork('Chìa khóa bàn giao');
  expect(screen.getByLabelText('Số lượng chìa khóa bàn giao')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeNull();
  closeWork();
  home();
  openSection(2);
  openWork('Hiện trạng chung');
  expect((screen.getByLabelText('Ghi chú') as HTMLInputElement).value).toBe(
    'Trần và sàn đã kiểm tra',
  );
  expect(
    state.transport.mock.calls.some(
      ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
    ),
  ).toBe(false);
  await captureProof('30000000-0000-4000-8000-000000000001');
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
});

it('suggests the first unfinished section based on saved server progress', async () => {
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'ELEC-01',
    utilityType: 0,
    date: '2026-11-20',
    value: '4',
    evidenceId: 'photo-e',
    evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'WATER-01',
    utilityType: 1,
    date: '2026-11-20',
    value: '5',
    evidenceId: 'photo-w',
    evidenceHash: 'hash-w',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: 'Passed',
    notes: '',
    evidenceIds: ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByRole('button', { name: '3. Kiểm kê tài sản' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '3. Kiểm kê tài sản' }).textContent).toContain(
    'Nên làm tiếp',
  );
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
  openSection(3);
  openWork('Quạt');
  expect(screen.getByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeTruthy();
});

it('keeps Assets as the next required section until its embedded inventory checkpoint completes', async () => {
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'ELEC-01',
    utilityType: 0,
    date: '2026-11-20',
    value: '4',
    evidenceId: 'photo-e',
    evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'WATER-01',
    utilityType: 1,
    date: '2026-11-20',
    value: '5',
    evidenceId: 'photo-w',
    evidenceHash: 'hash-w',
  };
  state.draft.roomCondition = 'Đạt';
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: 'Passed',
    notes: '',
    evidenceIds: ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.assets[0]!.checked = true;
  state.draft.moveInTask = {
    ...state.draft.moveInTask!,
    inventoryTaskId: '60000000-0000-4000-8000-000000000001',
    inventoryStatus: 'Assigned',
  };
  state.inventory = linkedInventory('InProgress', true);
  const page = render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect((await screen.findByRole('button', { name: '3. Kiểm kê tài sản' })).textContent).toContain(
    'Nên làm tiếp',
  );
  expect(screen.getByText('2/4 đã ghi nhận')).toBeTruthy();
  page.unmount();
  state.draft.moveInTask = { ...state.draft.moveInTask!, inventoryStatus: 'Completed' };
  state.inventory = linkedInventory('Completed', true);
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '4. Chìa khóa bàn giao' }).textContent).toContain(
      'Nên làm tiếp',
    ),
  );
  expect(screen.getByText('3/4 đã ghi nhận')).toBeTruthy();
});

it('opens each linked asset directly and shows ticks only for server-saved inventory items', async () => {
  state.draft.moveInTask = {
    ...state.draft.moveInTask!,
    inventoryTaskId: '60000000-0000-4000-8000-000000000001',
    inventoryStatus: 'InProgress',
  };
  const secondId = '20000000-0000-4000-8000-000000000002';
  state.draft.assets.push({
    id: secondId,
    name: 'Bàn',
    configuredQuantity: 2,
    checked: true,
    inventoryCondition: 'Tốt',
    observedCondition: 'Tốt',
  });
  state.inventory = linkedInventory('InProgress', true);
  state.inventory.items.push({
    id: secondId,
    assetId: null,
    name: 'Bàn',
    expectedQuantity: 2,
    actualQuantity: null,
    condition: null,
    notes: null,
    evidenceIds: [],
    incidentId: null,
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '3. Kiểm kê tài sản' });
  openSection(3);
  expect(screen.queryByRole('button', { name: 'Đối chiếu kiểm kê đầu vào' })).toBeNull();
  expect(screen.getByText('Quạt')).toBeTruthy();
  expect(screen.getByText('Bàn')).toBeTruthy();
  expect(screen.getByText('Đã kiểm kê · Đạt')).toBeTruthy();
  expect(screen.getByText('Chưa kiểm kê')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quạt' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Bàn' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeNull();
  expect(screen.getByText('Dự kiến 1 · Thực tế 1')).toBeTruthy();
  expect(screen.getByText('Dự kiến 2 · Thực tế chưa ghi')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  openWork('Bàn');
  expect(screen.getByTestId('inventory-editor').getAttribute('data-item-id')).toBe(secondId);
  closeWork();
  await screen.findByRole('button', { name: 'Bàn' });
  // Even though the old handover flag on Bàn is true, the internal server
  // inventory has not saved that item's observation, so it remains unchecked.
  home();
  expect(screen.getByText('1/2 nhóm tài sản đã kiểm tra')).toBeTruthy();
  expect(
    state.transport.mock.calls.filter(
      ([path, init]) => path.endsWith('/handover/draft') && init?.method === 'POST',
    ),
  ).toHaveLength(0);
});

it('reloads saved inventory ticks after the internal inventory modal closes', async () => {
  state.draft.moveInTask = {
    ...state.draft.moveInTask!,
    inventoryTaskId: '60000000-0000-4000-8000-000000000001',
    inventoryStatus: 'InProgress',
  };
  state.inventory = linkedInventory('InProgress');
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '3. Kiểm kê tài sản' });
  openSection(3);
  expect(screen.getByText('Chưa kiểm kê')).toBeTruthy();
  openWork('Quạt');
  expect(screen.getByText('Phiếu kiểm kê nội bộ')).toBeTruthy();
  state.inventory = linkedInventory('InProgress', true);
  closeWork();
  expect(await screen.findByText('Đã kiểm kê · Đạt')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Về 4 mục bàn giao' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quạt' })).toBeTruthy();
});

it('does not mislabel assets as inspected when the internal inventory request fails', async () => {
  state.draft.assets[0]!.checked = true;
  state.draft.moveInTask = {
    ...state.draft.moveInTask!,
    inventoryTaskId: '60000000-0000-4000-8000-000000000001',
    inventoryStatus: 'Completed',
  };
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/move-in-inventory')) throw { status: 403, code: 'forbidden' };
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '3. Kiểm kê tài sản' });
  openSection(3);
  expect(screen.getByText(/Không tải được trạng thái kiểm kê/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tải lại kết quả kiểm kê' })).toBeNull();
  expect(screen.getByText('Chưa kiểm kê')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quạt' })).toBeTruthy();
  expect(screen.queryByText('Đã kiểm kê · Đạt')).toBeNull();
});

it('does not complete handover when recorded keys lack mandatory photos', async () => {
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'ELEC-01',
    utilityType: 0,
    date: '2026-11-20',
    value: '4',
    evidenceId: 'photo-e',
    evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'WATER-01',
    utilityType: 1,
    date: '2026-11-20',
    value: '5',
    evidenceId: 'photo-w',
    evidenceHash: 'hash-w',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code,
    status: 'Passed',
    notes: '',
    evidenceIds: ['room-' + code],
  }));
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.assets[0]!.checked = true;
  state.draft.assets[0]!.evidenceIds = ['asset-photo'];
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 5, notes: '' }];
  state.draft.keyEvidenceIds = ['key-photo'];
  state.draft.keyEvidenceIds = [];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText('3/4 đã ghi nhận')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xác nhận hoàn thành' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.queryByText(/Gợi ý tiếp theo:/)).toBeNull();
  openSection(4);
  expect(screen.getByText('Chưa kiểm tra')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xác nhận hoàn thành' })).toBeNull();
  openWork('Chìa khóa bàn giao');
  expect(screen.getByText('Ảnh chìa khóa *')).toBeTruthy();
});

it('does not count the key section complete before the key quantity is saved', async () => {
  state.draft.accessItems = [];
  state.draft.keyEvidenceIds = [];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '4. Chìa khóa bàn giao' });
  openSection(4);
  expect(screen.getByText('Chưa kiểm tra')).toBeTruthy();
});

it('counts saved NotApplicable checks without photos, shows saved labels and compact meter values', async () => {
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'ELEC-01',
    utilityType: 0,
    date: '2026-11-20',
    value: '22.0000',
    evidenceId: 'photo-e',
    evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'WATER-01',
    utilityType: 1,
    date: '2026-11-20',
    value: '1.0000',
    evidenceId: 'photo-w',
    evidenceHash: 'hash-w',
  };
  state.draft.roomCondition = '';
  state.draft.evidenceIds = ['room-summary-photo'];
  state.draft.roomChecks = roomHandoverChecks.map(({ code }, index) => ({
    code,
    status: index === 0 ? 'NotApplicable' : 'Passed',
    notes: '',
    evidenceIds: index === 0 ? [] : ['room-' + code],
  }));
  state.draft.assets[0]!.checked = true;
  state.draft.assets[0]!.evidenceIds = ['asset-photo'];
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 2, notes: '' }];
  state.draft.keyEvidenceIds = ['key-photo'];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText('4/4 đã ghi nhận')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xác nhận hoàn thành' })).toHaveProperty(
    'disabled',
    false,
  );
  expect(screen.getByRole('button', { name: '4. Chìa khóa bàn giao' }).textContent).toContain(
    '2 chìa khóaĐã ghi nhận',
  );
  openSection(2);
  expect(screen.getByRole('button', { name: 'Hiện trạng chung' }).textContent).toContain('Đã lưu');
  expect(screen.getByRole('button', { name: 'Tường, trần và sàn' }).textContent).toContain(
    'Không áp dụng',
  );
  expect(screen.queryByText('Không áp dụng · Thiếu ảnh')).toBeNull();
  home();
  openSection(1);
  expect(screen.getByText('Điện: 22 kWh')).toBeTruthy();
  expect(screen.getByText('Nước: 1 m³')).toBeTruthy();
  home();
  openSection(4);
  expect(screen.getByText('2 chìa khóa')).toBeTruthy();
  expect(screen.getByText('Đã ghi nhận')).toBeTruthy();
});

it('shows recorded room issue but does not complete condition without photos', async () => {
  state.draft.electricity = {
    id: 'reading-e',
    meterCode: 'ELEC-01',
    utilityType: 0,
    date: '2026-11-20',
    value: '4',
    evidenceId: 'photo-e',
    evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w',
    meterCode: 'WATER-01',
    utilityType: 1,
    date: '2026-11-20',
    value: '5',
    evidenceId: 'photo-w',
    evidenceHash: 'hash-w',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }, index) => ({
    code,
    status: index === 0 ? 'Issue' : 'Passed',
    notes: index === 0 ? 'Tường bị ẩm' : '',
    evidenceIds: [],
  }));
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' })).toBeTruthy();
  expect(
    screen.getByRole('button', { name: '2. Kiểm tra hiện trạng phòng' }).textContent,
  ).toContain('Nên làm tiếp');
  openSection(2);
  expect(screen.getByText('Có vấn đề · Thiếu ảnh')).toBeTruthy();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
});

it('keeps all inspection and meter steps locked on failed start or mismatched responsible Staff', async () => {
  state.draft.moveInTask = {
    id: '40000000-0000-4000-8000-000000000000',
    status: 'Assigned',
    version: 5,
    canInspect: false,
  };
  state.transport.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/start') && options?.method === 'POST')
      throw { status: 403, code: 'forbidden' };
    return state.draft;
  });
  const page = render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu công việc' }));
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/start') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  expect(screen.queryByRole('button', { name: '1. Ghi chỉ số điện nước' })).toBeNull();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
  page.unmount();
  state.draft.moveInTask = { ...state.draft.moveInTask!, status: 'InProgress', canInspect: false };
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText(/Chưa thể ghi nhận/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '1. Ghi chỉ số điện nước' })).toBeNull();
});

it('Staff updates condition without altering meter baselines or contract creation', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Hiện trạng chung');
  fireEvent.change(screen.getByLabelText('Ghi chú'), {
    target: { value: 'Đã vệ sinh và kiểm tra' },
  });
  await captureProof('30000000-0000-4000-8000-000000000001');
  saveWork();
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft`,
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    ),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, init]) => path.endsWith('/handover/draft') && init.method === 'POST',
  );
  expect(JSON.parse(mutation![1].body)).toMatchObject({
    version: 7,
    roomCondition: 'Đã vệ sinh và kiểm tra',
  });
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('electricityReadingId');
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('waterReadingId');
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('assets');
});

it('saves room overview with empty notes only when a photo is present', async () => {
  state.draft.roomCondition = '';
  state.draft.evidenceIds = [];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Hiện trạng chung');
  expect(screen.getByLabelText('Ghi chú')).toHaveProperty('value', '');
  saveWork();
  expect(await screen.findByText('Chụp ít nhất một ảnh hiện trạng chung.')).toBeTruthy();
  await captureProof('30000000-0000-4000-8000-000000000001');
  saveWork();
  await waitFor(() => {
    const mutation = state.transport.mock.calls.find(
      ([path, init]) => path.endsWith('/handover/draft') && init?.method === 'POST',
    );
    expect(mutation).toBeTruthy();
    expect(JSON.parse(mutation![1].body)).toMatchObject({
      roomCondition: '',
      evidenceIds: ['30000000-0000-4000-8000-000000000001'],
    });
  });
});

it('blocks Staff edits while the Owner reviews a Tenant change request', async () => {
  state.draft = draft('ChangesRequested');
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(
    await screen.findByText(/Chờ chủ trọ quyết định trước khi nhân viên cập nhật/),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tiếp tục kiểm tra' })).toBeNull();
  expect(state.transport).toHaveBeenCalledTimes(1);
});

it('preserves uploaded photo assignment to an asset when saving the draft', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '3. Kiểm kê tài sản' });
  openSection(3);
  openWork('Quạt');
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/evidence`,
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' } }),
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Đã kiểm kê Quạt' }));
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, init]) => path.endsWith('/handover/draft') && init.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, init]) => path.endsWith('/handover/draft') && init.method === 'POST',
  );
  expect(JSON.parse(mutation![1].body).assets[0]).toMatchObject({
    checked: true,
    evidenceIds: ['30000000-0000-4000-8000-000000000001'],
  });
  expect(JSON.parse(mutation![1].body).evidenceIds ?? []).not.toContain(
    '30000000-0000-4000-8000-000000000001',
  );
});

it('saves asset groups across separate Staff visits without resetting the first inspection', async () => {
  const secondId = '20000000-0000-4000-8000-000000000002';
  state.draft.assets.push({
    id: secondId,
    name: 'Bàn',
    inventoryCondition: 'Tốt',
    observedCondition: 'Tốt',
    checked: false,
  });
  const submissions: Array<{ version: number; assets: { id: string; checked: boolean }[] }> = [];
  state.transport.mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/handover/draft') && init?.method === 'POST') {
        const body = JSON.parse(init.body!);
        submissions.push(body);
        for (const asset of body.assets ?? []) {
          const index = state.draft.assets.findIndex((existing) => existing.id === asset.id);
          state.draft.assets[index] = {
            ...state.draft.assets[index]!,
            ...asset,
            observedCondition: asset.condition,
          };
        }
        state.draft.version++;
        return state.draft;
      }
      return state.draft;
    },
  );
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '3. Kiểm kê tài sản' });
  openSection(3);
  openWork('Quạt');
  fireEvent.click(screen.getByRole('button', { name: 'Đã kiểm kê Quạt' }));
  await captureProof('30000000-0000-4000-8000-000000000001');
  saveWork();
  await waitFor(() => expect(submissions).toHaveLength(1));
  expect(submissions[0].assets.map((asset) => asset.id)).toEqual([state.draft.assets[0]!.id]);
  // Saving an asset should close only its modal, not take Staff back to the
  // four-section home. Staff can inspect the next item immediately.
  expect(await screen.findByRole('button', { name: 'Bàn' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Về 4 mục bàn giao' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '3. Kiểm kê tài sản' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  openWork('Bàn');
  fireEvent.click(screen.getByRole('button', { name: 'Đã kiểm kê Bàn' }));
  await captureProof('30000000-0000-4000-8000-000000000002');
  saveWork();
  await waitFor(() => expect(submissions).toHaveLength(2));
  expect(submissions[1].version).toBe(8);
  expect(state.draft.assets.map((asset) => asset.checked)).toEqual([true, true]);
  expect(state.draft.version).toBe(9);
});

it('stays in the seven-room-check list after each successful save and uses the refreshed server version', async () => {
  const savedVersions: number[] = [];
  state.transport.mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/handover/draft') && init?.method === 'POST') {
        const body = JSON.parse(init.body!);
        savedVersions.push(body.version);
        const touched = new Set(
          (body.roomChecks ?? []).map((check: { code: string }) => check.code),
        );
        state.draft = {
          ...state.draft,
          version: state.draft.version + 1,
          roomChecks: [
            ...state.draft.roomChecks.filter((check) => !touched.has(check.code)),
            ...(body.roomChecks ?? []),
          ],
        };
        return state.draft;
      }
      return state.draft;
    },
  );
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={contract}
      role="Staff"
      onUpdated={state.updated}
    />,
  );
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Tường, trần và sàn');
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  await captureProof('30000000-0000-4000-8000-000000000001');
  saveWork();
  await waitFor(() => expect(savedVersions).toEqual([7]));
  expect(await screen.findByRole('button', { name: 'Cửa, cửa sổ và ổ khóa' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Về 4 mục bàn giao' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '2. Kiểm tra hiện trạng phòng' })).toBeNull();
  openWork('Cửa, cửa sổ và ổ khóa');
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  await captureProof('30000000-0000-4000-8000-000000000002');
  saveWork();
  await waitFor(() => expect(savedVersions).toEqual([7, 8]));
  expect(await screen.findByRole('button', { name: 'Hệ thống điện, đèn và ổ cắm' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Về 4 mục bàn giao' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '2. Kiểm tra hiện trạng phòng' })).toBeNull();
  expect(state.draft.roomChecks.map((check) => check.code)).toEqual([
    'walls_ceiling_floor',
    'doors_windows_locks',
  ]);
  expect(state.updated).toHaveBeenCalledTimes(2);
  // Only the explicit Back action returns to the four-section menu.
  home();
  expect(screen.getByRole('button', { name: '2. Kiểm tra hiện trạng phòng' })).toBeTruthy();
});

it('saves only the open room check, with optional notes and optional evidence for NotApplicable', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Tường, trần và sàn');
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  closeWork();
  openWork('Cửa, cửa sổ và ổ khóa');
  fireEvent.click(screen.getByRole('radio', { name: 'Không áp dụng' }));
  expect(screen.getByText('Ảnh minh chứng (không bắt buộc)')).toBeTruthy();
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks).toEqual([
    {
      code: 'doors_windows_locks',
      status: 'NotApplicable',
      notes: null,
      evidenceIds: [],
    },
  ]);
  expect(body).not.toHaveProperty('accessItems');
  expect(body).not.toHaveProperty('outstandingIssues');
  expect(screen.queryByText('Đã lưu kết quả kiểm tra trên máy chủ.')).toBeNull();
});

it('saves the active room code without resending earlier unsaved checks or existing assets', async () => {
  state.draft.assets[0]!.checked = true;
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  for (const { label } of roomHandoverChecks) {
    openWork(label);
    fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
    if (label !== roomHandoverChecks[roomHandoverChecks.length - 1]?.label) closeWork();
  }
  await captureProof('30000000-0000-4000-8000-000000000001');
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks.map((check: { code: string }) => check.code)).toEqual([
    roomHandoverChecks[roomHandoverChecks.length - 1]!.code,
  ]);
  expect(body.roomChecks.every((check: { status: string }) => check.status === 'Passed')).toBe(
    true,
  );
  expect(body).not.toHaveProperty('assets');
});

it('Tenant can review seven room inspections, attached Issue image, access items and outstanding work', async () => {
  state.draft = draft('Ready');
  state.draft.roomChecks = roomHandoverChecks.map(({ code }, index) => ({
    code,
    status: index === 2 ? 'Issue' : 'Passed',
    notes: index === 2 ? 'Ổ điện bị hỏng' : '',
    evidenceIds:
      index === 2
        ? ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002']
        : [],
  }));
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 2, notes: 'Đã thử khóa' }];
  state.draft.outstandingIssues = [
    {
      code: 'electrical_lighting_outlets',
      description: 'Sửa ổ điện',
      responsibleParty: 'Owner',
      dueDate: '2026-11-30',
    },
  ];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Sẵn sàng bàn giao')).toBeTruthy();
  expect(screen.queryByText(/Ổ điện bị hỏng/)).toBeNull();
  expect(screen.queryByText(/Sửa ổ điện/)).toBeNull();
  expect(screen.queryByText('Tải ảnh')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hiện trạng phòng' }));
  for (const { label } of roomHandoverChecks) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.getByText(/Sửa ổ điện/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hệ thống điện, đèn và ổ cắm' }));
  expect(
    within(screen.getByTestId('handover-detail-panel')).getByText(/Ổ điện bị hỏng/),
  ).toBeTruthy();
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }));
  expect(screen.getByText('Ảnh kiểm tra 2')).toBeTruthy();
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(1);
  expect(screen.queryByText('Tải ảnh')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByTestId('handover-detail-panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chìa khóa' }));
  expect(screen.getByText('2 chìa khóa phòng')).toBeTruthy();
});

it('saves a room problem as a factual inspection with notes and photo, without assigning repairs', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Hệ thống điện, đèn và ổ cắm');
  fireEvent.click(screen.getByRole('radio', { name: 'Có vấn đề' }));
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Ổ cắm bên trái không có điện' },
  });
  expect(screen.queryByRole('button', { name: /Ảnh không có giấy tờ cá nhân/ })).toBeNull();
  expect(screen.getByText('Ảnh minh chứng *')).toBeTruthy();
  const camera = screen.getByRole('button', { name: 'Chụp ảnh' });
  expect(camera.getAttribute('data-presentation')).toBe('evidence');
  expect((camera as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(camera);
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(([path]) => path.endsWith('/handover/draft/evidence')),
    ).toBe(true),
  );
  expect(await screen.findByRole('button', { name: 'Xóa ảnh hiện trạng 1' })).toBeTruthy();
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(1);
  expect(screen.queryByText('Đã chọn')).toBeNull();
  expect(screen.queryByText('Chạm để chọn')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gắn ảnh 1' })).toBeNull();
  expect(screen.queryByText(/Chỉ ghi nhận thực tế\. Chủ trọ quyết định xử lý/)).toBeNull();
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks).toEqual([
    {
      code: 'electrical_lighting_outlets',
      status: 'Issue',
      notes: 'Ổ cắm bên trái không có điện',
      evidenceIds: ['30000000-0000-4000-8000-000000000001'],
    },
  ]);
  expect(body.evidenceIds ?? []).not.toContain('30000000-0000-4000-8000-000000000001');
  expect(body).not.toHaveProperty('outstandingIssues');
  expect(screen.queryByLabelText('Nội dung cần xử lý · Hệ thống điện, đèn và ổ cắm')).toBeNull();
  expect(screen.queryByLabelText('Hạn xử lý Hệ thống điện, đèn và ổ cắm (dd/MM/yyyy)')).toBeNull();
});

it('distinguishes passed, issue, not applicable and unreviewed room checks without losing saved progress', async () => {
  state.draft.roomChecks = [
    { code: 'walls_ceiling_floor', status: 'Passed', notes: '', evidenceIds: ['room-wall-photo'] },
    {
      code: 'doors_windows_locks',
      status: 'Issue',
      notes: 'Hỏng',
      evidenceIds: ['30000000-0000-4000-8000-000000000007'],
    },
    {
      code: 'electrical_lighting_outlets',
      status: 'NotApplicable',
      notes: 'Không lắp',
      evidenceIds: ['room-electrical-photo'],
    },
  ];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  expect(screen.getByText('3/8 mục đã kiểm tra')).toBeTruthy();
  openSection(2);
  const icon = (label: string) =>
    screen.getByRole('button', { name: label }).querySelector('[data-testid="paper-icon"]');
  expect(icon('Tường, trần và sàn')?.getAttribute('data-source')).toBe('check-circle-outline');
  expect(icon('Tường, trần và sàn')?.getAttribute('data-color')).toBe('#168565');
  expect(icon('Cửa, cửa sổ và ổ khóa')?.getAttribute('data-source')).toBe('alert-circle-outline');
  expect(icon('Cửa, cửa sổ và ổ khóa')?.getAttribute('data-color')).toBe('#a86108');
  expect(icon('Hệ thống điện, đèn và ổ cắm')?.getAttribute('data-source')).toBe(
    'minus-circle-outline',
  );
  expect(icon('Hệ thống điện, đèn và ổ cắm')?.getAttribute('data-color')).toBe('#64748b');
  expect(icon('Hệ thống nước và thoát nước')?.getAttribute('data-source')).toBe(
    'clipboard-text-outline',
  );
});

it('shows warning instead of a green success tick for a saved damaged inventory item', async () => {
  state.draft.moveInTask!.inventoryTaskId = '60000000-0000-4000-8000-000000000001';
  state.inventory = linkedInventory('InProgress', true);
  state.inventory.items[0]!.condition = 'Damaged';
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '3. Kiểm kê tài sản' });
  openSection(3);
  const inventoryRow = screen.getByText('Quạt').closest('div');
  expect(
    inventoryRow?.parentElement?.querySelector('[data-source="alert-circle-outline"]'),
  ).toBeTruthy();
  expect(screen.getByText('Đã kiểm kê · Hư hỏng')).toBeTruthy();
});

it('automatically attaches captured photos, shows only thumbnails and an upper-corner X, and removes one before save', async () => {
  let count = 0;
  const submitted: Array<{ roomChecks: { evidenceIds: string[] }[] }> = [];
  state.transport.mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/handover/draft/evidence') && init?.method === 'POST') {
        count++;
        return { id: `30000000-0000-4000-8000-${String(count).padStart(12, '0')}` };
      }
      if (path.endsWith('/handover/draft') && init?.method === 'POST') {
        submitted.push(JSON.parse(init.body!));
        return state.draft;
      }
      return state.draft;
    },
  );
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Tường, trần và sàn');
  fireEvent.click(screen.getByRole('radio', { name: 'Có vấn đề' }));
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Tường tróc sơn' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await waitFor(() => expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await waitFor(() => expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(2));
  const modal = screen.getByRole('dialog');
  expect(modal.textContent!.indexOf('Chụp ảnh')).toBeLessThan(
    modal.textContent!.indexOf('Ảnh hiện trạng 1'),
  );
  expect(screen.getAllByTestId('private-photo-thumbnail')[0].getAttribute('data-preview-uri')).toBe(
    'blob:unsaved-room-photo',
  );
  expect(screen.queryByText('Đã chọn')).toBeNull();
  expect(screen.queryByText('Chạm để chọn')).toBeNull();
  expect(screen.queryByText('Bỏ ảnh')).toBeNull();
  expect(screen.queryByRole('button', { name: /Chọn ảnh hiện trạng/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Xóa ảnh hiện trạng 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh hiện trạng 2' }));
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:unsaved-room-photo');
  saveWork();
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0].roomChecks[0].evidenceIds).toEqual(['30000000-0000-4000-8000-000000000001']);
  expect(submitted[0]).not.toHaveProperty('outstandingIssues');
});

it('limits room photos to five per area and never exposes photos from another area', async () => {
  let uploads = 0;
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/handover/draft/evidence')) {
      uploads++;
      return { id: `30000000-0000-4000-8000-${String(uploads).padStart(12, '0')}` };
    }
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Tường, trần và sàn');
  fireEvent.click(screen.getByRole('radio', { name: 'Có vấn đề' }));
  for (let count = 1; count <= 5; count++) {
    fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(count),
    );
  }
  expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  closeWork();
  openWork('Cửa, cửa sổ và ổ khóa');
  fireEvent.click(screen.getByRole('radio', { name: 'Có vấn đề' }));
  expect(screen.queryByTestId('private-photo-thumbnail')).toBeNull();
  expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  closeWork();
  openWork('Tường, trần và sàn');
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh hiện trạng 5' }));
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(4);
  expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('shows existing photos only inside their assigned room check and X unlinks the current room only', async () => {
  const photoId = '30000000-0000-4000-8000-000000000007';
  state.draft.roomChecks = [
    { code: 'doors_windows_locks', status: 'Issue', notes: 'Cửa kẹt', evidenceIds: [photoId] },
  ];
  const saves: Array<{
    roomChecks: { code: string; evidenceIds: string[] }[];
    evidenceIds: string[];
  }> = [];
  state.transport.mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/handover/draft') && init?.method === 'POST') {
        saves.push(JSON.parse(init.body!));
      }
      return state.draft;
    },
  );
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Tường, trần và sàn');
  expect(screen.queryByTestId('private-photo-thumbnail')).toBeNull();
  expect(screen.queryByRole('button', { name: /Xóa ảnh hiện trạng/ })).toBeNull();
  closeWork();
  openWork('Cửa, cửa sổ và ổ khóa');
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh hiện trạng 1' }));
  expect(screen.queryByTestId('private-photo-thumbnail')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  saveWork();
  expect(await screen.findByText(/Chụp ít nhất một ảnh/)).toBeTruthy();
  expect(saves).toHaveLength(0);
  await captureProof();
  saveWork();
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0].roomChecks).toEqual([
    {
      code: 'doors_windows_locks',
      status: 'Passed',
      notes: 'Cửa kẹt',
      evidenceIds: ['30000000-0000-4000-8000-000000000001'],
    },
  ]);
  expect(saves[0]).not.toHaveProperty('evidenceIds');
});

it('saves one counted key handover and rejects invalid quantities without multiple access types', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '4. Chìa khóa bàn giao' });
  openSection(4);
  expect(
    screen.queryByRole('button', { name: 'Thêm chìa khóa / thẻ / quyền truy cập' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ảnh bàn giao chung' })).toBeNull();
  openWork('Chìa khóa bàn giao');
  fireEvent.change(screen.getByLabelText('Số lượng chìa khóa bàn giao'), {
    target: { value: '-1' },
  });
  saveWork();
  expect(
    await within(screen.getByTestId('inspection-key-field')).findByText(/số nguyên từ 0 đến 100/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Số lượng chìa khóa bàn giao'), {
    target: { value: '2' },
  });
  fireEvent.change(screen.getByLabelText('Ghi chú chìa khóa (nếu có)'), {
    target: { value: 'Đã kiểm đếm' },
  });
  await captureProof('30000000-0000-4000-8000-000000000002');
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  expect(JSON.parse(mutation![1].body).accessItems).toEqual([
    { type: 'RoomKey', quantity: 2, notes: 'Đã kiểm đếm' },
  ]);
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('keysAndAccess');
});

it('places validation next to the incomplete field, scrolls there, and clears errors on close', async () => {
  state.modalScrollTo.mockClear();
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Cửa, cửa sổ và ổ khóa');
  saveWork();
  const statusField = screen.getByTestId('inspection-status-field');
  const photoField = screen.getByTestId('inspection-photo-field');
  expect(await within(statusField).findByText(/Hãy chọn kết quả kiểm tra/)).toBeTruthy();
  expect(within(photoField).queryByText(/Hãy chọn kết quả kiểm tra/)).toBeNull();
  // Rendering the inline message can precede the passive effect that scrolls to it.
  await waitFor(() =>
    expect(state.modalScrollTo).toHaveBeenLastCalledWith({ y: 0, animated: true }),
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  expect(screen.queryByText(/Hãy chọn kết quả kiểm tra/)).toBeNull();
  saveWork();
  expect(await within(photoField).findByText(/Chụp ít nhất một ảnh/)).toBeTruthy();
  await waitFor(() =>
    expect(state.modalScrollTo).toHaveBeenLastCalledWith({ y: 352, animated: true }),
  );
  expect(
    state.transport.mock.calls.some(
      ([path, init]) => path.endsWith('/handover/draft') && init?.method === 'POST',
    ),
  ).toBe(false);
  closeWork();
  expect(screen.queryByText(/Chụp ít nhất một ảnh/)).toBeNull();
  openWork('Cửa, cửa sổ và ổ khóa');
  expect(screen.queryByText(/Chụp ít nhất một ảnh/)).toBeNull();
  expect(screen.queryByText(/Hãy chọn kết quả kiểm tra/)).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Không áp dụng' }));
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, init]) => path.endsWith('/handover/draft') && init?.method === 'POST',
      ),
    ).toBe(true),
  );
});

it('attaches photographed keys only to key evidence, never to the old general room photos', async () => {
  state.draft.evidenceIds = ['30000000-0000-4000-8000-000000000009'];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '4. Chìa khóa bàn giao' });
  openSection(4);
  openWork('Chìa khóa bàn giao');
  expect(screen.getByText('Ảnh chìa khóa *')).toBeTruthy();
  expect(screen.queryByTestId('private-photo-thumbnail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(([path]) => path.endsWith('/handover/draft/evidence')),
    ).toBe(true),
  );
  expect(await screen.findByText(/Đã tải ảnh chìa khóa/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xóa ảnh chìa khóa 1' })).toBeTruthy();
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Số lượng chìa khóa bàn giao'), {
    target: { value: '2' },
  });
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  const body = JSON.parse(mutation![1].body);
  expect(body.accessItems).toEqual([{ type: 'RoomKey', quantity: 2, notes: '' }]);
  expect(body.keyEvidenceIds).toEqual(['30000000-0000-4000-8000-000000000001']);
  expect(body).not.toHaveProperty('evidenceIds');
  expect(body).not.toHaveProperty('roomChecks');
  expect(body).not.toHaveProperty('assets');
});

it('keeps key photographs exclusive, allows at most five and saves only the retained keys', async () => {
  let uploads = 0;
  const saved: Array<{ keyEvidenceIds: string[]; evidenceIds: string[] }> = [];
  state.transport.mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/handover/draft/evidence')) {
        uploads++;
        return { id: `30000000-0000-4000-8000-${String(uploads).padStart(12, '0')}` };
      }
      if (path.endsWith('/handover/draft') && init?.method === 'POST') {
        saved.push(JSON.parse(init.body!));
      }
      return state.draft;
    },
  );
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '4. Chìa khóa bàn giao' });
  openSection(4);
  openWork('Chìa khóa bàn giao');
  fireEvent.change(screen.getByLabelText('Số lượng chìa khóa bàn giao'), {
    target: { value: '3' },
  });
  for (let count = 1; count <= 5; count++) {
    fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(count),
    );
  }
  expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh chìa khóa 3' }));
  expect(screen.getAllByTestId('private-photo-thumbnail')).toHaveLength(4);
  expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  saveWork();
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]!.keyEvidenceIds).toHaveLength(4);
  expect(saved[0]!.keyEvidenceIds).not.toContain('30000000-0000-4000-8000-000000000003');
  expect(saved[0]).not.toHaveProperty('evidenceIds');
});

it('does not modify previous Owner plans when Staff changes the factual inspection result', async () => {
  state.draft.roomChecks = [
    {
      code: 'walls_ceiling_floor',
      status: 'Issue',
      notes: 'Tường bong sơn',
      evidenceIds: ['30000000-0000-4000-8000-000000000001'],
    },
    { code: 'doors_windows_locks', status: 'Passed', notes: '', evidenceIds: [] },
  ];
  state.draft.outstandingIssues = [
    {
      code: 'walls_ceiling_floor',
      description: 'Sơn lại',
      responsibleParty: 'Owner',
      dueDate: '2026-11-25',
    },
    {
      code: 'other',
      description: 'Đối chiếu vật dụng',
      responsibleParty: 'Staff',
      dueDate: '2026-11-27',
    },
  ];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: '2. Kiểm tra hiện trạng phòng' });
  openSection(2);
  openWork('Tường, trần và sàn');
  fireEvent.click(screen.getByRole('radio', { name: 'Đạt' }));
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks.map((check: { code: string }) => check.code)).toEqual([
    'walls_ceiling_floor',
  ]);
  expect(body).not.toHaveProperty('outstandingIssues');
});

it('shows a synthetic JPEG upload button only for a development demo contract on localhost Expo Web', async () => {
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('location', { hostname: 'localhost', port: '8081' });
  const testContract = { ...contract, isDevelopmentDemo: true };
  const liveContract = { ...contract, isDevelopmentDemo: false };
  const first = render(<MoveInDraftHandoverPanel api={api} contract={liveContract} role="Staff" />);
  await screen.findByRole('button', { name: '4. Chìa khóa bàn giao' });
  openSection(4);
  openWork('Chìa khóa bàn giao');
  expect(screen.queryByRole('button', { name: 'Thêm ảnh mẫu DEV' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mở công cụ ảnh mẫu DEV' })).toBeNull();
  first.unmount();
  render(<MoveInDraftHandoverPanel api={api} contract={testContract} role="Staff" />);
  await screen.findByRole('button', { name: '4. Chìa khóa bàn giao' });
  openSection(4);
  openWork('Chìa khóa bàn giao');
  const floating = screen.getByRole('group', { name: 'Công cụ ảnh mẫu DEV' });
  expect(floating.parentElement).toBe(screen.getByRole('dialog'));
  expect(floating.style.position).toBe('absolute');
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn công cụ ảnh mẫu DEV' }));
  expect(screen.queryByRole('button', { name: 'Thêm ảnh mẫu DEV' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Chụp ảnh' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Lưu tiến độ' })).toBeTruthy();
  closeWork();
  expect(screen.queryByRole('group', { name: 'Công cụ ảnh mẫu DEV' })).toBeNull();
  openWork('Chìa khóa bàn giao');
  expect(screen.queryByRole('button', { name: 'Thêm ảnh mẫu DEV' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mở công cụ ảnh mẫu DEV' }));
  expect(
    state.transport.mock.calls.filter(([path]) => path.endsWith('/handover/draft/evidence')),
  ).toHaveLength(0);
  const sample = screen.getByRole('button', { name: 'Thêm ảnh mẫu DEV' });
  expect((sample as HTMLButtonElement).disabled).toBe(false);
  const sampleJpeg = [0xff, 0xd8, 0xff, ...Array(140).fill(0)];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/jpeg;base64,${btoa(String.fromCharCode(...sampleJpeg))}`,
  );
  fireEvent.click(sample);
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contract.id}/handover/draft/evidence`,
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' } }),
    ),
  );
  expect(await screen.findByText('Đã tải ảnh giả lập DEV lên biên bản test.')).toBeTruthy();
  expect(
    state.transport.mock.calls.filter(([path]) => path.endsWith('/handover/draft/evidence')),
  ).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Xóa ảnh chìa khóa 1' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Số lượng chìa khóa bàn giao'), {
    target: { value: '2' },
  });
  expect(
    state.transport.mock.calls.filter(
      ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
    ),
  ).toHaveLength(0);
  saveWork();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.some(
        ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
      ),
    ).toBe(true),
  );
  const mutation = state.transport.mock.calls.find(
    ([path, options]) => path.endsWith('/handover/draft') && options?.method === 'POST',
  );
  const body = JSON.parse(mutation![1].body);
  expect(body.keyEvidenceIds).toEqual(['30000000-0000-4000-8000-000000000001']);
  expect(body).not.toHaveProperty('evidenceIds');
  expect(body).not.toHaveProperty('roomChecks');
  expect(body).not.toHaveProperty('assets');
});

it('Confirmed exposes only the newest immutable MoveInReport belonging to this contract', async () => {
  state.draft = draft('Confirmed');
  const finalId = '40000000-0000-4000-8000-000000000001';
  state.documents.mockResolvedValue([
    {
      id: '40000000-0000-4000-8000-000000000002',
      kind: 'AssetChangeReport',
      contractId: contract.id,
      recordedAt: '2026-11-19T12:00:00Z',
    },
    {
      id: '40000000-0000-4000-8000-000000000003',
      kind: 'MoveInReport',
      contractId: '50000000-0000-4000-8000-000000000001',
      recordedAt: '2026-11-19T12:00:00Z',
    },
    {
      id: '40000000-0000-4000-8000-000000000004',
      kind: 'MoveInReport',
      contractId: contract.id,
      recordedAt: '2026-11-18T12:00:00Z',
    },
    {
      id: finalId,
      kind: 'MoveInReport',
      contractId: contract.id,
      recordedAt: '2026-11-19T12:00:00Z',
    },
  ]);
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
    />,
  );
  await screen.findByRole('button', { name: 'Biên bản và chữ ký' });
  fireEvent.click(screen.getByRole('button', { name: 'Biên bản và chữ ký' }));
  const document = await screen.findByTestId('final-handover-pdf');
  expect(document.getAttribute('data-document-id')).toBe(finalId);
  expect(screen.getAllByTestId('final-handover-pdf')).toHaveLength(1);
  expect(screen.queryByTestId('draft-handover-pdf')).toBeNull();
  expect(state.documents).toHaveBeenCalledWith(contract.id, expect.any(AbortSignal));
});

it('Confirmed reports a missing or inaccessible final PDF without offering a watermarked draft', async () => {
  state.draft = draft('Confirmed');
  state.documents.mockRejectedValueOnce({ status: 403, code: 'forbidden' });
  const page = render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Biên bản và chữ ký' }));
  expect(await screen.findByText(/Không tải được PDF/)).toBeTruthy();
  expect(screen.queryByTestId('draft-handover-pdf')).toBeNull();
  expect(screen.queryByTestId('final-handover-pdf')).toBeNull();
  page.unmount();
  state.documents.mockResolvedValue([]);
  render(
    <MoveInDraftHandoverPanel
      api={api}
      contract={{ ...contract, status: 'Active' }}
      role="Tenant"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Biên bản và chữ ký' }));
  expect(await screen.findByText(/PDF cuối cùng/)).toBeTruthy();
  expect(screen.queryByTestId('draft-handover-pdf')).toBeNull();
});
