import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import type { WorkspaceScreen } from '../features/workspace/navigation';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';
import { featureCardLayout } from './FeatureCardLayout';
export const tenantFeatureGroups: {
  title: string;
  items: {
    title: string;
    detail: string;
    icon: string;
    screen: WorkspaceScreen;
    params?: Record<string, string>;
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
      },
      {
        title: 'Yêu cầu của tôi',
        detail: 'Theo dõi tiến độ xử lý',
        icon: 'clipboard-text-outline',
        screen: 'tenant-requests',
      },
    ],
  },
];

export function TenantFeatureDirectory({
  contractId,
  all = false,
}: {
  contractId?: string;
  all?: boolean;
}) {
  const { go } = useWorkspace();
  const groups = all
    ? tenantFeatureGroups
    : [
        {
          title: 'Tiện ích cư dân',
          items: [
            tenantFeatureGroups[0].items[0],
            tenantFeatureGroups[1].items[0],
            ...tenantFeatureGroups[2].items,
          ],
        },
      ];
  return (
    <View style={styles.directory}>
      {groups.map((group) => (
        <View key={group.title} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {all
              ? group.title.charAt(0) + group.title.slice(1).toLocaleLowerCase('vi-VN')
              : group.title}
          </Text>
          {Array.from({ length: Math.ceil(group.items.length / 2) }, (_, row) => (
            <View key={row} style={styles.row}>
              {group.items.slice(row * 2, row * 2 + 2).map((item) => (
                <View key={item.title} style={styles.tile}>
                  <TouchableRipple
                    style={featureCardLayout.ripple}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => {
                      const params =
                        contractId && ['contract', 'checklist'].includes(item.screen)
                          ? { ...item.params, contractId }
                          : item.params;
                      if (params) go(item.screen, params);
                      else go(item.screen);
                    }}
                  >
                    <View style={styles.tileContent}>
                      <View style={styles.iconBox}>
                        <Icon source={item.icon} size={22} color={s.blue} />
                      </View>
                      <Text style={styles.title} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </View>
                  </TouchableRipple>
                </View>
              ))}
              {group.items.length % 2 === 1 && row === Math.floor(group.items.length / 2) && (
                <View style={styles.spacer} />
              )}
            </View>
          ))}
        </View>
      ))}
      {!all && (
        <TouchableRipple
          accessibilityRole="button"
          accessibilityLabel="Xem tất cả chức năng"
          style={styles.allLink}
          onPress={() =>
            contractId ? go('tenant-features', { contractId }) : go('tenant-features')
          }
        >
          <View style={styles.linkRow}>
            <Icon source="view-grid-outline" size={18} color={s.blue} />
            <Text style={styles.linkText}>Xem tất cả chức năng</Text>
            <Icon source="chevron-right" size={18} color={c.muted} />
          </View>
        </TouchableRipple>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  directory: { gap: 12 },
  section: { gap: 12 },
  heading: { ...typography.sectionHeading, color: s.navy },
  row: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  tile: {
    ...featureCardLayout.surface,
    minWidth: 0,
    height: 112,
    backgroundColor: c.white,
  },
  tileContent: {
    ...featureCardLayout.content,
    ...featureCardLayout.compact,
    flex: 1,
    justifyContent: 'center',
  },
  iconBox: {
    ...featureCardLayout.icon,
    ...featureCardLayout.compactIcon,
    backgroundColor: s.blueSoft,
  },
  title: {
    ...typography.cardTitle,
    textAlign: 'center',
    color: s.navy,
    flexShrink: 1,
  },
  spacer: { flex: 1, minWidth: 0 },
  allLink: { borderRadius: 12 },
  linkRow: {
    minHeight: 48,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkText: { ...typography.link, flex: 1, color: s.blue },
});
