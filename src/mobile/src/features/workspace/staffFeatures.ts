import type { WorkspaceScreen } from './navigation';

export interface StaffFeature {
  title: string;
  detail: string;
  icon: string;
  screen: WorkspaceScreen;
  params?: Record<string, string>;
  pending?: boolean;
  partial?: boolean;
}

export const staffFeatureGroups: { title: string; items: StaffFeature[] }[] = [
  {
    title: 'TIẾP NHẬN & HỢP ĐỒNG',
    items: [
      {
        title: 'Tiếp nhận người thuê',
        detail: 'CCCD & người cùng ở',
        icon: 'account-plus-outline',
        screen: 'onboarding',
      },
      {
        title: 'Tạo hợp đồng giữ chỗ',
        detail: 'Chọn phòng, đại diện & tiền cọc',
        icon: 'file-document-plus-outline',
        screen: 'prepare-contract',
        params: { kind: 'Holding' },
      },
      {
        title: 'Hợp đồng',
        detail: 'Nháp, trạng thái & gia hạn',
        icon: 'file-document-edit-outline',
        screen: 'signing',
        partial: true,
      },
      {
        title: 'Phòng trọ',
        detail: 'Cơ sở, phòng & người ở',
        icon: 'door-open',
        screen: 'rooms',
        partial: true,
      },
    ],
  },
  {
    title: 'CÔNG VIỆC & LỊCH LÀM',
    items: [
      {
        title: 'Công việc của tôi',
        detail: 'Tiến độ & bằng chứng',
        icon: 'clipboard-check-outline',
        screen: 'work-orders',
      },
      {
        title: 'Lịch làm việc',
        detail: 'Ca được phân công',
        icon: 'calendar-month-outline',
        screen: 'shifts',
        pending: true,
      },
    ],
  },
  {
    title: 'ĐIỆN NƯỚC & BÀN GIAO',
    items: [
      {
        title: 'Ghi điện nước',
        detail: 'Chụp, OCR & xác nhận',
        icon: 'gauge',
        screen: 'meter-reading',
      },
      {
        title: 'Bàn giao / Trả phòng',
        detail: 'Kiểm tra & xác nhận',
        icon: 'key-outline',
        screen: 'move-in',
      },
      {
        title: 'Tài sản',
        detail: 'Thiết bị & hiện trạng',
        icon: 'package-variant-closed',
        screen: 'staff-assets',
        pending: true,
      },
    ],
  },
  {
    title: 'SỰ CỐ & BẢO TRÌ',
    items: [
      {
        title: 'Báo cáo sự cố',
        detail: 'Ghi nhận sự cố tại cơ sở',
        icon: 'alert-outline',
        screen: 'report-incident',
      },
      {
        title: 'Xử lý sự cố',
        detail: 'Theo dõi và xử lý sửa chữa',
        icon: 'tools',
        screen: 'staff-maintenance',
      },
      {
        title: 'Sự cố khẩn cấp',
        detail: 'Tiếp nhận và xử lý khẩn cấp',
        icon: 'alert-circle-outline',
        screen: 'staff-emergencies',
      },
    ],
  },
  {
    title: 'HÓA ĐƠN & CÔNG NỢ',
    items: [
      {
        title: 'Hóa đơn',
        detail: 'Trạng thái theo phòng',
        icon: 'receipt-text-outline',
        screen: 'staff-invoices',
        pending: true,
      },
      {
        title: 'Công nợ',
        detail: 'Theo dõi & nhắc thanh toán',
        icon: 'wallet-outline',
        screen: 'debt-follow-up',
        pending: true,
      },
    ],
  },
  {
    title: 'THÔNG BÁO',
    items: [
      {
        title: 'Gửi thông báo',
        detail: 'Thông tin vận hành cơ sở',
        icon: 'bullhorn-outline',
        screen: 'send-notification',
        pending: true,
      },
    ],
  },
];

const allFeatures = staffFeatureGroups.flatMap((group) => group.items);
export const frequentStaffFeatures = ['work-orders', 'meter-reading', 'onboarding', 'move-in']
  .map((screen) => allFeatures.find((feature) => feature.screen === screen))
  .filter((feature): feature is StaffFeature => !!feature);
