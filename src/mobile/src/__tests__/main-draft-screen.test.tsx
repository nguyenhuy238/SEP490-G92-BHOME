vi.mock('../components/WorkflowControls', () => ({ ChoiceField: () => null }));
// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getToastSnapshot } from '../lib/toast';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  roles: ['Staff'],
  params: vi.fn(),
  share: vi.fn(),
  available: vi.fn(),
  deleted: vi.fn(),
  writes: [] as number[][],
}));
vi.mock('expo-router', () => ({ router: { setParams: state.params } }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: state.available, shareAsync: state.share }));
vi.mock('expo-file-system', () => ({
  Directory: class {
    create() {}
  },
  File: class {
    exists = true;
    uri: string;
    constructor(_directory: unknown, filename: string) {
      this.uri = 'cache://test/' + filename;
    }
    create() {}
    write(bytes: Uint8Array) {
      state.writes.push(Array.from(bytes));
    }
    delete() {
      this.exists = false;
      state.deleted();
    }
  },
  Paths: { cache: { uri: 'cache://' } },
}));
vi.mock('../lib/SessionProvider', () => {
  const api = { request: state.request };
  return { useSession: () => ({ api, session: { roles: state.roles } }) };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  useWindowDimensions: () => ({ width: 360, height: 780 }),
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  Keyboard: { dismiss: vi.fn() },
  Image: ({ onLoad }: { onLoad?: () => void }) => (
    <button onClick={onLoad}>Hiển thị trang kiểm thử</button>
  ),
  FlatList: () => null,
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
  Icon: () => null,
  Checkbox: { Item: () => null },
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
  ui: {},
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
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  state.roles = ['Staff'];
  vi.clearAllMocks();
  state.writes = [];
  state.available.mockResolvedValue(true);
  state.share.mockResolvedValue(undefined);
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
it('observes Owner release while Staff waits without saving another draft', async () => {
  const original = state.request.getMockImplementation()!;
  let releasedByOwner = false;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/documents'))
      return { docx: { id: 'docx' }, pdf: { id: 'pdf' }, previewError: null };
    const result = await original(path, init);
    return path.endsWith('/draft-id') && !init?.method
      ? { ...result, status: releasedByOwner ? 'PendingSigning' : 'Draft' }
      : result;
  });
  const released = vi.fn();
  render(
    <MainDraftScreen
      roomId="room"
      representativeResidentId="resident"
      residentIds={['resident']}
      onCancel={vi.fn()}
      onList={vi.fn()}
      onReleased={released}
    />,
  );
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước hợp đồng' }));
  await screen.findByText('Bản hợp đồng PDF');
  vi.useFakeTimers();
  try {
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục ký hợp đồng' })),
    );
    expect(screen.getByText('Chờ Chủ cơ sở duyệt để ký')).toBeTruthy();
    releasedByOwner = true;
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(released).toHaveBeenCalledWith('draft-id');
    expect(
      state.request.mock.calls.filter(
        ([path, init]) => path === '/api/v1/contracts/main-drafts' && init?.method === 'POST',
      ),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
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
    ['Email người thuê *', 'tenant.synthetic@example.invalid'],
    ['Điều khoản bổ sung / ghi chú', 'Ghi chú giữ nguyên'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('opens a saved Owner draft for review without editing or releasing before PDF confirmation', async () => {
  state.roles = ['Owner'];
  const cancel = vi.fn();
  render(
    <MainDraftScreen
      initialId="draft-id"
      reviewOnly
      roomId="room"
      representativeResidentId="resident"
      residentIds={['resident']}
      onCancel={cancel}
      onList={vi.fn()}
    />,
  );
  const release = await screen.findByText('Duyệt và chuyển sang chờ ký');
  expect((release as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Lưu nháp')).toBeNull();
  expect(screen.queryByLabelText('Email người thuê *')).toBeNull();
  expect(screen.queryByText('Chỉnh sửa thông tin')).toBeNull();
  fireEvent.click(screen.getByLabelText('Quay lại danh sách hợp đồng'));
  expect(cancel).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText('Email người thuê *')).toBeNull();
  expect(state.request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true,
  );
});
it('recovers an outdated file using the latest draft version and a new document reference', async () => {
  const original = state.request.getMockImplementation()!;
  let generation = 0;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/documents'))
      return {
        docx: { id: 'docx' },
        pdf: { id: ++generation === 1 ? 'old-pdf' : 'new-pdf' },
        previewError: null,
      };
    if (path.endsWith('/old-pdf/preview')) throw { status: 409, code: 'draft_document_outdated' };
    if (path.endsWith('/new-pdf/preview'))
      return { fileId: 'new-pdf', pages: [{ number: 1, width: 595, height: 842 }] };
    if (path.includes('/pages/')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await original(path, init);
    return path.endsWith('/draft-id') && !init?.method ? { ...result, version: 2 } : result;
  });
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await screen.findAllByText('Tài liệu thuộc phiên bản cũ. Hãy tạo lại bản xem trước.');
  fireEvent.click(screen.getByText('Tải phiên bản mới'));
  await waitFor(() =>
    expect(state.request.mock.calls.some(([path]) => path.endsWith('/new-pdf/preview'))).toBe(true),
  );
  expect(generation).toBe(2);
  expect(
    state.request.mock.calls.filter(([path]) => path.endsWith('/old-pdf/preview')),
  ).toHaveLength(1);
  expect(
    state.request.mock.calls.filter(([path, init]) => path.endsWith('/draft-id') && !init?.method),
  ).toHaveLength(1);
});
it('requires an explicit save after a configuration conflict instead of regenerating repeatedly', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) =>
    path.endsWith('/documents')
      ? Promise.reject({ status: 409, code: 'draft_configuration_changed_save_again' })
      : original(path, init),
  );
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await screen.findAllByText(
    'Cấu hình đã thay đổi. Tải lại giá và lưu nháp trước khi tạo tài liệu.',
  );
  fireEvent.click(screen.getByText('Lưu lại bản nháp'));
  expect(screen.getByLabelText('Email người thuê *')).toBeTruthy();
  expect(state.request.mock.calls.filter(([path]) => path.endsWith('/documents'))).toHaveLength(1);
  expect((screen.getByLabelText('Email người thuê *') as HTMLInputElement).value).toBe(
    'tenant.synthetic@example.invalid',
  );
});
it('shows an Owner document conflict once and clears it after one locked recovery', async () => {
  state.roles = ['Owner'];
  const original = state.request.getMockImplementation()!;
  let finish: ((value: unknown) => void) | undefined;
  let generation = 0;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/documents')) {
      if (++generation === 2) return new Promise((resolve) => (finish = resolve));
      return { docx: { id: 'docx' }, pdf: { id: 'old-pdf' }, previewError: null };
    }
    if (path.endsWith('/old-pdf/preview')) throw { status: 409, code: 'draft_document_outdated' };
    if (path.endsWith('/new-pdf/preview'))
      return { fileId: 'new-pdf', pages: [{ number: 1, width: 595, height: 842 }] };
    if (path.includes('/pages/')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return original(path, init);
  });
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await screen.findByText('Tải phiên bản mới');
  expect(
    screen.getAllByText('Tài liệu thuộc phiên bản cũ. Hãy tạo lại bản xem trước.'),
  ).toHaveLength(1);
  const recover = screen.getByText('Tải phiên bản mới');
  fireEvent.click(recover);
  fireEvent.click(recover);
  await waitFor(() => expect(finish).toBeDefined());
  expect(generation).toBe(2);
  await act(async () =>
    finish!({ docx: { id: 'docx-new' }, pdf: { id: 'new-pdf' }, previewError: null }),
  );
  await screen.findByText('Hiển thị trang kiểm thử');
  fireEvent.click(screen.getByText('Hiển thị trang kiểm thử'));
  expect(screen.queryByText('Tài liệu thuộc phiên bản cũ. Hãy tạo lại bản xem trước.')).toBeNull();
  expect((screen.getByText('Tiếp tục duyệt hợp đồng') as HTMLButtonElement).disabled).toBe(false);
});
it('moves an Owner to the current workflow if the contract is released during document recovery', async () => {
  state.roles = ['Owner'];
  const original = state.request.getMockImplementation()!;
  let released = false;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/documents'))
      return { docx: { id: 'docx' }, pdf: { id: 'old' }, previewError: null };
    if (path.endsWith('/old/preview')) throw { status: 409, code: 'draft_document_outdated' };
    const result = await original(path, init);
    return path.endsWith('/draft-id') && !init?.method && released
      ? { ...result, status: 'PendingSigning' }
      : result;
  });
  const onReleased = vi.fn();
  render(
    <MainDraftScreen
      roomId="room"
      representativeResidentId="resident"
      residentIds={['resident']}
      onCancel={vi.fn()}
      onList={vi.fn()}
      onReleased={onReleased}
    />,
  );
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await screen.findByText('Tải phiên bản mới');
  released = true;
  fireEvent.click(screen.getByText('Tải phiên bản mới'));
  await waitFor(() => expect(onReleased).toHaveBeenCalledWith('draft-id'));
  expect(state.request.mock.calls.filter(([path]) => path.endsWith('/documents'))).toHaveLength(1);
});
it('returns an already released Owner draft to its actual contract detail without regenerating it', async () => {
  state.roles = ['Owner'];
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    const result = await original(path, init);
    return path.endsWith('/draft-id') && !init?.method
      ? { ...result, status: 'PendingSigning' }
      : result;
  });
  const released = vi.fn();
  render(
    <MainDraftScreen
      initialId="draft-id"
      roomId="room"
      representativeResidentId="resident"
      residentIds={['resident']}
      onCancel={vi.fn()}
      onList={vi.fn()}
      onReleased={released}
    />,
  );
  await waitFor(() => expect(released).toHaveBeenCalledWith('draft-id'));
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/documents'))).toBe(false);
});
it('previews an unchanged Owner draft without saving a new version', async () => {
  state.roles = ['Owner'];
  setup('draft-id');
  await screen.findByText('CCCD: ********0123');
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await screen.findByText(
    'Máy chủ chưa cấu hình LibreOffice để tạo PDF. Bản nháp và DOCX đã được giữ lại.',
  );
  expect(state.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
  expect(state.request.mock.calls.filter(([path]) => path.endsWith('/documents'))).toHaveLength(1);
});
it('aborts the previous resource and ignores a late document generation after the route changes', async () => {
  state.roles = ['Owner'];
  const original = state.request.getMockImplementation()!;
  let finish: ((value: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/first/documents')) {
      signal = init?.signal as AbortSignal;
      return new Promise((resolve) => (finish = resolve));
    }
    if (path.endsWith('/second/documents'))
      return { docx: { id: 'new-docx' }, pdf: { id: 'new-pdf' }, previewError: null };
    if (path.endsWith('/new-pdf/preview'))
      return { fileId: 'new-pdf', pages: [{ number: 1, width: 595, height: 842 }] };
    if (path.includes('/pages/')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await original(path, init);
    return path.endsWith('/first') || path.endsWith('/second')
      ? { ...result, id: path.split('/').at(-1) }
      : result;
  });
  const props = {
    roomId: 'room',
    representativeResidentId: 'resident',
    residentIds: ['resident'],
    onCancel: vi.fn(),
    onList: vi.fn(),
  };
  const rendered = render(<MainDraftScreen {...props} initialId="first" />);
  await screen.findByText('CCCD: ********0123');
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await waitFor(() => expect(finish).toBeDefined());
  rendered.rerender(<MainDraftScreen {...props} initialId="second" />);
  await screen.findByText('CCCD: ********0123');
  expect(signal?.aborted).toBe(true);
  fireEvent.click(screen.getByText('Xem trước hợp đồng'));
  await screen.findByText('Hiển thị trang kiểm thử');
  await act(async () =>
    finish!({ docx: { id: 'old-docx' }, pdf: { id: 'old-pdf' }, previewError: null }),
  );
  expect(state.request.mock.calls.some(([path]) => path.includes('/old-pdf/'))).toBe(false);
  fireEvent.click(screen.getByText('Hiển thị trang kiểm thử'));
  expect((screen.getByText('Tiếp tục duyệt hợp đồng') as HTMLButtonElement).disabled).toBe(false);
});
it('validates contact email, trims the supported draft field and omits issuing-place input', async () => {
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  expect(screen.queryByLabelText(/Nơi cấp CCCD/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Email người thuê *'), {
    target: { value: 'not an email' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  expect(screen.getByText('Nhập email người thuê hợp lệ.')).toBeTruthy();
  expect(state.request.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  fireEvent.change(screen.getByLabelText('Email người thuê *'), {
    target: { value: '  synthetic.contact@example.invalid  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Mã hợp đồng: draft-id');
  const post = state.request.mock.calls.find((call) => call[1]?.method === 'POST')!;
  expect(JSON.parse(post[1].body)).toMatchObject({
    tenantEmail: 'synthetic.contact@example.invalid',
    tenantPlaceOfIssue: '',
  });
  expect(state.request.mock.calls.some((call) => call[0].includes('/invitation'))).toBe(false);
});
it('shows one configuration notice and blocks save/preview when the server requires configuration', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) =>
    path.includes('/preparation?')
      ? Promise.resolve({
          ...preparation,
          blockers: ['owner_contract_settings_required', 'missing_policy_water'],
        })
      : original(path, init),
  );
  setup();
  await screen.findByText('Thiếu cấu hình hợp đồng');
  expect(
    screen.getByText(
      'Owner cần cấu hình thông tin bên cho thuê, tiền cọc và chính sách thanh toán tại cơ sở.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('Chưa có giá nước hiệu lực tại ngày bắt đầu.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Lưu nháp' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole('button', { name: 'Xem trước hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('prefills only the authorized representative contact, keeping email when returning from preview', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) =>
    path.includes('/preparation?')
      ? Promise.resolve({
          ...preparation,
          residents: [
            { ...preparation.residents[0], email: 'representative@example.invalid' },
            {
              ...preparation.residents[0],
              id: 'member',
              representative: false,
              email: 'other@example.invalid',
            },
          ],
        })
      : original(path, init),
  );
  setup();
  const email = await screen.findByLabelText('Email người thuê *');
  await waitFor(() =>
    expect((email as HTMLInputElement).value).toBe('representative@example.invalid'),
  );
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước hợp đồng' }));
  await screen.findByText('Bản hợp đồng PDF');
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa thông tin' }));
  expect((screen.getByLabelText('Email người thuê *') as HTMLInputElement).value).toBe(
    'tenant.synthetic@example.invalid',
  );
});
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
  expect(getToastSnapshot().toast?.type).not.toBe('error');
  expect((screen.getByLabelText('Điều khoản bổ sung / ghi chú') as HTMLInputElement).value).toBe(
    'Ghi chú giữ nguyên',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Mã hợp đồng: draft-id');
  expect(getToastSnapshot().toast?.type).toBe('success');
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
  expect(getToastSnapshot().toast?.type).toBe('success');
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
  expect(getToastSnapshot().toast?.type).not.toBe('error');
});

it('waits for backend confirmation before showing success and prevents repeated save requests', async () => {
  let finish!: (result: unknown) => void;
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return original(path, init);
  });
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  const save = screen.getByRole('button', { name: 'Lưu nháp' });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(typeof finish).toBe('function'));
  const posts = state.request.mock.calls.filter((call) => call[1]?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(getToastSnapshot().toast).toBeNull();
  await act(async () => finish(view(JSON.parse(posts[0][1].body))));
  expect(getToastSnapshot().toast?.type).toBe('success');
  expect(getToastSnapshot().toast?.message).toBe('Đã lưu hợp đồng nháp.');
});

it('downloads PDF and DOCX through the authenticated client and cleans private cache files after sharing or failure', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/documents'))
      return Promise.resolve({ docx: { id: 'docx' }, pdf: { id: 'pdf' }, previewError: null });
    if (path.endsWith('/pdf/preview'))
      return Promise.resolve({ fileId: 'pdf', pages: [{ number: 1, width: 595, height: 842 }] });
    if (path.includes('/pages/'))
      return Promise.resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    if (path.endsWith('/documents/pdf'))
      return Promise.resolve(new Uint8Array([37, 80, 68, 70, 45]));
    if (path.endsWith('/documents/docx')) return Promise.resolve(new Uint8Array([80, 75, 3, 4]));
    return original(path, init);
  });
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước hợp đồng' }));
  await screen.findByText('Bản hợp đồng PDF');
  fireEvent.click(screen.getByRole('button', { name: 'Xem PDF' }));
  await waitFor(() => expect(state.deleted).toHaveBeenCalledTimes(1));
  expect(state.share).toHaveBeenCalledWith(
    expect.stringMatching(/\.pdf$/),
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
  expect(state.writes[0]).toEqual([37, 80, 68, 70, 45]);
  fireEvent.click(screen.getByRole('button', { name: 'Mở hoặc lưu DOCX' }));
  await waitFor(() => expect(state.deleted).toHaveBeenCalledTimes(2));
  expect(state.share).toHaveBeenCalledWith(
    expect.stringMatching(/\.docx$/),
    expect.objectContaining({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  expect(state.writes[1]).toEqual([80, 75, 3, 4]);
  state.share.mockRejectedValueOnce(new Error('Unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Xem PDF' }));
  await waitFor(() => expect(state.deleted).toHaveBeenCalledTimes(3));
  expect(getToastSnapshot().toast?.type).not.toBe('error');
  const valid = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) =>
    path.endsWith('/documents/pdf')
      ? Promise.resolve(new Uint8Array([1, 2, 3]))
      : valid(path, init),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem PDF' }));
  await screen.findByText('Tệp tải về không hợp lệ. Hãy tạo lại tài liệu rồi thử lại.');
  expect(state.share).toHaveBeenCalledTimes(3);
  expect(state.deleted).toHaveBeenCalledTimes(3);
});

it('keeps the same saved draft and entered contact data when returning from signing to edit', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/documents'))
      return Promise.resolve({ docx: { id: 'docx' }, pdf: { id: 'pdf' }, previewError: null });
    if (path.endsWith('/pdf/preview'))
      return Promise.resolve({ fileId: 'pdf', pages: [{ number: 1, width: 595, height: 842 }] });
    if (path.includes('/pages/'))
      return Promise.resolve(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    return original(path, init);
  });
  setup();
  await screen.findByText('CCCD: ********0123');
  fill();
  const email = (screen.getByLabelText('Email người thuê *') as HTMLInputElement).value;
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước hợp đồng' }));
  await screen.findByText('Bản hợp đồng PDF');
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục ký hợp đồng' }));
  await screen.findByText('Chờ Chủ cơ sở duyệt để ký');
  fireEvent.click(screen.getByRole('button', { name: 'Xem hợp đồng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa thông tin' }));
  expect((screen.getByLabelText('Email người thuê *') as HTMLInputElement).value).toBe(email);
  expect(screen.getByText('Mã hợp đồng: draft-id')).toBeTruthy();
  expect(
    state.request.mock.calls.filter(
      (call) => call[0] === '/api/v1/contracts/main-drafts' && call[1]?.method === 'POST',
    ),
  ).toHaveLength(1);
});
