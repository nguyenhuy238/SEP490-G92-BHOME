import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MoneyField } from './MoneyField';
import {
  formatMoneyInput,
  moneyEditRange,
  moneyInputCaret,
  parseMoneyPaste,
  tryParseMoneyInput,
} from '../../../../../packages/client-core/src/moneyInput';

describe('Vietnamese money inputs', () => {
  it('keeps exact integer and decimal strings, including trailing decimals', () => {
    expect(formatMoneyInput('9007199254740993')).toBe('9.007.199.254.740.993');
    expect(formatMoneyInput('12345678901234.0001', true)).toBe('12.345.678.901.234,0001');
    expect(tryParseMoneyInput('12.345.678.901.234,0001', true)).toBe('12345678901234.0001');
    expect(tryParseMoneyInput('3.000,', true)).toBe('3000.');
    expect(tryParseMoneyInput('0003')).toBe('3');
    expect(tryParseMoneyInput('')).toBe('');
    expect(tryParseMoneyInput('-3.000')).toBeNull();
    expect(tryParseMoneyInput('-3.000', false, true)).toBe('-3000');
  });

  it('only accepts unambiguous pasted amounts', () => {
    expect(parseMoneyPaste('3.000.000')).toBe('3000000');
    expect(parseMoneyPaste('3000000')).toBe('3000000');
    expect(parseMoneyPaste('3.000,1250', true)).toBe('3000.1250');
    expect(parseMoneyPaste('3000.1250', true)).toBe('3000.1250');
    expect(parseMoneyPaste('1.5')).toBeNull();
    expect(parseMoneyPaste('3,000,000')).toBeNull();
    expect(parseMoneyPaste('3 triệu')).toBeNull();
  });

  function Harness({
    initial = '',
    decimal = false,
    changed = () => {},
  }: {
    initial?: string;
    decimal?: boolean;
    changed?: (raw: string) => void;
  }) {
    const [raw, setRaw] = useState(initial);
    return (
      <MoneyField
        label="Số tiền"
        value={raw}
        allowDecimal={decimal}
        maxRawLength={18}
        onValueChange={(next) => {
          setRaw(next);
          changed(next);
        }}
      />
    );
  }

  it('groups as the owner types and clears without changing the raw payload', () => {
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    const input = screen.getByRole('textbox', { name: 'Số tiền' });
    fireEvent.change(input, { target: { value: '3000' } });
    expect(input).toHaveValue('3.000');
    fireEvent.change(input, { target: { value: '3.0000' } });
    expect(input).toHaveValue('30.000');
    fireEvent.change(input, { target: { value: '30.00000' } });
    expect(input).toHaveValue('3.000.000');
    expect(changed).toHaveBeenLastCalledWith('3000000');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    expect(changed).toHaveBeenLastCalledWith('');
    fireEvent.change(input, { target: { value: '1000000.5' } });
    expect(input).toHaveValue('');
    expect(changed).toHaveBeenLastCalledWith('');
  });

  it('preserves a middle caret and deletes a digit when backspacing a grouping dot', () => {
    const changed = vi.fn();
    render(<Harness initial="1234567" changed={changed} />);
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Số tiền' });
    input.focus();
    fireEvent.change(input, { target: { value: '1.2934.567', selectionStart: 4 } });
    expect(input).toHaveValue('12.934.567');
    expect(input.selectionStart).toBe(4);
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input).toHaveValue('1.934.567');
    expect(changed).toHaveBeenLastCalledWith('1934567');
    expect(input.selectionStart).toBe(1);
  });

  it('supports pasted localized and raw decimal amounts and rejects invalid paste', () => {
    const changed = vi.fn();
    render(<Harness initial="0" decimal changed={changed} />);
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Số tiền' });
    input.focus();
    input.select();
    fireEvent.paste(input, { clipboardData: { getData: () => '3000.1250' } });
    expect(input).toHaveValue('3.000,1250');
    expect(changed).toHaveBeenLastCalledWith('3000.1250');
    input.select();
    fireEvent.paste(input, { clipboardData: { getData: () => '3,000,000' } });
    expect(input).toHaveValue('3.000,1250');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('maps the native edit range and grouping caret independently of display punctuation', () => {
    expect(moneyEditRange('1.234', '1234')).toEqual({ start: 1, previousEnd: 2, nextEnd: 1 });
    expect(moneyInputCaret('1.234.567', 4)).toBe(5);
  });
});
