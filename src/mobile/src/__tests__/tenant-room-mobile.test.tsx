// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TenantRoomScreen } from '../features/tenant/room/TenantRoomScreen';

const mocks = vi.hoisted(() => ({
  go: vi.fn(),
  tenancy: null as unknown,
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole === 'alert' ? 'alert' : undefined}>{children}</span>,
  Icon: () => null,
  ActivityIndicator: () => <span>Đang tải</span>,
  IconButton: ({
    onPress,
    accessibilityLabel,
    disabled,
  }: {
    onPress: () => void;
    accessibilityLabel: string;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {accessibilityLabel}
    </button>
  ),
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityState: { expanded: boolean };
  }) => (
    <button
      aria-label={accessibilityLabel}
      aria-expanded={accessibilityState.expanded}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock('../theme/theme', () => ({
  colors: {
    navy: '#001637',
    primary: '#172b4d',
    blue: '#1052cf',
    white: '#fff',
    soft: '#f1f3ff',
    border: '#e2e8f0',
    ink: '#111b2e',
    muted: '#64748b',
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: { grow: {}, muted: {}, red: {}, money: {}, line: {} },
  Heading: ({ title, detail }: { title: string; detail: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{detail}</p>
    </div>
  ),
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (id: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="">Chọn…</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({ useWorkspaceHeaderRefresh: vi.fn() }));
vi.mock('../features/tenant/room/useTenantTenancy', () => ({
  useTenantTenancy: () => mocks.tenancy,
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: mocks.go }),
}));

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const summary = {
  id,
  roomNumber: 'A101',
  locationName: 'Cơ sở thử nghiệm',
  startDate: '2026-10-01',
  endDate: '2027-09-30',
  kind: 'Main',
  status: 'Active',
};
const contract = {
  ...summary,
  monthlyRent: '2500000',
  requiredDeposit: '2500000',
  occupants: [{ id: 'resident-1', label: 'Người thuê thử nghiệm', representative: true }],
};
const handover = {
  status: 'Confirmed',
  snapshot: {
    date: '2026-10-01',
    roomCondition: 'Sạch sẽ',
    keysAndAccess: '2 chìa khóa',
    electricity: { value: '100' },
    water: { value: '20' },
    assets: [{ id: 'asset-1', name: 'Máy lạnh', observedCondition: 'Hoạt động tốt' }],
  },
  tenantConfirmedAt: '2026-10-01T03:00:00Z',
};

function tenantScope() {
  return {
    contracts: {
      data: { totalCount: 1, items: [summary] },
      loading: false,
      error: '',
      reload: vi.fn(),
    },
    items: [summary],
    current: summary,
    detail: { data: contract, loading: false, error: '', reload: vi.fn() },
    handover: { data: handover, loading: false, error: '', reload: vi.fn() },
    selected: id,
    selectionUnavailable: false,
    page: 1,
    setPage: vi.fn(),
    select: vi.fn(),
    reload: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenancy = tenantScope();
});
afterEach(cleanup);

it('shows current room, verified rent and contract dates before secondary information', () => {
  render(<TenantRoomScreen />);
  expect(screen.getByText('Phòng A101')).toBeTruthy();
  expect(screen.getByText('Giá thuê / tháng')).toBeTruthy();
  expect(screen.getAllByText(/2\.500\.000/).length).toBeGreaterThan(0);
  expect(screen.getByText('Ngày bắt đầu')).toBeTruthy();
  expect(screen.getByText('Ngày kết thúc')).toBeTruthy();
  expect(screen.queryByText('Người thuê thử nghiệm')).toBeNull();
  expect(screen.queryByText('Sạch sẽ')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem hợp đồng và quyền lợi' }));
  expect(mocks.go).toHaveBeenCalledWith('contract', { contractId: id, section: 'overview' });
});

it('discloses occupants and handover only on request without losing evidence workflow', () => {
  render(<TenantRoomScreen />);
  const occupants = screen.getByRole('button', { name: 'Người ở trong hợp đồng' });
  const handoverButton = screen.getByRole('button', { name: 'Thông tin bàn giao' });
  expect(occupants.getAttribute('aria-expanded')).toBe('false');
  expect(handoverButton.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(occupants);
  expect(occupants.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Người thuê thử nghiệm')).toBeTruthy();
  fireEvent.click(occupants);
  expect(screen.queryByText('Người thuê thử nghiệm')).toBeNull();

  fireEvent.click(handoverButton);
  expect(handoverButton.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Sạch sẽ')).toBeTruthy();
  expect(screen.getByText('Máy lạnh: Hoạt động tốt')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản bàn giao và bằng chứng' }));
  expect(mocks.go).toHaveBeenCalledWith('checklist', { contractId: id, section: 'handover' });
});

it('preserves the explicit multi-contract chooser and does not select a different contract automatically', () => {
  const scope = tenantScope();
  const other = { ...summary, id: secondId, roomNumber: 'B202' };
  scope.items = [summary, other];
  scope.contracts.data.items = [summary, other];
  scope.contracts.data.totalCount = 2;
  mocks.tenancy = scope;
  render(<TenantRoomScreen />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Chọn hợp đồng đang thuê' }), {
    target: { value: secondId },
  });
  expect(scope.select).toHaveBeenCalledWith(secondId);
  expect(mocks.go).not.toHaveBeenCalled();
});

it('keeps a removed selection unselected and never exposes stale contract details', () => {
  const scope = tenantScope();
  scope.current = undefined as never;
  scope.selected = secondId;
  scope.selectionUnavailable = true;
  mocks.tenancy = scope;
  render(<TenantRoomScreen />);
  expect(screen.getByRole('alert').textContent).toContain('không còn trên trang này');
  expect(screen.queryByText('Phòng A101')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem hợp đồng và quyền lợi' })).toBeNull();
  expect(mocks.go).not.toHaveBeenCalled();
});

it('shows failed handover loading and retry only when the handover section is expanded', () => {
  const scope = tenantScope();
  scope.handover.data = null as never;
  scope.handover.error = 'Không tải được biên bản';
  mocks.tenancy = scope;
  render(<TenantRoomScreen />);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thông tin bàn giao' }));
  expect(screen.getByRole('alert').textContent).toContain('Không tải được biên bản');
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(scope.handover.reload).toHaveBeenCalledOnce();
});
