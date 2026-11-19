import { useCallback, useEffect, useRef, useState } from 'react';
import {
  contractError,
  type ContractClient,
  type HandoverChoices,
  type HandoverHistory,
  type HandoverView,
  type PreviewDocument,
} from './contracts';

export function useContractHandover(api: ContractClient, id: string, staff: boolean, autoRefreshMs = 0) {
  const [data, setData] = useState<{
    api: ContractClient;
    id: string;
    staff: boolean;
    revision: number;
    record: HandoverView | null;
    history: HandoverHistory[];
    choices: HandoverChoices | null;
    documents: PreviewDocument[];
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const latestData = useRef(data);
  latestData.current = data;
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const record = api.handover(id, c.signal).catch((e: unknown) => {
          if (e && typeof e === 'object' && 'status' in e && e.status === 404) return null;
          throw e;
        });
        const [recordValue, history, choices, documents] = await Promise.all([
          record,
          api.handoverHistory(id, c.signal),
          staff ? api.handoverChoices(id, c.signal) : Promise.resolve(null),
          api.handoverDocuments?.(id, c.signal) ?? Promise.resolve([]),
        ]);
        if (!c.signal.aborted)
          setData({ api, id, staff, revision, record: recordValue, history, choices, documents });
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [api, id, staff, revision]);
  useEffect(() => {
    if (!autoRefreshMs || !id || error) return;
    const controller = new AbortController();
    let checking = false;
    const interval = setInterval(() => {
      const previous = latestData.current;
      // A completed handover is immutable. Do not poll an empty or unrelated
      // contract, or interrupt Staff while they are editing a form.
      if (checking || !previous || previous.api !== api || previous.id !== id ||
          previous.revision !== revision ||
          previous.record?.status === 'Confirmed') return;
      checking = true;
      void api.handover(id, controller.signal).then((record) => {
        if (!controller.signal.aborted && latestData.current === previous &&
            JSON.stringify(previous.record) !== JSON.stringify(record)) reload();
      }).catch((failure: unknown) => {
        // An access change must not leave a stale authorized handover visible.
        if (!controller.signal.aborted && [401, 403, 404].includes(
          (failure as { status?: number })?.status ?? 0)) reload();
      }).finally(() => { checking = false; });
    }, autoRefreshMs);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [api, id, autoRefreshMs, reload, revision, error]);
  const current =
    data?.api === api && data.id === id && data.staff === staff && data.revision === revision
      ? data
      : null;
  return { data: current, loading, error, reload };
}
