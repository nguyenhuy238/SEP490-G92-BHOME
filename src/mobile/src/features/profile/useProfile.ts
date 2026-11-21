import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '../../lib/SessionProvider';
import { queryPolicies } from '../../lib/queryPolicies';
import { useCachedWorkspaceQuery } from '../workspace/useCachedWorkspaceQuery';
import {
  loadAccountProfile,
  profilePath,
  updateAccountProfile,
  type AccountProfile,
  type ProfileUpdate,
} from '../../services/accountProfile';

export function useProfile() {
  const { api, session } = useSession();
  const userId = session?.userId;
  const query = useCachedWorkspaceQuery<AccountProfile>(
    session && api ? profilePath : null,
    queryPolicies.profile,
    loadAccountProfile,
  );
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [api, session?.userId]);
  const publish = query.setData;
  const save = useCallback(
    async (input: ProfileUpdate) => {
      if (!api || !userId) return null;
      if (request.current) return null;
      const controller = new AbortController();
      request.current = controller;
      try {
        const result = await updateAccountProfile(api, input, controller.signal);
        if (controller.signal.aborted) return null;
        publish(result);
        return result;
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
    [api, userId, publish],
  );
  return { ...query, save };
}
