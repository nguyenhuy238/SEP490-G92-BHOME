import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type MobileApi } from '../../lib/api';
import type { QueryPolicy } from '../../lib/queryCache';
import { conciseMessage } from '../../lib/toast';

const idle = {
  data: undefined,
  hasData: false,
  error: null,
  fetching: false,
  invalidated: false,
  updatedAt: 0,
};
const noopSubscribe = () => () => {};
export function useCachedWorkspaceQuery<T>(
  path: string | null,
  policy?: QueryPolicy,
  load?: (api: MobileApi, path: string, signal: AbortSignal) => Promise<T>,
) {
  const { api, session } = useSession();
  const scope = JSON.stringify([session?.userId, [...(session?.roles ?? [])].sort()]);
  const entry = useMemo(
    () =>
      api && path && policy
        ? api.queryCache.query(
            scope,
            path,
            policy,
            (signal) => (load ? load(api, path, signal) : api.request<T>(path, { signal })),
            load,
          )
        : null,
    [api, path, policy, scope, load],
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      entry && api ? api.queryCache.subscribe(entry, listener) : noopSubscribe(),
    [entry, api],
  );
  const snapshot = useCallback(() => entry?.state ?? idle, [entry]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useFocusEffect(
    useCallback(() => (entry && api ? api.queryCache.activate(entry) : undefined), [api, entry]),
  );
  const reload = useCallback(() => {
    if (entry && api) void api.queryCache.fetch(entry, true);
  }, [api, entry]);
  const revalidate = useCallback(() => {
    if (entry && api) void api.queryCache.fetch(entry);
  }, [api, entry]);
  const refresh = useCallback(async () => {
    if (!entry || !api) return null;
    await api.queryCache.fetch(entry, true);
    if (entry.state.error) throw entry.state.error;
    return entry.state.hasData ? (entry.state.data as T) : null;
  }, [api, entry]);
  const setData = useCallback(
    (data: T) => {
      if (entry && api) api.queryCache.setData(entry, data);
    },
    [api, entry],
  );
  const updateData = useCallback(
    (update: (current: T | null) => T | null) => {
      if (!entry || !api || entry.retired) return;
      const next = update(entry.state.hasData ? (entry.state.data as T) : null);
      if (next !== null) api.queryCache.setData(entry, next);
    },
    [api, entry],
  );
  return {
    data: state.hasData ? (state.data as T) : null,
    error: state.error ? conciseMessage(errorMessage(state.error)) : '',
    loading: !!entry && !state.hasData && !state.error,
    fetching: state.fetching,
    stale: !!entry && api!.queryCache.isStale(entry),
    updatedAt: state.updatedAt,
    reload,
    revalidate,
    refresh,
    setData,
    updateData,
    rawError: state.error,
  };
}
