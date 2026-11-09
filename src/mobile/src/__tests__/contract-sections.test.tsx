// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContractSummary } from '../../../../packages/client-core/src/contracts';
import { contractActionSection, groupContracts } from '../features/contracts/contractSections';

const state = vi.hoisted(() => ({
  role: 'Staff',
  deep: true,
  section: undefined as string | undefined,
  request: vi.fn(),
  contract: {} as Record<string, unknown>,
}));
const id = 'bc050000-0000-4000-8000-000000004003';
const transport = { request: state.request };
vi.mock('../theme/theme', () => ({ colors: {} }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => (state.deep ? { contractId: id, section: state.section } : {}),
  router: { setParams: vi.fn() },
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
    data: { contract: state.contract, moveOut: null, readiness: null, history: [] },
  }),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
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
vi.mock('../components/CameraCapture', () => ({ CameraCapture: () => <span>Upload camera</span> }));
vi.mock('../features/contracts/ContractProgress', () => ({
  ContractProgress: () => <span>Contract progress</span>,
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: () => <span>Action form</span>,
  SigningCertificates: () => null,
}));
vi.mock('../features/contracts/ContractDraftForm', () => ({ ContractDraftForm: () => null }));
vi.mock('../features/contracts/MainDraftScreen', () => ({ MainDraftScreen: () => null }));
vi.mock('../features/contracts/MainDraftStart', () => ({ MainDraftStart: () => null }));
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
  state.section = undefined;
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
  expect(screen.getByText('Điều khoản đưa đi ký')).toBeTruthy();
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
});
it('defaults to overview and switches sections without displaying all forms at once', () => {
  render(<ContractScreen />);
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
  render(<ContractScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ký & kích hoạt' }));
  expect(screen.getByText('Chữ ký và bằng chứng')).toBeTruthy();
  expect(screen.queryByText('Signed PDF')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeNull();
  expect(screen.getByText(/Staff chuẩn bị và theo dõi hồ sơ/)).toBeTruthy();
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
