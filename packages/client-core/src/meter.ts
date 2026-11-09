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
  dueAt?: string | null;
  assignedStaffUserId?: string | null;
  automationPlanId?: string | null;
  version?: number;
  locationId?: string;
  roomId?: string;
}

export function meterClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  return {
    tasks: (
      signal?: AbortSignal,
      filters: {
        locationId?: string;
        roomId?: string;
        status?: string;
        dueDate?: string;
        page?: number;
      } = {},
    ) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== '' && value != null) query.set(key, String(value));
      return request<MeterTask[]>('/api/v1/capture/meter-tasks' + (query.size ? `?${query}` : ''), {
        signal,
      });
    },
    task: (id: string, signal?: AbortSignal) =>
      request<MeterTask>(`/api/v1/capture/meter-tasks/${encodeURIComponent(id)}`, { signal }),
    reading: (id: string, signal?: AbortSignal) =>
      request<ConfirmedReading>(`/api/v1/capture/readings/${encodeURIComponent(id)}`, { signal }),
  };
}
