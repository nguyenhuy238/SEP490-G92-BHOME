import { expect, it } from 'vitest';
import type { MeterTask } from '../lib/api';
import {
  countOverdueMeterRooms,
  groupRoomMeterTasks,
  isOverduePeriodicMeterTask,
  meterRoundLabel,
  roomMeterTasks,
} from '../features/workspace/roomMeterTasks';

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
it('shows only month and year for periodic readings while retaining actual dates for handovers', () => {
  expect(meterRoundLabel({ ...electric, billingPeriod: '2026-12-01' })).toBe('Kỳ 12/2026');
  expect(meterRoundLabel({ ...electric, billingPeriod: null })).toBe('Kỳ 11/2026');
  expect(meterRoundLabel({ ...electric, purpose: 0 })).toBe('Chỉ số ban đầu · 04/11/2026');
  expect(meterRoundLabel({ ...electric, purpose: 2 })).toBe('Chốt trả phòng · 04/11/2026');
});
it('counts overdue rooms once across utility types and periods, ignoring non-periodic or closed tasks', () => {
  const overdue = { ...electric, isOverdue: true };
  expect(
    countOverdueMeterRooms([
      overdue,
      { ...water, isOverdue: true },
      { ...overdue, id: 'previous', billingPeriod: '2026-10-01' },
      { ...overdue, id: 'other', roomId: 'room-b', status: 1 },
      { ...overdue, id: 'closed', roomId: 'room-c', status: 2 },
      { ...overdue, id: 'cancelled', roomId: 'room-d', status: 3 },
      { ...overdue, id: 'handover', roomId: 'room-e', purpose: 0 },
      { ...overdue, id: 'move-out', roomId: 'room-f', purpose: 2 },
    ]),
  ).toBe(2);
  expect(isOverduePeriodicMeterTask(electric)).toBe(false);
});
it('groups both pending and completed utilities without requiring an order', () => {
  const saved = { ...electric, status: 2, confirmedReadingId: 'reading' };
  expect(roomMeterTasks(water, [saved, water])).toEqual([saved, water]);
  expect(roomMeterTasks(saved, [water])).toEqual([saved, water]);
});
it.each([
  { roomId: 'other' },
  { locationId: 'other' },
  { billingPeriod: '2026-10-01' },
  { purpose: 2 },
  { contractId: 'other' },
])('does not mix room identity, periods, purposes or contracts: %j', (change) => {
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

it('groups all periodic utilities by room and billing period regardless of generation source or reading day', () => {
  const automatedElectric = { ...electric, automationPlanId: 'plan-1' };
  const automatedWater = { ...water, automationPlanId: 'plan-2', readingDate: '2026-11-05' };
  expect(roomMeterTasks(automatedElectric, [automatedWater])).toEqual([
    automatedElectric,
    automatedWater,
  ]);
  expect(roomMeterTasks(automatedElectric, [water])).toEqual([automatedElectric, water]);
  expect(groupRoomMeterTasks([automatedElectric, automatedWater, water])).toHaveLength(1);
});
