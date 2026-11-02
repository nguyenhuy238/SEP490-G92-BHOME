import { useCallback, useEffect, useState } from 'react';
import { contractError, type Certificate, type ContractClient } from './contracts';

// Scope results to the current client and discard late responses after retry/unmount.
export function useSigningCertificates(api: ContractClient, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: ContractClient;
    revision: number;
    certificates: Certificate[];
    error: string;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void api.certificates(controller.signal).then(
      (certificates) => {
        if (!controller.signal.aborted) setState({ api, revision, certificates, error: '' });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ api, revision, certificates: [], error: contractError(error) });
      },
    );
    return () => controller.abort();
  }, [api, enabled, revision]);
  const current = enabled && state?.api === api && state.revision === revision ? state : null;
  return {
    certificates: current?.certificates ?? [],
    error: current?.error ?? '',
    loading: enabled && !current,
    reload,
  };
}
