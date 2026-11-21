// @vitest-environment jsdom
import React, { forwardRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.unmock('../components/KeyboardFormScrollView');
type Handlers = Record<string, (event?: unknown) => unknown>;
const native = vi.hoisted(() => ({ pad: null as Handlers | null }));
vi.mock('react-native', () => ({
  Keyboard: { addListener: () => ({ remove: () => {} }) },
  UIManager: { measureInWindow: () => {} },
  ScrollView: forwardRef(function Scroll({
    children,
    scrollEnabled,
  }: {
    children: React.ReactNode;
    scrollEnabled?: boolean;
  }) {
    return (
      <div data-testid="page" data-scroll={String(scrollEnabled !== false)}>
        {children}
      </div>
    );
  }),
  View: ({
    children,
    accessibilityLabel,
    ...props
  }: Handlers & { children?: React.ReactNode; accessibilityLabel?: string }) => {
    if (accessibilityLabel) native.pad = props;
    return <div aria-label={accessibilityLabel}>{children}</div>;
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
import { KeyboardFormScrollView } from '../components/KeyboardFormScrollView';
import { SignaturePad } from '../features/contracts/SignaturePad';

afterEach(cleanup);
const at = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } });

it('locks page scrolling while a stroke is drawn and publishes the drawing on release', () => {
  const onChange = vi.fn();
  render(
    <KeyboardFormScrollView>
      <SignaturePad onChange={onChange} />
    </KeyboardFormScrollView>,
  );
  const pad = () => native.pad!;
  act(() => void pad().onLayout({ nativeEvent: { layout: { width: 300 } } }));
  expect(pad().onStartShouldSetResponder()).toBe(true);
  expect(pad().onResponderTerminationRequest()).toBe(false);
  expect(screen.getByTestId('page').dataset.scroll).toBe('true');

  act(() => void pad().onResponderGrant(at(10, 100)));
  // A vertical stroke draws instead of scrolling the page.
  expect(screen.getByTestId('page').dataset.scroll).toBe('false');
  for (let y = 95; y >= 60; y -= 5) act(() => void pad().onResponderMove(at(12, y)));
  expect(onChange).not.toHaveBeenCalled();

  act(() => void pad().onResponderRelease());
  expect(screen.getByTestId('page').dataset.scroll).toBe('true');
  const drawing = onChange.mock.calls.at(-1)![0];
  expect(drawing).toMatchObject({ width: 300, height: 200 });
  expect(drawing.strokes).toHaveLength(1);
  expect(drawing.strokes[0]).toHaveLength(9);
});

it('unlocks scrolling when the system takes the touch away mid-stroke', () => {
  render(
    <KeyboardFormScrollView>
      <SignaturePad onChange={() => {}} />
    </KeyboardFormScrollView>,
  );
  act(() => void native.pad!.onResponderGrant(at(10, 10)));
  expect(screen.getByTestId('page').dataset.scroll).toBe('false');
  act(() => void native.pad!.onResponderTerminate());
  expect(screen.getByTestId('page').dataset.scroll).toBe('true');
});

it('does not take the touch while signing is busy', () => {
  render(<SignaturePad onChange={() => {}} disabled />);
  expect(native.pad!.onStartShouldSetResponder()).toBe(false);
});
