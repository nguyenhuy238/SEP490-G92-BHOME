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
  Modal: ({ children, transparent }: { children: React.ReactNode; transparent: boolean }) => (
    <div data-testid={transparent ? 'calendar-popup' : 'opaque-calendar'}>{children}</div>
  ),
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  AppState: {
    addEventListener: (_: string, callback: (value: string) => void) => {
      state.background = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('react-native-paper', () => ({
  useTheme: () => ({ colors: { backdrop: 'black', elevation: { level3: 'white' } } }),
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
vi.mock('react-native-paper-dates', () => {
  const MockPicker = (props: {
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
  };
  return {
    registerTranslation: vi.fn(),
    DatePickerModal: MockPicker,
    DatePickerModalContent: MockPicker,
  };
});
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

it('inserts hyphens while typing a move-out date and lets Backspace remove them', () => {
  function MoveOutDate() {
    const [value, setValue] = React.useState('');
    return (
      <IdentityDateField
        label="Ngày dự kiến trả phòng"
        accessibilityLabel="Ngày dự kiến trả phòng"
        value={value}
        onChange={setValue}
        disabled={false}
        hyphenated
        compactCalendar
      />
    );
  }
  render(<MoveOutDate />);
  const input = screen.getByRole<HTMLInputElement>('textbox');
  for (const [typed, displayed] of [
    ['05', '05-'],
    ['05-11', '05-11-'],
    ['05-11', '05-11'],
    ['05-1', '05-1'],
    ['05112028', '05-11-2028'],
  ]) {
    fireEvent.change(input, { target: { value: typed } });
    expect(input.value).toBe(displayed);
  }
  fireEvent.click(screen.getByLabelText('Chọn Ngày dự kiến trả phòng'));
  expect(screen.getByTestId('calendar-popup')).toBeTruthy();
  expect(state.picker?.date?.getDate()).toBe(5);
  expect(state.picker?.date?.getMonth()).toBe(10);
  fireEvent.click(screen.getByText('Chọn ngày'));
  expect(input.value).toBe('29-02-2028');
});

it('opens an empty move-out calendar on the business date without changing the input', () => {
  const change = vi.fn();
  render(
    <IdentityDateField
      label="Ngày trả phòng"
      accessibilityLabel="Ngày trả phòng"
      value=""
      onChange={change}
      disabled={false}
      hyphenated
      compactCalendar
      calendarDate="2027-02-27"
    />,
  );
  fireEvent.click(screen.getByLabelText('Chọn Ngày trả phòng'));
  expect(state.picker?.date?.getFullYear()).toBe(2027);
  expect(state.picker?.date?.getMonth()).toBe(1);
  expect(state.picker?.date?.getDate()).toBe(27);
  fireEvent.click(screen.getByText('Đóng lịch'));
  expect(change).not.toHaveBeenCalled();
});
