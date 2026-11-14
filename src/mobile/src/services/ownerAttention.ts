import type { WorkspaceScreen } from '../features/workspace/navigation';

export type AttentionCategory = 'emergency' | 'maintenance' | 'task' | 'contract';
export interface AttentionSource {
  category: AttentionCategory;
  path: string;
  status: string;
  title: string;
  screen: WorkspaceScreen;
  parameter: string;
  action: string;
}
// Only existing server-filtered states. Financial administration stays on Web.
export const attentionSources: readonly AttentionSource[] = [
  {
    category: 'emergency',
    path: '/incidents?severity=Emergency&status=Submitted',
    status: 'Khẩn cấp · Mới báo',
    title: 'Sự cố khẩn cấp',
    screen: 'incident-detail',
    parameter: 'incidentId',
    action: 'Xem cảnh báo',
  },
  {
    category: 'emergency',
    path: '/incidents?severity=Emergency&status=InProgress',
    status: 'Khẩn cấp · Đang xử lý',
    title: 'Sự cố khẩn cấp',
    screen: 'incident-detail',
    parameter: 'incidentId',
    action: 'Xem cảnh báo',
  },
  {
    category: 'maintenance',
    path: '/work-orders?workOrderStatus=PendingVerification',
    status: 'Chờ nghiệm thu sửa chữa',
    title: 'Kết quả sửa chữa',
    screen: 'maintenance-detail',
    parameter: 'workOrderId',
    action: 'Kiểm tra kết quả',
  },
  {
    category: 'task',
    path: '/operational-tasks?status=PendingVerification',
    status: 'Chờ kiểm tra kết quả',
    title: 'Công việc vận hành',
    screen: 'task-detail',
    parameter: 'taskId',
    action: 'Kiểm tra kết quả',
  },
  {
    category: 'maintenance',
    path: '/work-orders?workOrderStatus=PendingApproval',
    status: 'Chờ duyệt phương án',
    title: 'Phương án sửa chữa',
    screen: 'maintenance-detail',
    parameter: 'workOrderId',
    action: 'Xem phương án',
  },
  {
    category: 'contract',
    path: '/contracts?status=PendingSigning',
    status: 'Đang hoàn tất chữ ký',
    title: 'Hợp đồng',
    screen: 'signing',
    parameter: 'contractId',
    action: 'Xem tiến độ ký',
  },
  {
    category: 'contract',
    path: '/contracts?status=PendingActivation',
    status: 'Chờ xác nhận kích hoạt',
    title: 'Hợp đồng',
    screen: 'signing',
    parameter: 'contractId',
    action: 'Kiểm tra hợp đồng',
  },
];
export interface AttentionRecord {
  id: string;
  title?: string;
  description?: string;
  expectedOutcome?: string;
  locationId?: string;
  locationName?: string;
  roomId?: string | null;
  roomNumber?: string;
  dueAt?: string | null;
  targetCompletionAt?: string;
  createdAt?: string;
  isOverdue?: boolean;
}
export interface AttentionPage {
  items: AttentionRecord[];
  totalCount: number;
}
export const attentionPageSize = 6;
export function attentionTitle(item: AttentionRecord, source: AttentionSource) {
  return (
    item.title ||
    item.description ||
    item.expectedOutcome ||
    (item.roomNumber ? `Hợp đồng phòng ${item.roomNumber}` : source.title)
  );
}
