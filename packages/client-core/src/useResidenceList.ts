import { useCallback, useEffect, useState } from 'react';
import { residenceError, type ResidenceClient, type ResidencePage } from './residence';
export function useResidenceList(api: ResidenceClient) {
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: ResidenceClient;
    page: number;
    data: ResidencePage | null;
    loading: boolean;
    error: string;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      api,
      page,
      data: previous?.api === api && previous.page === page ? previous.data : null,
      loading: true,
      error: '',
    }));
    void api.list(page, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ api, page, data, loading: false, error: '' });
      },
      (failure) => {
        if (!controller.signal.aborted)
          setState({ api, page, data: null, loading: false, error: residenceError(failure) });
      },
    );
    return () => controller.abort();
  }, [api, page, revision]);
  const current = state?.api === api && state.page === page ? state : null;
  return {
    data: current?.data ?? null,
    loading: current?.loading ?? true,
    error: current?.error ?? '',
    page,
    setPage,
    reload,
  };
}
