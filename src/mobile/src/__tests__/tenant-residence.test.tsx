// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi } from '../lib/api';
import { TenantResidenceScreen } from '../screens/TenantResidenceScreen';
import {
  residencePayload,
  residenceClient,
  type ResidenceTask,
} from '../../../../packages/client-core/src/residence';
const state = vi.hoisted(() => ({
  api: null as MobileApi | null,
  user: 'tenant',
  roles: ['Tenant'],
  gallery: vi.fn(),
  camera: vi.fn(),
  permission: vi.fn(),
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: state.api, session: { userId: state.user, roles: state.roles } }),
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('../components/ContractDateField', () => ({
  ContractDateField: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
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
    onChange: (v: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: state.gallery,
  launchCameraAsync: state.camera,
  requestCameraPermissionsAsync: state.permission,
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    get size() {
      return state.bytes.length;
    }
    get exists() {
      return true;
    }
    delete() {}
    async bytes() {
      return state.bytes.slice();
    }
  },
}));
type C = { children?: React.ReactNode };
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: 'ios' },
  View: ({ children }: C) => <div>{children}</div>,
  ScrollView: ({ children }: C) => <div>{children}</div>,
  Image: ({
    source,
    accessibilityLabel,
  }: {
    source: { uri: string };
    accessibilityLabel?: string;
  }) => <img src={source.uri} alt={accessibilityLabel} />,
  Modal: ({ visible, children }: C & { visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
}));
vi.mock('react-native-paper', () => {
  const content = ({ children }: C) => <div>{children}</div>;
  const button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: C & {
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { checked?: boolean; selected?: boolean };
  }) => (
    <button
      onClick={onPress}
      disabled={disabled}
      aria-label={accessibilityLabel}
      role={accessibilityRole}
      aria-checked={accessibilityState?.checked}
      aria-selected={accessibilityState?.selected}
    >
      {children}
    </button>
  );
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Text: ({ children, accessibilityRole }: C & { accessibilityRole?: string }) => (
      <span role={accessibilityRole}>{children}</span>
    ),
    Button: button,
    Checkbox: {
      Item: ({
        label,
        onPress,
        disabled,
      }: {
        label: string;
        onPress: () => void;
        disabled?: boolean;
      }) => (
        <button disabled={disabled} onClick={onPress}>
          {label}
        </button>
      ),
    },
    IconButton: button,
    TouchableRipple: button,
    Icon: () => null,
    ActivityIndicator: () => <span>Đang tải</span>,
    Portal: content,
    Dialog: Object.assign(
      ({ visible, children }: C & { visible: boolean }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: content, ScrollArea: content, Actions: content },
    ),
    TextInput: ({
      label,
      value,
      onChangeText,
      onBlur,
      disabled,
      multiline,
    }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
      onBlur?: () => void;
      disabled?: boolean;
      multiline?: boolean;
    }) =>
      multiline ? (
        <textarea
          aria-label={label}
          value={value}
          onChange={(event) => onChangeText(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
        />
      ) : (
        <input
          aria-label={label}
          value={value}
          onChange={(event) => onChangeText(event.target.value)}
          disabled={disabled}
        />
      ),
  };
});

