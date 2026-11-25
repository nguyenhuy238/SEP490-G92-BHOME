// @vitest-environment jsdom
import { earlyTerminationDate } from '../../../../packages/client-core/src/contracts';
import React, { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  ContractAction,
  ContractSummary,
  MoveOut,
  Readiness,
} from '../../../../packages/client-core/src/contracts';
import { contractActionSection, groupContracts } from '../features/contracts/contractSections';

const state = vi.hoisted(() => ({
  role: 'Staff',
  deep: true,
  section: undefined as string | undefined,
  request: vi.fn(),
  contract: {} as Record<string, unknown>,
  readiness: null as Readiness | null,
  moveOut: null as MoveOut | null,
  back: vi.fn(),
  go: vi.fn(),
  registerExitGuard: vi.fn(() => () => {}),
  disablePrevention: vi.fn(),
  headerBack: undefined as (() => void) | undefined,
  viewedId: '',
  includeMoveOut: true,
  params: null as Record<string, string | undefined> | null,
}));
const id = 'bc050000-0000-4000-8000-000000004003';
vi.mock('../features/contracts/HoldingProgress', () => ({ HoldingProgress: () => null }));
const transport = { request: state.request };
vi.mock('../theme/theme', () => ({ colors: {}, staffColors: {} }));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => useEffect(callback, [callback]),
  usePreventRemove: () => state.disablePrevention,
  useLocalSearchParams: () =>
    state.params ?? (state.deep ? { contractId: id, section: state.section } : {}),
  router: { setParams: vi.fn(), canGoBack: () => true, back: state.back },
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: (
    _refresh: () => void,
    _disabled: boolean,
    options?: { onBack?: () => void },
  ) => {
    state.headerBack = options?.onBack;
    return true;
  },
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: transport,
    session: { userId: state.role.toLowerCase(), roles: [state.role] },
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: state.role,
    go: state.go,
    registerExitGuard: state.registerExitGuard,
  }),
}));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
vi.mock('../lib/useFeedbackState', () => ({ useFeedbackState: () => useState('') }));
vi.mock('../lib/toast', () => ({ conciseMessage: (s: string) => s, showError: vi.fn() }));
vi.mock('../../../../packages/client-core/src/useContractDetail', () => ({
  useContractDetail: (
    _client: unknown,
    contractId: string,
    _role: string,
    _interval: number,
    includeMoveOut: boolean,
  ) => {
    state.viewedId = contractId;
    state.includeMoveOut = includeMoveOut;
    return {
      loading: false,
      error: '',
      reload: vi.fn(),
      data: {
        contract: state.contract,
        moveOut: state.moveOut,
        readiness: state.readiness,
        history: [],
      },
    };
  },
}));
vi.mock('../features/contracts/StaffContractsList', () => ({
  StaffContractsList: ({
    onOpen,
  }: {
    onOpen: (contract: { id: string; kind: string }) => void;
  }) => (
    <button onClick={() => onOpen({ id: 'bc050000-0000-4000-8000-000000004001', kind: 'Holding' })}>
      Open previous Holding
    </button>
  ),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Icon: () => null,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ActivityIndicator: () => <span>Loading</span>,
  Checkbox: { Item: () => null },
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
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  ui: {},
}));
vi.mock('../components/WorkflowControls', () => ({ ChoiceField: () => null }));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: () => ({ data: null, error: '', loading: false, reload: vi.fn() }),
}));
vi.mock('../components/CameraCapture', () => ({ CameraCapture: () => <span>Upload camera</span> }));
vi.mock('../features/contracts/ContractProgress', () => ({
  ContractProgress: () => <span>Contract progress</span>,
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: ({ action, onSuccess }: { action: ContractAction; onSuccess: () => void }) =>
    action.operation === 'termination-requests' ? (
      <>
        <h2>{action.label}</h2>
        {action.fields.map((field) => (
          <label key={field.name}>{field.label}</label>
        ))}
        <button onClick={() => onSuccess()}>Gửi yêu cầu</button>
      </>
    ) : (
      <span>Action form</span>
    ),
  SigningCertificates: () => null,
}));
vi.mock('../features/contracts/ContractDraftForm', () => ({
  ContractDraftForm: ({ onCancel }: { onCancel: () => void }) => (
    <button onClick={onCancel}>Cấu hình giữ chỗ</button>
  ),
}));
vi.mock('../features/contracts/MainDraftScreen', () => ({
  MainDraftScreen: ({
    initialId,
    persistRoute = true,
    reviewOnly = false,
  }: {
    initialId?: string;
    persistRoute?: boolean;
    reviewOnly?: boolean;
  }) => (
    <span data-persist-route={String(persistRoute)} data-review-only={String(reviewOnly)}>
      Draft {initialId}
    </span>
  ),
}));
vi.mock('../features/contracts/MainDraftStart', () => ({
  MainDraftStart: () => <span>Main preparation</span>,
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: () => <span>Signed PDF</span>,
}));
vi.mock('../features/contracts/ContractWorkflowPanel', () => ({
  ContractWorkflowPanel: ({ section }: { section: string }) => <span>Workflow {section}</span>,
}));
vi.mock('../features/contracts/ContractHandoverPanel', () => ({
  ContractHandoverPanel: () => <span>Handover panel</span>,
}));
vi.mock('../features/contracts/MoveInDraftHandoverPanel', () => ({
  MoveInDraftHandoverPanel: () => <span>Handover draft panel</span>,
}));
vi.mock('../features/contracts/ContractLifecyclePanel', () => ({
  ContractLifecyclePanel: () => <span>Lifecycle panel</span>,
}));
vi.mock('../features/contracts/ContractExpiryPanel', () => ({ ContractExpiryPanel: () => null }));
import { ContractScreen } from '../features/contracts/ContractScreen';
import { router } from 'expo-router';
it('opens the routed Main contract instead of a previously selected Holding', () => {
  state.role = 'Staff';
  state.params = {};
  const page = render(<ContractScreen />);
  fireEvent.click(screen.getByText('Open previous Holding'));
  expect(state.viewedId).toBe('bc050000-0000-4000-8000-000000004001');
  state.params = { contractId: id, mainDraftId: '', kind: '' };
  state.contract = { ...state.contract, id, kind: 'Main' };
  page.rerender(<ContractScreen />);
  expect(state.viewedId).toBe(id);
});

