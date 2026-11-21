import { useEffect, useState } from 'react';
import {
  contractError,
  type ContractClient,
  type ContractConfiguration,
  type NamedOption,
  type Preparation,
} from './contracts';

export function useContractPreparation(api: ContractClient, location: string, owner: boolean) {
  const [data, setData] = useState<{
    configuration: ContractConfiguration;
    preparation: Preparation;
    accounts: NamedOption[];
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
        const [configuration, preparation, accounts] = await Promise.all([
          api.configuration(c.signal),
          api.preparation(location, c.signal),
          owner ? api.tenantAccounts(c.signal) : Promise.resolve([]),
        ]);
        if (!c.signal.aborted) setData({ configuration, preparation, accounts });
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [api, location, owner, revision]);
  return { data, loading, error, reload: () => setRevision((v) => v + 1) };
}
