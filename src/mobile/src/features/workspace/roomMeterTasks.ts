import type { MeterTask } from '../../lib/api';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';

export function meterRoundLabel(task: MeterTask) {
  if (task.purpose === 0)
    return `${task.contractId ? 'Khởi tạo cho hợp đồng' : 'Chỉ số ban đầu'} · ${displayContractDate(task.readingDate)}`;
  if (task.purpose === 2) return `Chốt trả phòng · ${displayContractDate(task.readingDate)}`;
  const period = task.billingPeriod ?? task.readingDate;
  return `Kỳ ${period.slice(5, 7)}/${period.slice(0, 4)}`;
}

function roundKey(task: MeterTask) {
  // Never group rooms by their display names, even on older API payloads.
  if (!task.roomId || !task.locationId) return task.id;
  // Periodic readings belong to the room and billing period, regardless of
  // generation source (legacy/demo records may lack an automation plan ID).
  if (task.purpose === 1 && task.billingPeriod && !task.contractId)
    return JSON.stringify([task.locationId, task.roomId, 'periodic', task.billingPeriod]);
  return JSON.stringify([
    task.locationId,
    task.roomId,
    task.purpose,
    task.readingDate,
    task.billingPeriod,
    task.contractId ?? null,
  ]);
}

export function groupRoomMeterTasks(tasks: MeterTask[]) {
  const groups = new Map<string, MeterTask[]>();
  for (const task of tasks) {
    const key = roundKey(task);
    const group = groups.get(key) ?? [];
    if (!group.some((t) => t.id === task.id)) group.push(task);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function isOverduePeriodicMeterTask(task: MeterTask): boolean {
  return (
    task.purpose === 1 &&
    !!task.billingPeriod &&
    task.status !== 2 &&
    task.status !== 3 &&
    task.isOverdue === true
  );
}

export function countOverdueMeterRooms(tasks: MeterTask[]): number {
  return new Set(
    tasks
      .filter((task) => isOverduePeriodicMeterTask(task) && task.roomId && task.locationId)
      .map((task) => JSON.stringify([task.locationId, task.roomId])),
  ).size;
}

export function roomMeterTasks(selected: MeterTask, candidates: MeterTask[]) {
  if (selected.status === 3) return [selected];
  const scoped = candidates.filter(
    (task) => roundKey(task) === roundKey(selected) && task.status !== 3,
  );
  const tasks = new Map(scoped.map((task) => [task.id, task]));
  tasks.set(selected.id, selected);
  return [...tasks.values()].sort(
    (a, b) => a.utilityType - b.utilityType || a.meterCode.localeCompare(b.meterCode),
  );
}
