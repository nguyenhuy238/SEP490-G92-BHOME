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
    title: 'Công việc của tôi',
    items: [
      {
        title: 'Công việc',
        detail: 'Việc được giao và lịch làm',
        icon: 'clipboard-check-outline',
        screen: 'work-orders',
      },
    ],
  },
  {
    title: 'Phòng được phân công',
    items: [
      {
        title: 'Phòng được phân công',
        detail: 'Phòng và người ở',
        icon: 'door-open',
        screen: 'rooms',
      },
    ],
  },
  {
    title: 'Ghi điện nước',
    items: [
      {
        title: 'Ghi điện nước',
        detail: 'Chụp và xác nhận chỉ số',
        icon: 'gauge',
        screen: 'meter-reading',
      },
    ],
  },
  {
    title: 'Bàn giao / Trả phòng',
    items: [
      {
        title: 'Bàn giao / Trả phòng',
        detail: 'Kiểm tra và xác nhận',
        icon: 'key-outline',
        screen: 'move-in',
      },
    ],
  },
  {
    title: 'Sự cố & bảo trì',
    items: [
      {
        title: 'Xử lý sự cố',
        detail: 'Báo cáo và theo dõi xử lý',
        icon: 'tools',
        screen: 'staff-incidents',
      },
    ],
  },
  {
    title: 'Hợp đồng thuê',
    items: [
      {
        title: 'Hợp đồng thuê',
        detail: 'Tạo và theo dõi hợp đồng',
        icon: 'file-document-outline',
        screen: 'signing',
      },
    ],
  },
];

const allFeatures = staffFeatureGroups.flatMap((group) => group.items);
export const frequentStaffFeatures = ['work-orders', 'meter-reading', 'move-in', 'staff-incidents']
  .map((screen) => allFeatures.find((feature) => feature.screen === screen))
  .filter((feature): feature is StaffFeature => !!feature);
