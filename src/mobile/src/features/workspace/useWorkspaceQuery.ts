import { useCallback, useEffect, useState } from 'react';
import { errorMessage, type MobileApi } from '../../lib/api';
import { useSession } from '../../lib/SessionProvider';
import { conciseMessage, showError } from '../../lib/toast';
import type { QueryPolicy } from '../../lib/queryCache';
import { useCachedWorkspaceQuery } from './useCachedWorkspaceQuery';

// Query identity changes with the URL or session: never retain another account's data.
export function useWorkspaceQuery<T>(
  path: string | null,
  options: {
    load?: (api: MobileApi, path: string, signal: AbortSignal) => Promise<T>;
    notifyError?: boolean;
    cache?: QueryPolicy;
  } = {},
) {
  const cached = useCachedWorkspaceQuery<T>(
    options.cache ? path : null,
    options.cache,
    options.load,
  );
  const uncached = useUncachedWorkspaceQuery<T>(options.cache ? null : path, options);
  return options.cache
    ? cached
    : {
        ...uncached,
        fetching: uncached.loading,
        stale: false,
        updatedAt: 0,
        revalidate: uncached.reload,
      };
}
function useUncachedWorkspaceQuery<T>(
  path: string | null,
  {
    load,
    notifyError = true,
  }: {
    load?: (api: MobileApi, path: string, signal: AbortSignal) => Promise<T>;
    notifyError?: boolean;
  } = {},
) {
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
    void (
      load
        ? load(api, path, controller.signal)
        : api.request<T>(path, { signal: controller.signal })
    ).then(
      (data) => {
        if (!controller.signal.aborted) setState({ api, path, revision, data, error: '' });
      },
      (error) => {
        if (!controller.signal.aborted) {
          const message = conciseMessage(errorMessage(error));
          setState({ api, path, revision, data: null, error: message });
          if (notifyError) showError(message);
        }
      },
    );
    return () => controller.abort();
  }, [api, path, revision, load, notifyError]);
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
