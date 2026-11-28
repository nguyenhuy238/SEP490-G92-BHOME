import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import type { WorkspaceScreen } from '../features/workspace/navigation';
import { colors as c, staffColors as s } from '../theme/theme';
import { staffHomePalette as h } from '../theme/staffLayout';
import { fontStyle, typography } from '../theme/typography';
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
        title: 'Bàn giao / Chấm dứt hợp đồng',
        detail: 'Biên bản & xác nhận',
        icon: 'key-outline',
        screen: 'checklist',
      },
      {
        title: 'Kết thúc hợp đồng sớm',
        detail: 'Gửi yêu cầu chấm dứt trước hạn',
        icon: 'file-document-remove-outline',
        screen: 'contract',
        params: { section: 'lifecycle' },
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
      {
        title: 'Hoàn tiền',
        detail: 'Gửi yêu cầu & xem chứng từ',
        icon: 'cash-refund',
        screen: 'refund-requests',
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
            tenantFeatureGroups[0].items[2],
            tenantFeatureGroups[1].items[0],
            tenantFeatureGroups[2].items[0],
            tenantFeatureGroups[0].items[3],
            tenantFeatureGroups[2].items[2],
          ],
        },
      ];
  return (
    <View style={styles.directory}>
      {groups.map((group) => (
        <View key={group.title} style={styles.section}>
          <View style={styles.headingRow}>
            <View style={styles.headingAccent} />
            <Text accessibilityRole="header" style={styles.heading}>
              {all
                ? group.title.charAt(0) + group.title.slice(1).toLocaleLowerCase('vi-VN')
                : group.title}
            </Text>
          </View>
          <View style={styles.list}>
            {group.items.map((item) => (
              <TouchableRipple
                key={item.title}
                style={styles.item}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityHint={item.detail}
                onPress={() => {
                  const params =
                    contractId && ['contract', 'checklist'].includes(item.screen)
                      ? { ...item.params, contractId }
                      : item.params;
                  if (params) go(item.screen, params);
                  else go(item.screen);
                }}
              >
                <View style={styles.itemContent}>
                  <View style={styles.iconBox}>
                    <Icon source={item.icon} size={20} color={s.blue} />
                  </View>
                  <View style={styles.itemText}>
                    <Text style={styles.title} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {!!item.detail && (
                      <Text style={styles.detail} numberOfLines={2}>
                        {item.detail}
                      </Text>
                    )}
                  </View>
                  <Icon source="chevron-right" size={19} color={c.muted} />
                </View>
              </TouchableRipple>
            ))}
          </View>
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
            <Icon source="format-list-bulleted" size={18} color={s.blue} />
            <Text style={styles.linkText}>Xem tất cả chức năng</Text>
            <Icon source="chevron-right" size={18} color={c.muted} />
          </View>
        </TouchableRipple>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  directory: { gap: 14 },
  section: { gap: 8 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 3 },
  headingAccent: { width: 4, height: 18, borderRadius: 2, backgroundColor: s.blue },
  heading: { ...fontStyle('bold', 18, 25), color: h.ink, flexShrink: 1 },
  list: { gap: 8 },
  item: {
    minHeight: 72,
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: h.border,
    overflow: 'hidden',
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: h.iconSurface,
  },
  itemText: { flex: 1, minWidth: 0, gap: 3 },
  title: {
    ...typography.cardTitle,
    textAlign: 'left',
    color: h.ink,
    flexShrink: 1,
  },
  detail: { ...typography.secondary, color: h.muted, flexShrink: 1 },
  allLink: { borderRadius: 12 },
  linkRow: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkText: { ...typography.link, flex: 1, color: s.blue },
});
