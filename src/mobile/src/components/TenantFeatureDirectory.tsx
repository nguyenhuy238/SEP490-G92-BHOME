import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { DashboardHeading, dashboardStyles } from './DashboardKit';
import { StaffFeatureCard } from './StaffFeatureCard';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import type { WorkspaceScreen } from '../features/workspace/navigation';
import { staffColors as s } from '../theme/theme';

export const tenantFeatureGroups: {
  title: string;
  items: {
    title: string;
    detail: string;
    icon: string;
    screen: WorkspaceScreen;
    params?: Record<string, string>;
    status?: string;
  }[];
}[] = [
  {
    title: 'PHÒNG & HỢP ĐỒNG',
    items: [
      {
        title: 'Phòng của tôi',
        detail: 'Phòng, tài sản & người ở',
        icon: 'door-open',
        screen: 'tenant-room',
      },
      {
        title: 'Hợp đồng',
        detail: 'Ký, gia hạn & kết thúc',
        icon: 'file-document-outline',
        screen: 'contract',
      },
      {
        title: 'Bàn giao / Trả phòng',
        detail: 'Biên bản & xác nhận',
        icon: 'key-outline',
        screen: 'checklist',
      },
      {
        title: 'Tạm trú VNeID',
        detail: 'Hướng dẫn & kết quả',
        icon: 'card-account-details-outline',
        screen: 'residence',
        status: 'Chưa lưu được kết quả',
      },
    ],
  },
  {
    title: 'HÓA ĐƠN & THANH TOÁN',
    items: [
      {
        title: 'Hóa đơn',
        detail: 'Danh sách theo kỳ',
        icon: 'receipt-text-outline',
        screen: 'invoice',
      },
      {
        title: 'Thanh toán',
        detail: 'Chuyển khoản & trạng thái',
        icon: 'qrcode-scan',
        screen: 'invoice',
        params: { focus: 'payment' },
      },
      { title: 'Điện nước', detail: 'Chỉ số đã xác nhận', icon: 'gauge', screen: 'tenant-meters' },
      {
        title: 'Lịch sử thanh toán',
        detail: 'Đã ghi nhận & còn nợ',
        icon: 'history',
        screen: 'billing-history',
      },
      {
        title: 'Điều chỉnh hóa đơn',
        detail: 'Gửi qua hóa đơn của bạn',
        icon: 'receipt-text-edit-outline',
        screen: 'invoice',
        params: { focus: 'adjustment' },
      },
    ],
  },
  {
    title: 'SỰ CỐ & YÊU CẦU',
    items: [
      {
        title: 'Báo sự cố',
        detail: 'Mô tả & ảnh hiện trường',
        icon: 'wrench-outline',
        screen: 'incidents',
        status: 'Chưa hỗ trợ gửi',
      },
      {
        title: 'Yêu cầu của tôi',
        detail: 'Theo dõi tiến độ xử lý',
        icon: 'clipboard-text-outline',
        screen: 'tenant-requests',
        status: 'Chưa có dữ liệu máy chủ',
      },
    ],
  },
];

export function TenantFeatureDirectory({ contractId }: { contractId?: string }) {
  const { go } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Button
        mode="outlined"
        icon={expanded ? 'chevron-up' : 'view-grid-outline'}
        onPress={() => setExpanded(!expanded)}
        accessibilityState={{ expanded }}
      >
        {expanded ? 'Thu gọn chức năng' : 'Tất cả chức năng'}
      </Button>
      {(expanded
        ? tenantFeatureGroups
        : [
            {
              title: 'TIỆN ÍCH CƯ DÂN',
              items: [
                tenantFeatureGroups[0].items[0],
                tenantFeatureGroups[1].items[0],
                ...tenantFeatureGroups[2].items,
              ],
            },
          ]
      ).map((group) => (
        <View key={group.title} style={dashboardStyles.section}>
          <DashboardHeading title={group.title} />
          <View style={styles.grid}>
            {group.items.map((item) => (
              <View key={item.title} style={styles.cell}>
                <StaffFeatureCard
                  compact
                  title={item.title}
                  description={item.detail}
                  icon={item.icon}
                  color={s.blue}
                  background={s.blueSoft}
                  status={item.status}
                  onPress={() => {
                    const params =
                      contractId && ['contract', 'checklist'].includes(item.screen)
                        ? { ...item.params, contractId }
                        : item.params;
                    if (params) go(item.screen, params);
                    else go(item.screen);
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexBasis: '45%', flexGrow: 1, maxWidth: '48%' },
});
