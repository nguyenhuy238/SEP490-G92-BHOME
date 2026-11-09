import { useCallback, useEffect, useState } from 'react';
import { residenceError, type ResidenceClient, type ResidencePage } from './residence';
export function useResidenceList(api: ResidenceClient, locationId = '', status = '') {
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: ResidenceClient;
    page: number;
    data: ResidencePage | null;
    revision: number;
    locationId: string;
    status: string;
    error: string;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void api.list(page, controller.signal, { locationId, status }).then(
      (data) => {
        if (!controller.signal.aborted)
          setState({ api, page, revision, locationId, status, data, error: '' });
      },
      (failure) => {
        if (!controller.signal.aborted)
          setState({
            api,
            page,
            revision,
            locationId,
            status,
            data: null,
            error: residenceError(failure),
          });
      },
    );
    return () => controller.abort();
  }, [api, page, revision, locationId, status]);
  const current =
    state?.api === api &&
    state.page === page &&
    state.locationId === locationId &&
    state.status === status
      ? state
      : null;
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
