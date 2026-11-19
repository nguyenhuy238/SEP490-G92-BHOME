import type { Policy } from '../../../../../packages/client-core/src/invoices';
import { todayVietnam } from '../staff/staffContracts';

export function canEditPolicyInPlace(policy: Policy) {
  return (
    policy.canEditInPlace ??
    (policy.effectiveFrom > todayVietnam() && !policy.firstUsedAt && !policy.lastContractEndDate)
  );
}
