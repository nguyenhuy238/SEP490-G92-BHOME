// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { MobileApi, MobileApiError } from '../lib/api';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ProfileEditScreen } from '../screens/ProfileEditScreen';
import { loadAccountProfile, profilePath, type AccountProfile } from '../services/accountProfile';
import { queryPolicies } from '../lib/queryPolicies';
import { normalizeLoginPhone } from '../../../../packages/client-core/src/loginValidation';
import { getToastSnapshot } from '../lib/toast';

const s = vi.hoisted(() => ({
  role: 'Tenant',
  userId: 'synthetic-a',
  signedIn: true,
  api: null as MobileApi | null,
  go: vi.fn(),
  logout: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(() => true),
  expired: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: s.api,
    session: s.signedIn ? { userId: s.userId, roles: [s.role] } : null,
    logout: s.logout,
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: s.role, preview: false, go: s.go, leavePreview: vi.fn() }),
}));
vi.mock('expo-router', () => ({
  router: { back: s.back, replace: s.replace, canGoBack: s.canGoBack },
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({
    children,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <div aria-label={accessibilityLabel} role={accessibilityRole}>
      {children}
    </div>
  ),
}));
vi.mock('react-native-paper', () => {
  type Content = { children?: React.ReactNode };
  const Content = ({ children }: Content) => <>{children}</>;
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Icon: () => null,
    Avatar: { Text: ({ label }: { label: string }) => <span data-testid="initials">{label}</span> },
    Text: ({ children, accessibilityRole }: Content & { accessibilityRole?: string }) => (
      <span role={accessibilityRole}>{children}</span>
    ),
    HelperText: ({ children }: Content) => <span role="alert">{children}</span>,
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      disabled,
    }: {
      accessibilityLabel: string;
      value: string;
      onChangeText: (value: string) => void;
      disabled?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChangeText(e.target.value)}
      />
    ),
    Button: ({
      children,
      onPress,
      disabled,
    }: Content & { onPress: () => void; disabled?: boolean }) => (
      <button disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
    TouchableRipple: ({
      children,
      onPress,
      accessibilityLabel,
    }: Content & { onPress: () => void; accessibilityLabel: string }) => (
      <button aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
    Portal: Content,
    Dialog: Object.assign(
      ({ visible, children }: Content & { visible: boolean }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: Content, Content, Actions: Content },
    ),
  };
});
const initial: AccountProfile = {
  userId: 'synthetic-a',
  fullName: 'Nguyễn Kiểm Thử',
  phone: '0901234567',
  email: 'synthetic@example.invalid',
  roles: ['Tenant'],
  isActive: true,
  version: 'version-1',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const caches: MobileApi[] = [];
function setup(fetcher: Mock<typeof fetch>) {
  s.api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-token',
    async () => undefined,
    s.expired,
    fetcher as typeof fetch,
  );
  caches.push(s.api);
}
beforeEach(() => {
  vi.clearAllMocks();
  s.role = 'Tenant';
  s.userId = 'synthetic-a';
  s.signedIn = true;
  s.canGoBack.mockReturnValue(true);
  s.logout.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  caches.forEach((api) => api.queryCache.dispose());
  caches.length = 0;
});
it('offers retry after a network failure without treating it as an empty profile', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(json(initial));
  setup(fetcher);
  render(<ProfileScreen />);
  await screen.findByRole('alert', {}, { timeout: 3000 });
  expect(screen.queryByText('Chưa cập nhật')).toBeNull();
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText(initial.email!);
});
it('does not load personal information in an unauthenticated preview', () => {
  s.signedIn = false;
  const fetcher = vi.fn<typeof fetch>();
  setup(fetcher);
  render(<ProfileScreen />);
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByText('Chỉnh sửa')).toBeNull();
});
it('aborts a pending PUT on unmount and does not navigate or publish its late response', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
    init?.method === 'PUT'
      ? new Promise((yes) => {
          finish = yes;
        })
      : json(initial),
  );
  setup(fetcher);
  const view = render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  await waitFor(() => expect(finish).toBeDefined());
  const signal = fetcher.mock.calls.at(-1)![1]!.signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(json({ ...initial, fullName: 'Late response', version: 'v2' })));
  expect(s.back).not.toHaveBeenCalled();
  expect(s.logout).not.toHaveBeenCalled();
});
it('does not automatically repeat a failed mutation or claim that it was saved', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (init?.method === 'PUT') throw new MobileApiError(0, 'network_unavailable');
    return json(initial);
  });
  setup(fetcher);
  render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  await screen.findByRole('alert');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(s.back).not.toHaveBeenCalled();
  expect(s.logout).not.toHaveBeenCalled();
  expect(getToastSnapshot().toast?.type).toBe('error');
});
it.each([
  ['Tenant', 'Khách thuê'],
  ['Staff', 'Nhân viên'],
  ['Owner', 'Chủ cơ sở'],
])(
  'loads the real %s profile contract and keeps internal metadata out of the UI',
  async (role, label) => {
    s.role = role;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith('/api/v1/capture/locations')
          ? json([{ id: 'assigned-location', label: 'Synthetic assigned Location' }])
          : json({ ...initial, roles: [role] }),
      );
    setup(fetcher);
    render(<ProfileScreen />);
    await screen.findByText(label);
    expect(screen.getAllByText(initial.fullName)).toHaveLength(2);
    expect(screen.getByText(initial.email!)).toBeTruthy();
    expect(screen.getByTestId('initials').textContent).toBe('KT');
    expect(screen.getByText('Tài khoản đang hoạt động')).toBeTruthy();
    if (role === 'Staff') {
      await screen.findByText('Synthetic assigned Location');
      expect(screen.queryByRole('button', { name: 'Synthetic assigned Location' })).toBeNull();
    }
    expect(screen.queryByText(/synthetic-a|version-1|Đã xác thực danh tính/)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.invalid' + profilePath,
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith(profilePath))).toHaveLength(1);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer synthetic-token',
    );
    fireEvent.click(screen.getByText('Chỉnh sửa'));
    expect(s.go).toHaveBeenCalledWith('profile-edit');
    fireEvent.click(screen.getByRole('button', { name: 'Bảo mật và mật khẩu' }));
    expect(s.go).toHaveBeenCalledWith('security');
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo của tôi' }));
    expect(s.go).toHaveBeenCalledWith('notifications');
  },
);
it('renders null contacts, inactive status and a compact initial skeleton without fabricated verification', async () => {
  let resolve!: (response: Response) => void;
  setup(
    vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    ),
  );
  render(<ProfileScreen />);
  expect(screen.getByLabelText('Đang tải hồ sơ')).toBeTruthy();
  await waitFor(() => expect(resolve).toBeDefined());
  await act(async () => resolve(json({ ...initial, phone: null, email: null, isActive: false })));
  expect(screen.getAllByText('Chưa cập nhật')).toHaveLength(2);
  expect(screen.getByText('Tài khoản đã ngừng hoạt động')).toBeTruthy();
  expect(screen.queryByText('Tải lại dữ liệu')).toBeNull();
});
it.each([403, 404, 500, 502])('shows a safe retry state for GET failure %s', async (status) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ fullName: 'PRIVATE' }, status))
    .mockResolvedValueOnce(json(initial));
  setup(fetcher);
  render(<ProfileScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText('PRIVATE')).toBeNull();
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText(initial.email!);
});
it('uses existing session expiration on GET 401 and never shows the rejected response', async () => {
  setup(vi.fn<typeof fetch>().mockResolvedValue(json({ ...initial, fullName: 'PRIVATE' }, 401)));
  render(<ProfileScreen />);
  await waitFor(() => expect(s.expired).toHaveBeenCalledOnce());
  expect(screen.queryByText('PRIVATE')).toBeNull();
});
it('clears the previous account from view immediately when API/account changes', async () => {
  setup(vi.fn<typeof fetch>().mockResolvedValue(json(initial)));
  const view = render(<ProfileScreen />);
  await screen.findByText(initial.email!);
  s.userId = 'synthetic-b';
  setup(
    vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ...initial,
        userId: s.userId,
        fullName: 'Other User',
        email: 'other@example.invalid',
      }),
    ),
  );
  view.rerender(<ProfileScreen />);
  expect(screen.queryByText(initial.email!)).toBeNull();
  await screen.findByText('other@example.invalid');
});
it.each(['Tenant', 'Staff', 'Owner'])(
  'saves %s name with only the allowed PUT fields and the returned version',
  async (role) => {
    s.role = role;
    const saved = { ...initial, fullName: 'Tên Đã Lưu', roles: [role], version: 'version-2' };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        json(init?.method === 'PUT' ? saved : { ...initial, roles: [role] }),
      );
    setup(fetcher);
    const view = render(<ProfileEditScreen />);
    await screen.findByDisplayValue(initial.fullName);
    fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: '  Tên Đã Lưu  ' } });
    fireEvent.click(screen.getByText('Lưu thay đổi'));
    await waitFor(() => expect(s.back).toHaveBeenCalledOnce());
    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({
      fullName: saved.fullName,
      phone: normalizeLoginPhone(initial.phone!),
      email: initial.email,
      version: initial.version,
    });
    expect(s.logout).not.toHaveBeenCalled();
    view.rerender(<ProfileScreen />);
    await screen.findByText(saved.email!);
    expect(screen.getAllByText(saved.fullName)).toHaveLength(2);
    expect(
      fetcher.mock.calls.filter(
        ([url, init]) => String(url).endsWith(profilePath) && init?.method !== 'PUT',
      ),
    ).toHaveLength(1);
    view.rerender(<ProfileEditScreen />);
    await screen.findByDisplayValue(saved.fullName);
    fireEvent.click(screen.getByText('Lưu thay đổi'));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2),
    );
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).version).toBe('version-2');
  },
);
it('validates name, email and phone before making any PUT', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(initial));
  setup(fetcher);
  render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'A' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid' } });
  fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: 'abc' } });
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  expect(screen.getAllByRole('alert')).toHaveLength(4);
  expect(screen.getByText('Vui lòng nhập mật khẩu hiện tại để xác nhận thay đổi liên hệ.')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['email_already_used', 'phone_already_used'])(
  'preserves the draft and presents %s as a friendly conflict',
  async (code) => {
    setup(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (_url, init) =>
          init?.method === 'PUT' ? json({ code }, 409) : json(initial),
        ),
    );
    render(<ProfileEditScreen />);
    await screen.findByDisplayValue(initial.fullName);
    fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'Bản Nháp' } });
    fireEvent.click(screen.getByText('Lưu thay đổi'));
    await screen.findByRole('alert');
    expect(screen.getByDisplayValue('Bản Nháp')).toBeTruthy();
    expect(screen.queryByText(code)).toBeNull();
    expect(s.back).not.toHaveBeenCalled();
    expect(getToastSnapshot().toast?.type).toBe('error');
  },
);
it('requires explicit refresh after a stale version and retries only with that freshly viewed version', async () => {
  let gets = 0,
    puts = 0;
  const newer = { ...initial, fullName: 'Tên Mới Từ Máy Chủ', version: 'version-3' };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (init?.method !== 'PUT') return json(++gets === 1 ? initial : newer);
    return ++puts === 1
      ? json({ code: 'stale_profile_version' }, 409)
      : json({ ...newer, version: 'version-4' });
  });
  setup(fetcher);
  render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  fireEvent.change(screen.getByLabelText('Họ và tên'), { target: { value: 'Bản Nháp' } });
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  await screen.findByText('Tải hồ sơ mới');
  expect(screen.getByDisplayValue('Bản Nháp')).toBeTruthy();
  expect((screen.getByText('Lưu thay đổi') as HTMLButtonElement).disabled).toBe(true);
  expect(puts).toBe(1);
  expect(gets).toBe(1);
  fireEvent.click(screen.getByText('Tải hồ sơ mới'));
  await screen.findByDisplayValue(newer.fullName);
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  await waitFor(() => expect(s.back).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).version).toBe('version-3');
});
it('does not silently rebase an unsaved draft after a background profile read', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      json(init?.method === 'PUT' ? { ...initial, version: 'version-2' } : initial),
    );
  setup(fetcher);
  render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  const scope = JSON.stringify([s.userId, [s.role]]);
  const entry = s.api!.queryCache.query(
    scope,
    profilePath,
    queryPolicies.profile,
    async () => initial,
    loadAccountProfile,
  );
  act(() =>
    s.api!.queryCache.setData(entry, {
      ...initial,
      fullName: 'Server changed',
      version: 'server-version',
    }),
  );
  expect(screen.getByDisplayValue(initial.fullName)).toBeTruthy();
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  await waitFor(() => expect(s.back).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).version).toBe(initial.version);
});
it('prevents duplicate submissions and normalizes accepted phone separators before saving', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) =>
    init?.method === 'PUT'
      ? new Promise((yes) => {
          finish = yes;
        })
      : json(initial),
  );
  setup(fetcher);
  render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '090-123 4567' } });
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  fireEvent.click(screen.getByText('Lưu thay đổi'));
  await waitFor(() => expect(finish).toBeDefined());
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).phone).toBe(
    normalizeLoginPhone(initial.phone!),
  );
  await act(async () => finish(json({ ...initial, version: 'version-2' })));
  expect(s.logout).not.toHaveBeenCalled();
});
it.each(['email', 'phone'] as const)(
  'preserves the session after a successful %s change with current-password proof',
  async (field) => {
    const changed = {
      ...initial,
      [field]: field === 'email' ? 'changed@example.invalid' : '0912345678',
      version: 'v2',
    };
    setup(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (_url, init) => json(init?.method === 'PUT' ? changed : initial)),
    );
    render(<ProfileEditScreen />);
    await screen.findByDisplayValue(initial.fullName);
    fireEvent.change(screen.getByLabelText(field === 'email' ? 'Email' : 'Số điện thoại'), {
      target: { value: changed[field] },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại để xác nhận'), {
      target: { value: 'Synthetic!Profile-795' },
    });
    fireEvent.click(screen.getByText('Lưu thay đổi'));
    await waitFor(() => expect(s.back).toHaveBeenCalledOnce());
    expect(s.logout).not.toHaveBeenCalled();
    expect(s.replace).not.toHaveBeenCalled();
    expect(getToastSnapshot().toast?.message).toMatch(/Phiên đăng nhập được giữ/);
  },
);
it('cancels editing without PUT and confirms logout before clearing the session', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(initial));
  setup(fetcher);
  const view = render(<ProfileEditScreen />);
  await screen.findByDisplayValue(initial.fullName);
  fireEvent.click(screen.getByText('Hủy'));
  expect(s.back).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender(<ProfileScreen />);
  await screen.findByText(initial.email!);
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  fireEvent.click(screen.getByText('Ở lại'));
  expect(s.logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đăng xuất' }));
  await waitFor(() => expect(s.logout).toHaveBeenCalledOnce());
  expect(s.replace).toHaveBeenCalledWith('/');
});