const task: ResidenceTask = {
  contractId: '10000000-0000-4000-8000-000000000001',
  residentId: '10000000-0000-4000-8000-000000000002',
  locationId: '10000000-0000-4000-8000-000000000003',
  roomId: '10000000-0000-4000-8000-000000000004',
  roomNumber: 'M101',
  residentLabel: 'Người thử nghiệm',
  residentRole: 'Representative',
  tenantUserId: 'tenant',
  residenceFrom: '2026-01-01',
  actualResidenceFrom: null,
  status: 'Pending',
  hasEvidence: false,
  resultAt: null,
  ownerConfirmed: false,
  ownerConfirmedAt: null,
  history: [],
};
let saved: ResidenceTask;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const root = '/api/v1/residence-tasks';
const path = `${root}/${task.contractId}/${task.residentId}`;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  vi.clearAllMocks();
  state.user = 'tenant';
  state.roles = ['Tenant'];
  saved = structuredClone(task);
  state.bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  state.gallery.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/photo.png', mimeType: 'image/png', fileSize: 8 }],
  });
  state.permission.mockResolvedValue({ granted: false });
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const value = String(url);
    if (value.includes('?')) return json({ items: [saved], page: 1, pageSize: 20, totalCount: 1 });
    if (value.endsWith('/evidence')) {
      if (init?.method === 'PUT') {
        saved = { ...saved, hasEvidence: true, ownerConfirmed: false, ownerConfirmedAt: null };
        return json(saved);
      }
      return new Response(state.bytes.slice(), { headers: { 'content-type': 'image/png' } });
    }
    if (init?.method === 'PUT') {
      saved = {
        ...saved,
        ...JSON.parse(String(init.body)),
        ownerConfirmed: false,
        ownerConfirmedAt: null,
      };
      return json(saved);
    }
    return json(saved);
  });
  state.api = new MobileApi(
    'https://bhome.test',
    () => 'test-token',
    async () => 'test-token',
    vi.fn(),
    fetcher as unknown as typeof fetch,
  );
});
afterEach(cleanup);
it('loads compound-ID detail, hides single-record selectors and starts real tracking once', async () => {
  render(<TenantResidenceScreen />);
  await screen.findByText('Người thử nghiệm');
  expect(screen.queryByLabelText('Phòng / người ở')).toBeNull();
  expect(screen.queryByText(/Mã hồ sơ tham chiếu|0\/5/)).toBeNull();
  const start = screen.getByRole('button', { name: 'Bắt đầu đăng ký' });
  fireEvent.click(start);
  fireEvent.click(start);
  await screen.findByText('Đang thực hiện');
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(writes).toHaveLength(1);
  expect(String(writes[0][0])).toBe('https://bhome.test' + path);
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({
    actualResidenceFrom: '2026-01-01',
    status: 'InProgress',
    resultAt: null,
    note: null,
  });
  expect(new Headers(writes[0][1]?.headers).get('Authorization')).toBe('Bearer test-token');
});
it('uses detail rather than stale list state and prevents completing without server evidence', async () => {
  saved.status = 'InProgress';
  render(<TenantResidenceScreen />);
  await screen.findByText('Đang thực hiện');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã có kết quả' }));
  await screen.findByText('Tải ảnh minh chứng lên trước khi xác nhận kết quả.');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
it('uploads one picked image as authenticated raw PNG bytes, refreshes evidence and completes', async () => {
  saved.status = 'InProgress';
  render(<TenantResidenceScreen />);
  await screen.findByText('Đang thực hiện');
  fireEvent.click(screen.getByRole('button', { name: 'Chọn ảnh' }));
  await screen.findByAltText('Ảnh đã chọn chưa tải lên');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh lên' }));
  await screen.findByAltText('Ảnh minh chứng đã lưu');
  const upload = fetcher.mock.calls.find(
    ([url, init]) => String(url).endsWith('/evidence') && init?.method === 'PUT',
  )!;
  expect(upload[1]?.body).toBeInstanceOf(Uint8Array);
  expect(new Headers(upload[1]?.headers).get('Content-Type')).toBe('image/png');
  expect(new Headers(upload[1]?.headers).get('Authorization')).toBe('Bearer test-token');
  fireEvent.change(screen.getByLabelText('Ngày có kết quả (dd/MM/yyyy)'), {
    target: { value: '02/01/2026' },
  });
  fireEvent.change(screen.getByLabelText('Giờ có kết quả (HH:mm, giờ Việt Nam)'), {
    target: { value: '10:30' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã có kết quả' }));
  await screen.findByText('Đã ghi nhận kết quả');
  expect(saved.resultAt).toBe('2026-01-02T03:30:00.000Z');
  expect(screen.getByText('Chờ Owner xác nhận')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bắt đầu đăng ký' })).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('owner-confirmation'))).toBe(
    false,
  );
});
it('requires a warning acknowledgement before replacing Owner-confirmed evidence', async () => {
  Object.assign(saved, {
    status: 'Completed',
    hasEvidence: true,
    resultAt: '2026-01-02T03:30:00Z',
    ownerConfirmed: true,
    ownerConfirmedAt: '2026-01-03T03:30:00Z',
  });
  render(<TenantResidenceScreen />);
  await screen.findByText('Owner đã xác nhận');
  expect(screen.queryByRole('button', { name: 'Thay ảnh' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tôi muốn thay ảnh' }));
  expect(screen.getByText(/Thay ảnh sẽ hủy xác nhận/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thay ảnh' }));
  await screen.findByAltText('Ảnh đã chọn chưa tải lên');
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh lên' }));
  await screen.findByText('Chờ Owner xác nhận');
  expect(saved.ownerConfirmed).toBe(false);
});
it('keeps form values on conflict and requires a read and explicit review before sending again', async () => {
  saved.status = 'InProgress';
  saved.hasEvidence = true;
  const original = fetcher.getMockImplementation()!;
  let failed = false;
  fetcher.mockImplementation(async (url, init) => {
    if (init?.method === 'PUT' && !failed) {
      failed = true;
      return json({ code: 'invalid_residence_transition' }, 409);
    }
    return original(url, init);
  });
  render(<TenantResidenceScreen />);
  await screen.findByText('Đang thực hiện');
  fireEvent.change(screen.getByLabelText('Ngày có kết quả (dd/MM/yyyy)'), {
    target: { value: '02/01/2026' },
  });
  fireEvent.change(screen.getByLabelText('Giờ có kết quả (HH:mm, giờ Việt Nam)'), {
    target: { value: '10:30' },
  });
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Giữ ghi chú này' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã có kết quả' }));
  await screen.findByText(/Hồ sơ chưa đủ điều kiện/);
  expect((screen.getByLabelText('Ghi chú (không bắt buộc)') as HTMLInputElement).value).toBe(
    'Giữ ghi chú này',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra dữ liệu mới' }));
  await screen.findByRole('button', { name: 'Tôi đã đối chiếu dữ liệu mới' });
  expect(
    (screen.getByRole('button', { name: 'Xác nhận đã có kết quả' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Tôi đã đối chiếu dữ liệu mới' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã có kết quả' }));
  await screen.findByText('Đã ghi nhận kết quả');
  expect(saved.history).toEqual([]);
});
it('has a true empty state without a fake form', async () => {
  fetcher.mockImplementation(async () => json({ items: [], page: 1, pageSize: 20, totalCount: 0 }));
  render(<TenantResidenceScreen />);
  await screen.findByText('Chưa có hồ sơ theo dõi tạm trú.');
  expect(screen.queryByRole('button', { name: 'Bắt đầu đăng ký' })).toBeNull();
});
it('does not load residence APIs for Staff', () => {
  state.roles = ['Staff'];
  render(<TenantResidenceScreen />);
  expect(fetcher).not.toHaveBeenCalled();
});
it('reports denied camera permission and keeps gallery available', async () => {
  saved.status = 'InProgress';
  render(<TenantResidenceScreen />);
  await screen.findByText('Đang thực hiện');
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await screen.findByText(/Chưa có quyền camera/);
  expect(state.camera).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Chọn ảnh' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
it('validates dates, result time, Completed backwards transition and MIME before requests', async () => {
  expect(() => residencePayload(task, '31/12/2025', '', '', '', false)).toThrow(/không được trước/);
  expect(() =>
    residencePayload({ ...task, hasEvidence: true }, '01/01/2026', '31/02/2026', '10:30', '', true),
  ).toThrow(/Ngày không hợp lệ/);
  expect(() =>
    residencePayload({ ...task, hasEvidence: true }, '01/01/2026', '02/01/2026', '25:30', '', true),
  ).toThrow(/HH:mm/);
  expect(() =>
    residencePayload({ ...task, status: 'Completed' }, '01/01/2026', '', '', '', false),
  ).toThrow(/không thể chuyển/);
  const api = residenceClient(state.api!.request.bind(state.api));
  expect(() => api.upload(task, new Uint8Array([1, 2, 3]))).toThrow(/JPG hoặc PNG/);
});
it('shows a compound resident selector and only paginates when total exceeds page size', async () => {
  const second = {
    ...task,
    residentId: '20000000-0000-4000-8000-000000000002',
    residentLabel: 'Người ở thứ hai',
  };
  fetcher.mockImplementation(async (url) =>
    String(url).includes('?')
      ? json({ items: [task, second], page: 1, pageSize: 20, totalCount: 21 })
      : json(String(url).endsWith(second.residentId) ? second : task),
  );
  render(<TenantResidenceScreen />);
  await screen.findByText('Người thử nghiệm');
  fireEvent.change(screen.getByLabelText('Phòng / người ở'), {
    target: { value: `${second.contractId}/${second.residentId}` },
  });
  await screen.findByText('Người ở thứ hai');
  expect(screen.getByRole('button', { name: 'Trang hồ sơ sau' })).toBeTruthy();
});
it('does not offer a form for a future backend status', async () => {
  saved.status = 'FutureState' as ResidenceTask['status'];
  render(<TenantResidenceScreen />);
  await screen.findByText('Chưa xác định trạng thái');
  expect(screen.queryByRole('button', { name: 'Bắt đầu đăng ký' })).toBeNull();
  expect(screen.queryByLabelText('Ngày cư trú thực tế (dd/MM/yyyy)')).toBeNull();
});
it('clears previously visible data when detail access is revoked', async () => {
  render(<TenantResidenceScreen />);
  await screen.findByText('Người thử nghiệm');
  fetcher.mockImplementation(async () => json({ code: 'operations_resource_not_found' }, 404));
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới trạng thái' }));
  await screen.findByText(/Không tìm thấy hồ sơ hoặc ảnh/);
  expect(screen.queryByText('Người thử nghiệm')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Bắt đầu đăng ký' })).toBeNull();
});
it('does not block the result form when the evidence download fails', async () => {
  saved.status = 'InProgress';
  saved.hasEvidence = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) =>
    String(url).endsWith('/evidence') ? json({}, 404) : original(url, init),
  );
  render(<TenantResidenceScreen />);
  await screen.findByRole('button', { name: 'Tải lại ảnh' });
  expect((screen.getByLabelText('Ngày có kết quả (dd/MM/yyyy)') as HTMLInputElement).disabled).toBe(
    false,
  );
  expect(screen.queryByAltText('Ảnh minh chứng đã lưu')).toBeNull();
});
it('pull/header refresh reloads the selected detail and shows a new Owner confirmation', async () => {
  Object.assign(saved, {
    status: 'Completed',
    hasEvidence: true,
    resultAt: '2026-01-02T03:30:00Z',
  });
  render(<TenantResidenceScreen />);
  await screen.findByText('Chờ Owner xác nhận');
  saved = { ...saved, ownerConfirmed: true, ownerConfirmedAt: '2026-01-03T03:30:00Z' };
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại hồ sơ tạm trú' }));
  await screen.findByText('Owner đã xác nhận');
});