function summary(status: string, kind = 'Main', name = status): ContractSummary {
  return {
    id: name,
    roomId: 'room',
    locationId: 'location',
    locationName: 'Test',
    roomNumber: 'CT204',
    kind,
    status,
    startDate: '2026-10-01',
    endDate: '2027-10-01',
    monthlyRent: '3000000',
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Staff';
  state.deep = true;
  state.params = null;
  state.section = undefined;
  state.readiness = null;
  state.moveOut = null;
  state.contract = {
    ...summary('Active'),
    id,
    requiredDeposit: '0',
    appliedHoldingDeposit: '0',
    terms: 'Điều khoản test đã lưu',
    residentIds: ['resident'],
    signatures: [],
    previousContractId: null,
    ownerSignerId: 'owner',
    tenantUserId: 'tenant',
    representativeResidentId: 'resident',
    occupants: [{ id: 'resident', label: 'Người ở tổng hợp', representative: true }],
    isDevelopmentDemo: true,
  };
  state.request.mockImplementation(async (path: string) =>
    path.includes('move-out-assignments') || path.endsWith('/previews')
      ? []
      : {
          items: [
            summary('Draft'),
            summary('PendingSigning'),
            summary('Active'),
            summary('Draft', 'Renewal', 'renewal'),
            summary('Terminated'),
          ],
          totalCount: 5,
          page: 1,
          pageSize: 20,
        },
  );
});
afterEach(cleanup);
it('shows the early termination form directly in the Tenant lifecycle section', () => {
  state.role = 'Tenant';
  state.section = 'lifecycle';
  render(<ContractScreen />);

  expect(screen.getByRole('heading', { name: 'Yêu cầu chấm dứt trước hạn' })).toBeTruthy();
  expect(screen.getByText('Ngày dự kiến trả phòng')).toBeTruthy();
  expect(screen.getByText('Lý do')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Yêu cầu chấm dứt trước hạn' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
  expect(screen.getByText('Yêu cầu đang chờ chủ trọ duyệt.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi yêu cầu' })).toBeNull();
});

