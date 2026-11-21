import type { ContractView } from '../../../../../packages/client-core/src/contracts';

// A created draft has completed entry steps 1–4. Approval remains Draft until invitation.
export function holdingStage(c: ContractView) {
  if (c.status === 'Active') return 8;
  if (c.status === 'PendingActivation') return 7;
  if (c.status === 'PendingSigning' || c.approvedAt) return 6;
  return 5;
}

export function holdingStageLabel(c: ContractView) {
  if (c.status === 'Active') return 'Đã kích hoạt giữ chỗ';
  if (c.status === 'PendingActivation') return 'Đã hoàn tất ký · Chờ cọc và kích hoạt';
  if (c.status === 'PendingSigning') return 'Chờ hoàn tất ký hợp đồng';
  if (c.status === 'Draft')
    return c.approvedAt ? 'Đã phê duyệt · Chờ gửi lời mời ký' : 'Chờ Owner phê duyệt';
  return null;
}
