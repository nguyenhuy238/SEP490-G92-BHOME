import { useQuery } from '@tanstack/react-query';
import type {
  ContractClient,
  ContractView,
  Readiness,
  HoldingDepositStatus,
} from '../../../../../../packages/client-core/src/contracts';

export function useContractFunds(
  api: ContractClient,
  c: ContractView | undefined,
  actorId: string,
  r?: Readiness | null,
) {
  type FundsResponse =
    HoldingDepositStatus | { required: string; received: string; remaining: string };
  const query = useQuery({
    queryKey: ['contract-detail-funds', actorId, c?.id, c?.status],
    enabled:
      !!c &&
      !c.onboardingDraft &&
      ['Main', 'Holding'].includes(c.kind) &&
      typeof api.transport === 'function',
    retry: false,
    queryFn: ({ signal }) =>
      c!.kind === 'Holding'
        ? api.transport<FundsResponse>(
            `/api/v1/contracts/${encodeURIComponent(c!.id)}/holding-deposit`,
            { signal },
          )
        : api.transport<FundsResponse>(
            `/api/v1/contracts/${encodeURIComponent(c!.id)}/deposit-payment`,
            { signal },
          ),
  });
  const data = query.data;
  const verified =
    data && typeof data === 'object'
      ? 'verified' in data
        ? data.verified
        : 'received' in data
          ? data.received
          : undefined
      : undefined;
  return {
    query,
    required: typeof data?.required === 'string' ? data.required : c?.requiredDeposit,
    verified: typeof verified === 'string' ? verified : r?.verifiedDeposit,
    remaining: typeof data?.remaining === 'string' ? data.remaining : r?.remainingDeposit,
    review: !!(data && 'requiresManualReview' in data && data.requiresManualReview),
  };
}
