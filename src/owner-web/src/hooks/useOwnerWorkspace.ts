import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../packages/client-core/src/api';
import { invoiceError } from '../../../../packages/client-core/src/invoices';
import { useMeterApi } from '../features/meters/useMeterApi';

export interface OwnerPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface OwnerLocation {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
}
export interface OwnerRoom {
  id: string;
  locationId: string;
  roomNumber: string;
}
export function ownerQuery(values: Record<string, unknown>) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== '' && value != null) result.set(key, String(value));
  return result.toString();
}
export function ownerError(error: unknown) {
  if (error instanceof ApiError) {
    const fields = Object.values(error.problem?.errors ?? {})
      .flat()
      .join(' ');
    const codes: Record<string, string> = {
      staff_responsibilities_unresolved:
        'Nhân viên còn trách nhiệm chưa giải quyết. Hãy thay người phụ trách trước.',
      stale_staff_version: 'Hồ sơ đã thay đổi. Tải lại trước khi sửa tiếp.',
      no_responsible_staff: 'Cơ sở chưa có nhân viên phụ trách đang hoạt động.',
      staff_specialist_work_unresolved:
        'Còn lệnh sửa chữa hoặc kiểm tra trả phòng chưa được phân công lại.',
    };
    return fields || codes[error.problem?.code ?? ''] || invoiceError(error);
  }
  return invoiceError(error);
}
export function useOwnerQuery<T>(key: readonly unknown[], path: string, enabled = true) {
  const { session } = useAuth();
  const { request } = useMeterApi();
  return useQuery({
    queryKey: ['owner-workspace', session?.userId, ...key],
    enabled: enabled && !!session?.roles.includes('Owner'),
    queryFn: ({ signal }) => request<T>(path, { signal }),
  });
}
export function useOwnerAction() {
  const { request } = useMeterApi();
  const cache = useQueryClient();
  const lock = useRef(false);
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(work: () => Promise<unknown>, message = 'Đã lưu thay đổi trên máy chủ.') {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await cache.invalidateQueries({ queryKey: ['owner-workspace'] });
      setNotice(message);
      return true;
    } catch (e) {
      setError(ownerError(e));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function command<T>(path: string, method: string, body?: unknown) {
    // Keep the same key after an uncertain response, but never reuse it for changed input.
    const fingerprint = JSON.stringify([path, method, body]);
    let key = keys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(fingerprint, key);
    }
    return request<T>(path, {
      method,
      headers: { 'Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  return { busy, error, notice, run, command, request };
}
