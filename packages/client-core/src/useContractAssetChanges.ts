import { useCallback, useEffect, useState } from 'react';
import {
  contractError,
  type AssetChange,
  type AssetChangePreparation,
  type ContractClient,
  type HandoverChoices,
} from './contracts';

export function useContractAssetChanges(api: ContractClient, id: string, staff: boolean) {
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const [state, setState] = useState<{
    id: string;
    api: ContractClient;
    revision: number;
    events: AssetChange[];
    preparation: AssetChangePreparation | null;
    choices: HandoverChoices | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.assetChanges?.(id, controller.signal) ?? [],
      staff ? api.assetChangePreparation(id, controller.signal) : null,
      staff ? api.handoverChoices(id, controller.signal) : null,
    ])
      .then(([events, preparation, choices]) => {
        if (!controller.signal.aborted)
          setState({ id, api, revision, events, preparation, choices, error: '' });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({
            id,
            api,
            revision,
            events: [],
            preparation: null,
            choices: null,
            error: contractError(e),
          });
      });
    return () => controller.abort();
  }, [api, id, staff, revision]);
  const current =
    state?.id === id && state.api === api && state.revision === revision ? state : null;
  return {
    events: current?.events ?? [],
    preparation: current?.preparation,
    choices: current?.choices,
    error: current?.error ?? '',
    loading: !current,
    reload,
  };
}
