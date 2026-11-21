// @vitest-environment jsdom
import React from 'react';
vi.mock('../features/contracts/ContractLoading', () => ({
  ContractLoading: ({ label }: { label: string }) => (
    <div role="progressbar" aria-label={label}>
      {label}
    </div>
  ),
}));
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ContractClient,
  draftPayload,
  holdingDraftPayload,
} from '../../../../packages/client-core/src/contracts';
import { ContractDraftForm } from '../features/contracts/ContractDraftForm';
import { type MainDraftPreparation } from '../../../../packages/client-core/src/mainDrafts';

const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
vi.mock('../features/contracts/HoldingProgress', () => ({
  HoldingProgress: ({ current }: { current: number }) => (
    <span>Bước {current > 1 ? current : 1}/7</span>
  ),
}));
const state = vi.hoisted(() => ({
  role: 'Staff',
  verified: false,
  linked: false,
  go: vi.fn(),
  residentId: '00000000-0000-4000-8000-000000000003',
  foreground: null as null | ((state: string) => void),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: state.role,
    go: state.go,
    staffLocationId: '00000000-0000-4000-8000-000000000001',
  }),
}));

vi.mock('../features/contracts/HoldingNewTenant', () => ({
  HoldingNewTenant: ({
    initialResidentId,
    onCreated,
    onConfirmed,
    onVerifiedSummary,
    stage,
    onContinue,
    disabled,
  }: {
    initialResidentId?: string;
    onCreated: (id: string, name: string, email: string) => void;
    onConfirmed: () => void;
    onVerifiedSummary: (summary: { fullName: string; dateOfBirth: string }) => void;
    stage: 'details' | 'identity';
    onContinue: () => void;
    disabled?: boolean;
  }) => (
    <div data-testid="applicant-form" data-resident={initialResidentId ?? ''}>
      {stage === 'identity' && !initialResidentId && (
        <button onClick={() => onCreated(ids[2], 'Synthetic applicant', '')}>Open identity</button>
      )}
      {stage === 'details' ? (
        <button
          disabled={disabled}
          onClick={() => {
            onCreated(ids[2], 'Người đăng ký mới', 'applicant@example.test');
            onContinue();
          }}
        >
          Tiếp tục
        </button>
      ) : (
        <button
          disabled={disabled}
          onClick={() => {
            state.verified = true;
            onVerifiedSummary({ fullName: 'Họ tên đã xác minh', dateOfBirth: '1995-05-20' });
            onConfirmed();
          }}
        >
          Xác nhận CCCD từ backend
        </button>
      )}
    </div>
  ),
}));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
vi.mock('../theme/theme', () => ({ staffColors: {}, colors: {} }));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
}));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, callback: (value: string) => void) => {
      state.foreground = callback;
      return { remove: () => {} };
    },
  },
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Icon: () => null,
  ActivityIndicator: () => <span>Đang tải</span>,
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
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  IconButton: ({
    accessibilityLabel,
    onPress,
    disabled,
  }: {
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  }) => <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled} />,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <>
      <h2>{title}</h2>
      <span>{detail}</span>
    </>
  ),
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" />
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('../components/ContractDateField', () => ({
  ContractDateField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
afterEach(() => {
  cleanup();
  state.role = 'Staff';
  state.verified = false;
  state.linked = false;
  state.foreground = null;
});
function makeApi(mutate = vi.fn().mockResolvedValue({ id: ids[0] })) {
  return {
    mutate,
    holdingRoomReady: vi.fn().mockResolvedValue(true),
    locations: vi.fn().mockResolvedValue([{ id: ids[0], label: 'Cơ sở A' }]),
    holdingRooms: vi.fn().mockResolvedValue({
      items: [{ id: ids[1], locationId: ids[0], roomNumber: 'P101', status: 0 }],
      totalCount: 1,
      page: 1,
      pageSize: 100,
    }),
    tenantAccounts: vi.fn(),
    linkTenant: vi.fn(),
    configuration: vi.fn().mockResolvedValue({
      template: { available: true, title: 'Mẫu kỹ thuật không hiển thị', fields: [] },
    }),
    preparation: vi.fn().mockImplementation(async () => ({
      locations: [{ id: ids[0], label: 'Cơ sở A' }],
      rooms: [{ id: ids[1], locationId: ids[0], label: 'P101', status: 'Available' }],
      residents: [
        {
          id: ids[2],
          roomId: ids[1],
          label: 'Hồ sơ mới',
          verified: state.verified,
          tenantUserId: state.linked ? ids[3] : null,
        },
      ],
      ownerSigners: [{ id: ids[4], label: 'Owner A' }],
    })),
  } as unknown as ContractClient;
}
function mount(
  api = makeApi(),
  created = vi.fn(),
  prepare = vi.fn().mockImplementation(
    async (input) =>
      ({
        roomId: input.roomId,
        locationId: ids[0],
        locationName: 'Cơ sở A',
        roomNumber: 'P101',
        address: 'Địa chỉ mẫu',
        residents: [],
        charges: [],
        ownerName: 'Owner A',
        effectiveOn: input.startDate,
        securityDeposit: '1000000',
        paymentTerms: 'Điều khoản đã cấu hình',
        blockers: [],
      }) as MainDraftPreparation,
  ),
) {
  render(
    <ContractDraftForm
      api={api}
      prepareDefaults={prepare}
      onCancel={vi.fn()}
      onCreated={created}
    />,
  );
  return { api, created, prepare };
}
const continueButton = () => screen.getByRole('button', { name: 'Tiếp tục' });
async function chooseRoom() {
  await screen.findByText('P101 · Cơ sở A');
  fireEvent.change(screen.getByLabelText('Phòng giữ chỗ *'), { target: { value: ids[1] } });
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(screen.getByText(/2\/7/)).toBeTruthy();
}
async function confirmApplicant() {
  await chooseRoom();
  fireEvent.click(screen.getByText('Open identity'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Xác nhận CCCD từ backend'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(screen.getByText(/3\/7/)).toBeTruthy();
}
const submit = () => screen.getByRole('button', { name: 'Tạo bản nháp và tiếp tục' });
it('starts at room selection without a duplicate header, refresh icon or location selector', async () => {
  const { api } = mount();
  await screen.findByText('P101 · Cơ sở A');
  expect(screen.getByText(/1\/7/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tải lại lựa chọn' })).toBeNull();
  expect(screen.queryByLabelText('Cơ sở')).toBeNull();
  expect(api.preparation).not.toHaveBeenCalled();
});
it('loads preparation and readiness for the selected room/location, without any Tenant selection', async () => {
  const { api } = mount();
  await chooseRoom();
  expect(api.preparation).toHaveBeenCalledWith(ids[0], expect.any(AbortSignal));
  expect(api.holdingRoomReady).toHaveBeenCalledOnce();
  expect(screen.getByText('CCCD của người giữ chỗ')).toBeTruthy();
  expect(screen.queryByText('Thông tin người giữ chỗ')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(api.tenantAccounts).not.toHaveBeenCalled();
  expect(api.linkTenant).not.toHaveBeenCalled();
});
it('requires the new applicant to be verified before continuing, but does not require a Tenant account', async () => {
  const { api } = mount();
  await chooseRoom();
  expect(screen.getByText('CCCD của người giữ chỗ')).toBeTruthy();
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(
    screen.getByText('Nhập và xác minh thông tin người giữ chỗ trước khi tiếp tục.'),
  ).toBeTruthy();
  expect(api.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Open identity'));
  fireEvent.click(screen.getByText('Xác nhận CCCD từ backend'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(screen.getByText('Thông tin phòng')).toBeTruthy();
  expect(api.linkTenant).not.toHaveBeenCalled();
});
it('does not rescan the room catalog when creating and verifying the applicant', async () => {
  const { api } = mount();
  await confirmApplicant();
  expect(api.holdingRooms).toHaveBeenCalledOnce();
  expect(api.configuration).toHaveBeenCalledOnce();
  expect(api.locations).toHaveBeenCalledOnce();
  expect(api.preparation).toHaveBeenCalledOnce();
});
it('keeps identity actions available while the selected profile is refreshing', async () => {
  const { api } = mount();
  await chooseRoom();
  fireEvent.click(continueButton());
  const loadPreparation = vi.mocked(api.preparation).getMockImplementation()!;
  let resolvePreparation!: (value: Awaited<ReturnType<typeof api.preparation>>) => void;
  vi.mocked(api.preparation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePreparation = resolve;
      }),
  );
  act(() => state.foreground?.('active'));
  const identity = screen.getByText('Xác nhận CCCD từ backend');
  expect(identity).toHaveProperty('disabled', false);
  fireEvent.click(identity);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Đang cập nhật…' })).toHaveProperty('disabled', true),
  );
  expect(screen.getByText('Xác nhận CCCD từ backend')).toHaveProperty('disabled', false);
  expect(api.holdingRooms).toHaveBeenCalledOnce();
  resolvePreparation(await loadPreparation(ids[0]));
  await waitFor(() => expect(continueButton()).toHaveProperty('disabled', false));
});
it('reviews verified applicant data and keeps confirmation entirely read-only', async () => {
  const { api, prepare } = mount();
  await confirmApplicant();
  expect(screen.getByText('Họ tên đã xác minh')).toBeTruthy();
  expect(screen.queryByText('applicant@example.test')).toBeNull();
  expect(screen.getByText('20/05/1995')).toBeTruthy();
  expect(screen.getByText('Đã xác minh')).toBeTruthy();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(screen.queryByText('Owner A')).toBeNull();
  expect(screen.queryByText('Mẫu kỹ thuật không hiển thị')).toBeNull();
  expect(screen.queryByRole('button', { name: /Chọn Ngày/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem mẫu hợp đồng' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem chi tiết' })).toBeNull();
  expect(prepare).not.toHaveBeenCalled();
  expect((submit() as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(submit());
  expect(api.mutate).not.toHaveBeenCalled();
});
it('does not invent dates or money and does not query a date-dependent configuration without backend dates', async () => {
  const { api, prepare } = mount();
  await confirmApplicant();
  expect(
    screen.getByText('Chưa có thời hạn giữ chỗ từ hệ thống. Chưa thể tạo hợp đồng.'),
  ).toBeTruthy();
  expect(screen.getAllByText('Chưa có dữ liệu')).toHaveLength(4);
  expect(screen.queryByText(/1 tháng|Tạm dùng|00:00/)).toBeNull();
  expect(prepare).not.toHaveBeenCalled();
  expect(api.mutate).not.toHaveBeenCalled();
});

it('uses the room location Holding quote for dates, deposit and configuration version without Main defaults', async () => {
  const api = makeApi();
  api.holdingPreparation = vi.fn().mockResolvedValue({
    roomId: ids[1],
    locationId: ids[0],
    roomNumber: 'P101',
    settingsVersion: 2,
    holdingMonths: 2,
    startDate: '2099-01-01',
    endDate: '2099-03-01',
    expiresAt: '2099-02-28T17:00:00Z',
    monthlyRent: '3000000',
    holdingDeposit: '1500000',
    terms: 'Điều khoản giữ chỗ riêng',
  });
  const { prepare } = mount(api);
  await confirmApplicant();
  await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false));
  expect(api.holdingPreparation).toHaveBeenCalledOnce();
  fireEvent.click(submit());
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith(
      null,
      'holdings',
      expect.objectContaining({
        holdingDeposit: '1500000',
        startDate: '2099-01-01',
        endDate: '2099-03-01',
        expiresAt: '2099-02-28T17:00:00Z',
        settingsVersion: 2,
        terms: 'Điều khoản giữ chỗ riêng',
      }),
      expect.any(String),
    ),
  );
  expect(prepare).not.toHaveBeenCalled();
});
it('shows step 4 skeleton during creation and restores the verified form after an error', async () => {
  let rejectSave!: (reason: unknown) => void;
  const save = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const api = makeApi(save);
  api.holdingPreparation = vi.fn().mockResolvedValue({
    roomId: ids[1],
    locationId: ids[0],
    settingsVersion: 2,
    holdingMonths: 2,
    startDate: '2099-01-01',
    endDate: '2099-03-01',
    expiresAt: '2099-02-28T17:00:00Z',
    monthlyRent: '3000000',
    holdingDeposit: '1500000',
    terms: 'Điều khoản giữ chỗ riêng',
  });
  const { created } = mount(api);
  await confirmApplicant();
  await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit());
  expect(
    await screen.findByRole('progressbar', { name: 'Đang tạo hợp đồng và chuẩn bị gửi ký…' }),
  ).toBeTruthy();
  expect(screen.getByText(/4\/7/)).toBeTruthy();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  fireEvent.click(submit());
  expect(save).toHaveBeenCalledOnce();
  expect(created).not.toHaveBeenCalled();
  rejectSave({ status: 409, code: 'room_contract_conflict' });
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  expect(screen.getByText(/3\/7/)).toBeTruthy();
  expect(screen.getByText('Họ tên đã xác minh')).toBeTruthy();
  expect(screen.getByTestId('applicant-form').getAttribute('data-resident')).toBe(ids[2]);
});
it('retains the verified resident when returning from confirmation', async () => {
  mount();
  await confirmApplicant();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(screen.getByTestId('applicant-form').getAttribute('data-resident')).toBe(ids[2]);
  fireEvent.click(continueButton());
  expect(screen.getByText('Họ tên đã xác minh')).toBeTruthy();
  expect((submit() as HTMLButtonElement).disabled).toBe(true);
});
it('does not choose arbitrarily when multiple signing Owners are returned', async () => {
  const api = makeApi();
  const base = await api.preparation('');
  vi.mocked(api.preparation).mockResolvedValue({
    ...base,
    ownerSigners: [...base.ownerSigners, { id: ids[0], label: 'Owner B' }],
  });
  mount(api);
  await chooseRoom();
  expect((continueButton() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/cơ sở có nhiều Owner hợp lệ/)).toBeTruthy();
});
it('recovers a room query error using an inline retry rather than a header refresh', async () => {
  const api = makeApi();
  vi.mocked(api.holdingRooms).mockRejectedValueOnce({ status: 403 });
  mount(api);
  await screen.findByRole('button', { name: 'Thử lại' });
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText('P101 · Cơ sở A');
});
it('permits null Tenant only for Holding while preserving existing Main draft validation', () => {
  const input = {
    roomId: ids[1],
    ownerSignerId: ids[4],
    representativeResidentId: ids[2],
    startDate: '01/12/2099',
    endDate: '01/12/2100',
    terms: 'Điều khoản',
    expiresAt: '2099-11-20T17:30',
    requiredDeposit: '1000000',
    monthlyRent: '3000000',
  };
  expect(holdingDraftPayload(input, [ids[2]]).tenantUserId).toBeNull();
  expect(() => draftPayload(input, [ids[2]])).toThrow();
});
