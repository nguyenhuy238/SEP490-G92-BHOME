// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContractSummary, Readiness } from '../../../../packages/client-core/src/contracts';
import { contractActionSection, groupContracts } from '../features/contracts/contractSections';

const state = vi.hoisted(() => ({
  role: 'Staff',
  deep: true,
  section: undefined as string | undefined,
  request: vi.fn(),
  contract: {} as Record<string, unknown>,
  readiness: null as Readiness | null,
  back: vi.fn(),
  headerBack: undefined as (() => void) | undefined,
  params: null as Record<string, string | undefined> | null,
}));
const id = 'bc050000-0000-4000-8000-000000004003';
vi.mock('../features/contracts/HoldingProgress', () => ({ HoldingProgress: () => null }));
const transport = { request: state.request };
vi.mock('../theme/theme', () => ({ colors: {}, staffColors: {} }));
vi.mock('expo-router', () => ({
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
    session: { userId: 'staff', roles: [state.role] },
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role }),
}));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
vi.mock('../lib/useFeedbackState', () => ({ useFeedbackState: () => useState('') }));
vi.mock('../lib/toast', () => ({ conciseMessage: (s: string) => s, showError: vi.fn() }));
vi.mock('../../../../packages/client-core/src/useContractDetail', () => ({
  useContractDetail: () => ({
    loading: false,
    error: '',
    reload: vi.fn(),
    data: { contract: state.contract, moveOut: null, readiness: state.readiness, history: [] },
  }),
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
  ContractActionForm: () => <span>Action form</span>,
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
  }: {
    initialId?: string;
    persistRoute?: boolean;
  }) => <span data-persist-route={String(persistRoute)}>Draft {initialId}</span>,
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
vi.mock('../features/contracts/ContractLifecyclePanel', () => ({
  ContractLifecyclePanel: () => <span>Lifecycle panel</span>,
}));
vi.mock('../features/contracts/ContractExpiryPanel', () => ({ ContractExpiryPanel: () => null }));
import { ContractScreen } from '../features/contracts/ContractScreen';
import { router } from 'expo-router';

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
    path.includes('move-out-assignments')
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
it('removes the duplicate detail back button and registers previous-screen navigation on the topbar', () => {
  render(<ContractScreen />);
  expect(screen.queryByRole('button', { name: 'Về danh sách hợp đồng' })).toBeNull();
  expect(state.headerBack).toBeTypeOf('function');
  state.headerBack!();
  expect(state.back).toHaveBeenCalledOnce();
});

it('opens a Holding draft with metadata in the Holding flow without Main handover tabs', () => {
  state.contract.kind = 'Holding';
  state.contract.status = 'Draft';
  state.contract.onboardingDraft = true;
  state.contract.signingMode = 'INTERNAL_OTP_DRAWN';
  render(<ContractScreen />);
  expect(screen.getByText('Chờ Owner phê duyệt')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bàn giao' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gia hạn & trả phòng' })).toBeNull();
  expect(screen.queryByText('Chữ ký số qua MySign')).toBeNull();
});
it('preserves an Owner draft deep link as Web guidance and returns to the list when route IDs clear', async () => {
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
  expect(router.setParams).toHaveBeenCalledWith({ contractId: id, mainDraftId: id, roomId: '' });
  state.params = { contractId: id, mainDraftId: id };
  view.rerender(<ContractScreen />);
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByText(`Draft ${id}`)).toBeNull();
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
it('allows Owner to approve a Holding draft while Staff cannot approve, verify deposits or activate', () => {
  state.contract.kind = 'Holding';
  state.contract.status = 'Draft';
  state.contract.holdingExpiresAt = '2099-12-01T00:00:00Z';
  state.role = 'Owner';
  const view = render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký hợp đồng' }));
  expect(screen.getByRole('button', { name: 'Phê duyệt hợp đồng giữ chỗ' })).toBeTruthy();
  expect(screen.queryByText('Thực hiện trên Owner Web')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác minh cọc ngân hàng' })).toBeNull();
  view.unmount();
  state.role = 'Staff';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký hợp đồng' }));
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
  expect(
    (screen.getByRole('button', { name: 'Kích hoạt giữ chỗ' }) as HTMLButtonElement).disabled,
  ).toBe(!ready);
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
  expect(screen.getByText('Handover panel')).toBeTruthy();
  expect(screen.queryByText('Điều khoản đưa đi ký')).toBeNull();
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
  expect(
    (screen.getByRole('button', { name: 'Kích hoạt hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(!ready);
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
it('keeps a persisted Owner Draft informational without mounting editing or changing route IDs', () => {
  state.role = 'Owner';
  state.params = { contractId: id };
  state.contract = { ...state.contract, onboardingDraft: true, status: 'Draft' };
  render(<ContractScreen />);
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByText(`Draft ${id}`)).toBeNull();
  expect(router.setParams).not.toHaveBeenCalled();
});
it('defaults to overview and switches sections without displaying all forms at once', () => {
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết hợp đồng' }));
  expect(screen.getByText('Điều khoản test đã lưu')).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao' }));
  expect(screen.getByText('Handover panel')).toBeTruthy();
  expect(screen.queryByText('Điều khoản test đã lưu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử' }));
  expect(screen.getByText('Workflow history')).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
});
it('keeps Staff restrictions in the signing section', () => {
  state.contract.status = 'PendingSigning';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký & kích hoạt' }));
  expect(screen.getByText('Bước 2/4 · Ký hợp đồng')).toBeTruthy();
  expect(screen.queryByText('Signed PDF')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeNull();
  expect(screen.getByText(/Staff theo dõi hồ sơ/)).toBeTruthy();
});
it('does not open handover forms before activation', () => {
  state.contract.status = 'Draft';
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao' }));
  expect(screen.getByText(/Chỉ thực hiện bàn giao sau khi hợp đồng được kích hoạt/)).toBeTruthy();
  expect(screen.queryByText('Handover panel')).toBeNull();
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
