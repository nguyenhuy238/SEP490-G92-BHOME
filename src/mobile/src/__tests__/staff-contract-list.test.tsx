// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  ContractClient,
  ContractSummary,
} from '../../../../packages/client-core/src/contracts';
import {
  loadStaffContracts,
  staffContractPage,
  staffContractTone,
  defaultStaffContractListView,
  isMainOnboardingDraft,
} from '../features/contracts/staffContractList';

const state = vi.hoisted(() => ({
  list: vi.fn(),
  schedules: vi.fn(),
  open: vi.fn(),
  create: vi.fn(),
  inspect: vi.fn(),
  scroll: vi.fn(),
  refresh: null as (() => void) | null,
  refreshDisabled: false,
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ resetScroll: state.scroll }),
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: (refresh: () => void, disabled: boolean) => {
    state.refresh = refresh;
    state.refreshDisabled = disabled;
    return true;
  },
}));
type Children = { children?: React.ReactNode };
vi.mock('../theme/theme', () => ({ colors: {} }));
type Control = Children & {
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { selected?: boolean; expanded?: boolean };
  testID?: string;
};
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: Children) => <div>{children}</div>,
  ScrollView: ({ children }: Children) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Pill: ({ children }: Children) => <span>{children}</span>,
  ui: {},
}));
vi.mock('react-native-paper', () => {
  const Button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    testID,
  }: Control) => (
    <button
      role={accessibilityRole || 'button'}
      aria-label={accessibilityLabel}
      aria-selected={accessibilityState?.selected}
      aria-expanded={accessibilityState?.expanded}
      data-testid={testID}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
  const Input = ({
    value,
    onChangeText,
    accessibilityLabel,
    placeholder,
    right,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel: string;
    placeholder: string;
    right?: React.ReactNode;
  }) => (
    <label>
      {accessibilityLabel}
      <input
        aria-label={accessibilityLabel}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChangeText(event.target.value)}
      />
      {right}
    </label>
  );
  return {
    Text: ({ children }: Children) => <span>{children}</span>,
    Icon: () => null,
    ActivityIndicator: () => <span>Loading contracts</span>,
    Button,
    IconButton: Button,
    TouchableRipple: Button,
    TextInput: Object.assign(Input, {
      Icon: ({ onPress, accessibilityLabel }: Control) =>
        onPress ? <button onClick={onPress} aria-label={accessibilityLabel} /> : null,
    }),
    Menu: Object.assign(
      ({ visible, anchor, children }: Children & { visible: boolean; anchor: React.ReactNode }) => (
        <>
          {anchor}
          {visible && <div role="menu">{children}</div>}
        </>
      ),
      {
        Item: ({ title, onPress }: { title: string; onPress: () => void }) => (
          <button onClick={onPress}>{title}</button>
        ),
      },
    ),
  };
});
import { StaffContractsList } from '../features/contracts/StaffContractsList';
const api = { list: state.list, moveOutAssignments: state.schedules } as unknown as ContractClient;
function fixtures(): ContractSummary[] {
  const statuses = [
    'Draft',
    'Draft',
    'PendingSigning',
    'PendingActivation',
    ...Array<string>(7).fill('Active'),
    'Terminated',
    'Superseded',
    'Cancelled',
  ];
  return statuses.map((status, i) => ({
    id: `contract-${i + 1}`,
    roomId: `room-${i + 1}`,
    locationId: 'location',
    locationName: 'BHOME Đống Đa',
    roomNumber: `CT${201 + i}`,
    kind: 'Main',
    status,
    startDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
    endDate: '2027-01-01',
    monthlyRent: String(3000000 + i * 100000),
  }));
}
let all: ContractSummary[];
beforeEach(() => {
  vi.clearAllMocks();
  all = fixtures();
  state.refresh = null;
  state.list.mockImplementation(async (page: number) => ({
    items: all.slice((page - 1) * 20, page * 20),
    page,
    pageSize: 20,
    totalCount: all.length,
  }));
  state.schedules.mockResolvedValue([
    {
      contractId: 'inspection-contract',
      roomNumber: 'CT208',
      locationName: 'BHOME TEST',
      scheduledAt: '2026-11-07T03:00:00Z',
      status: 'Approved',
    },
  ]);
});
afterEach(cleanup);
async function openList() {
  render(
    <StaffContractsList
      api={api}
      onOpen={state.open}
      onCreateHolding={() => state.create('Holding')}
      onInspection={state.inspect}
    />,
  );
  await screen.findByText('Hiển thị 1–5 / 14');
}
it('opens holding creation from its own staff action', async () => {
  await openList();
  fireEvent.click(screen.getByText('Tạo hợp đồng giữ chỗ'));
  expect(state.create).toHaveBeenCalledWith('Holding');
});
it('keeps Holding kind independent from Draft/Signing/Active states and counts every matching record', async () => {
  all = [
    ...all,
    ...['Draft', 'PendingSigning', 'Active'].map((status, index) => ({
      ...all[index]!,
      id: `holding-${index}`,
      roomNumber: `H${index}`,
      kind: 'Holding',
      status,
      monthlyRent: '9999999',
      requiredDeposit: '500000',
      holdingExpiresAt: '2099-12-01T00:00:00Z',
      onboardingDraft: true,
    })),
  ];
  render(
    <StaffContractsList
      api={api}
      onOpen={state.open}
      onCreateHolding={() => state.create('Holding')}
      onInspection={state.inspect}
    />,
  );
  await screen.findByText('17 hợp đồng');
  expect(screen.getByRole('tab', { name: 'Tất cả (17)' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Giữ chỗ (3)' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Chính thức (14)' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Bản nháp (3)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Giữ chỗ (3)' }));
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(3);
  for (const card of screen.getAllByTestId('staff-contract-card')) {
    expect(card.textContent).toContain('Hạn giữ chỗ:');
    expect(card.textContent).toContain('500.000');
    expect(card.textContent).not.toContain('9.999.999');
    expect(card.textContent).not.toContain('/tháng');
    expect(card.textContent).not.toContain('01/01/2027');
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Bản nháp (1)' }));
  expect(screen.getByText('Hiển thị 1–1 / 1')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Chính thức (2)' })).toBeTruthy();
  fireEvent.click(screen.getAllByTestId('staff-contract-card')[0]!);
  expect(state.open).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'holding-0', kind: 'Holding', status: 'Draft' }),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Tất cả (17)' }));
  expect(screen.getByText('Hiển thị 1–5 / 17')).toBeTruthy();
});

it('never sends a Holding draft into Main onboarding even if a previous API flagged draft metadata', () => {
  expect(isMainOnboardingDraft({ ...all[0]!, kind: 'Holding', onboardingDraft: true })).toBe(false);
  expect(isMainOnboardingDraft({ ...all[0]!, kind: 'Main', onboardingDraft: true })).toBe(true);
});

it('retains closed Holding states and uses deposit amounts instead of rental rates for sorting', () => {
  const holding = ['Expired', 'Converted', 'Cancelled'].map((status, index) => ({
    ...all[index]!,
    id: `closed-${index}`,
    kind: 'Holding',
    status,
    requiredDeposit: '500000',
    monthlyRent: '9999999',
  }));
  expect(staffContractPage(holding, '', '', 'newest', 1, 'Holding').total).toBe(3);
  expect(staffContractPage(holding, 'closed', '', 'newest', 1, 'Holding').total).toBe(3);
  expect(staffContractPage([all[0]!, holding[0]!], '', '', 'rent-asc', 1).items[0]!.id).toBe(
    'closed-0',
  );
});
it('shows 14 real records as exactly 5 + 5 + 4 across three pages with correct navigation limits', async () => {
  await openList();
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(5);
  expect(screen.getByText('Trang 1 / 3')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByText('Hiển thị 6–10 / 14')).toBeTruthy();
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getByText('Trang 3 / 3')).toBeTruthy();
  expect(screen.getByText('Hiển thị 11–14 / 14')).toBeTruthy();
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(4);
  expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
  expect(screen.getByText('Trang 2 / 3')).toBeTruthy();
});
it('combines status, accent-insensitive search and pagination, resetting page one on a filter change', async () => {
  await openList();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Đang hiệu lực (7)' }));
  expect(screen.getByText('Trang 1 / 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(2);
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm hợp đồng' }), {
    target: { value: 'CT205' },
  });
  expect(screen.getByText('Hiển thị 1–1 / 1')).toBeTruthy();
  expect(screen.getByText('Trang 1 / 1')).toBeTruthy();
  expect(screen.getByText('Phòng CT205')).toBeTruthy();
});
it('sorts by exact rent and resets pagination before displaying the sorted result', async () => {
  await openList();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  fireEvent.click(screen.getByRole('button', { name: /^Sắp xếp hợp đồng/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Số tiền tăng dần' }));
  expect(screen.getByText('Trang 1 / 3')).toBeTruthy();
  expect(screen.getAllByTestId('staff-contract-card')[0]!.textContent).toContain('Phòng CT201');
  fireEvent.click(screen.getByRole('button', { name: /^Sắp xếp hợp đồng/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Số tiền giảm dần' }));
  expect(screen.getAllByTestId('staff-contract-card')[0]!.textContent).toContain('Phòng CT214');
});
it('opens the selected detail without exposing the removed creation action', async () => {
  await openList();
  fireEvent.click(screen.getAllByTestId('staff-contract-card')[0]!);
  expect(state.open).toHaveBeenCalledWith(all[13]);
  expect(screen.queryByRole('button', { name: 'Tạo mới hợp đồng' })).toBeNull();
  expect(screen.queryByText('Tạo mới')).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});
it('keeps inspection details collapsed and opens the existing assigned contract when expanded', async () => {
  await openList();
  expect(screen.queryByRole('button', { name: 'Mở kiểm tra phòng CT208' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lịch kiểm tra trả phòng, 1 lịch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mở kiểm tra phòng CT208' }));
  expect(state.inspect).toHaveBeenCalledWith('inspection-contract');
});
it('handles an empty query and restores the list when clearing filters', async () => {
  await openList();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm hợp đồng' }), {
    target: { value: 'no-such-contract' },
  });
  expect(screen.getByText('Không tìm thấy hợp đồng')).toBeTruthy();
  expect(screen.queryAllByTestId('staff-contract-card')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(5);
});
it('does not turn a failed request into an empty result and retries through the header action', async () => {
  state.list.mockRejectedValueOnce(Error('offline'));
  render(<StaffContractsList api={api} onOpen={state.open} onInspection={state.inspect} />);
  await screen.findByRole('button', { name: 'Thử tải lại hợp đồng' });
  expect(screen.queryByText('Chưa có hợp đồng')).toBeNull();
  act(() => state.refresh?.());
  await screen.findByText('Hiển thị 1–5 / 14');
});
it('keeps contracts usable when only the inspection schedule fails', async () => {
  state.schedules.mockRejectedValue(Error('offline'));
  await openList();
  fireEvent.click(screen.getByRole('button', { name: 'Lịch kiểm tra trả phòng, chưa tải được' }));
  expect(screen.getByRole('button', { name: 'Thử lại lịch kiểm tra' })).toBeTruthy();
  expect(screen.getAllByTestId('staff-contract-card')).toHaveLength(5);
});
it('clamps the page after refreshing a smaller backend result', async () => {
  await openList();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  all = all.slice(0, 4);
  act(() => state.refresh?.());
  await screen.findByText('Hiển thị 1–4 / 4');
  expect(screen.getByText('Trang 1 / 1')).toBeTruthy();
});
it('restores the current filter and page when returning from contract details', async () => {
  function PersistentList({ visible }: { visible: boolean }) {
    const [viewState, setViewState] = useState({ ...defaultStaffContractListView });
    return visible ? (
      <StaffContractsList
        api={api}
        onOpen={state.open}
        onInspection={state.inspect}
        viewState={viewState}
        onViewStateChange={setViewState}
      />
    ) : (
      <span>Chi tiết</span>
    );
  }
  const view = render(<PersistentList visible />);
  await screen.findByText('Hiển thị 1–5 / 14');
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm hợp đồng' }), {
    target: { value: 'CT' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  fireEvent.click(screen.getAllByTestId('staff-contract-card')[0]!);
  view.rerender(<PersistentList visible={false} />);
  view.rerender(<PersistentList visible />);
  await screen.findByText('Hiển thị 11–14 / 14');
  expect(screen.getByText('Trang 3 / 3')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Tìm hợp đồng' }) as HTMLInputElement).value).toBe(
    'CT',
  );
});
it('shows loading without stale counts and accepts a genuinely empty backend result', async () => {
  let resolve!: (value: unknown) => void;
  state.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<StaffContractsList api={api} onOpen={state.open} onInspection={state.inspect} />);
  await waitFor(() => expect(state.list).toHaveBeenCalled());
  expect(state.refreshDisabled).toBe(true);
  expect(screen.queryAllByTestId('staff-contract-card')).toHaveLength(0);
  expect(screen.queryByText('Chưa có hợp đồng')).toBeNull();
  await act(async () => resolve({ items: [], totalCount: 0, page: 1, pageSize: 20 }));
  await screen.findByText('Chưa có hợp đồng');
  expect(state.refreshDisabled).toBe(false);
  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
});
it('applies search, status and exact rent sorting before selecting a result page', () => {
  const result = staffContractPage(all, 'Active', 'dong da', 'rent-asc', 2);
  expect(result.total).toBe(7);
  expect(result.items.map((item) => item.roomNumber)).toEqual(['CT210', 'CT211']);
  expect(result.from).toBe(6);
});
it('loads every existing backend page before calculating counts and slicing five visible cards', async () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ ...all[i % all.length]!, id: `many-${i}` }));
  state.list.mockImplementation(async (page) => ({
    items: many.slice((page - 1) * 20, page * 20),
    page,
    pageSize: 20,
    totalCount: 23,
  }));
  const loaded = await loadStaffContracts(api, new AbortController().signal);
  expect(loaded).toHaveLength(23);
  expect(state.list).toHaveBeenCalledTimes(2);
  const page = staffContractPage(loaded, '', '', 'newest', 5);
  expect(page.items).toHaveLength(3);
  expect(page.pages).toBe(5);
});
it('fails instead of reporting inaccurate totals when later backend pages make no progress', async () => {
  state.list.mockResolvedValue({ items: all, page: 1, pageSize: 20, totalCount: 30 });
  await expect(loadStaffContracts(api, new AbortController().signal)).rejects.toThrow(
    /Không tải đủ/,
  );
  expect(state.list).toHaveBeenCalledTimes(2);
});
it('requests a refresh instead of presenting misleading counts if the dataset changes during loading', async () => {
  state.list
    .mockResolvedValueOnce({ items: all, page: 1, pageSize: 20, totalCount: 21 })
    .mockResolvedValueOnce({ items: [], page: 2, pageSize: 20, totalCount: 22 });
  await expect(loadStaffContracts(api, new AbortController().signal)).rejects.toThrow(
    /đã thay đổi/,
  );
});
it('searches identifiers and Vietnamese location names without accents', () => {
  expect(staffContractPage(all, '', 'dong da', 'newest', 1).total).toBe(14);
  expect(staffContractPage(all, '', 'contract-14', 'newest', 1).items[0]!.id).toBe('contract-14');
  expect(staffContractPage(all, 'closed', '', 'newest', 1).total).toBe(3);
});
it('does not lose monetary precision when sorting large decimal-string rents', () => {
  const samples = [
    { ...all[0]!, id: 'low', monthlyRent: '9007199254740992' },
    { ...all[1]!, id: 'high', monthlyRent: '9007199254740993' },
  ];
  expect(staffContractPage(samples, '', '', 'rent-desc', 1).items.map((item) => item.id)).toEqual([
    'high',
    'low',
  ]);
});
it.each([
  ['Draft', 'neutral'],
  ['PendingSigning', 'amber'],
  ['PendingActivation', 'blue'],
  ['Active', 'green'],
  ['Terminated', 'neutral'],
  ['Cancelled', 'neutral'],
])('uses the existing %s status with %s styling', (status, tone) =>
  expect(staffContractTone(status)).toBe(tone),
);
