import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type {
  ContractPage,
  ContractView,
  HandoverView,
} from '../../../../../packages/client-core/src/contracts';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';

// Select only from the account-scoped server list; route text cannot select another tenancy.
export function useTenantTenancy(withDetails = true) {
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const contracts = useWorkspaceQuery<ContractPage>(
    allowed ? `/api/v1/contracts?page=${page}&pageSize=20&status=Active` : null,
  );
  const items =
    contracts.data?.items.filter((item) => item.status === 'Active' && item.kind !== 'Holding') ??
    [];
  const current = items.find((item) => item.id === selected) ?? items[0];
  const detail = useWorkspaceQuery<ContractView>(
    allowed && withDetails && current
      ? `/api/v1/contracts/${encodeURIComponent(current.id)}`
      : null,
  );
  const handover = useWorkspaceQuery<HandoverView | null>(
    allowed && withDetails && current
      ? `/api/v1/contracts/${encodeURIComponent(current.id)}/handover`
      : null,
  );
  const reloadContracts = contracts.reload,
    reloadDetail = detail.reload,
    reloadHandover = handover.reload;
  useFocusEffect(
    useCallback(() => {
      if (!allowed) return;
      reloadContracts();
      if (withDetails) {
        reloadDetail();
        reloadHandover();
      }
    }, [allowed, withDetails, reloadContracts, reloadDetail, reloadHandover]),
  );
  return { contracts, items, current, detail, handover, page, setPage, select: setSelected };
}
