import { useCallback } from 'react';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import {
  attentionSources,
  attentionPageSize,
  type AttentionPage,
  loadOwnerPage,
} from '../../services/ownerAttention';
import { ownerQueuePolicy } from './ownerQueryPolicy';

function useSource(index: number, page: number) {
  const { api, session } = useSession();
  return useWorkspaceQuery<AttentionPage>(
    api && session?.roles.includes('Owner')
      ? `/api/v1${attentionSources[index].path}&page=${page}&pageSize=${attentionPageSize}`
      : null,
    { cache: ownerQueuePolicy, load: loadOwnerPage },
  );
}

export function useOwnerAttention(page = 1) {
  const a = useSource(0, page);
  const b = useSource(1, page);
  const c = useSource(2, page);
  const d = useSource(3, page);
  const e = useSource(4, page);
  const f = useSource(5, page);
  const g = useSource(6, page);
  const h = useSource(7, page);
  const { reload: ra } = a,
    { reload: rb } = b,
    { reload: rc } = c,
    { reload: rd } = d,
    { reload: re } = e,
    { reload: rf } = f,
    { reload: rg } = g,
    { reload: rh } = h;
  const reload = useCallback(() => {
    ra();
    rb();
    rc();
    rd();
    re();
    rf();
    rg();
    rh();
  }, [ra, rb, rc, rd, re, rf, rg, rh]);
  const queries = [a, b, c, d, e, f, g, h];
  const totalKnown = queries.reduce((total, query) => total + (query.data?.totalCount ?? 0), 0);
  return {
    buckets: queries.map((query, index) => ({ query, source: attentionSources[index] })),
    items: queries.flatMap((query, index) =>
      (query.data?.items ?? []).map((item) => ({ item, source: attentionSources[index] })),
    ),
    totalKnown,
    complete: queries.every((query) => !!query.data && !query.error),
    emergencyCount:
      a.data && b.data && !a.error && !b.error ? a.data.totalCount + b.data.totalCount : null,
    loading: queries.some((query) => query.loading),
    fetching: queries.some((query) => query.fetching),
    error: queries.some((query) => !!query.error),
    hasMore: queries.some((query) => (query.data?.totalCount ?? 0) > page * attentionPageSize),
    reload,
  };
}
