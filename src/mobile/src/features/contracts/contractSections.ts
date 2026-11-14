import {
  contractActions,
  type ContractSummary,
} from '../../../../../packages/client-core/src/contracts';

export function mobileContractActions(...args: Parameters<typeof contractActions>) {
  return contractActions(...args).filter(
    (action) => !['move-out/inspection', 'move-out/settlement'].includes(action.operation),
  );
}

export const contractSections = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'signing', label: 'Ký & kích hoạt' },
  { id: 'handover', label: 'Bàn giao' },
  { id: 'lifecycle', label: 'Gia hạn & trả phòng' },
  { id: 'history', label: 'Lịch sử' },
] as const;
export type ContractSection = (typeof contractSections)[number]['id'];

export function groupContracts(items: ContractSummary[]) {
  const groups = [
    { id: 'draft', title: '1. Hồ sơ nháp', items: [] as ContractSummary[] },
    { id: 'waiting', title: '2. Chờ ký / kích hoạt', items: [] as ContractSummary[] },
    { id: 'active', title: '3. Đang thuê', items: [] as ContractSummary[] },
    { id: 'renewal', title: '4. Bản gia hạn', items: [] as ContractSummary[] },
    { id: 'closed', title: '5. Đã kết thúc / hủy', items: [] as ContractSummary[] },
  ];
  for (const contract of items) {
    const index = ['Terminated', 'Superseded', 'Cancelled'].includes(contract.status)
      ? 4
      : contract.kind === 'Renewal'
        ? 3
        : contract.onboardingDraft || contract.status === 'Draft'
          ? 0
          : ['PendingSigning', 'PendingActivation'].includes(contract.status)
            ? 1
            : 2;
    groups[index]!.items.push(contract);
  }
  return groups.filter((group) => group.items.length > 0);
}

export function contractActionSection(operation: string): ContractSection {
  if (
    ['renewals', 'renewal-cancellation', 'termination-requests', 'expiry-move-out'].includes(
      operation,
    ) ||
    operation.startsWith('move-out/')
  )
    return 'lifecycle';
  if (
    operation.startsWith('signing') ||
    operation.startsWith('holding-') ||
    ['activate', 'deposit-verifications', 'cancel'].includes(operation)
  )
    return 'signing';
  return 'overview';
}
