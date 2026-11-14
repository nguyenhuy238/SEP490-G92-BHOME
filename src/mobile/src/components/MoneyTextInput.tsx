import React, { useState } from 'react';
import { TextInput } from 'react-native-paper';
import type { ComponentProps } from 'react';
import {
  formatMoneyInput,
  moneyEditRange,
  moneyInputCaret,
  parseMoneyPaste,
  tryParseMoneyInput,
} from '../../../../packages/client-core/src/moneyInput';

type Props = Omit<ComponentProps<typeof TextInput>, 'value' | 'onChangeText' | 'keyboardType'> & {
  value: string;
  onChangeText: (raw: string) => void;
};

/** Native VND input preserves the raw decimal string and caret through grouping changes. */
export function MoneyTextInput({ value, onChangeText, ...props }: Props) {
  const display = formatMoneyInput(value);
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  return (
    <TextInput
      {...props}
      keyboardType="number-pad"
      value={display}
      selection={selection}
      onSelectionChange={(event) => {
        setSelection(event.nativeEvent.selection);
        props.onSelectionChange?.(event);
      }}
      onChangeText={(text) => {
        const { start, previousEnd, nextEnd } = moneyEditRange(display, text);
        let next = text;
        let position = nextEnd;
        // Backspace/delete a separator as one edit, rather than restoring it endlessly.
        if (display.slice(start, previousEnd) === '.' && start === nextEnd) {
          const forward = selection?.start === start;
          const remove = forward ? start + 1 : start - 1;
          if (remove >= 0 && remove < display.length) {
            next = display.slice(0, remove) + display.slice(remove + 1);
            position = forward ? start : remove;
          }
        } else if (nextEnd - start > 1 || text.slice(start, nextEnd).includes('.')) {
          // Reject ambiguous pasted amounts; do not silently remove non-grouping punctuation.
          const pasted = parseMoneyPaste(text.slice(start, nextEnd));
          if (pasted === null && parseMoneyPaste(text) === null) return;
        }
        const raw = tryParseMoneyInput(next);
        if (raw === null) return;
        const caret = moneyInputCaret(
          formatMoneyInput(raw),
          next.slice(0, position).replace(/\./g, '').length,
        );
        setSelection({ start: caret, end: caret });
        onChangeText(raw);
      }}
    />
  );
}
