import type { MobileRole } from '../features/workspace/navigation';

export interface ApprovalItem {
  id: string;
  category: string;
  location: string;
  title: string;
  detail: string;
  amount: string;
  time: string;
  urgent: boolean;
}
export interface WorkOrderItem {
  id: string;
  room: string;
  title: string;
  category: string;
  status: string;
  time: string;
  detail: string;
}
export interface NoticeItem {
  id: string;
  roles: MobileRole[];
  category: string;
  title: string;
  detail: string;
  time: string;
  icon: string;
}
export interface WorkspaceData {
  approvals: ApprovalItem[];
  workOrders: WorkOrderItem[];
  notices: NoticeItem[];
}
export interface WorkspaceDataService {
  load(role: MobileRole): Promise<WorkspaceData>;
}
// Synthetic fixtures from Stitch, available ONLY in the explicit design preview.
// New backend adapters must implement this interface using confirmed API contracts.
export const sampleApprovals: ApprovalItem[] = [
  {
    id: 'sample-a1',
    category: 'Hợp đồng',
    location: 'Thanh Xuân',
    title: 'Duyệt Hợp đồng thuê P.205',
    detail: 'Khách thuê mẫu • Kỳ hạn 12 tháng\nHồ sơ và trạng thái ký minh họa',
    amount: '4.800.000 đ/tháng',
    time: '15p trước',
    urgent: true,
  },
  {
    id: 'sample-a2',
    category: 'Sửa chữa & Vật tư',
    location: 'Đống Đa',
    title: 'Thay rơ-le & bảo dưỡng máy bơm tăng áp',
    detail: 'Ảnh hưởng: 24 phòng tầng 4–6 đang bị tụt áp nước\nĐề xuất: Kỹ thuật viên mẫu',
    amount: '2.450.000 đ',
    time: '32p trước',
    urgent: true,
  },
  {
    id: 'sample-a3',
    category: 'Hóa đơn & Tiền tệ',
    location: 'Cầu Giấy',
    title: 'Giảm trừ hóa đơn tiền nước T10 - P.402',
    detail: 'Lý do: Phao bồn nước ngầm kẹt kỹ thuật.\nCó biên bản kiểm tra hiện trường.',
    amount: '-350.000 đ',
    time: '1 giờ trước',
    urgent: false,
  },
  {
    id: 'sample-a4',
    category: 'Hợp đồng',
    location: 'Cầu Giấy',
    title: 'Gia hạn thuê thêm 6 tháng - P.301',
    detail: 'Lịch sử trả tiền: 100% đúng hạn\nGiá gia hạn theo đề xuất',
    amount: '5.200.000 đ/tháng',
    time: '2 giờ trước',
    urgent: false,
  },
  {
    id: 'sample-a5',
    category: 'Sửa chữa & Vật tư',
    location: 'Hà Đông',
    title: 'Bổ sung 4 bình chữa cháy khí CO2 MT3',
    detail: 'Trang bị bổ sung tầng hầm để xe và hành lang T1.',
    amount: '1.800.000 đ',
    time: '3 giờ trước',
    urgent: false,
  },
];
export const sampleWorkOrders: WorkOrderItem[] = [
  {
    id: 'CV-1051',
    room: 'Khu chung',
    title: 'Kiểm tra vệ sinh và lối thoát hiểm tầng 1',
    category: 'Công việc chung',
    status: 'Cần làm',
    time: 'Hạn: 16:00',
    detail: 'Đối chiếu checklist an toàn, ghi nhận vướng mắc và ảnh kết quả để Owner kiểm tra.',
  },
  {
    id: 'CV-1042',
    room: 'Khu kỹ thuật',
    title: 'Xử lý tụt áp bơm tăng áp Tầng 4 – Tầng 6',
    category: 'Điện nước',
    status: 'Đang xử lý',
    time: 'Hạn: 11:30',
    detail: 'Tòa B Đống Đa • Đang lắp đặt rơ-le áp suất\nVật tư: Đã nhận rơ-le từ kho kỹ thuật',
  },
  {
    id: 'CV-1045',
    room: 'P.301',
    title: 'Sửa rò rỉ dây cấp nước vòi xịt',
    category: 'Điện nước',
    status: 'Cần làm',
    time: 'Hẹn 14:00',
    detail: 'Dây cấp inox 304 • Đã duyệt vật tư',
  },
  {
    id: 'CV-1048',
    room: 'P.302',
    title: 'Bàn giao & Ký biên bản vào ở',
    category: 'Bàn giao',
    status: 'Cần làm',
    time: 'Hẹn 14:30',
    detail: '6 hạng mục thiết bị kiểm kê • Chờ xác nhận',
  },
  {
    id: 'CV-1039',
    room: 'P.402',
    title: 'Bảo dưỡng định kỳ cục nóng điều hòa',
    category: 'Bảo dưỡng',
    status: 'Chờ vật tư',
    time: 'Định kỳ 6T',
    detail: 'Đề xuất bổ sung gas R32 • Chờ Owner duyệt',
  },
  {
    id: 'CV-1030',
    room: 'Khu chung',
    title: 'Thay bóng đèn tuýp LED hành lang T.3',
    category: 'Bảo dưỡng',
    status: 'Hoàn thành',
    time: '08:45',
    detail: 'LED Rạng Đông 1.2m 18W • Đã hoàn thành',
  },
];
export const sampleNotices: NoticeItem[] = [
  {
    id: 'n1',
    roles: ['Owner', 'Staff'],
    category: 'Khẩn cấp',
    title: 'Tụt áp máy bơm nước tầng 4–6',
    detail: 'Tòa B - Đống Đa • Kỹ thuật viên đang kiểm tra. 24 phòng bị gián đoạn nước sinh hoạt.',
    time: '15p',
    icon: 'alert-outline',
  },
  {
    id: 'n2',
    roles: ['Owner'],
    category: 'Phê duyệt',
    title: 'Duyệt hợp đồng thuê mới P.205',
    detail: 'Thanh Xuân • Yêu cầu chờ Owner kiểm tra hồ sơ.',
    time: '45p',
    icon: 'file-sign',
  },
  {
    id: 'n3',
    roles: ['Owner', 'Staff'],
    category: 'Vận hành',
    title: 'Hoàn tất chốt số điện nước kỳ T10',
    detail: 'Cơ sở được phân công • Chỉ số đã được Staff xác nhận.',
    time: '4 giờ',
    icon: 'text-recognition',
  },
  {
    id: 'n4',
    roles: ['Tenant'],
    category: 'Tài chính',
    title: 'Hóa đơn tháng 10 đã sẵn sàng',
    detail: 'P.301 • Xem chi tiết khoản thu và thông tin thanh toán.',
    time: '1 giờ',
    icon: 'receipt-text-outline',
  },
  {
    id: 'n5',
    roles: ['Tenant'],
    category: 'Vận hành',
    title: 'Phiếu sửa chữa P.301 đang xử lý',
    detail: 'Kỹ thuật viên đã tiếp nhận và đến kiểm tra dây cấp nước.',
    time: '2 giờ',
    icon: 'wrench-outline',
  },
  {
    id: 'n6',
    roles: ['Owner', 'Staff', 'Tenant'],
    category: 'Vận hành',
    title: 'Lịch kiểm tra an toàn PCCC định kỳ',
    detail: 'Kiểm tra hệ thống báo cháy và cửa thoát hiểm tại khu vực sinh hoạt.',
    time: 'Hôm qua',
    icon: 'shield-check-outline',
  },
];
export const previewWorkspaceService: WorkspaceDataService = {
  async load(role) {
    return {
      approvals: role === 'Owner' ? sampleApprovals : [],
      workOrders: role === 'Staff' ? sampleWorkOrders : [],
      notices: sampleNotices.filter((item) => item.roles.includes(role)),
    };
  },
};
export const invoiceLines = [
  {
    icon: 'home-city-outline',
    title: 'Tiền thuê phòng P.301',
    detail: 'Chu kỳ: 01/10 – 31/10/2024',
    amount: 4800000,
  },
  {
    icon: 'lightning-bolt-outline',
    title: 'Điện sinh hoạt (105 kWh)',
    detail: 'Chỉ số cũ: 1.420 → Mới: 1.525',
    amount: 380000,
  },
  {
    icon: 'water-outline',
    title: 'Nước sinh hoạt (7 m³)',
    detail: 'Chỉ số cũ: 210 → Mới: 217',
    amount: 140000,
  },
  {
    icon: 'broom',
    title: 'Dịch vụ tòa nhà & vệ sinh',
    detail: 'Thang máy, wifi hành lang, bảo an',
    amount: 100000,
  },
];
export function vnd(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(amount) + ' đ';
}
