import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ActivityIndicator, Button, Icon, IconButton, Menu, Text } from 'react-native-paper';
import {
  notificationCategories,
  type NotificationItem,
} from '../../../../packages/client-core/src/notifications';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { homeScreen } from '../features/workspace/navigation';
import { useNotificationInbox } from '../features/notifications/useNotificationInbox';
import { useNotificationActions } from '../features/notifications/useNotificationActions';
import { NotificationRow } from '../features/notifications/NotificationRow';
import { colors, staffColors } from '../theme/theme';
import type { NotificationFilter } from '../services/notificationInbox';

const keyForItem = (item: NotificationItem) => item.id;
const Separator = () => <View style={{ height: 8 }} />;
export function NotificationsScreen() {
  const { session } = useSession();
  const [category, setCategory] = useState('');
  const [unread, setUnread] = useState(false);
  const scope = JSON.stringify([session?.userId, session?.roles, category, unread]);
  return (
    <Inbox key={scope} filter={{ category, unread }} category={setCategory} unread={setUnread} />
  );
}
function Inbox({
  filter,
  category,
  unread,
}: {
  filter: NotificationFilter;
  category: (value: string) => void;
  unread: (value: boolean) => void;
}) {
  const { api, session } = useSession();
  const { role, go, requestNavigation } = useWorkspace();
  const inbox = useNotificationInbox(filter);
  const actions = useNotificationActions(inbox);
  const [menu, setMenu] = useState(false);
  const refresh = inbox.refresh;
  const refreshCount = inbox.refreshCount;
  const reload = useCallback(() => {
    void refresh().catch(() => {});
    refreshCount();
  }, [refresh, refreshCount]);
  const open = actions.open;
  const onOpen = useCallback(
    (item: NotificationItem, read: boolean) => {
      void open(item, read);
    },
    [open],
  );
  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <NotificationRow
        item={item}
        read={!!item.readAt || !!inbox.data?.confirmedReadIds.includes(item.id)}
        busy={actions.busy === item.id}
        onOpen={onOpen}
      />
    ),
    [inbox.data?.confirmedReadIds, actions.busy, onOpen],
  );
  const clear = () => {
    category('');
    unread(false);
  };
  const back = () =>
    requestNavigation(() => {
      if (router.canGoBack()) router.back();
      else if (role) go(homeScreen[role]);
    });
  if (!session)
    return (
      <View style={styles.empty}>
        <Text>Đăng nhập để xem thông báo.</Text>
      </View>
    );
  return (
    <FlatList<NotificationItem>
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      data={session && api ? inbox.items : []}
      keyExtractor={keyForItem}
      renderItem={renderItem}
      initialNumToRender={12}
      windowSize={7}
      ItemSeparatorComponent={Separator}
      refreshControl={
        <RefreshControl
          refreshing={inbox.fetching && !!inbox.data}
          onRefresh={reload}
          tintColor={staffColors.blue}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <View style={styles.header}>
            {role !== 'Staff' && (
              <IconButton
                icon="arrow-left"
                size={22}
                accessibilityLabel="Quay lại"
                onPress={back}
                style={{ margin: 0 }}
              />
            )}
            <Text variant="titleLarge" style={{ flex: 1 }}>
              Thông báo
            </Text>
            {(inbox.unreadCount ?? 0) > 0 && (
              <Button
                compact
                mode="text"
                disabled={!!actions.busy || !api}
                loading={actions.busy === 'all'}
                onPress={() => void actions.readAll()}
              >
                Đọc tất cả
              </Button>
            )}
          </View>
          <View style={styles.filters}>
            <Button
              compact
              mode={!filter.unread ? 'contained-tonal' : 'text'}
              accessibilityState={{ selected: !filter.unread }}
              onPress={() => unread(false)}
            >
              Tất cả
            </Button>
            <Button
              compact
              mode={filter.unread ? 'contained-tonal' : 'text'}
              accessibilityState={{ selected: filter.unread }}
              onPress={() => unread(true)}
            >
              {inbox.unreadCount === null ? 'Chưa đọc' : `Chưa đọc (${inbox.unreadCount})`}
            </Button>
            <Menu
              visible={menu}
              onDismiss={() => setMenu(false)}
              anchor={
                <Button
                  compact
                  mode={filter.category ? 'contained-tonal' : 'text'}
                  icon="filter-variant"
                  onPress={() => setMenu(true)}
                >
                  Bộ lọc
                </Button>
              }
            >
              <Menu.Item
                title="Tất cả nhóm"
                onPress={() => {
                  category('');
                  setMenu(false);
                }}
              />
              {Object.entries(notificationCategories).map(([id, label]) => (
                <Menu.Item
                  key={id}
                  title={label}
                  leadingIcon={filter.category === id ? 'check' : undefined}
                  onPress={() => {
                    category(id);
                    setMenu(false);
                  }}
                />
              ))}
            </Menu>
          </View>
          {!!filter.category && (
            <View style={styles.activeFilter}>
              <Text style={styles.muted}>
                {notificationCategories[filter.category as keyof typeof notificationCategories]}
              </Text>
              <IconButton
                size={16}
                icon="close"
                accessibilityLabel="Xóa bộ lọc nhóm"
                onPress={() => category('')}
                style={{ margin: 0 }}
              />
            </View>
          )}
          {!!inbox.rawError && (
            <View style={styles.error}>
              <Text accessibilityRole="alert" style={styles.muted}>
                Không thể tải thông báo
              </Text>
              <Button compact mode="text" onPress={reload} disabled={inbox.fetching}>
                Thử lại
              </Button>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        inbox.loading && session ? (
          <NotificationSkeleton />
        ) : !inbox.rawError ? (
          <View style={styles.empty}>
            <Icon source="bell-outline" size={30} color={colors.muted} />
            <Text variant="titleMedium">
              {filter.category || filter.unread
                ? 'Không có thông báo phù hợp'
                : 'Chưa có thông báo'}
            </Text>
            <Text style={styles.muted}>Các cập nhật mới sẽ xuất hiện tại đây.</Text>
            {(filter.category || filter.unread) && (
              <Button compact mode="text" onPress={clear}>
                Xóa bộ lọc
              </Button>
            )}
          </View>
        ) : undefined
      }
      ListFooterComponent={
        <View style={{ paddingVertical: 12 }}>
          {inbox.loadingMore ? (
            <ActivityIndicator size="small" accessibilityLabel="Đang tải thêm thông báo" />
          ) : (
            inbox.data?.hasMore && (
              <Button
                compact
                mode="text"
                disabled={inbox.fetching || !!actions.busy}
                onPress={() => void inbox.loadMore()}
              >
                {inbox.moreError ? 'Thử tải thêm' : 'Tải thêm'}
              </Button>
            )
          )}
        </View>
      }
    />
  );
}
function NotificationSkeleton() {
  return (
    <View
      accessibilityLabel="Đang tải thông báo"
      accessibilityRole="progressbar"
      style={{ gap: 8 }}
    >
      {[0, 1, 2, 3].map((n) => (
        <View key={n} style={styles.skeleton}>
          <View style={styles.skeletonIcon} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skeletonLine, { width: '35%' }]} />
            <View style={[styles.skeletonLine, { width: '85%' }]} />
            <View style={[styles.skeletonLine, { width: '65%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 24,
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  activeFilter: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  empty: { paddingVertical: 48, alignItems: 'center', gap: 10 },
  skeleton: {
    borderRadius: 14,
    backgroundColor: colors.white,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
  },
  skeletonIcon: { width: 20, height: 20, borderRadius: 5, backgroundColor: colors.soft },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: colors.soft },
});
