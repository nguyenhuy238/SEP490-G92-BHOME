import { useCallback, useEffect, useState } from 'react';
import {
  contractError,
  type ContractClient,
  type ContractView,
  type MoveOut,
  type Readiness,
  type SettlementReview,
} from './contracts';

export interface ContractDetail {
  contract: ContractView;
  moveOut: MoveOut | null;
  readiness: Readiness | null;
  history: SettlementReview[];
}
export function useContractDetail(client: ContractClient, id: string, role: string) {
  const [state, setState] = useState<{
    id: string;
    data: ContractDetail | null;
    error: string;
    loading: boolean;
  }>({ id: '', data: null, error: '', loading: false });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const signal = controller.signal;
    // All subsequent reads are scoped by a successful contract lookup.
    async function load() {
      setState({ id, data: null, error: '', loading: true });
      try {
        const contract = await client.get(id, signal);
        const moveOut = await client.moveOut(id, signal).catch((e: unknown) => {
          if ((e as { status?: number })?.status === 404) return null;
          throw e;
        });
        const financial = role === 'Owner' || role === 'Tenant';
        const [readiness, history] = await Promise.all([
          financial && ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status)
            ? client.readiness(id, signal)
            : Promise.resolve(null),
          financial && moveOut ? client.history(id, signal) : Promise.resolve([]),
        ]);
        if (!signal.aborted)
          setState({
            id,
            data: { contract, moveOut, readiness, history },
            error: '',
            loading: false,
          });
      } catch (e) {
        if (!signal.aborted) setState({ id, data: null, error: contractError(e), loading: false });
      }
    }
    void load();
    return () => controller.abort();
  }, [client, id, role, revision]);
  return {
    data: state.id === id ? state.data : null,
    error: state.id === id ? state.error : '',
    loading: !!id && (state.id !== id || state.loading),
    reload,
  };
}
