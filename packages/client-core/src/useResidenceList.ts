import { useCallback, useEffect, useState } from 'react';
import { residenceError, type ResidenceClient, type ResidencePage } from './residence';
export function useResidenceList(api: ResidenceClient) {
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: ResidenceClient;
    page: number;
    data: ResidencePage | null;
    revision: number;
    error: string;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void api.list(page, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ api, page, revision, data, error: '' });
      },
      (failure) => {
        if (!controller.signal.aborted)
          setState({ api, page, revision, data: null, error: residenceError(failure) });
      },
    );
    return () => controller.abort();
  }, [api, page, revision]);
  const current = state?.api === api && state.page === page ? state : null;
  const loading = current?.revision !== revision;
  return {
    data: current?.data ?? null,
    loading,
    error: loading ? '' : (current?.error ?? ''),
    page,
    setPage,
    reload,
  };
}
