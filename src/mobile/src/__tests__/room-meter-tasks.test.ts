import { expect, it } from 'vitest';
import type { MeterTask } from '../lib/api';
import { groupRoomMeterTasks, roomMeterTasks } from '../features/workspace/roomMeterTasks';

const electric: MeterTask = {
  id: 'electric',
  meterId: 'meter-electric',
  locationId: 'location-a',
  roomId: 'room-a',
  location: 'A',
  room: '101',
  meterCode: 'E101',
  utilityType: 0,
  display: 0,
  decimalPlaces: 2,
  purpose: 1,
  readingDate: '2026-11-04',
  billingPeriod: '2026-11-01',
  status: 0,
  previousValue: '100',
};
const water: MeterTask = { ...electric, id: 'water', meterId: 'meter-water', utilityType: 1 };
it('groups both pending and completed utilities without requiring an order', () => {
  const saved = { ...electric, status: 2, confirmedReadingId: 'reading' };
  expect(roomMeterTasks(water, [saved, water])).toEqual([saved, water]);
  expect(roomMeterTasks(saved, [water])).toEqual([saved, water]);
});
it.each([
  { roomId: 'other' },
  { locationId: 'other' },
  { readingDate: '2026-11-03' },
  { billingPeriod: '2026-10-01' },
  { purpose: 2 },
  { contractId: 'other' },
])('does not mix room identity, dates, periods, purposes or contracts: %j', (change) => {
  expect(roomMeterTasks(electric, [{ ...water, ...change }])).toEqual([electric]);
});
it('keeps multiple meters visible and deduplicates tasks by ID', () => {
  const secondWater = { ...water, id: 'water-2', meterId: 'water-2', meterCode: 'W2' };
  expect(roomMeterTasks(electric, [water, water, secondWater])).toHaveLength(3);
});
it('does not assume that a room needs a missing task or combine legacy payloads by names', () => {
  expect(roomMeterTasks(electric, [])).toEqual([electric]);
  const legacy = { ...electric, roomId: undefined };
  expect(roomMeterTasks(legacy, [water])).toEqual([legacy]);
  expect(groupRoomMeterTasks([legacy, water])).toHaveLength(2);
});
it('excludes cancelled counterparts from required progress and isolates a cancelled selection', () => {
  expect(roomMeterTasks(electric, [{ ...water, status: 3 }])).toEqual([electric]);
  const cancelled = { ...electric, status: 3 };
  expect(roomMeterTasks(cancelled, [water])).toEqual([cancelled]);
});
