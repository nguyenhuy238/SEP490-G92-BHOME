// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi } from '../lib/api';
import { IncidentReportForm } from '../features/incidents/IncidentReportForm';
import { queryPolicies } from '../lib/queryPolicies';
import {
  incidentFormError,
  loadReportingRooms,
  loadReportingAssets,
  submitTenantIncident,
} from '../services/tenantIncidentReport';
import { readPickedIncidentPhoto } from '../components/TenantIncidentPhotos';
const state = vi.hoisted(() => ({
  api: null as MobileApi | null,
  user: 'tenant-a',
  go: vi.fn(),
  success: vi.fn(),
  gallery: vi.fn(),
  camera: vi.fn(),
  permission: vi.fn(),
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  size: 8,
  resize: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: state.api, session: { userId: state.user, roles: ['Tenant'] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: 'Tenant', preview: false, go: state.go }),
}));
vi.mock('../lib/toast', () => ({
  conciseMessage: (value: string) => value,
  showError: vi.fn(),
  showSuccess: state.success,
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  router: { canGoBack: () => false, back: vi.fn() },
}));
vi.mock('../components/ContextPortal', () => ({
  ContextPortal: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('../components/CameraCapture', () => ({ CameraCapture: () => null }));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: state.gallery,
  launchCameraAsync: state.camera,
  requestCameraPermissionsAsync: state.permission,
}));
vi.mock('expo-file-system', () => ({
  File: class {
    get size() {
      return state.size;
    }
    async bytes() {
      return state.bytes;
    }
  },
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: state.resize,
      release: vi.fn(),
      renderAsync: async () => ({
        release: vi.fn(),
        saveAsync: async () => {
          state.bytes = new Uint8Array([255, 216, 255, 217]);
          state.size = 4;
          return { uri: 'file:///resized-camera.jpg' };
        },
      }),
    }),
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
const roomId = '11111111-1111-4111-8111-111111111111',
  locationId = '22222222-2222-4222-8222-222222222222',
  assetId = '33333333-3333-4333-8333-333333333333',
  incidentId = '44444444-4444-4444-8444-444444444444';
const room = { roomId, locationId, roomNumber: 'M101', locationName: 'Cơ sở kiểm thử' };
const page = (items: unknown[], totalCount = items.length, page = 1) => ({
  items,
  totalCount,
  page,
  pageSize: 20,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const result = { incidentId, workOrderId: null, resourceId: null };
const picked = {
  canceled: false,
  assets: [
    { uri: 'file:///synthetic.png', mimeType: 'image/png', fileSize: 8, width: 1, height: 1 },
  ],
};
function setup(handler?: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url, init) =>
      handler
        ? handler(String(url), init)
        : json(
            init?.method === 'POST'
              ? result
              : String(url).includes('reporting-rooms')
                ? page([room])
                : page([]),
            init?.method === 'POST' ? 201 : 200,
          ),
    );
  state.api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-token',
    async () => undefined,
    vi.fn(),
    fetcher as typeof fetch,
  );
  return fetcher;
}
const describeIncident = (value = 'Ống nước đang bị rò trong phòng') =>
  fireEvent.change(screen.getByLabelText('Mô tả sự cố'), { target: { value } });
