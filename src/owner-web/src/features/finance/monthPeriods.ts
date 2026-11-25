import { businessToday } from '../../../../../packages/client-core/src/contracts';

/**
 * Vietnam-local calendar ranges for date-picker shortcuts.
 * This helper sets filters only; all actual financial calculations remain server-side.
 */
export function financeMonthPeriod(monthOffset: number): { from: string; to: string } {
  const [year, month, day] = businessToday().split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const lastDay =
    monthOffset === 0
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(Date.UTC(year, month + monthOffset, 0));
  return { from: firstDay.toISOString().slice(0, 10), to: lastDay.toISOString().slice(0, 10) };
}
