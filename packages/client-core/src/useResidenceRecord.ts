import { useCallback, useEffect, useRef, useState } from 'react';
import { residenceError, type ResidenceClient, type ResidenceTask } from './residence';

// Mount per compound identifier/account. No speculative status or retry of a write.
export function useResidenceRecord(api: ResidenceClient, contractId: string, residentId: string) {
  const [task, setTask] = useState<ResidenceTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false),
    alive = useRef(true),
    request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  const reload = useCallback(async () => {
    if (lock.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const data = await api.get(contractId, residentId, controller.signal);
      if (!controller.signal.aborted && alive.current) {
        setTask(data);
        setRevision((value) => value + 1);
      }
    } catch (failure) {
      if (!controller.signal.aborted && alive.current) {
        const status = (failure as { status?: number })?.status;
        if ([401, 403, 404].includes(status ?? 0)) setTask(null);
        else setReview(true);
        setError(residenceError(failure));
      }
    } finally {
      if (!controller.signal.aborted && alive.current) setLoading(false);
    }
  }, [api, contractId, residentId]);
  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);
  async function mutate(write: () => Promise<ResidenceTask>, message: string) {
    if (lock.current || loading || review) return false;
    request.current?.abort();
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await write();
      if (!alive.current) return false;
      setTask(saved);
      // Refresh the authoritative detail and protected image after every successful mutation.
      const latest = await api.get(contractId, residentId);
      if (!alive.current) return false;
      setTask(latest);
      setRevision((value) => value + 1);
      setNotice(message);
      return true;
    } catch (failure) {
      if (!alive.current) return false;
      setError(residenceError(failure));
      const status = (failure as { status?: number })?.status;
      if ([401, 403, 404].includes(status ?? 0)) setTask(null);
      else setReview(true);
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    task,
    loading,
    busy,
    error,
    notice,
    revision,
    reload,
    mutate,
    review,
    acknowledge: () => {
      if (!loading && task && !error) setReview(false);
    },
  };
}