beforeEach(() => {
  vi.clearAllMocks();
  state.user = 'tenant-a';
  state.bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  state.size = 8;
  state.gallery.mockResolvedValue(picked);
  state.camera.mockResolvedValue(picked);
  state.permission.mockResolvedValue({ granted: true });
});
afterEach(() => {
  cleanup();
  state.api?.queryCache.dispose();
  vi.useRealTimers();
});
it('preselects only a unique eligible room, keeps the header compact and submits authenticated UTF-8 multipart', async () => {
  const fetcher = setup();
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  fireEvent.click(screen.getByRole('radio', { name: /Khẩn cấp/ }));
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByAltText('Ảnh hiện trường 1');
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await waitFor(() => expect(state.go).toHaveBeenCalledWith('incident-detail', { incidentId }));
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  const headers = new Headers(posts[0][1]?.headers),
    body = new TextDecoder().decode(posts[0][1]?.body as Uint8Array);
  expect(headers.get('Authorization')).toBe('Bearer synthetic-token');
  expect(headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=bhome-/);
  expect(headers.get('Idempotency-Key')).toMatch(/^[\da-f-]{36}$/i);
  expect(body).toContain('Ống nước đang bị rò trong phòng');
  expect(body).toContain(`name="roomId"\r\n\r\n${roomId}`);
  expect(body).not.toContain('name="commonArea"');
  expect(body).toContain('name="severity"\r\n\r\n1');
  expect(body).toContain('name="images"; filename="evidence-0.png"');
  expect(body).toContain('Content-Type: image/png');
  expect(body).not.toContain('file:///');
  expect(state.success).toHaveBeenCalledWith('Đã gửi báo cáo sự cố thành công');
  expect(
    fetcher.mock.calls.some(([url]) => /capture\/|\/contracts|\/invoices/.test(String(url))),
  ).toBe(false);
});
it('requires explicit choice among multiple rooms and loads further pages only in the modal', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    ...room,
    roomId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    roomNumber: `P${index + 1}`,
  }));
  const last = { ...room, roomNumber: 'P21' };
  const fetcher = setup((url) =>
    json(url.includes('page=2&') ? page([last], 21, 2) : page(rows, 21)),
  );
  render(<IncidentReportForm />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  describeIncident();
  expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Tải thêm')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn phòng' }));
  await screen.findByRole('button', { name: 'Phòng P1 · Cơ sở kiểm thử' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Tải thêm'));
  fireEvent.click(await screen.findByRole('button', { name: 'Phòng P21 · Cơ sở kiểm thử' }));
  expect(screen.getByText('Phòng P21')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('clears incompatible room assets on common-area switch and preserves description and photos', async () => {
  const asset = {
    assetId,
    locationId,
    roomId,
    commonArea: null,
    name: 'Vòi nước',
    category: 'Water',
    status: 'Active',
  };
  const fetcher = setup((url, init) =>
    json(
      init?.method === 'POST'
        ? result
        : url.includes('reporting-assets')
          ? page([asset])
          : page([room]),
      init?.method === 'POST' ? 201 : 200,
    ),
  );
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByAltText('Ảnh hiện trường 1');
  fireEvent.click(screen.getByText('Tài sản liên quan (tùy chọn)'));
  fireEvent.click(await screen.findByRole('button', { name: 'Vòi nước · Water · Hoạt động' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Khu vực chung' }));
  fireEvent.change(screen.getByLabelText('Tên khu vực chung'), {
    target: { value: 'Hành lang tầng 2' },
  });
  expect(screen.queryByText('Bỏ chọn tài sản')).toBeNull();
  expect(screen.getByAltText('Ảnh hiện trường 1')).toBeTruthy();
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await waitFor(() => expect(state.go).toHaveBeenCalled());
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  const body = new TextDecoder().decode(post[1]?.body as Uint8Array);
  expect(body).toContain('Hành lang tầng 2');
  expect(body).not.toContain('name="roomId"');
  expect(body).not.toContain('name="assetId"');
  expect(body).toContain('Ống nước đang bị rò trong phòng');
});
it('validates description after interaction, retains overlong text and explains the disabled state', async () => {
  setup();
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  expect(screen.queryByRole('alert')).toBeNull();
  describeIncident('Quá ngắn');
  fireEvent.blur(screen.getByLabelText('Mô tả sự cố'));
  expect(screen.getByRole('alert').textContent).toContain('10 đến 8.000');
  const long = 'a'.repeat(8001);
  describeIncident(long);
  expect((screen.getByLabelText('Mô tả sự cố') as HTMLTextAreaElement).value).toHaveLength(8001);
  expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(true);
});
it('preserves photos and exact payload keys after ambiguous failure, locks pending presses and changes keys after edits', async () => {
  let reject!: (cause: Error) => void;
  const fetcher = setup((_url, init) =>
    init?.method === 'POST'
      ? new Promise((_resolve, no) => {
          reject = no;
        })
      : json(page([room])),
  );
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByAltText('Ảnh hiện trường 1');
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  fireEvent.click(screen.getByText('Đang gửi báo cáo...'));
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
  );
  await act(async () => reject(new Error('connection lost')));
  await screen.findByRole('alert');
  expect(state.success).not.toHaveBeenCalled();
  expect(screen.getByAltText('Ảnh hiện trường 1')).toBeTruthy();
  fetcher.mockImplementation(async (_url, init) =>
    init?.method === 'POST'
      ? json({ code: 'idempotency_conflict', detail: 'PRIVATE_STACK' }, 409)
      : json(page([room])),
  );
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await screen.findByRole('alert');
  let posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(new Headers(posts[1][1]?.headers).get('Idempotency-Key')).toBe(
    new Headers(posts[0][1]?.headers).get('Idempotency-Key'),
  );
  expect(new TextDecoder().decode(posts[1][1]?.body as Uint8Array)).toBe(
    new TextDecoder().decode(posts[0][1]?.body as Uint8Array),
  );
  await waitFor(() =>
    expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(false),
  );
  describeIncident('Mô tả thay đổi sau khi gửi thất bại');
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3),
  );
  posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(new Headers(posts[2][1]?.headers).get('Idempotency-Key')).not.toBe(
    new Headers(posts[0][1]?.headers).get('Idempotency-Key'),
  );
  expect(screen.queryByText(/PRIVATE_STACK/)).toBeNull();
});
it.each([400, 401, 403, 404, 409, 413, 500])(
  'keeps a failed report intact and never navigates on HTTP %s',
  async (status) => {
    setup((_url, init) =>
      init?.method === 'POST'
        ? json({ code: 'rejected', detail: 'PRIVATE_STACK' }, status)
        : json(page([room])),
    );
    render(<IncidentReportForm />);
    await screen.findByText('Phòng M101');
    describeIncident();
    fireEvent.click(screen.getByText('Gửi báo cáo'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Mô tả sự cố') as HTMLTextAreaElement).value).toContain(
      'Ống nước',
    );
    expect(state.go).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.queryByText(/PRIVATE_STACK/)).toBeNull();
  },
);
it('reuses cached room data across remount and clears draft values across accounts', async () => {
  const fetcher = setup();
  const view = render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  view.unmount();
  const next = render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  expect(fetcher).toHaveBeenCalledTimes(1);
  describeIncident('Riêng tư tài khoản A');
  state.user = 'tenant-b';
  fetcher.mockImplementation(async () => new Promise(() => {}));
  next.rerender(<IncidentReportForm />);
  expect((screen.getByLabelText('Mô tả sự cố') as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByText('Phòng M101')).toBeNull();
});
it('does not silently move an edited report to a different room after background refresh', async () => {
  let current = room;
  setup(() => json(page([current])));
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  current = { ...room, roomId: assetId, roomNumber: 'M202' };
  act(() => state.api!.queryCache.invalidate(['rooms']));
  await waitFor(() => expect(screen.queryByText('Phòng M101')).toBeNull());
  expect(screen.queryByText('Phòng M202')).toBeNull();
  expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Mô tả sự cố') as HTMLTextAreaElement).value).toContain('Ống nước');
  fireEvent.click(screen.getByRole('button', { name: 'Chọn phòng' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Phòng M202 · Cơ sở kiểm thử' }));
  expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(false);
});
it('invalidates incident summaries on success without refetching financial queries', async () => {
  setup();
  const cache = state.api!.queryCache,
    incidents = vi.fn().mockResolvedValue([]),
    invoices = vi.fn().mockResolvedValue([]);
  const first = cache.query(
      'tenant',
      '/api/v1/incidents?page=1&pageSize=1',
      queryPolicies.incidents,
      incidents,
    ),
    second = cache.query('tenant', '/api/v1/invoices', queryPolicies.invoices, invoices);
  cache.activate(first);
  cache.activate(second);
  await Promise.all([cache.fetch(first), cache.fetch(second)]);
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await waitFor(() => expect(state.go).toHaveBeenCalled());
  expect(incidents).toHaveBeenCalledTimes(2);
  expect(invoices).toHaveBeenCalledTimes(1);
});
it('previews/removes images and handles camera permission denial without dropping the draft', async () => {
  setup();
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  state.permission.mockResolvedValue({ granted: false });
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByText(/Chưa có quyền camera/);
  expect(state.camera).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByAltText('Ảnh hiện trường 1');
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh hiện trường 1' }));
  expect(screen.getByAltText('Ảnh hiện trường phóng lớn')).toBeTruthy();
  fireEvent.click(screen.getByText('Đóng ảnh'));
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh hiện trường 1' }));
  expect(screen.queryByAltText('Ảnh hiện trường 1')).toBeNull();
  expect((screen.getByLabelText('Mô tả sự cố') as HTMLTextAreaElement).value).toContain('Ống nước');
});
it('checks real bytes and the decimal 5 MB boundary, not just picker metadata', async () => {
  const asset = picked.assets[0];
  state.bytes = new Uint8Array(5_000_000);
  state.bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  state.size = 5_000_000;
  expect((await readPickedIncidentPhoto(asset)).bytes.length).toBe(5_000_000);
  state.bytes = new Uint8Array(5_000_001);
  state.bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  state.size = 8;
  await expect(readPickedIncidentPhoto(asset)).rejects.toThrow(/5.000.000/);
  await expect(readPickedIncidentPhoto({ ...asset, mimeType: 'image/gif' })).rejects.toThrow(
    /JPG\/PNG/,
  );
});
it('re-encodes camera images above backend pixel limits to real JPEG bytes', async () => {
  const photo = await readPickedIncidentPhoto({ ...picked.assets[0], width: 4032, height: 3024 });
  expect(state.resize).toHaveBeenCalledWith({ width: 1920, height: 1440 });
  expect(photo.previewUri).toBe('file:///resized-camera.jpg');
  expect(photo.contentType).toBe('image/jpeg');
  expect([...photo.bytes]).toEqual([255, 216, 255, 217]);
});
it('rejects unsupported or excess gallery selections without discarding an existing photo', async () => {
  setup();
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByAltText('Ảnh hiện trường 1');
  state.gallery.mockResolvedValue({
    canceled: false,
    assets: Array.from({ length: 5 }, () => picked.assets[0]),
  });
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByText(/Chỉ chọn tối đa 5 ảnh/);
  expect(screen.getByAltText('Ảnh hiện trường 1')).toBeTruthy();
  expect(screen.queryByAltText('Ảnh hiện trường 2')).toBeNull();
  state.gallery.mockResolvedValue({
    canceled: false,
    assets: [{ ...picked.assets[0], mimeType: 'image/webp' }],
  });
  fireEvent.click(screen.getByText('Thư viện'));
  await screen.findByText(/Chỉ nhận ảnh JPG\/PNG/);
  expect(screen.getByAltText('Ảnh hiện trường 1')).toBeTruthy();
});
it('handles no eligible rooms and malformed success responses without inventing a destination', async () => {
  const fetcher = setup(() => json(page([])));
  const view = render(<IncidentReportForm />);
  await screen.findByText(/Bạn chưa có phòng đủ điều kiện/);
  expect((screen.getByText('Gửi báo cáo') as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  state.api?.queryCache.dispose();
  setup((_url, init) =>
    json(
      init?.method === 'POST'
        ? { incidentId: 'not-a-server-guid', workOrderId: null, resourceId: null }
        : page([room]),
      init?.method === 'POST' ? 201 : 200,
    ),
  );
  render(<IncidentReportForm />);
  await screen.findByText('Phòng M101');
  describeIncident();
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await screen.findByRole('alert');
  expect(state.go).not.toHaveBeenCalled();
  expect(state.success).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it('rejects wrong lookup shapes and mismatched asset scope before rendering choices', async () => {
  setup();
  const signal = new AbortController().signal;
  const fake = { request: vi.fn().mockResolvedValue({ items: null }) } as unknown as MobileApi;
  await expect(
    loadReportingRooms(fake, '/api/v1/incidents/reporting-rooms?page=1&pageSize=20', signal),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  fake.request = vi.fn().mockResolvedValue(
    page([
      {
        assetId,
        locationId: incidentId,
        roomId,
        commonArea: null,
        name: 'Wrong scope',
        category: 'Water',
        status: 'Active',
      },
    ]),
  );
  await expect(
    loadReportingAssets(
      fake,
      `/api/v1/incidents/reporting-assets?locationId=${locationId}&roomId=${roomId}&page=1&pageSize=20`,
      signal,
    ),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  expect(
    incidentFormError(
      {
        locationId,
        roomId,
        commonArea: 'Không được đồng thời',
        assetId: null,
        severity: 'Normal',
        description: 'Mô tả đủ ký tự để gửi',
      },
      [],
    ),
  ).not.toBe('');
});
it('bounds an interrupted upload without automatic mutation retry or an invented success', async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('Aborted'))),
        ),
    );
  const fake = { request } as unknown as MobileApi;
  const promise = submitTenantIncident(
    fake,
    {
      locationId,
      roomId,
      commonArea: null,
      assetId: null,
      severity: 'Normal',
      description: 'Ống nước đang bị rò trong phòng',
    },
    [],
    incidentId,
    new AbortController().signal,
  ).catch((error) => error);
  await vi.advanceTimersByTimeAsync(90_000);
  expect((await promise).message).toContain('Chưa xác định được máy chủ đã nhận hay chưa');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(incidentId);
});
