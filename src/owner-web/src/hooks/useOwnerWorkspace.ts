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
      incident_version_changed: 'Sự cố đã đổi phiên bản. Tải lại và xem xét trước khi quyết định.',
      stale_version: 'Dữ liệu đã đổi phiên bản. Tải lại và xem xét trước khi quyết định.',
      owner_classification_required:
        'Cần Owner phân loại sự cố trước khi giao việc hoặc xử lý trực tiếp.',
      completion_evidence_required: 'Chưa có bằng chứng hoàn tất hợp lệ để xác minh.',
      emergency_cost_decision_required: 'Cần quyết định các chi phí khẩn cấp còn chờ duyệt.',
      open_work_orders_require_cancellation:
        'Còn lệnh sửa chữa đang mở. Xử lý các lệnh trước khi đóng sự cố.',
      work_order_verification_required:
        'Các lệnh sửa chữa phải được Owner xác minh trước khi đóng.',
      staff_unavailable: 'Staff không còn được phân công hiệu lực tại cơ sở này.',
      public_location_incomplete:
        'Cần giới thiệu cơ sở và ít nhất một số điện thoại hoặc email liên hệ.',
      public_room_incomplete: 'Cần mô tả phòng trước khi xuất bản.',
      public_location_not_published: 'Cần xuất bản cơ sở trước khi xuất bản phòng.',
      announcement_idempotency_conflict:
        'Mã tạo nháp đã dùng cho nội dung khác. Mở lại nháp đã lưu để kiểm tra.',
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
    enabled: enabled && !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) => request<T>(path, { signal }),
  });
}
export function useOwnerAction() {
  const { request } = useMeterApi();
  const cache = useQueryClient();
  const lock = useRef(false);
  const keys = useRef(new Map<string, string>());
  const completed = useRef(new Set<string>());
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
      // Retire confirmed intents; preserve unresolved keys for a safe retry.
      for (const fingerprint of completed.current) keys.current.delete(fingerprint);
      completed.current.clear();
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
    }).then((result) => {
      completed.current.add(fingerprint);
      return result;
    });
  }
  return { busy, error, notice, run, command, request };
}
