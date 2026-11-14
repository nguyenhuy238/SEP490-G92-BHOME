// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-native-paper', () => ({
  TextInput: ({
    label,
    value,
    onChangeText,
    onSelectionChange,
  }: {
    label: string;
    value: string;
    onChangeText: (raw: string) => void;
    onSelectionChange: (event: {
      nativeEvent: { selection: { start: number; end: number } };
    }) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      onSelect={(e) =>
        onSelectionChange({
          nativeEvent: {
            selection: {
              start: e.currentTarget.selectionStart ?? 0,
              end: e.currentTarget.selectionEnd ?? 0,
            },
          },
        })
      }
    />
  ),
}));

import { MoneyTextInput } from '../components/MoneyTextInput';

afterEach(cleanup);

function Harness({ changed, initial = '' }: { changed: (raw: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MoneyTextInput
      label="Số tiền"
      value={value}
      onChangeText={(raw) => {
        setValue(raw);
        changed(raw);
      }}
    />
  );
}

it('groups VND as a mobile user types, keeping exact raw strings', () => {
  const changed = vi.fn();
  render(<Harness changed={changed} />);
  const input = screen.getByLabelText<HTMLInputElement>('Số tiền');
  fireEvent.change(input, { target: { value: '3000' } });
  expect(input.value).toBe('3.000');
  fireEvent.change(input, { target: { value: '3.000000' } });
  expect(input.value).toBe('3.000.000');
  expect(changed).toHaveBeenLastCalledWith('3000000');
  fireEvent.change(input, { target: { value: '9007199254740993' } });
  expect(input.value).toBe('9.007.199.254.740.993');
  expect(changed).toHaveBeenLastCalledWith('9007199254740993');
  fireEvent.change(input, { target: { value: '' } });
  expect(input.value).toBe('');
  expect(changed).toHaveBeenLastCalledWith('');
});

it('rejects fractional VND and removes a digit when deleting a grouping separator', () => {
  const changed = vi.fn();
  render(<Harness changed={changed} initial="1234" />);
  const input = screen.getByLabelText<HTMLInputElement>('Số tiền');
  expect(input.value).toBe('1.234');
  fireEvent.change(input, { target: { value: '1000000.5' } });
  expect(changed).not.toHaveBeenCalled();
  expect(input.value).toBe('1.234');
  fireEvent.change(input, { target: { value: '1234' } });
  expect(input.value).toBe('234');
  expect(changed).toHaveBeenLastCalledWith('234');
});
