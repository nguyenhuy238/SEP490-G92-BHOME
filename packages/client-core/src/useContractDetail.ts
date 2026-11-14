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
export function useContractDetail(
  client: ContractClient,
  id: string,
  role: string,
  refreshIntervalMs = 0,
) {
  const [state, setState] = useState<{
    id: string;
    data: ContractDetail | null;
    error: string;
    loading: boolean;
  }>({ id: '', data: null, error: '', loading: false });
  const [revision, setRevision] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let running = false;
    let pollingEligible = false;
    // All subsequent reads are scoped by a successful contract lookup.
    async function load(background = false) {
      if (running || signal.aborted) return;
      running = true;
      if (!background) setState({ id, data: null, error: '', loading: true });
      try {
        const contract = await client.get(id, signal);
        pollingEligible =
          (contract.kind === 'Holding' || contract.kind === 'Main') &&
          ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status);
        if (contract.kind === 'Main' && contract.onboardingDraft) {
          if (!signal.aborted)
            setState({
              id,
              data: { contract, moveOut: null, readiness: null, history: [] },
              error: '',
              loading: false,
            });
          return;
        }
        const moveOut =
          contract.kind === 'Holding'
            ? null
            : await client.moveOut(id, signal).catch((e: unknown) => {
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
        if (!signal.aborted) {
          setRefreshError('');
          const data = { contract, moveOut, readiness, history };
          setState((previous) =>
            previous.id === id &&
            !previous.loading &&
            !previous.error &&
            JSON.stringify(previous.data) === JSON.stringify(data)
              ? previous
              : { id, data, error: '', loading: false },
          );
        }
      } catch (e) {
        if (!signal.aborted && background) setRefreshError(contractError(e));
        if (!signal.aborted && !background)
          setState({ id, data: null, error: contractError(e), loading: false });
      } finally {
        running = false;
      }
    }
    void load();
    const timer =
      refreshIntervalMs > 0
        ? setInterval(() => {
            if (pollingEligible) void load(true);
          }, refreshIntervalMs)
        : null;
    return () => {
      controller.abort();
      if (timer !== null) clearInterval(timer);
    };
  }, [client, id, role, revision, refreshIntervalMs]);
  return {
    data: state.id === id ? state.data : null,
    error: state.id === id ? state.error : '',
    loading: !!id && (state.id !== id || state.loading),
    reload,
    refreshError,
  };
}
