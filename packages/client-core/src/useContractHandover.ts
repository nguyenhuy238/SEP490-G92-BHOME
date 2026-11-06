import { useEffect, useState } from 'react';
import {
  contractError,
  type ContractClient,
  type HandoverChoices,
  type HandoverHistory,
  type HandoverView,
} from './contracts';

export function useContractHandover(api: ContractClient, id: string, staff: boolean) {
  const [data, setData] = useState<{
    api: ContractClient;
    id: string;
    staff: boolean;
    revision: number;
    record: HandoverView | null;
    history: HandoverHistory[];
    choices: HandoverChoices | null;
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
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
        const [recordValue, history, choices] = await Promise.all([
          record,
          api.handoverHistory(id, c.signal),
          staff ? api.handoverChoices(id, c.signal) : Promise.resolve(null),
        ]);
        if (!c.signal.aborted)
          setData({ api, id, staff, revision, record: recordValue, history, choices });
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [api, id, staff, revision]);
  const current =
    data?.api === api && data.id === id && data.staff === staff && data.revision === revision
      ? data
      : null;
  return { data: current, loading, error, reload: () => setRevision((v) => v + 1) };
}
