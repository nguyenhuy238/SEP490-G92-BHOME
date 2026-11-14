import { expect, it } from 'vitest';
import type { ContractView } from '../../../../packages/client-core/src/contracts';
import { holdingStage, holdingStageLabel } from '../features/contracts/holdingStage';

it.each([
  ['Draft', null, 5, 'Chờ Owner phê duyệt'],
  ['Draft', '2026-11-13T00:00:00Z', 6, 'Đã phê duyệt · Chờ gửi lời mời ký'],
  ['PendingSigning', '2026-11-13T00:00:00Z', 6, 'Chờ hoàn tất ký hợp đồng'],
  ['PendingActivation', '2026-11-13T00:00:00Z', 7, 'Đã hoàn tất ký · Chờ cọc và kích hoạt'],
  ['Active', '2026-11-13T00:00:00Z', 8, 'Đã kích hoạt giữ chỗ'],
] as const)(
  'derives %s progress from persisted contract and approval',
  (status, approvedAt, step, label) => {
    const contract = { status, approvedAt } as ContractView;
    expect(holdingStage(contract)).toBe(step);
    expect(holdingStageLabel(contract)).toBe(label);
    expect(holdingStage({ ...contract })).toBe(step);
  },
);
