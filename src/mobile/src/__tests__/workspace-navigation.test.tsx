// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  leave: vi.fn(),
  roles: ['Staff'],
  signedIn: true,
}));
vi.mock('expo-router', () => ({ router: { push: state.push, replace: state.replace } }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: state.signedIn ? { roles: state.roles } : null }),
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
    ScrollView: forwardRef(function Scroll({ children }: { children?: React.ReactNode }, ref) {
      useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
      return <div>{children}</div>;
    }),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
  SafeAreaView: ({ children, edges }: { children?: React.ReactNode; edges: string[] }) => (
    <main data-edges={edges.join(',')}>{children}</main>
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
beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  state.roles = ['Staff'];
  state.signedIn = true;
  vi.clearAllMocks();
});
afterEach(cleanup);
it.each(['Owner', 'Staff'])('opens the OCR test directly from the %s development home', (role) => {
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
  expect(state.push).toHaveBeenCalledOnce();
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
  for (const tab of tabs) expect((tab.firstElementChild as HTMLElement).style.height).toBe('60px');
  expect(tabs[0].parentElement?.style.paddingBottom).toBe('24px');
  expect(view.container.querySelector('main')?.getAttribute('data-edges')).toBe('top,left,right');
  expect(
    (screen.getByRole('tab', { name: 'Thông báo' }).querySelector('span') as HTMLElement).style
      .color,
  ).toBe('rgb(37, 99, 235)');
});
