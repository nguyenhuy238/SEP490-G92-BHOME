import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../packages/client-core/src/auth';
import {
  ApiError,
  infrastructureError,
  getUserFriendlyMessage,
} from '../../../../packages/client-core/src/api';
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
  const infrastructure = infrastructureError(error);
  if (infrastructure) return infrastructure;
  if (error instanceof ApiError) {
    const codes: Record<string, string> = {
      email_recipient_not_allowed:
        'Địa chỉ nhận chưa được cho phép trong môi trường thử nghiệm. Liên hệ người quản trị môi trường trước khi gửi lại.',
      staff_account_requires_invitation:
        'Phiên bản Backend cũ yêu cầu kích hoạt tài khoản. Hãy cập nhật Backend rồi thử gửi lại thông tin đăng nhập.',
      staff_password_update_failed:
        'Chưa thể cấp mật khẩu mới cho tài khoản này. Vui lòng thử lại hoặc kiểm tra cấu hình xác thực.',
      identity_retention_review_changed:
        'Metadata hoặc nghĩa vụ đã thay đổi. Tải lại và xác nhận lại trước khi lưu.',
      identity_retention_key_conflict: 'Yêu cầu rà soát đã dùng với nội dung khác. Tải lại hồ sơ.',
      identity_retention_hold_not_active: 'Lệnh giữ đã được xử lý hoặc không thuộc hồ sơ này.',
      invalid_identity_retention_review:
        'Chọn thao tác metadata hợp lệ, nhập lý do và xác nhận đã đọc hồ sơ.',
      staff_responsibilities_unresolved:
        'Nhân viên còn trách nhiệm chưa giải quyết. Hãy thay người phụ trách trước.',
      stale_staff_version: 'Hồ sơ đã thay đổi. Tải lại trước khi sửa tiếp.',
      no_responsible_staff: 'Cơ sở chưa có nhân viên phụ trách đang hoạt động.',
      invalid_task_target:
        'Phòng, khu vực hoặc tài sản không thuộc cơ sở/vị trí đã chọn. Vui lòng chọn lại.',
      invalid_phone_number: 'Số điện thoại không đúng định dạng.',
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
      fast_repair_category_inactive:
        'Nhóm sửa nhanh chưa được Owner kích hoạt. Gửi phương án sửa chữa thông thường để duyệt.',
      fast_repair_requires_normal_approval:
        'Công việc cần chi phí hoặc vật tư. Dừng sửa nhanh và gửi phương án để Owner duyệt.',
      asset_link_unavailable:
        'Tài sản đã được liên kết hoặc đề xuất chưa sẵn sàng. Tải lại lệnh sửa chữa.',
      asset_proposal_pending: 'Owner cần quyết định đề xuất tài sản trước khi nghiệm thu.',
      compensation_already_decided:
        'Công việc đã có quyết định bồi thường. Xem quyết định và lịch sử để tránh thu trùng.',
      compensation_deposit_insufficient:
        'Cọc còn lại không đủ toàn bộ mức bồi thường hoặc đã được sử dụng. Chưa thể chọn hoặc thực hiện khấu trừ.',
      compensation_move_out_required:
        'Chỉ khấu trừ sau khi Owner duyệt trả phòng và xác nhận biên bản kiểm tra.',
      compensation_collected_or_invoice_adjustment_required:
        'Quyết định đã phát hành hóa đơn hoặc đã khấu trừ. Quy trình sửa hoặc đảo khoản đã thu chưa được phê duyệt. Lịch sử giao dịch được giữ nguyên.',
      invalid_compensation_amount:
        'Mức bồi thường phải là VND nguyên, lớn hơn 0 và không vượt chi phí sửa chữa thực tế.',
      compensation_invoice_due_date_required:
        'Hóa đơn cần ngày đến hạn từ hôm nay và Tenant có quyền theo hợp đồng được chọn.',
      verified_room_maintenance_required:
        'Chỉ xác nhận bồi thường cho công việc trong phòng đã được Owner nghiệm thu và xác nhận chi phí.',
      compensation_evidence_changed:
        'Bằng chứng đã thay đổi. Dừng quyết toán và kiểm tra nguồn bằng chứng.',
      compensation_concurrent_or_invalid_state:
        'Nguồn tiền hoặc quyết định đã thay đổi. Tải lại và đối chiếu trước khi thử lại.',
      public_location_incomplete:
        'Cần giới thiệu cơ sở và ít nhất một số điện thoại hoặc email liên hệ.',
      public_room_incomplete: 'Cần mô tả phòng trước khi xuất bản.',
      public_location_not_published: 'Cần xuất bản cơ sở trước khi xuất bản phòng.',
      announcement_idempotency_conflict:
        'Mã tạo nháp đã dùng cho nội dung khác. Mở lại nháp đã lưu để kiểm tra.',
    };
    return codes[error.problem?.code ?? ''] || getUserFriendlyMessage(error);
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
