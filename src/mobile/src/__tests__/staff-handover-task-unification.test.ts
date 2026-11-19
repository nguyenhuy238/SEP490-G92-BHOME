import { describe, expect, it } from 'vitest';
import {
  isEmbeddedInitialMeterTask,
  isEmbeddedMoveInInventory,
  isMainMoveInWork,
  type OperationalTask,
} from '../services/operationalTasks';

const base: OperationalTask = {
  id: '10000000-0000-4000-8000-000000000000',
  locationId: '20000000-0000-4000-8000-000000000000',
  kind: 'AdHoc',
  title: 'Bàn giao vào phòng TEST-101',
  requirements: '',
  priority: 'Normal',
  dueAt: null,
  evidenceRequired: true,
  status: 'Assigned',
  isOverdue: false,
  currentResponsibleStaffUserId: null,
  responsibilityAvailable: true,
  result: null,
  version: 1,
  verifiedAt: null,
  target: {
    roomId: '30000000-0000-4000-8000-000000000000',
    assetId: null,
    commonArea: null,
    label: 'TEST-101',
    contractId: '40000000-0000-4000-8000-000000000000',
  },
};

describe('Staff move-in work card grouping', () => {
  it('keeps only the canonical handover work card and exposes its contract', () => {
    const inventory: OperationalTask = {
      ...base, id: '50000000-0000-4000-8000-000000000000',
      title: 'Kiểm kê trước nhận phòng TEST-101', kind: 'MoveInInventory',
    };
    const electricity: OperationalTask = {
      ...base, id: '60000000-0000-4000-8000-000000000000',
      title: 'Chụp chỉ số điện khi nhận phòng TEST-101', kind: 'MeterReading',
      target: null,
    };
    const water: OperationalTask = {
      ...electricity, id: '70000000-0000-4000-8000-000000000000',
      title: 'Chụp chỉ số nước khi nhận phòng TEST-101',
    };
    expect(isMainMoveInWork(base)).toBe(true);
    expect(isEmbeddedMoveInInventory(inventory)).toBe(true);
    expect(isEmbeddedInitialMeterTask(electricity)).toBe(true);
    expect(isEmbeddedInitialMeterTask(water)).toBe(true);
    const visible = [inventory, base, electricity, water].filter((task) =>
      !isEmbeddedMoveInInventory(task) && !isEmbeddedInitialMeterTask(task));
    expect(visible.map((task) => task.id)).toEqual([base.id]);
    expect(visible[0]?.target?.contractId).toBe(base.target?.contractId);
  });

  it('does not hide ordinary meter work, unrelated operational tasks, or other inventory', () => {
    const routineMeter = {
      ...base, kind: 'MeterReading', title: 'Ghi chỉ số điện tháng 11',
    } as OperationalTask;
    const ordinary = {
      ...base, title: 'Kiểm tra đèn hành lang',
      target: { ...base.target!, contractId: null },
    };
    const otherInventory = { ...base, kind: 'MoveInInventory', target: null } as OperationalTask;
    expect(isEmbeddedInitialMeterTask(routineMeter)).toBe(false);
    expect(isMainMoveInWork(ordinary)).toBe(false);
    expect(isEmbeddedMoveInInventory(otherInventory)).toBe(false);
  });
});
