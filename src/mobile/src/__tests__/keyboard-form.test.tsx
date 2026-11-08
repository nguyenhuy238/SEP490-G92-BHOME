// @vitest-environment jsdom
import React, { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.unmock('../components/KeyboardFormScrollView');
const native = vi.hoisted(() => ({
  reveal: vi.fn(),
  listeners: new Set<() => void>(),
  frames: new Map<number, () => void>(),
  sequence: 0,
}));
vi.mock('react-native', () => ({
  Keyboard: {
    addListener: (_: string, cb: () => void) => {
      native.listeners.add(cb);
      return { remove: () => native.listeners.delete(cb) };
    },
  },
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
      scrollResponderScrollNativeHandleToKeyboard: native.reveal,
    }));
    return (
      <div onFocusCapture={() => onFocusCapture({ nativeEvent: { target: 42 } })}>{children}</div>
    );
  }),
}));
import { KeyboardFormScrollView } from '../components/KeyboardFormScrollView';
beforeEach(() => {
  vi.clearAllMocks();
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
it('reveals the focused input after focus and keyboard layout changes and releases listeners on close', () => {
  const view = render(
    <KeyboardFormScrollView>
      <input aria-label="Ghi chú" />
    </KeyboardFormScrollView>,
  );
  fireEvent.focus(screen.getByLabelText('Ghi chú'));
  act(flush);
  expect(native.reveal).toHaveBeenCalledWith(42, 24, true);
  native.reveal.mockClear();
  act(() => native.listeners.forEach((cb) => cb()));
  act(flush);
  expect(native.reveal).toHaveBeenCalledWith(42, 24, true);
  view.unmount();
  expect(native.listeners.size).toBe(0);
  expect(native.frames.size).toBe(0);
});