it('shows the submitted request and waits for Owner approval before showing Tenant settlement', () => {
  state.role = 'Tenant';
  state.section = 'lifecycle';
  state.moveOut = {
    status: 'Requested',
    proposedDate: '2099-11-05',
    reason: 'Chuyển nơi ở',
    version: 1,
  } as MoveOut;
  const { rerender } = render(<ContractScreen />);

  expect(screen.getByText('Lý do: Chuyển nơi ở')).toBeTruthy();
  expect(screen.queryByText('Lifecycle panel')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gửi yêu cầu' })).toBeNull();

  state.moveOut = { ...state.moveOut, status: 'Approved' };
  rerender(<ContractScreen />);
  expect(screen.getByText('Lifecycle panel')).toBeTruthy();
});

it('removes the duplicate detail back button and registers previous-screen navigation on the topbar', () => {
  state.contract.status = 'PendingSigning';
  render(<ContractScreen />);
  expect(screen.queryByRole('button', { name: 'Về danh sách hợp đồng' })).toBeNull();
  expect(state.headerBack).toBeTypeOf('function');
  state.headerBack!();
  expect(state.back).toHaveBeenCalledOnce();
});

it('returns Staff home after confirming a completed Main contract or using its header back button', () => {
  render(<ContractScreen />);
  expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận · Về Trang chủ' }));
  expect(state.go).toHaveBeenCalledExactlyOnceWith('staff-home');

  state.go.mockClear();
  state.headerBack!();
  expect(state.go).toHaveBeenCalledExactlyOnceWith('staff-home');
  expect(state.back).not.toHaveBeenCalled();
});

it('returns Staff home from an existing Main draft without a CCCD exit guard', () => {
  state.contract = { ...state.contract, status: 'Draft', onboardingDraft: true };
  render(<ContractScreen />);
  expect(state.registerExitGuard).not.toHaveBeenCalled();
  state.headerBack!();
  expect(state.go).toHaveBeenCalledExactlyOnceWith('staff-home');
  expect(state.back).not.toHaveBeenCalled();
});

it('opens a Holding draft with metadata in the Holding flow without Main handover tabs', () => {
  state.contract.kind = 'Holding';
  state.contract.status = 'Draft';
  state.contract.onboardingDraft = true;
  state.contract.signingMode = 'INTERNAL_OTP_DRAWN';
  state.contract.holdingCustomer = { fullName: 'Synthetic Holding Customer', maskedCitizenNumber: '********0001' };
  render(<ContractScreen />);
  expect(screen.getByText('Bản nháp chờ gửi Owner ký')).toBeTruthy();
  expect(screen.getByText('Synthetic Holding Customer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bàn giao' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gia hạn & trả phòng' })).toBeNull();
  expect(screen.queryByText('Chữ ký số qua MySign')).toBeNull();
});

it('opens an Owner draft for review and returns to the list when route IDs clear', async () => {
  state.role = 'Owner';
  state.params = {};
  state.request.mockResolvedValue({
    items: [{ ...summary('Draft', 'Main', id), onboardingDraft: true }],
    totalCount: 1,
    page: 1,
    pageSize: 20,
  });
  const view = render(<ContractScreen />);
  fireEvent.click(await screen.findByText('Xem hợp đồng'));
  expect(router.setParams).toHaveBeenCalledWith({ contractId: id, mainDraftId: '', roomId: '' });
  state.params = { contractId: id };
  state.contract = { ...state.contract, onboardingDraft: true, status: 'Draft' };
  view.rerender(<ContractScreen />);
  expect(screen.getByText(`Draft ${id}`).getAttribute('data-review-only')).toBe('true');
  state.params = { contractId: '', mainDraftId: '', roomId: '' };
  view.rerender(<ContractScreen />);
  await screen.findByText('Hợp đồng & Vòng đời');
  expect(screen.queryByText(`Draft ${id}`)).toBeNull();
});
it('opens Owner Holding metadata from the list without creating a Main draft route', async () => {
  state.role = 'Owner';
  state.params = {};
  state.request.mockResolvedValue({
    items: [{ ...summary('Draft', 'Holding', id), onboardingDraft: true }],
    totalCount: 1,
    page: 1,
    pageSize: 20,
  });
  render(<ContractScreen />);
  fireEvent.click(await screen.findByText('Xem hợp đồng'));
  expect(router.setParams).toHaveBeenCalledWith({ contractId: id, mainDraftId: '', roomId: '' });
});
it.each([
  { contractId: 'malformed' },
  { contractId: id, mainDraftId: 'bc050000-0000-4000-8000-000000004004' },
])('rejects malformed or conflicting Owner resource references %j', (params) => {
  state.role = 'Owner';
  state.params = params;
  render(<ContractScreen />);
  expect(screen.getByText(/Tham chiếu hợp đồng không hợp lệ/)).toBeTruthy();
  expect(screen.queryByText('Action form')).toBeNull();
});
it('does not expose full contract creation in the Owner contract list', () => {
  state.role = 'Owner';
  state.params = {};
  render(<ContractScreen />);
  expect(screen.queryByText('Tạo hợp đồng thuê')).toBeNull();
  expect(screen.queryByText('Main preparation')).toBeNull();
});
it('lets the Owner signer review a Holding draft without an approval step and keeps Staff read-only in signing', async () => {
  state.contract.kind = 'Holding';
  state.contract.status = 'Draft';
  state.contract.holdingExpiresAt = '2099-12-01T00:00:00Z';
  state.role = 'Owner';
  const view = render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký hợp đồng' }));
  expect(screen.getByRole('button', { name: 'Xem hợp đồng' })).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('Đang tải tài liệu…')).toBeNull());
  expect(state.request.mock.calls.map(([path]) => path)).toContain(
    `/api/v1/contracts/${id}/previews`,
  );
  expect(screen.queryByRole('button', { name: 'Phê duyệt hợp đồng giữ chỗ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kích hoạt giữ chỗ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác minh cọc ngân hàng' })).toBeNull();
  view.unmount();
  state.role = 'Staff';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký hợp đồng' }));
  expect(screen.getByText('Gửi Owner ký')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xem hợp đồng' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Phê duyệt hợp đồng giữ chỗ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kích hoạt giữ chỗ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác minh cọc ngân hàng' })).toBeNull();
});
it.each([true, false])('gates Holding activation on backend readiness=%s', (ready) => {
  state.role = 'Owner';
  state.contract.kind = 'Holding';
  state.contract.status = 'PendingActivation';
  state.contract.approvedAt = '2026-11-01T00:00:00Z';
  state.contract.holdingExpiresAt = '2099-12-01T00:00:00Z';
  state.readiness = {
    ready,
    verifiedDeposit: '1000000',
    remainingDeposit: '0',
    blockers: ready ? [] : ['verified_signature_evidence_required'],
  };
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký hợp đồng' }));
  expect(screen.queryByRole('button', { name: 'Kích hoạt giữ chỗ' })).toBeNull();
});
it('preserves Staff conversion for an active unexpired Holding contract', () => {
  state.contract.kind = 'Holding';
  state.contract.status = 'Active';
  state.contract.holdingExpiresAt = '2099-12-01T00:00:00Z';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký hợp đồng' }));
  expect(screen.getByRole('button', { name: 'Chuyển sang hợp đồng thuê chính' })).toBeTruthy();
});
it('blocks legacy Owner holding-creation routes without opening an authoring form', () => {
  state.role = 'Owner';
  state.params = { kind: 'Holding' };
  render(<ContractScreen />);
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByText('Cấu hình giữ chỗ')).toBeNull();
  expect(state.request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true,
  );
});

