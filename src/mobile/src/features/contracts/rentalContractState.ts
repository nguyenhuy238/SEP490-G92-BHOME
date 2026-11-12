import type {
  ContractView,
  Readiness,
  Signature,
} from '../../../../../packages/client-core/src/contracts';

export const rentalContractSteps = [
  { key: 'preview', label: 'Xem hợp đồng' },
  { key: 'sign', label: 'Ký hợp đồng' },
  { key: 'payment', label: 'Tạo mã QR' },
  { key: 'activate', label: 'Kích hoạt hợp đồng' },
] as const;
export type SignerState = 'unsigned' | 'waiting' | 'signed';
export function signerState(
  signatures: readonly Signature[],
  signerId: string | null,
): SignerState {
  if (!signerId) return 'unsigned';
  const mine = signatures.filter((signature) => signature.signerUserId === signerId);
  if (mine.some((signature) => signature.status === 'Signed')) return 'signed';
  return mine.some((signature) => !['Failed', 'Simulated'].includes(signature.status))
    ? 'waiting'
    : 'unsigned';
}
export function rentalContractState(contract: ContractView, readiness: Readiness | null) {
  const owner = signerState(contract.signatures, contract.ownerSignerId);
  const tenant = signerState(contract.signatures, contract.tenantUserId);
  const signed = owner === 'signed' && tenant === 'signed';
  const active = contract.status === 'Active';
  const depositVerified = !!readiness && /^0(?:\.0+)?$/.test(readiness.remainingDeposit);
  const released = ['PendingSigning', 'PendingActivation', 'Active'].includes(contract.status);
  const current = active || (signed && depositVerified) ? 3 : signed ? 2 : released ? 1 : 0;
  // Completion is based on server state, never on visiting a screen or pressing Next.
  const completed = [
    ...(released ? ['preview'] : []),
    ...(signed ? ['sign'] : []),
    ...(depositVerified ? ['payment'] : []),
    ...(active ? ['activate'] : []),
  ];
  return { owner, tenant, signed, active, depositVerified, current, completed };
}
