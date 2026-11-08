import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import {
  notificationCategories,
  type NotificationItem,
} from '../../../../../packages/client-core/src/notifications';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { colors, staffColors } from '../../theme/theme';
import { fontFaces } from '../../theme/typography';

const icons: Record<string, string> = {
  Contract: 'file-document-outline',
  Invoice: 'receipt-text-outline',
  Payment: 'credit-card-outline',
  Adjustment: 'file-edit-outline',
  Task: 'clipboard-check-outline',
};
export const NotificationRow = memo(function NotificationRow({
  item,
  read,
  busy,
  onOpen,
}: {
  item: NotificationItem;
  read: boolean;
  busy: boolean;
  onOpen: (item: NotificationItem, read: boolean) => void;
}) {
  return (
    <TouchableRipple
      style={[styles.surface, !read && styles.unread]}
      onPress={() => onOpen(item, read)}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={read ? 'Đã đọc. Mở thông báo.' : 'Chưa đọc. Đọc và mở thông báo.'}
    >
      <View style={styles.row}>
        <View style={{ paddingTop: 2 }}>
          <Icon
            source={icons[item.category] ?? 'bell-outline'}
            size={20}
            color={read ? colors.muted : staffColors.blue}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <View style={styles.metadata}>
            <Text style={styles.category}>
              {notificationCategories[item.category as keyof typeof notificationCategories] ??
                'Thông báo'}
            </Text>
            <Text style={styles.time}>{formatInstant(item.createdAt)}</Text>
            {!read && <View accessibilityLabel="Chưa đọc" style={styles.dot} />}
          </View>
          <Text style={[styles.title, !read && { fontFamily: fontFaces.semibold }]}>
            {item.title}
          </Text>
          <Text style={styles.summary} numberOfLines={2} ellipsizeMode="tail">
            {item.summary}
          </Text>
        </View>
      </View>
    </TouchableRipple>
  );
});
const styles = StyleSheet.create({
  surface: { backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden' },
  unread: { backgroundColor: '#EDF3FD' },
  row: { flexDirection: 'row', gap: 12, padding: 14, minHeight: 92 },
  metadata: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  category: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fontFaces.medium,
  },
  time: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: staffColors.blue },
  title: { color: colors.ink, fontSize: 14, lineHeight: 21, fontFamily: fontFaces.medium },
  summary: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