it('opens the handover section directly for the selected Tenant contract', () => {
  state.role = 'Tenant';
  state.section = 'handover';
  render(<ContractScreen />);
  expect(screen.getByText('Handover draft panel')).toBeTruthy();
  expect(screen.queryByText('Điều khoản đưa đi ký')).toBeNull();
});
it('does not load signing methods or move-out on a Staff handover deep link', () => {
  state.role = 'Staff';
  state.section = 'handover';
  render(<ContractScreen />);
  expect(screen.getByText('Handover draft panel')).toBeTruthy();
  expect(state.includeMoveOut).toBe(false);
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/signing-methods'))).toBe(false);
});
it('renders only the inspection workspace when Staff opens a handover task and returns to the task list', () => {
  state.params = { contractId: id, section: 'handover', origin: 'staff-handovers' };
  render(<ContractScreen />);
  expect(screen.getByText('Handover draft panel')).toBeTruthy();
  for (const label of [
    'Tổng quan',
    'Ký & kích hoạt',
    'Bàn giao',
    'Gia hạn & trả phòng',
    'Lịch sử',
  ]) {
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  }
  expect(screen.queryByText('Đang hiệu lực')).toBeNull();
  expect(state.includeMoveOut).toBe(false);
  expect(state.headerBack).toBeTypeOf('function');
  state.headerBack?.();
  expect(state.go).toHaveBeenCalledWith('staff-handovers', { tab: 'MoveIn' });
});
it('ignores an invalid initial contract section', () => {
  state.role = 'Tenant';
  state.section = '../unknown';
  render(<ContractScreen />);
  expect(screen.getByText('Hợp đồng đã được kích hoạt')).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
});

