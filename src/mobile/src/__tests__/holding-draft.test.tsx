// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ContractClient,
  draftPayload,
  holdingDraftPayload,
} from '../../../../packages/client-core/src/contracts';
import { ContractDraftForm } from '../features/contracts/ContractDraftForm';

const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
const state = vi.hoisted(() => ({
  role: 'Staff',
  verified: false,
  linked: false,
  go: vi.fn(),
  residentId: '00000000-0000-4000-8000-000000000003',
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role, go: state.go }),
}));

vi.mock('../features/contracts/HoldingNewTenant', () => ({
  HoldingNewTenant: ({
    initialResidentId,
    onCreated,
    onConfirmed,
    onVerifiedSummary,
  }: {
    initialResidentId?: string;
    onCreated: (id: string, name: string, email: string) => void;
    onConfirmed: () => void;
    onVerifiedSummary: (summary: { fullName: string; dateOfBirth: string }) => void;
  }) => (
    <div data-testid="applicant-form" data-resident={initialResidentId ?? ''}>
      <button onClick={() => onCreated(ids[2], 'Người đăng ký mới', 'applicant@example.test')}>
        Nhập người giữ chỗ mới
      </button>
      <button
        onClick={() => {
          state.verified = true;
          onVerifiedSummary({ fullName: 'Họ tên đã xác minh', dateOfBirth: '1995-05-20' });
          onConfirmed();
        }}
      >
        Xác nhận CCCD từ backend
      </button>
    </div>
  ),
}));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000099' }));
vi.mock('../theme/theme', () => ({ staffColors: {}, colors: {} }));
vi.mock('react-native', () => ({
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
function mount(api = makeApi(), created = vi.fn()) {
  render(<ContractDraftForm api={api} onCancel={vi.fn()} onCreated={created} />);
  return { api, created };
}
const continueButton = () => screen.getByRole('button', { name: 'Tiếp tục' });
async function chooseRoom() {
  await screen.findByText('P101 · Cơ sở A');
  fireEvent.change(screen.getByLabelText('Phòng giữ chỗ *'), { target: { value: ids[1] } });
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(screen.getByText('Bước 2/3 · Người giữ chỗ')).toBeTruthy();
}
async function confirmApplicant() {
  await chooseRoom();
  fireEvent.click(screen.getByText('Nhập người giữ chỗ mới'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Xác nhận CCCD từ backend'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(screen.getByText('Bước 3/3 · Xác nhận')).toBeTruthy();
}
function fillTerms() {
  for (const [label, value] of [
    ['Ngày dự kiến bắt đầu thuê (dd/MM/yyyy)', '01/12/2099'],
    ['Ngày dự kiến kết thúc thuê (dd/MM/yyyy)', '01/12/2100'],
    ['Ngày hết hạn giữ chỗ (dd/MM/yyyy)', '20/11/2099'],
    ['Giờ hết hạn giữ chỗ (HH:mm, giờ Việt Nam)', '17:30'],
    ['Cọc giữ chỗ (VND)', '1000000'],
    ['Điều khoản đã thống nhất', 'Điều khoản đã thống nhất'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
const submit = () => screen.getByRole('button', { name: 'Tạo hợp đồng giữ chỗ' });
it('starts at room selection without a duplicate header, refresh icon or location selector', async () => {
  const { api } = mount();
  await screen.findByText('P101 · Cơ sở A');
  expect(screen.getByText('Bước 1/3 · Chọn phòng')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tải lại lựa chọn' })).toBeNull();
  expect(screen.queryByLabelText('Cơ sở')).toBeNull();
  expect(api.preparation).not.toHaveBeenCalled();
});
it('loads preparation and readiness for the selected room/location, without any Tenant selection', async () => {
  const { api } = mount();
  await chooseRoom();
  expect(api.preparation).toHaveBeenCalledWith(ids[0], expect.any(AbortSignal));
  expect(api.holdingRoomReady).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Thông tin người giữ chỗ')).toBeTruthy();
  expect(screen.getByText('Nhập thông tin của người đăng ký giữ chỗ.')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(api.tenantAccounts).not.toHaveBeenCalled();
  expect(api.linkTenant).not.toHaveBeenCalled();
});
it('requires the new applicant to be verified before continuing, but does not require a Tenant account', async () => {
  const { api } = mount();
  await chooseRoom();
  fireEvent.click(screen.getByText('Nhập người giữ chỗ mới'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(
    screen.getByText('Nhập và xác minh thông tin người giữ chỗ trước khi tiếp tục.'),
  ).toBeTruthy();
  expect(api.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Xác nhận CCCD từ backend'));
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(continueButton());
  expect(screen.getByText('Xác nhận thông tin giữ chỗ')).toBeTruthy();
  expect(api.linkTenant).not.toHaveBeenCalled();
});
it('reviews verified name, email and birth date and retains the created profile when navigating back', async () => {
  mount();
  await confirmApplicant();
  fillTerms();
  expect(screen.getByText('Họ và tên người giữ chỗ: Họ tên đã xác minh')).toBeTruthy();
  expect(screen.getByText('Email: applicant@example.test')).toBeTruthy();
  expect(screen.getByText('Ngày sinh: 20/05/1995')).toBeTruthy();
  expect(screen.getByText('Owner ký hợp đồng: Owner A')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(screen.getByTestId('applicant-form').getAttribute('data-resident')).toBe(ids[2]);
  fireEvent.click(continueButton());
  expect((screen.getByLabelText('Cọc giữ chỗ (VND)') as HTMLInputElement).value).toBe('1000000');
});
it('creates exactly one Holding draft with a real resident ID, tenantUserId=null and no identity fields added to the DTO', async () => {
  const { api, created } = mount();
  await confirmApplicant();
  fillTerms();
  const button = submit();
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(created).toHaveBeenCalledWith(ids[0]));
  expect(api.mutate).toHaveBeenCalledExactlyOnceWith(
    null,
    'holdings',
    {
      roomId: ids[1],
      ownerSignerId: ids[4],
      tenantUserId: null,
      representativeResidentId: ids[2],
      residentIds: [ids[2]],
      startDate: '2099-12-01',
      endDate: '2100-12-01',
      terms: 'Điều khoản đã thống nhất',
      holdingDeposit: '1000000',
      expiresAt: '2099-11-20T10:30:00.000Z',
      reservedCapacity: 1,
    },
    expect.any(String),
  );
});
it('retains a real linked Tenant ID if backend preparation says the created resident has one', async () => {
  state.linked = true;
  const { api } = mount();
  await confirmApplicant();
  fillTerms();
  fireEvent.click(submit());
  await waitFor(() => expect(api.mutate).toHaveBeenCalled());
  expect(vi.mocked(api.mutate).mock.calls[0][2]).toMatchObject({ tenantUserId: ids[3] });
});
it('blocks creating if readiness changes while filling the form', async () => {
  const { api, created } = mount();
  await confirmApplicant();
  fillTerms();
  vi.mocked(api.holdingRoomReady).mockResolvedValue(false);
  fireEvent.click(submit());
  await screen.findByText('Phòng không còn đủ điều kiện giữ chỗ. Vui lòng chọn lại phòng.');
  expect(api.mutate).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});
it('retains the idempotency key on an uncertain retry', async () => {
  const mutate = vi.fn().mockRejectedValueOnce({ status: 0 }).mockResolvedValueOnce({ id: ids[0] });
  const { created } = mount(makeApi(mutate));
  await confirmApplicant();
  fillTerms();
  fireEvent.click(submit());
  await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit());
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  expect(mutate.mock.calls[0][3]).toBe(mutate.mock.calls[1][3]);
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
