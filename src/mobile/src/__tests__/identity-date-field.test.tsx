// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  picker: null as { locale: string; mode: string; date?: Date } | null,
  background: null as ((state: string) => void) | null,
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppState: {
    addEventListener: (_: string, callback: (value: string) => void) => {
      state.background = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('react-native-paper', () => ({
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    disabled,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
      disabled={disabled}
    />
  ),
  IconButton: ({
    accessibilityLabel,
    onPress,
    disabled,
  }: {
    accessibilityLabel: string;
    onPress: () => void;
    disabled: boolean;
  }) => <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled} />,
}));
vi.mock('react-native-paper-dates', () => ({
  registerTranslation: vi.fn(),
  DatePickerModal: (props: {
    locale: string;
    mode: string;
    date?: Date;
    onConfirm: (params: { date?: Date }) => void;
    onDismiss: () => void;
  }) => {
    state.picker = props;
    return (
      <div role="dialog">
        <button onClick={() => props.onConfirm({ date: new Date(2028, 1, 29) })}>Chọn ngày</button>
        <button onClick={props.onDismiss}>Đóng lịch</button>
      </div>
    );
  },
}));
import { IdentityDateField } from '../components/IdentityDateField';

beforeEach(() => {
  state.picker = null;
  state.background = null;
});
afterEach(cleanup);
function mount(value = '20/05/1995', disabled = false) {
  const change = vi.fn();
  render(
    <IdentityDateField
      label="Ngày sinh *"
      accessibilityLabel="Ngày sinh"
      value={value}
      onChange={change}
      onBlur={vi.fn()}
      disabled={disabled}
      error={false}
    />,
  );
  return change;
}
it('opens the Vietnamese library picker at the entered birthday and returns a local dd/MM/yyyy date', () => {
  const change = mount();
  fireEvent.click(screen.getByLabelText('Chọn Ngày sinh'));
  expect(state.picker).toMatchObject({ mode: 'single', locale: 'vi' });
  expect(state.picker?.date?.getFullYear()).toBe(1995);
  expect(state.picker?.date?.getMonth()).toBe(4);
  expect(state.picker?.date?.getDate()).toBe(20);
  fireEvent.click(screen.getByText('Chọn ngày'));
  expect(change).toHaveBeenCalledExactlyOnceWith('29/02/2028');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['', '31/02/2026'])(
  'does not normalize an invalid or empty manual value (%s) and cancel keeps the form unchanged',
  (value) => {
    const change = mount(value);
    fireEvent.click(screen.getByLabelText('Chọn Ngày sinh'));
    expect(state.picker?.date).toBeUndefined();
    fireEvent.click(screen.getByText('Đóng lịch'));
    expect(change).not.toHaveBeenCalled();
  },
);
it('retains manual date entry', () => {
  const change = mount();
  fireEvent.change(screen.getByLabelText('Ngày sinh'), { target: { value: '02/03/1990' } });
  expect(change).toHaveBeenCalledWith('02/03/1990');
});
it('prevents opening the picker while disabled', () => {
  mount('', true);
  fireEvent.click(screen.getByLabelText('Chọn Ngày sinh'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('closes the identity calendar when the app goes to the background', () => {
  const change = mount();
  fireEvent.click(screen.getByLabelText('Chọn Ngày sinh'));
  act(() => state.background?.('background'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
