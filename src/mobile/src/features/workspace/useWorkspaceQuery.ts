import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../lib/SessionProvider';
import { conciseMessage, showError } from '../../lib/toast';

// Query identity changes with the URL or session: never retain another account's data.
export function useWorkspaceQuery<T>(path: string | null) {
  const { api } = useSession();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: typeof api;
    path: string;
    revision: number;
    data: T | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!api || !path) return;
    const controller = new AbortController();
    void api.request<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setState({ api, path, revision, data, error: '' });
      },
      (error) => {
        if (!controller.signal.aborted) {
          const message = conciseMessage(errorMessage(error));
          setState({ api, path, revision, data: null, error: message });
          showError(message);
        }
      },
    );
    return () => controller.abort();
  }, [api, path, revision]);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const current =
    state?.api === api && state?.path === path && state?.revision === revision ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? '',
    loading: !!api && !!path && !current,
    reload,
  };
}
