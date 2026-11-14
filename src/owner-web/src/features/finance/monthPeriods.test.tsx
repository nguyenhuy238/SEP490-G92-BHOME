import { afterEach, expect, it, vi } from 'vitest';
import { financeMonthPeriod } from './monthPeriods';

afterEach(() => vi.useRealTimers());

it('uses Vietnam calendar dates across the year boundary for shortcuts', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-12-31T18:30:00Z')); // 01/01/2026 in Vietnam
  expect(financeMonthPeriod(-1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  expect(financeMonthPeriod(0)).toEqual({ from: '2026-01-01', to: '2026-01-01' });
});