it('groups each contract exactly once and keeps closed renewals in history', () => {
  const items = [
    summary('Draft'),
    summary('PendingSigning'),
    summary('PendingActivation'),
    summary('Active'),
    summary('Draft', 'Renewal', 'renewal'),
    summary('Superseded'),
    summary('Cancelled'),
    summary('Terminated', 'Renewal', 'old-renewal'),
  ];
  const groups = groupContracts(items);
  expect(groups).toHaveLength(5);
  expect(groups.flatMap((group) => group.items)).toHaveLength(items.length);
  expect(groups.find((group) => group.id === 'closed')!.items).toHaveLength(3);
});
it('shows separate populated lifecycle groups on the list page', async () => {
  state.role = 'Owner';
  state.deep = false;
  render(<ContractScreen />);
  await screen.findByText('1. Hồ sơ nháp');
  expect(screen.getByText('2. Chờ ký / kích hoạt')).toBeTruthy();
  expect(screen.getByText('3. Đang thuê')).toBeTruthy();
  expect(screen.getByText('4. Bản gia hạn')).toBeTruthy();
  expect(screen.getByText('5. Đã kết thúc / hủy')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tạo nháp hợp đồng thuê' })).toBeNull();
});
it('shows Owner contract state and only actions appropriate for an Active contract', () => {
  state.role = 'Owner';
  render(<ContractScreen />);
  expect(screen.queryByText('Thực hiện trên Owner Web')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ký & kích hoạt' }));
  expect(screen.queryByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gia hạn & trả phòng' }));
  expect(screen.queryByRole('button', { name: 'Chuẩn bị gia hạn' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hoàn tất trả phòng' })).toBeNull();
  expect(screen.queryByText('Action form')).toBeNull();
});
it.each([true, false])('gates Owner Main activation on backend readiness=%s', (ready) => {
  state.role = 'Owner';
  state.contract.status = 'PendingActivation';
  state.readiness = {
    ready,
    verifiedDeposit: '1000000',
    remainingDeposit: ready ? '0' : '1000000',
    blockers: ready ? [] : ['verified_signature_evidence_required'],
  };
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký & kích hoạt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xem tiền cọc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kích hoạt' }));
  expect(screen.queryByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeNull();
});
it('keeps full Main preparation on Owner Web even when the prepare flag is supplied', () => {
  state.role = 'Owner';
  state.params = {};
  render(<ContractScreen prepare />);
  expect(screen.queryByText('Main preparation')).toBeNull();
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByText('Action form')).toBeNull();
  expect(state.request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true,
  );
});
it('opens a persisted Owner Draft for review without changing route IDs', () => {
  state.role = 'Owner';
  state.params = { contractId: id };
  state.contract = { ...state.contract, onboardingDraft: true, status: 'Draft' };
  render(<ContractScreen />);
  expect(screen.getByText(`Draft ${id}`).getAttribute('data-review-only')).toBe('true');
  expect(router.setParams).not.toHaveBeenCalled();
});
it('defaults to overview and switches sections without displaying all forms at once', () => {
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết hợp đồng' }));
  expect(screen.getByText('Điều khoản test đã lưu')).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao' }));
  expect(screen.getByText('Handover draft panel')).toBeTruthy();
  expect(screen.queryByText('Điều khoản test đã lưu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử' }));
  expect(screen.getByText('Workflow history')).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
});
it.each(['PendingSigning', 'PendingActivation', 'Active'] as const)(
  'hides the section tabs in the Staff guided Main contract flow in %s',
  (status) => {
    state.contract = { ...state.contract, status, initialPaymentRequired: true };
    render(<ContractScreen />);
    for (const name of [
      'Tổng quan',
      'Ký & kích hoạt',
      'Bàn giao',
      'Gia hạn & trả phòng',
      'Lịch sử',
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
  },
);
it('keeps Staff restrictions in the signing section', () => {
  state.contract.status = 'PendingSigning';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký & kích hoạt' }));
  expect(screen.getByText('Bước 5/7')).toBeTruthy();
  expect(screen.queryByText('Signed PDF')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeNull();
  expect(screen.getByText(/Staff theo dõi hồ sơ/)).toBeTruthy();
});
it('shows the handover draft before contract activation for Staff', () => {
  state.contract.status = 'PendingActivation';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao' }));
  expect(screen.getByText('Handover draft panel')).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
});
it('keeps active Main contracts on the new handover with historic fallback available', () => {
  state.role = 'Tenant';
  state.section = 'handover';
  render(<ContractScreen />);
  expect(screen.getByText('Handover draft panel')).toBeTruthy();
});
it('puts renewal actions in lifecycle and closes an action when changing sections', () => {
  render(<ContractScreen />);
  expect(screen.queryByRole('button', { name: 'Tạo bản gia hạn' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gia hạn & trả phòng' }));
  const action = screen.getByRole('button', { name: 'Chuẩn bị gia hạn' });
  fireEvent.click(action);
  expect(screen.getByText('Action form')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tổng quan' }));
  expect(screen.queryByText('Action form')).toBeNull();
});
it.each([
  ['renewals', 'lifecycle'],
  ['move-out/approve', 'lifecycle'],
  ['signing/sync', 'signing'],
  ['activate', 'signing'],
])('routes %s actions to %s without changing permissions', (operation, section) =>
  expect(contractActionSection(operation)).toBe(section),
);

it('validates the typed early termination date before it can be sent', () => {
  const contract = { startDate: '2099-01-01', endDate: '2099-12-31' };
  expect(() => earlyTerminationDate('05-11-', contract)).toThrow(/dd\/MM\/yyyy/);
  expect(() => earlyTerminationDate('31-02-2099', contract)).toThrow(/dd\/MM\/yyyy/);
  expect(() => earlyTerminationDate('09-10-2024', contract)).toThrow(/quá khứ/);
  expect(() => earlyTerminationDate('31-12-2098', contract)).toThrow(/bắt đầu/);
  expect(() => earlyTerminationDate('31-12-2099', contract)).toThrow(/hết hạn/);
  expect(earlyTerminationDate('05-11-2099', contract)).toBe('2099-11-05');
});
