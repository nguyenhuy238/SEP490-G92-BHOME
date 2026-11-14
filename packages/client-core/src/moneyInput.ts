/** Raw amounts use ASCII digits and a decimal point; display uses Vietnamese separators. */
export function formatMoneyInput(raw: string | number, allowDecimal = false): string {
  const value = String(raw);
  if (!/^-?\d*(?:\.\d*)?$/.test(value)) return '';
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return allowDecimal && fraction !== undefined ? grouped + ',' + fraction : grouped;
}

export function tryParseMoneyInput(
  display: string,
  allowDecimal = false,
  allowNegative = false,
): string | null {
  const value = display.trim();
  const allowed = allowDecimal ? /^-?[\d.]*,?\d*$/ : /^-?[\d.]*$/;
  if (!allowed.test(value) || (!allowNegative && value.startsWith('-'))) return null;
  const raw = value
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/^(-?)0+(?=\d)/, '$1');
  if (raw.startsWith('.')) return '0' + raw;
  if (raw.startsWith('-.')) return '-0' + raw.slice(1);
  return raw;
}

/** Paste accepts ungrouped digits, Vietnamese grouping and unambiguous raw decimal strings. */
export function parseMoneyPaste(
  text: string,
  allowDecimal = false,
  allowNegative = false,
): string | null {
  const value = text.trim();
  if (!allowNegative && value.startsWith('-')) return null;
  if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(value))
    return tryParseMoneyInput(value, allowDecimal, allowNegative);
  if (allowDecimal && /^-?\d+\.\d+$/.test(value)) return value.replace(/^(-?)0+(?=\d)/, '$1');
  return null;
}

/** Infer the edit range when a native input supplies only the changed text. */
export function moneyEditRange(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let previousEnd = before.length;
  let nextEnd = after.length;
  while (previousEnd > start && nextEnd > start && before[previousEnd - 1] === after[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return { start, previousEnd, nextEnd };
}

export function parseMoneyInput(
  display: string,
  allowDecimal = false,
  allowNegative = false,
): string {
  return tryParseMoneyInput(display, allowDecimal, allowNegative) ?? '';
}

/** Translate a caret by counting meaningful characters, ignoring grouping dots. */
export function moneyInputCaret(display: string, logicalPosition: number): number {
  if (logicalPosition <= 0) return 0;
  let logical = 0;
  for (let i = 0; i < display.length; i += 1) {
    if (display[i] !== '.') logical += 1;
    if (logical === logicalPosition) return i + 1;
  }
  return display.length;
}
