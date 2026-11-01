export interface ConfirmedReading {
  id: string;
  taskId: string;
  confirmedValue: string;
  previousValue: string | null;
  consumption: string | null;
  status: number;
  confirmedAt: string;
}

export interface MeterTask {
  id: string;
  meterId: string;
  location: string;
  room: string;
  meterCode: string;
  utilityType: number;
  display: number;
  decimalPlaces: number;
  purpose: number;
  readingDate: string;
  billingPeriod: string | null;
  status: number;
  previousValue: string | null;
  contractId?: string | null;
  confirmedReadingId?: string | null;
}

export function meterClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  return {
    tasks: (signal?: AbortSignal) =>
      request<MeterTask[]>('/api/v1/capture/meter-tasks', { signal }),
    task: (id: string, signal?: AbortSignal) =>
      request<MeterTask>(`/api/v1/capture/meter-tasks/${encodeURIComponent(id)}`, { signal }),
    reading: (id: string, signal?: AbortSignal) =>
      request<ConfirmedReading>(`/api/v1/capture/readings/${encodeURIComponent(id)}`, { signal }),
  };
}
