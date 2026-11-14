// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
const state = vi.hoisted(() => ({
  push: vi.fn(),
  navigate: vi.fn(),
  dismissTo: vi.fn(),
  segments: ['workspace', '[screen]'],
  params: {} as Record<string, string>,
  scrollTo: vi.fn(),
  navigation: { isFocused: vi.fn(() => true) },
  leave: vi.fn(),
  userId: 'staff-a',
  roles: ['Staff'],
  signedIn: true,
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(),
  renderTabBar: false,
}));
vi.mock('expo-router', () => ({
  useSegments: () => state.segments,
  useNavigation: () => state.navigation,
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect">{href}</div>,
  useLocalSearchParams: () => state.params,
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  router: {
    push: state.push,
    navigate: state.navigate,
    dismissTo: state.dismissTo,
    back: state.back,
    replace: state.replace,
    canGoBack: state.canGoBack,
  },
}));
vi.mock('expo-router/js-tabs', () => {
  const Tabs = ({
    children,
    screenOptions,
    backBehavior,
    tabBar,
  }: {
    children?: React.ReactNode;
    screenOptions: { animation: string; lazy: boolean };
    backBehavior: string;
    tabBar: (props: BottomTabBarProps) => React.ReactNode;
  }) => (
    <div
      data-testid="navigator"
      data-animation={screenOptions.animation}
      data-lazy={String(screenOptions.lazy)}
      data-back={backBehavior}
    >
      {children}
      {state.renderTabBar && (
        <WorkspaceTabsContext.Consumer>
          {() => tabBar(navigatorBarProps())}
        </WorkspaceTabsContext.Consumer>
      )}
    </div>
  );
  return {
    Tabs: Object.assign(Tabs, {
      Screen: ({ name }: { name: string }) => <div data-testid="tab-route">{name}</div>,
      Protected: ({ guard, children }: { guard: boolean; children?: React.ReactNode }) =>
        guard ? children : null,
    }),
  };
});
vi.mock('../features/workspace/WorkspaceScreenView', () => ({
  WorkspaceScreenView: ({ screen }: { screen: string }) => (
    <div data-testid="screen-view">{screen}</div>
  ),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    session: state.signedIn ? { userId: state.userId, roles: state.roles } : null,
  }),
}));
vi.mock('../components/NotificationBadge', () => ({ NotificationBadge: () => null }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native', () => {
  const View = ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties | React.CSSProperties[];
  }) => (
    <div style={Object.assign({}, ...(Array.isArray(style) ? style : [style]))}>{children}</div>
  );
  return {
    View,
    Platform: { OS: 'android' },
    StyleSheet: { create: (s: unknown) => s },
    KeyboardAvoidingView: View,
    RefreshControl: ({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) => (
      <button aria-label="Kéo để tải lại" disabled={refreshing} onClick={onRefresh} />
    ),
    ScrollView: forwardRef(function Scroll(
      {
        children,
        refreshControl,
      }: { children?: React.ReactNode; refreshControl?: React.ReactNode },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ scrollTo: state.scrollTo }));
      return (
        <div data-testid="shell-scroll">
          {refreshControl}
          {children}
        </div>
      );
    }),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
  SafeAreaView: ({
    children,
    edges,
    style,
  }: {
    children?: React.ReactNode;
    edges: string[];
    style?: React.CSSProperties | React.CSSProperties[];
  }) => (
    <main
      data-edges={edges.join(',')}
      style={Object.assign({}, ...(Array.isArray(style) ? style : [style]))}
    >
      {children}
    </main>
  ),
}));
vi.mock('react-native-paper', () => {
  const Content = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Text: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
      <span style={style}>{children}</span>
    ),
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress: () => void }) => (
      <button onClick={onPress}>{children}</button>
    ),
    TouchableRipple: ({
      children,
      onPress,
      accessibilityRole,
      accessibilityLabel,
      accessibilityState,
    }: {
      children?: React.ReactNode;
      onPress: () => void;
      accessibilityRole: string;
      accessibilityLabel: string;
      accessibilityState?: { selected: boolean };
    }) => (
      <button
        role={accessibilityRole}
        aria-label={accessibilityLabel}
        aria-selected={accessibilityState?.selected}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    Icon: () => null,
    Badge: () => null,
    IconButton: ({
      onPress,
      accessibilityLabel,
    }: {
      onPress: () => void;
      accessibilityLabel: string;
    }) => <button aria-label={accessibilityLabel} onClick={onPress} />,
    Portal: Content,
    Dialog: Object.assign(
      ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: Content, Content, Actions: Content },
    ),
  };
});
vi.mock('../components/WorkspaceKit', () => ({ ui: {} }));
import { WorkspaceProvider, useWorkspace } from '../features/workspace/WorkspaceProvider';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import {
  canOpenScreen,
  activeWorkspaceTab,
  isWorkspaceTabDestination,
  tabs,
  type WorkspaceScreen,
} from '../features/workspace/navigation';
import WorkspaceTabsLayout, { NavigatorTabBar } from '../app/(tabs)/_layout';
import WorkspaceRoute from '../app/workspace/[screen]';
import { WorkspaceTabsContext } from '../features/workspace/WorkspaceTabsContext';
it('lets the inbox own its virtual list without nesting it inside the shell ScrollView', () => {
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="notifications">
        <span>Virtual inbox content</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('Virtual inbox content')).toBeTruthy();
  expect(screen.queryByTestId('shell-scroll')).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
});
beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  state.userId = 'staff-a';
  state.roles = ['Staff'];
  state.signedIn = true;
  state.segments = ['workspace', '[screen]'];
  state.params = {};
  state.renderTabBar = false;
  vi.clearAllMocks();
  state.canGoBack.mockReturnValue(false);
  state.navigation.isFocused.mockReturnValue(true);
});
it('restricts the feature catalog to Tenant and returns to Home through normal back navigation', () => {
  expect(canOpenScreen('Tenant', 'tenant-features')).toBe(true);
  expect(canOpenScreen('Staff', 'tenant-features')).toBe(false);
  expect(canOpenScreen('Owner', 'tenant-features')).toBe(false);
  expect(activeWorkspaceTab('Tenant', 'tenant-features')).toBe('tenant-home');
  state.roles = ['Tenant'];
  state.canGoBack.mockReturnValue(true);
  const view = render(
    <WorkspaceProvider>
      <WorkspaceShell screen="tenant-features">
        <span>Danh mục chức năng</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('Tất cả chức năng')).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect((screen.getAllByRole('tab')[0].firstElementChild as HTMLElement).style.minHeight).toBe(
    '54px',
  );
  expect(view.container.querySelector('main')?.getAttribute('data-edges')).toBe('top,left,right');
  expect(screen.getAllByRole('tab')[0].parentElement?.style.paddingBottom).toBe('24px');
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(state.back).toHaveBeenCalledOnce();
  expect(state.replace).not.toHaveBeenCalled();
});
afterEach(cleanup);
it.each(['Staff'])('opens the OCR test directly from the %s development home', (role) => {
  state.roles = [role];
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen={role === 'Owner' ? 'owner-home' : 'staff-home'}>
        <span>Nội dung</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Test OCR' }));
  expect(state.push).toHaveBeenCalledWith('/ocr-test');
});
it.each([
  { development: false, role: 'Staff', home: 'staff-home' as const },
  { development: false, role: 'Owner', home: 'owner-home' as const },
  { development: true, role: 'Owner', home: 'owner-home' as const },
  { development: true, role: 'Tenant', home: 'tenant-home' as const },
  { development: true, role: 'Staff', home: 'notifications' as const },
])(
  'hides the OCR test outside an authorized development home: %o',
  ({ development, role, home }) => {
    vi.stubGlobal('__DEV__', development);
    state.roles = [role];
    render(
      <WorkspaceProvider>
        <WorkspaceShell screen={home}>
          <span>Nội dung</span>
        </WorkspaceShell>
      </WorkspaceProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Test OCR' })).toBeNull();
  },
);
it('does not offer a real OCR action in role preview without a session', () => {
  state.signedIn = false;
  function Preview() {
    const { startPreview } = useWorkspace();
    return <button onClick={() => startPreview('Staff')}>Xem mẫu</button>;
  }
  render(
    <WorkspaceProvider>
      <Preview />
      <WorkspaceShell screen="staff-home">
        <span>Nội dung</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem mẫu' }));
  expect(screen.queryByRole('button', { name: 'Test OCR' })).toBeNull();
});
function Draft() {
  const { registerExitGuard, go } = useWorkspace();
  useEffect(() => registerExitGuard(() => true, state.leave), [registerExitGuard]);
  return <button onClick={() => go('staff-home')}>Đổi màn hình</button>;
}
function ContractHeaderProbe({ refresh }: { refresh: () => void }) {
  useWorkspaceHeaderRefresh(refresh, false);
  return <span>Danh sách hợp đồng</span>;
}
it('keeps the Staff task title, refresh, back and four bottom tabs in the shell', () => {
  const refresh = vi.fn();
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="work-orders">
        <ContractHeaderProbe refresh={refresh} />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('Công việc vận hành')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại công việc' }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
});
function ProfileEditFooterProbe() {
  useWorkspaceHeaderRefresh(state.leave, false, {
    title: 'Chỉnh sửa hồ sơ',
    footer: <button>Save profile footer</button>,
  });
  return <span>Profile form content</span>;
}
it.each(['Owner', 'Staff', 'Tenant'] as const)(
  'keeps %s edit profile on Stack with Profile selected and a keyboard-accessible footer',
  (role) => {
    state.roles = [role];
    expect(canOpenScreen(role, 'profile-edit')).toBe(true);
    expect(activeWorkspaceTab(role, 'profile-edit')).toBe('profile');
    state.canGoBack.mockReturnValue(true);
    render(
      <WorkspaceProvider>
        <WorkspaceShell screen="profile-edit">
          <ProfileEditFooterProbe />
        </WorkspaceShell>
      </WorkspaceProvider>,
    );
    expect(screen.getByText('Chỉnh sửa hồ sơ')).toBeTruthy();
    expect(
      screen
        .getByRole('tab', { name: role === 'Owner' ? 'Tài khoản' : 'Cá nhân' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    const footer = screen.getByText('Save profile footer');
    expect(footer.parentElement?.contains(screen.getByText('Profile form content'))).toBe(true);
    // The form belongs to the scroll view; the footer is its sibling inside KeyboardAvoidingView.
    expect(screen.getByText('Profile form content').parentElement?.contains(footer)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(state.back).toHaveBeenCalledOnce();
    expect(state.push).not.toHaveBeenCalled();
  },
);
function InvoiceHeaderProbe({ refresh, back }: { refresh: () => void; back: () => void }) {
  useWorkspaceHeaderRefresh(refresh, false, { title: 'Chi tiết hóa đơn', onBack: back });
  return <span>Nội dung hóa đơn</span>;
}
function LedgerHeaderProbe({ refresh }: { refresh: () => void }) {
  useWorkspaceHeaderRefresh(refresh, false, { title: 'Lịch sử & công nợ' });
  return <span>Nội dung giao dịch</span>;
}
it('provides a shared ledger refresh icon and pull-to-refresh while retaining Tenant navigation', () => {
  state.roles = ['Tenant'];
  const refresh = vi.fn();
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="billing-history">
        <LedgerHeaderProbe refresh={refresh} />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('Lịch sử & công nợ')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại giao dịch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kéo để tải lại' }));
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tab', { name: 'Hóa đơn' }).parentElement?.style.paddingBottom).toBe(
    '24px',
  );
});
it('uses invoice header actions while retaining Tenant tabs and bottom safe area', () => {
  state.roles = ['Tenant'];
  const refresh = vi.fn(),
    back = vi.fn();
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="invoice">
        <InvoiceHeaderProbe refresh={refresh} back={back} />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('Chi tiết hóa đơn')).toBeTruthy();
  expect(screen.getByText('Thông tin tài chính của phòng')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại hóa đơn' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kéo để tải lại' }));
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(back).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tab', { name: 'Hóa đơn' }).parentElement?.style.paddingBottom).toBe(
    '24px',
  );
});
it('provides pull-to-refresh to Tenant My Room and leaves profile controls unchanged', () => {
  state.roles = ['Tenant'];
  const refresh = vi.fn();
  const view = render(
    <WorkspaceProvider>
      <WorkspaceShell screen="tenant-room">
        <ContractHeaderProbe refresh={refresh} />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kéo để tải lại' }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: 'Tải lại hợp đồng' })).toBeNull();
  view.rerender(
    <WorkspaceProvider>
      <WorkspaceShell screen="profile">
        <span>Cá nhân</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Kéo để tải lại' })).toBeNull();
});
it.each([
  ['Tenant', 'tenant-home'],
  ['Staff', 'staff-home'],
] as const)(
  'connects %s Home pull-to-refresh without adding another refresh button',
  (role, home) => {
    state.roles = [role];
    const refresh = vi.fn();
    render(
      <WorkspaceProvider>
        <WorkspaceShell screen={home}>
          <ContractHeaderProbe refresh={refresh} />
        </WorkspaceShell>
      </WorkspaceProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kéo để tải lại' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Tải lại hợp đồng' })).toBeNull();
  },
);
it('lets the Tenant incident form own its compact header while retaining the Staff report back control', () => {
  state.roles = ['Tenant'];
  const view = render(
    <WorkspaceProvider>
      <WorkspaceShell screen="incidents">
        <span>Báo cáo sự cố</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.queryByText('Quay lại')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
  expect(screen.getByText('Hỗ trợ cư dân')).toBeTruthy();
  state.userId = 'staff-a';
  state.roles = ['Staff'];
  view.rerender(
    <WorkspaceProvider>
      <WorkspaceShell screen="report-incident">
        <span>Staff report</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
});
it('places contract refresh beside the compact Staff title and clears it when opening details', () => {
  const refresh = vi.fn();
  const view = render(
    <WorkspaceProvider>
      <WorkspaceShell screen="signing">
        <ContractHeaderProbe refresh={refresh} />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('Hợp đồng')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại hợp đồng' }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  view.rerender(
    <WorkspaceProvider>
      <WorkspaceShell screen="signing">
        <span>Chi tiết hợp đồng</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Tải lại hợp đồng' })).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
});
it('lets meter steps use the Staff shell back action without navigating home', () => {
  const back = vi.fn();
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="meter-reading" onBack={back} contentRevision={2}>
        <span>Kiểm tra chỉ số</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  expect(screen.getByText('BHOME Nhân viên')).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(back).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
});
it('keeps the draft exit guard when opening the OCR test', () => {
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="staff-home">
        <Draft />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Test OCR' }));
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Rời quy trình' }));
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.push).toHaveBeenCalledWith('/ocr-test');
});
it('asks before leaving a draft and navigates only after explicit confirmation', () => {
  render(
    <WorkspaceProvider>
      <Draft />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đổi màn hình' }));
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
  expect(state.push).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đổi màn hình' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rời quy trình' }));
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.dismissTo).toHaveBeenCalledWith('/(tabs)/staff-home');
  expect(state.push).not.toHaveBeenCalled();
});
it('renders four labeled Staff tabs at 60dp and applies Android bottom inset exactly once', () => {
  const view = render(
    <WorkspaceProvider>
      <WorkspaceShell screen="notifications">
        <span>Nội dung</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(4);
  expect(screen.getByRole('tab', { name: 'Thông báo' }).getAttribute('aria-selected')).toBe('true');
  for (const tab of tabs)
    expect((tab.firstElementChild as HTMLElement).style.minHeight).toBe('60px');
  expect(tabs[0].parentElement?.style.paddingBottom).toBe('24px');
  expect(view.container.querySelector('main')?.getAttribute('data-edges')).toBe('top,left,right');
  expect(
    (screen.getByRole('tab', { name: 'Thông báo' }).querySelector('span') as HTMLElement).style
      .color,
  ).toBe('rgb(37, 99, 235)');
});

it.each([
  ['Owner', 'owner-home', ['Tổng quan', 'Cần xử lý', 'Vận hành', 'Tài khoản']],
  ['Staff', 'staff-home', ['Trang chủ', 'Công việc', 'Thông báo', 'Cá nhân']],
  ['Tenant', 'tenant-home', ['Trang chủ', 'Hóa đơn', 'Yêu cầu', 'Cá nhân']],
] as const)('keeps %s destinations in the shared Staff shell', (role, home, labels) => {
  state.roles = [role];
  const view = render(
    <WorkspaceProvider>
      <WorkspaceShell screen={home}>
        <span>Nội dung</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([...labels]);
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  expect((tabs[0].firstElementChild as HTMLElement).style.minHeight).toBe(
    role === 'Tenant' ? '54px' : '60px',
  );
  expect(tabs[0].parentElement?.style.paddingBottom).toBe('24px');
  expect(view.container.querySelector('main')?.style.backgroundColor).toBe(
    role === 'Tenant' ? 'rgb(23, 54, 84)' : 'rgb(25, 54, 83)',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
  if (role === 'Staff') expect(state.dismissTo).toHaveBeenLastCalledWith('/(tabs)/notifications');
  else
    expect(state.push).toHaveBeenLastCalledWith({
      pathname: '/workspace/[screen]',
      params: { screen: 'notifications' },
    });
  fireEvent.click(tabs[1]);
  expect(state.dismissTo).toHaveBeenLastCalledWith(
    `/(tabs)/${role === 'Owner' ? 'approvals' : role === 'Staff' ? 'work-orders' : 'invoice'}`,
  );
});
it('returns to the preceding Staff screen when navigation history exists', () => {
  state.canGoBack.mockReturnValue(true);
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="staff-maintenance">
        <span>Nội dung</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(state.back).toHaveBeenCalledOnce();
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});
it('uses a valid Staff fallback when a detail screen is opened directly', () => {
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="task-detail">
        <span>Nội dung</span>
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(state.replace).toHaveBeenCalledWith('/(tabs)/work-orders');
  expect(state.back).not.toHaveBeenCalled();
});
it('protects an onboarding draft before going back in Staff history', () => {
  state.canGoBack.mockReturnValue(true);
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="onboarding">
        <Draft />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(state.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
  expect(state.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rời quy trình' }));
  expect(state.leave).toHaveBeenCalledOnce();
  expect(state.back).toHaveBeenCalledOnce();
});

it.each(['Owner', 'Staff', 'Tenant'] as const)(
  'registers only %s tabs, lazily, without animation, with Android back to Home',
  (role) => {
    state.roles = [role];
    render(
      <WorkspaceProvider>
        <WorkspaceTabsLayout />
      </WorkspaceProvider>,
    );
    expect(screen.getAllByTestId('tab-route').map((route) => route.textContent)).toEqual(
      tabs[role].map((tab) => tab.screen),
    );
    const navigator = screen.getByTestId('navigator');
    expect(navigator.dataset.animation).toBe('none');
    expect(navigator.dataset.lazy).toBe('true');
    expect(navigator.dataset.back).toBe('firstRoute');
  },
);
function NavigationProbe({
  destination,
  params,
}: {
  destination: WorkspaceScreen;
  params?: Record<string, string>;
}) {
  const { go } = useWorkspace();
  return <button onClick={() => go(destination, params)}>Navigate probe</button>;
}
it('switches sections inside Tabs without pushing, while parameterized invoice links push details', () => {
  state.roles = ['Tenant'];
  state.segments = ['(tabs)', 'tenant-home'];
  const view = render(
    <WorkspaceProvider>
      <NavigationProbe destination="invoice" />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByText('Navigate probe'));
  expect(state.navigate).toHaveBeenCalledWith('/(tabs)/invoice');
  expect(state.push).not.toHaveBeenCalled();
  view.rerender(
    <WorkspaceProvider>
      <NavigationProbe destination="invoice" params={{ invoiceId: 'fixture-invoice' }} />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByText('Navigate probe'));
  expect(state.push).toHaveBeenCalledWith({
    pathname: '/workspace/[screen]',
    params: { screen: 'invoice', invoiceId: 'fixture-invoice' },
  });
});
it('unwinds details to the existing Tabs instance when selecting a section', () => {
  render(
    <WorkspaceProvider>
      <NavigationProbe destination="work-orders" />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByText('Navigate probe'));
  expect(state.dismissTo).toHaveBeenCalledWith('/(tabs)/work-orders');
  expect(state.push).not.toHaveBeenCalled();
});
it.each(['invoiceId', 'focus', 'returnTo'])(
  'keeps a tab-named route on the detail Stack when it has %s',
  (parameter) => {
    expect(isWorkspaceTabDestination('Tenant', 'invoice', { [parameter]: 'fixture' })).toBe(false);
  },
);
it('does not classify another role section as an authorized tab', () => {
  expect(isWorkspaceTabDestination('Tenant', 'work-orders')).toBe(false);
  expect(isWorkspaceTabDestination('Staff', 'invoice')).toBe(false);
});
function navigatorBarProps(index = 0, prevent = false) {
  return {
    state: { index, routes: tabs.Staff.map((tab) => ({ name: tab.screen, key: tab.screen })) },
    descriptors: {},
    insets: { top: 0, bottom: 24, left: 0, right: 0 },
    emitter: { emit: vi.fn(() => ({ defaultPrevented: prevent })) },
    navigateToTab: vi.fn(),
  } as unknown as React.ComponentProps<typeof NavigatorTabBar>;
}
it('uses navigator selection, retains the bar node, and ignores a reselected tab', () => {
  const props = navigatorBarProps();
  const view = render(
    <WorkspaceProvider>
      <NavigatorTabBar {...props} />
    </WorkspaceProvider>,
  );
  const bar = screen.getAllByRole('tab')[0].parentElement;
  fireEvent.click(screen.getByRole('tab', { name: 'Trang chủ' }));
  expect(props.navigateToTab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Công việc' }));
  expect(props.navigateToTab).toHaveBeenCalledExactlyOnceWith('work-orders');
  expect(state.push).not.toHaveBeenCalled();
  view.rerender(
    <WorkspaceProvider>
      <NavigatorTabBar {...props} state={{ ...props.state, index: 1 }} />
    </WorkspaceProvider>,
  );
  expect(screen.getByRole('tab', { name: 'Công việc' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getAllByRole('tab')[0].parentElement).toBe(bar);
});
it('honors prevented tabPress events', () => {
  const props = navigatorBarProps(0, true);
  render(
    <WorkspaceProvider>
      <NavigatorTabBar {...props} />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Công việc' }));
  expect(props.navigateToTab).not.toHaveBeenCalled();
});
it('retains the draft exit guard for navigator tab presses', () => {
  const props = navigatorBarProps();
  render(
    <WorkspaceProvider>
      <Draft />
      <NavigatorTabBar {...props} />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Công việc' }));
  expect(props.navigateToTab).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Rời quy trình' }));
  expect(props.navigateToTab).toHaveBeenCalledExactlyOnceWith('work-orders');
});
it('renders exactly one bar when a screen shell is hosted inside Tabs', () => {
  const props = navigatorBarProps();
  render(
    <WorkspaceProvider>
      <WorkspaceTabsContext.Provider value={true}>
        <WorkspaceShell screen="staff-home">
          <span>Home</span>
        </WorkspaceShell>
        <NavigatorTabBar {...props} />
      </WorkspaceTabsContext.Provider>
    </WorkspaceProvider>,
  );
  expect(screen.getAllByRole('tab')).toHaveLength(4);
});
it('resets mounted account state when the principal changes', () => {
  function LocalState() {
    const [value, setValue] = React.useState('');
    return (
      <input aria-label="Local filter" value={value} onChange={(e) => setValue(e.target.value)} />
    );
  }
  const view = render(
    <WorkspaceProvider>
      <LocalState />
    </WorkspaceProvider>,
  );
  fireEvent.change(screen.getByLabelText('Local filter'), { target: { value: 'private-filter' } });
  state.userId = 'staff-b';
  view.rerender(
    <WorkspaceProvider>
      <LocalState />
    </WorkspaceProvider>,
  );
  expect((screen.getByLabelText('Local filter') as HTMLInputElement).value).toBe('');
});
it('redirects legacy section URLs into Tabs and preserves detail URLs', () => {
  state.roles = ['Tenant'];
  state.params = { screen: 'invoice' };
  const view = render(
    <WorkspaceProvider>
      <WorkspaceRoute />
    </WorkspaceProvider>,
  );
  expect(screen.getByTestId('redirect').textContent).toBe('/(tabs)/invoice');
  state.params = { screen: 'invoice', invoiceId: 'fixture-invoice' };
  view.rerender(
    <WorkspaceProvider>
      <WorkspaceRoute />
    </WorkspaceProvider>,
  );
  expect(screen.queryByTestId('redirect')).toBeNull();
  expect(screen.getByTestId('screen-view').textContent).toBe('invoice');
});

it('does not reset the scroll of a retained, unfocused tab when a detail requests a scroll reset', () => {
  function ResetScroll() {
    const { resetScroll } = useWorkspace();
    return <button onClick={resetScroll}>Reset detail scroll</button>;
  }
  render(
    <WorkspaceProvider>
      <WorkspaceShell screen="staff-home">
        <ResetScroll />
      </WorkspaceShell>
    </WorkspaceProvider>,
  );
  const initialCalls = state.scrollTo.mock.calls.length;
  state.navigation.isFocused.mockReturnValue(false);
  fireEvent.click(screen.getByText('Reset detail scroll'));
  expect(state.scrollTo).toHaveBeenCalledTimes(initialCalls);
});
it('drops a pending draft navigation on logout instead of carrying it into a different role', () => {
  const view = render(
    <WorkspaceProvider>
      <Draft />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByText('\u0110\u1ed5i m\u00e0n h\u00ecnh'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  state.signedIn = false;
  view.rerender(
    <WorkspaceProvider>
      <span>Signed out</span>
    </WorkspaceProvider>,
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  state.signedIn = true;
  state.roles = ['Tenant'];
  view.rerender(
    <WorkspaceProvider>
      <NavigationProbe destination="invoice" />
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByText('Navigate probe'));
  expect(state.dismissTo).toHaveBeenCalledWith('/(tabs)/invoice');
  expect(state.leave).not.toHaveBeenCalled();
});

it('renders the navigator tabBar callback inside a Context.Consumer without calling hooks in the callback', () => {
  state.renderTabBar = true;
  render(
    <WorkspaceProvider>
      <WorkspaceTabsLayout />
    </WorkspaceProvider>,
  );
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
});
