import { useCallback, useEffect, useRef, useState } from 'react';
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
  historyError?: string;
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
    client?: ContractClient;
    role?: string;
  }>({ id: '', data: null, error: '', loading: false });
  const cached = useRef<{
    client: ContractClient;
    id: string;
    role: string;
    data: ContractDetail;
  } | null>(null);
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
      const retainData =
        cached.current?.client === client &&
        cached.current.id === id &&
        cached.current.role === role;
      if (!background) {
        setRefreshError('');
        if (!retainData) setState({ id, client, role, data: null, error: '', loading: true });
      }
      try {
        const contract = await client.get(id, signal);
        pollingEligible =
          (contract.kind === 'Holding' || contract.kind === 'Main') &&
          ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status);
        if (contract.kind === 'Main' && contract.onboardingDraft) {
          if (!signal.aborted) {
            const data = { contract, moveOut: null, readiness: null, history: [] };
            cached.current = { client, id, role, data };
            setState({
              id,
              client,
              role,
              data,
              error: '',
              loading: false,
            });
          }
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
        const canReadReadiness = financial || (role === 'Staff' && contract.kind === 'Main');
        let historyError = '';
        const [readiness, history] = await Promise.all([
          canReadReadiness &&
          ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status)
            ? client.readiness(id, signal)
            : Promise.resolve(null),
          financial && moveOut
            ? client.history(id, signal).catch((error: unknown) => {
                if ([401, 403, 404].includes((error as { status?: number })?.status ?? 0))
                  throw error;
                historyError = contractError(error);
                return [];
              })
            : Promise.resolve([]),
        ]);
        if (!signal.aborted) {
          setRefreshError('');
          const data = { contract, moveOut, readiness, history, historyError };
          cached.current = { client, id, role, data };
          setState((previous) =>
            previous.id === id &&
            previous.client === client &&
            previous.role === role &&
            !previous.loading &&
            !previous.error &&
            JSON.stringify(previous.data) === JSON.stringify(data)
              ? previous
              : { id, client, role, data, error: '', loading: false },
          );
        }
      } catch (e) {
        if (!signal.aborted) {
          const accessLost = [401, 403, 404].includes((e as { status?: number })?.status ?? 0);
          if ((background || retainData) && !accessLost) setRefreshError(contractError(e));
          else {
            cached.current = null;
            setState({ id, client, role, data: null, error: contractError(e), loading: false });
          }
        }
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
  const currentScope = state.id === id && state.client === client && state.role === role;
  return {
    data: currentScope ? state.data : null,
    error: currentScope ? state.error : '',
    loading: !!id && (!currentScope || state.loading),
    reload,
    refreshError,
  };
}
