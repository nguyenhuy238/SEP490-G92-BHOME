import { TextField, type TextFieldProps } from '@mui/material';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  formatMoneyInput,
  moneyEditRange,
  moneyInputCaret,
  parseMoneyPaste,
  tryParseMoneyInput,
} from '../../../../../packages/client-core/src/moneyInput';

type MoneyFieldProps = Omit<TextFieldProps, 'type' | 'value' | 'onChange'> & {
  value: string | number;
  onValueChange: (raw: string) => void;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  maxRawLength?: number;
};

/** Keep the displayed grouping separate from the value sent to business logic. */
export function MoneyField({
  value,
  onValueChange,
  allowDecimal = false,
  allowNegative = false,
  maxRawLength,
  slotProps,
  ...props
}: MoneyFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [numericDraft, setNumericDraft] = useState<string | null>(null);
  const rawValue =
    typeof value === 'number' && numericDraft !== null && Number(numericDraft) === value
      ? numericDraft
      : value;
  const display = formatMoneyInput(rawValue, allowDecimal);
  useLayoutEffect(() => {
    if (caret.current !== null) {
      input.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const update = (next: string, position: number) => {
    const raw = tryParseMoneyInput(next, allowDecimal, allowNegative);
    if (raw === null || (maxRawLength !== undefined && raw.length > maxRawLength)) return;
    const logical = next.slice(0, position).replace(/\./g, '').length;
    caret.current = moneyInputCaret(formatMoneyInput(raw, allowDecimal), logical);
    if (typeof value === 'number') setNumericDraft(raw);
    onValueChange(raw);
    // The parent may normalize the amount to a number or retain the same value.
    if (String(rawValue) === raw) {
      input.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  };

  return (
    <TextField
      {...props}
      inputRef={input}
      type="text"
      value={display}
      onBlur={(event) => {
        setNumericDraft(null);
        props.onBlur?.(event);
      }}
      slotProps={{
        ...slotProps,
        htmlInput: (ownerState) => ({
          ...(typeof slotProps?.htmlInput === 'function'
            ? slotProps.htmlInput(ownerState)
            : slotProps?.htmlInput),
          inputMode: allowDecimal ? 'decimal' : 'numeric',
        }),
      }}
      onChange={(event) => {
        const target = event.target as HTMLInputElement;
        const { start, nextEnd } = moneyEditRange(display, target.value);
        const inserted = target.value.slice(start, nextEnd);
        if (inserted.includes('.')) {
          // Grouping is added by this component. Never reinterpret a newly entered
          // fractional amount such as 1000000.5 as 10000005.
          if (inserted === '.' && allowDecimal) {
            update(target.value.slice(0, start) + ',' + target.value.slice(nextEnd), start + 1);
            return;
          }
          const pasted = parseMoneyPaste(target.value, allowDecimal, allowNegative);
          if (pasted === null) return;
          const formatted = formatMoneyInput(pasted, allowDecimal);
          update(formatted, formatted.length);
          return;
        }
        update(target.value, target.selectionStart ?? target.value.length);
      }}
      onPaste={(event) => {
        props.onPaste?.(event);
        if (event.defaultPrevented) return;
        const target = input.current;
        if (!target) return;
        event.preventDefault();
        const pasted = parseMoneyPaste(
          event.clipboardData.getData('text'),
          allowDecimal,
          allowNegative,
        );
        if (pasted === null) return;
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? start;
        const inserted = formatMoneyInput(pasted, allowDecimal);
        update(display.slice(0, start) + inserted + display.slice(end), start + inserted.length);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const target = input.current;
        if (!target || target.selectionStart !== target.selectionEnd) return;
        const position = target.selectionStart ?? 0;
        // Deleting a grouping dot should delete the adjacent digit instead.
        if (event.key === 'Backspace' && display[position - 1] === '.' && position >= 2) {
          event.preventDefault();
          update(display.slice(0, position - 2) + display.slice(position), position - 2);
        } else if (event.key === 'Delete' && display[position] === '.') {
          event.preventDefault();
          update(display.slice(0, position) + display.slice(position + 2), position);
        }
      }}
    />
  );
}
