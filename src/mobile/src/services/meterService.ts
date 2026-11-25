import { meterClient } from '../../../../packages/client-core/src/meter';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';
import type { MobileApi } from '../lib/api';

export function meterService(api: MobileApi) {
  return {
    ...meterClient((path, init) => api.request(path, init)),
    evidence: (readingId: string, signal?: AbortSignal) =>
      api.request<Uint8Array>(
        `/api/v1/capture/readings/${encodeURIComponent(readingId)}/evidence`,
        { signal },
        'bytes',
      ),
    confirm: (taskId: string, value: string, evidenceId: string, signal?: AbortSignal) =>
      api.json<ConfirmedReading>(
        `/api/v1/capture/meter-tasks/${encodeURIComponent(taskId)}/confirm`,
        { humanConfirmed: true, confirmedValue: value, evidenceId },
        signal,
      ),
  };
}
