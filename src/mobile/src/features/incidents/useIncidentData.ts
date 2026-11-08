import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { showSuccess } from '../../lib/toast';
import { randomUUID } from '../../lib/randomUUID';
import { incidentError } from '../../services/incidents';

const listeners = new Set<() => void>();
export function refreshIncidents() {
  listeners.forEach((listener) => listener());
}
export function useIncidentQuery<T>(path: string | null) {
  const query = useWorkspaceQuery<T>(path);
  const reload = query.reload;
  const visited = useRef<string | null>(null);
  useEffect(() => {
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      if (path && visited.current === path) reload();
      visited.current = path;
    }, [path, reload]),
  );
  return query;
}

// Keep operation keys on ambiguous failure; no automatic retries of mutations.
export function useIncidentMutation({
  successMessage = 'Máy chủ đã ghi nhận.',
}: { successMessage?: string } = {}) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [notice, setNotice] = useState(''),
    [progress, setProgress] = useState('');
  const lock = useRef(false),
    pending = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const keys = pending.current;
    return () => {
      active.current = false;
      controller.current?.abort();
      keys.clear();
    };
  }, [api]);
  async function run<T>(
    signature: string,
    work: (
      key: (operation: string) => string,
      signal: AbortSignal,
      progress: (text: string) => void,
    ) => Promise<T>,
  ): Promise<T | undefined> {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const request = new AbortController();
    controller.current = request;
    const key = (operation: string) => {
      const fingerprint = operation.startsWith('upload:') ? operation : signature + ':' + operation;
      if (!pending.current.has(fingerprint)) pending.current.set(fingerprint, randomUUID());
      return pending.current.get(fingerprint)!;
    };
    try {
      const result = await work(key, request.signal, (text) => {
        if (!request.signal.aborted) setProgress(text);
      });
      if (request.signal.aborted || !active.current) return;
      pending.current.clear();
      setNotice(successMessage);
      showSuccess(successMessage);
      refreshIncidents();
      return result;
    } catch (e) {
      if (!request.signal.aborted && active.current) {
        setError(incidentError(e));
      }
    } finally {
      lock.current = false;
      if (active.current && !request.signal.aborted) {
        setBusy(false);
        setProgress('');
      }
    }
  }
  return { busy, error, notice, progress, run };
}
