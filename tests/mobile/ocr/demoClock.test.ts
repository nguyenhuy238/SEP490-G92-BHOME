import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDemoDays,
  demoBusinessNow,
  getDemoClockState,
  setDemoBusinessDate,
  subscribeDemoClock,
} from '../../../packages/client-core/src/demoClock';
import { businessToday, localSchedule } from '../../../packages/client-core/src/contracts';

afterEach(() => {
  setDemoBusinessDate(null);
  vi.useRealTimers();
});

describe('demo business clock', () => {
  it('shifts business dates, not the actual security clock, and restores real time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T18:30:00Z'));
    expect(businessToday()).toBe('2026-11-25');
    const notify = vi.fn();
    const unsubscribe = subscribeDemoClock(notify);
    const state = { enabled: true, simulated: true, businessDate: '2026-11-01', version: 1 };
    expect(setDemoBusinessDate(state)).toBe(true);
    expect(setDemoBusinessDate({ ...state })).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getDemoClockState()).toEqual(state);
    expect(businessToday()).toBe('2026-11-01');
    expect(new Date(demoBusinessNow()).toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(new Date(Date.now()).toISOString()).toBe('2026-11-24T18:30:00.000Z');
    expect(localSchedule('2026-11-01T02:00')).toBe('2026-10-31T19:00:00.000Z');
    expect(() => localSchedule('2026-11-01T01:00')).toThrow();
    setDemoBusinessDate({ ...state, simulated: false, version: 2, businessDate: '2026-11-25' });
    expect(businessToday()).toBe('2026-11-25');
    expect(demoBusinessNow()).toBe(Date.now());
    unsubscribe();
    setDemoBusinessDate(null);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('advances across short months and year boundaries', () => {
    expect(addDemoDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDemoDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
