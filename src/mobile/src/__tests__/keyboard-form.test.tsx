// @vitest-environment jsdom
import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.unmock('../components/KeyboardFormScrollView');
const native = vi.hoisted(() => ({
  scrollTo: vi.fn(),
  measure: vi.fn((_target: number, callback: (...values: number[]) => void) =>
    callback(0, 450, 200, 60),
  ),
  listeners: new Map<
    string,
    Set<(event?: { endCoordinates: { screenY: number } }) => void>
  >(),
  frames: new Map<number, () => void>(),
  sequence: 0,
}));
vi.mock('react-native', () => ({
  Keyboard: {
    addListener: (
      name: string,
      cb: (event?: { endCoordinates: { screenY: number } }) => void,
    ) => {
      const listeners = native.listeners.get(name) ?? new Set();
      listeners.add(cb);
      native.listeners.set(name, listeners);
      return { remove: () => listeners.delete(cb) };
    },
  },
  UIManager: { measureInWindow: native.measure },
  ScrollView: forwardRef(function Scroll(
    {
      children,
      onFocusCapture,
    }: {
      children: React.ReactNode;
      onFocusCapture: (event: { nativeEvent: { target: number } }) => void;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      scrollTo: native.scrollTo,
    }));
    return (
      <div onFocusCapture={() => onFocusCapture({ nativeEvent: { target: 42 } })}>{children}</div>
    );
  }),
}));
import { KeyboardFormScrollView } from '../components/KeyboardFormScrollView';
beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
  native.frames.clear();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    const id = ++native.sequence;
    native.frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => native.frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const flush = () => {
  const callbacks = [...native.frames.values()];
  native.frames.clear();
  callbacks.forEach((cb) => cb());
};
const flushLayout = () => {
  flush();
  flush();
};
it('reveals the focused input after focus and keyboard layout changes and releases listeners on close', () => {
  const view = render(
    <KeyboardFormScrollView>
      <input aria-label="Ghi chú" />
    </KeyboardFormScrollView>,
  );
  fireEvent.focus(screen.getByLabelText('Ghi chú'));
  act(flushLayout);
  expect(native.scrollTo).not.toHaveBeenCalled();
  act(() =>
    native.listeners
      .get('keyboardDidShow')
      ?.forEach((cb) => cb({ endCoordinates: { screenY: 500 } })),
  );
  act(flushLayout);
  expect(native.measure).toHaveBeenCalledWith(42, expect.any(Function));
  expect(native.scrollTo).toHaveBeenCalledWith({ y: 26, animated: true });
  native.scrollTo.mockClear();
  act(() =>
    native.listeners
      .get('keyboardDidChangeFrame')
      ?.forEach((cb) => cb({ endCoordinates: { screenY: 540 } })),
  );
  act(flushLayout);
  expect(native.scrollTo).not.toHaveBeenCalled();
  act(() => native.listeners.get('keyboardDidHide')?.forEach((cb) => cb()));
  view.unmount();
  expect([...native.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  expect(native.frames.size).toBe(0);
});
