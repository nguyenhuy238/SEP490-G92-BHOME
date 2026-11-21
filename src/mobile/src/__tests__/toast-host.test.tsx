// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.unmock('../components/ToastHost');
const native = vi.hoisted(() => ({
  animate: vi.fn(),
  announce: vi.fn(),
  listeners: new Set<(state: string) => void>(),
}));
vi.mock('react-native', () => {
  type Props = {
    children?: React.ReactNode;
    style?: Record<string, unknown> | Record<string, unknown>[];
    testID?: string;
    accessibilityRole?: string;
  };
  const View = ({ children, style, testID, accessibilityRole }: Props) => {
    const merged = Object.assign({}, ...(Array.isArray(style) ? style : [style]));
    return (
      <div
        data-testid={testID}
        role={accessibilityRole === 'alert' ? 'alert' : undefined}
        style={{ top: merged.top as number }}
      >
        {children}
      </div>
    );
  };
  return {
    Platform: { OS: 'android' },
    View,
    StyleSheet: { create: (value: unknown) => value },
    AppState: {
      addEventListener: (_: string, cb: (state: string) => void) => {
        native.listeners.add(cb);
        return { remove: () => native.listeners.delete(cb) };
      },
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      announceForAccessibility: native.announce,
    },
    Animated: {
      View,
      Value: class {
        setValue() {}
        interpolate() {
          return 0;
        }
      },
      timing: (...args: unknown[]) => {
        native.animate(...args);
        return { start: vi.fn(), stop: vi.fn() };
      },
    },
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Icon: () => null,
  IconButton: ({
    onPress,
    accessibilityLabel,
  }: {
    onPress: () => void;
    accessibilityLabel: string;
  }) => <button onClick={onPress} aria-label={accessibilityLabel} />,
}));
import { ToastHost } from '../components/ToastHost';
import { getToastSnapshot, showError, showInfo } from '../lib/toast';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('renders below the safe area, animates, and supports manual dismissal and background cleanup', async () => {
  render(<ToastHost />);
  act(() => showError('Không thể lưu.'));
  expect(screen.getByRole('alert').parentElement?.style.top).toBe('32px');
  expect(screen.getByText('Không thể lưu.')).toBeTruthy();
  await waitFor(() =>
    expect(native.animate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ useNativeDriver: true, toValue: 1 }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
  expect(getToastSnapshot().toast?.closing).toBe(true);
  act(() => native.listeners.forEach((cb) => cb('background')));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('renders a single toast in a native modal host and keeps it on navigation back', () => {
  const view = render(
    <>
      <div data-testid="root">
        <ToastHost />
      </div>
      <div data-testid="modal">
        <ToastHost modal />
      </div>
    </>,
  );
  act(() => showInfo('Đã nhận dữ liệu.'));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(within(screen.getByTestId('modal')).getByRole('alert')).toBeTruthy();
  view.rerender(
    <>
      <div data-testid="root">
        <ToastHost />
      </div>
    </>,
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(within(screen.getByTestId('root')).getByRole('alert')).toBeTruthy();
});
