// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ request: vi.fn(), params: vi.fn() }));
vi.mock('expo-router', () => ({ router: { setParams: state.params } }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  Paths: { cache: { uri: 'cache://' } },
}));
vi.mock('../lib/SessionProvider', () => {
  const api = { request: state.request };
  return { useSession: () => ({ api }) };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Alert: { alert: vi.fn() },
  StyleSheet: { create: (s: unknown) => s },
  Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Portal: { Host: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  ActivityIndicator: () => <span>Loading</span>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  IconButton: ({
    onPress,
    accessibilityLabel,
  }: {
    onPress: () => void;
    accessibilityLabel: string;
  }) => <button onClick={onPress} aria-label={accessibilityLabel} />,
  TextInput: ({
    label,
    accessibilityLabel,
    value,
    onChangeText,
    disabled,
  }: {
    label: string;
    accessibilityLabel?: string;
    value: string;
    onChangeText: (s: string) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel ?? label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock('../components/ContractDateField', () => ({
  ContractDateField: ({
    label,
    value,
    onChange,
    error,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    error?: string;
  }) => (
    <>
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <span>{error}</span>}
    </>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
import { MainDraftScreen } from '../features/contracts/MainDraftScreen';
const preparation = {
  roomId: 'room',
  locationId: 'location',
  locationName: 'Cơ sở kiểm thử',
  roomNumber: '101',
  address: 'Địa chỉ kiểm thử',
  effectiveOn: '2026-11-02',
  residents: [
    {
      id: 'resident',
      fullName: 'NGƯỜI KIỂM THỬ',
      maskedCitizenNumber: '********0123',
      dateOfIssue: '2021-06-15',
      representative: true,
    },
  ],
  charges: [
    { id: 'rent', name: 'Tiền thuê', chargeCode: 'RENT', rate: '3100000.0000', version: 1 },
  ],
  securityDeposit: '6200000',
  paymentTerms: 'Chuyển khoản',
  ownerName: 'OWNER KIỂM THỬ',
  blockers: [],
};
const view = (input: unknown) => ({
  id: 'draft-id',
  status: 'Draft',
  version: 1,
  input,
  preparation,
});
beforeEach(() => {
  vi.clearAllMocks();
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes('/preparation?')) return preparation;
    if (path.endsWith('/documents'))
      return {
        docx: { id: 'docx' },
        pdf: null,
        previewError: 'contract_pdf_converter_unavailable',
      };
    if (init?.method === 'POST' || init?.method === 'PUT')
      return view(JSON.parse(init.body as string));
    return view({
      roomId: 'room',
      representativeResidentId: 'resident',
      residentIds: ['resident'],
      startDate: '2026-11-02',
      endDate: '2027-11-02',
      notes: 'Đã lưu trước',
      tenantPhone: '0000000001',
      tenantPlaceOfIssue: 'Nơi cấp kiểm thử',
      expectedVersion: 0,
    });
  });
});
afterEach(cleanup);
function setup(initialId?: string) {
  return render(
    <MainDraftScreen
      initialId={initialId}
      roomId="room"
      representativeResidentId="resident"
      residentIds={['resident']}
      onCancel={vi.fn()}
      onList={vi.fn()}
    />,
  );
}
function fill() {
  for (const [label, value] of [
    ['Ngày bắt đầu (dd/MM/yyyy)', '02/11/2026'],
    ['Ngày kết thúc (dd/MM/yyyy)', '02/11/2027'],
    ['Số điện thoại người thuê', '0000000001'],
    ['Nơi cấp CCCD (chưa có trong hồ sơ)', 'Nơi cấp kiểm thử'],
    ['Điều khoản bổ sung / ghi chú', 'Ghi chú giữ nguyên'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('loads authoritative read-only identity and validates editable fields without posting invalid data', async () => {
  setup();
  await screen.findByText('Cơ sở kiểm thử · Phòng 101');
  expect(screen.getByText('CCCD: ********0123')).toBeTruthy();
  expect(screen.getAllByText(/3\.100\.000/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('textbox', { name: 'Họ và tên' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  expect(screen.getByText('Nhập ngày kết thúc hợp lệ theo dd/MM/yyyy.')).toBeTruthy();
  expect(state.request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
});
it('keeps the form after an API failure and retries with the same idempotency key', async () => {
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  const base = state.request.getMockImplementation()!;
  let fail = true;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST' && fail) {
      fail = false;
      throw { code: 'draft_version_or_status_changed' };
    }
    return base(path, init);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText(/Bản nháp đã thay đổi/);
  expect((screen.getByLabelText('Điều khoản bổ sung / ghi chú') as HTMLInputElement).value).toBe(
    'Ghi chú giữ nguyên',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Mã hợp đồng: draft-id');
  const posts = state.request.mock.calls.filter((call) => call[1]?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0][1].headers['Idempotency-Key']).toBe(posts[1][1].headers['Idempotency-Key']);
  expect(state.params).toHaveBeenCalledWith({ mainDraftId: 'draft-id' });
});
it('preserves edits across preview, reports missing PDF honestly and exposes no lifecycle actions', async () => {
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước hợp đồng' }));
  await screen.findByText(/Máy chủ chưa cấu hình LibreOffice/);
  expect(screen.getByRole('button', { name: 'Mở hoặc lưu DOCX' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Ký hợp đồng|Kích hoạt|QR/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa thông tin' }));
  expect((screen.getByLabelText('Điều khoản bổ sung / ghi chú') as HTMLInputElement).value).toBe(
    'Ghi chú giữ nguyên',
  );
  expect((screen.getByLabelText('Ngày kết thúc (dd/MM/yyyy)') as HTMLInputElement).value).toBe(
    '02/11/2027',
  );
});
it('reopens the persisted draft from the server', async () => {
  setup('draft-id');
  await waitFor(() =>
    expect((screen.getByLabelText('Điều khoản bổ sung / ghi chú') as HTMLInputElement).value).toBe(
      'Đã lưu trước',
    ),
  );
  expect(state.request.mock.calls[0][0]).toBe('/api/v1/contracts/main-drafts/draft-id');
});
it('autofills and locks a contact phone already supplied by the server', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) =>
    path.includes('/preparation?')
      ? Promise.resolve({
          ...preparation,
          residents: preparation.residents.map((r) => ({ ...r, phone: '0000000002' })),
        })
      : original(path, init),
  );
  setup();
  await waitFor(() =>
    expect((screen.getByLabelText('Số điện thoại người thuê') as HTMLInputElement).value).toBe(
      '0000000002',
    ),
  );
  expect((screen.getByLabelText('Số điện thoại người thuê') as HTMLInputElement).disabled).toBe(
    true,
  );
});
it('keeps its saved result when promoting reference params to a persisted draft route', async () => {
  const page = setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Mã hợp đồng: draft-id');
  page.rerender(
    <MainDraftScreen
      initialId="draft-id"
      roomId="room"
      representativeResidentId="resident"
      residentIds={['resident']}
      onCancel={vi.fn()}
      onList={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByText('Mã hợp đồng: draft-id')).toBeTruthy());
  expect(
    state.request.mock.calls.filter(
      (call) => call[0] === '/api/v1/contracts/main-drafts/draft-id' && !call[1]?.method,
    ),
  ).toHaveLength(0);
});
it('does not report a cancelled idempotent replay as a saved draft', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    const result = await original(path, init);
    return init?.method === 'POST' ? { ...result, status: 'Cancelled' } : result;
  });
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText(/Bản nháp đã thay đổi/);
  expect(screen.queryByText('Đã tạo hợp đồng nháp')).toBeNull();
});
