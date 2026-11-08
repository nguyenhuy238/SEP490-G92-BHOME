import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type {
  ContractPage,
  ContractView,
  HandoverView,
} from '../../../../../packages/client-core/src/contracts';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import {
  loadTenantRoomPage,
  loadTenantRoomContract,
  loadTenantRoomHandover,
} from '../../services/tenantRoom';

// Select only from the account-scoped server list; route text cannot select another tenancy.
export function useTenantTenancy(withDetails = true) {
  const { session, api } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const [pagination, setPagination] = useState({ api, page: 1 });
  const page = pagination.api === api ? pagination.page : 1;
  const setPage = (next: number) => setPagination({ api, page: next });
  const [selection, setSelection] = useState({ api, id: '' });
  const selected = selection.api === api ? selection.id : '';
  const select = (id: string) => setSelection({ api, id });
  const contracts = useWorkspaceQuery<ContractPage>(
    allowed ? `/api/v1/contracts?page=${page}&pageSize=20&status=Active` : null,
    withDetails ? { load: loadTenantRoomPage, notifyError: false } : undefined,
  );
  const items =
    contracts.data?.items.filter((item) => item.status === 'Active' && item.kind !== 'Holding') ??
    [];
  const current =
    items.find((item) => item.id === selected) ??
    (!selected && (!withDetails || (items.length === 1 && (contracts.data?.totalCount ?? 0) <= 20))
      ? items[0]
      : undefined);
  // Remember the single automatic choice before a later response can replace it.
  // A removed choice remains selected until the user explicitly chooses again.
  if (withDetails && !selected && current) setSelection({ api, id: current.id });
  const detail = useWorkspaceQuery<ContractView>(
    allowed && withDetails && current
      ? `/api/v1/contracts/${encodeURIComponent(current.id)}`
      : null,
    withDetails ? { load: loadTenantRoomContract, notifyError: false } : undefined,
  );
  const handover = useWorkspaceQuery<HandoverView | null>(
    allowed &&
      withDetails &&
      current &&
      detail.data?.id === current.id &&
      detail.data.status === 'Active'
      ? `/api/v1/contracts/${encodeURIComponent(current.id)}/handover`
      : null,
    { load: loadTenantRoomHandover, notifyError: false },
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
  const reload = useCallback(() => {
    reloadContracts();
    reloadDetail();
    reloadHandover();
  }, [reloadContracts, reloadDetail, reloadHandover]);
  return {
    contracts,
    items,
    current,
    detail,
    handover,
    page,
    setPage,
    select,
    selected,
    reload,
    selectionUnavailable: !!selected && !!contracts.data && !current,
  };
}
