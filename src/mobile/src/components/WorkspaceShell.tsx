import React, { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Badge, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors as c } from '../theme/theme';
import { homeScreen, tabs, type WorkspaceScreen } from '../features/workspace/navigation';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { ui } from './WorkspaceKit';

export function WorkspaceShell({
  screen,
  children,
}: {
  screen: WorkspaceScreen;
  children: React.ReactNode;
}) {
  const { role, preview, go, unavailable, leavePreview, scrollRevision } = useWorkspace();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [screen, scrollRevision]);
  if (!role) return null;
  const active = ['contract', 'checklist', 'residence', 'contract-request'].includes(screen)
    ? 'tenant-home'
    : ['security', 'preferences'].includes(screen)
      ? 'profile'
      : [
            'onboarding',
            'prepare-contract',
            'move-out',
            'move-in',
            'shifts',
            'rooms',
            'debt-follow-up',
          ].includes(screen)
        ? 'staff-home'
        : screen === 'task-detail'
          ? 'work-orders'
          : ['adjustment', 'billing-history'].includes(screen)
            ? 'invoice'
            : screen;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <TouchableRipple
          onPress={() => unavailable('Chọn cơ sở')}
          accessibilityRole="button"
          accessibilityLabel="Chọn cơ sở"
          style={ui.grow}
        >
          <View style={ui.row}>
            {role === 'Owner' && (
              <View style={styles.logo}>
                <Text style={ui.white}>B</Text>
              </View>
            )}
            <View style={ui.grow}>
              <Text variant="labelMedium" style={{ color: c.navy }}>
                BHOME {role === 'Tenant' ? 'RESIDENT' : role.toUpperCase()}
              </Text>
              <Text variant="labelSmall" style={ui.muted}>
                {!preview
                  ? 'Phạm vi theo tài khoản'
                  : role === 'Owner'
                    ? 'Tất cả cơ sở (5/5) ⌄'
                    : role === 'Staff'
                      ? 'Cơ sở Đống Đa - Tòa B'
                      : 'BHOME Cầu Giấy • P.301'}
              </Text>
            </View>
          </View>
        </TouchableRipple>
        <View>
          <IconButton
            icon="bell-outline"
            size={22}
            onPress={() => go('notifications')}
            accessibilityLabel="Thông báo"
          />
          {preview && <Badge size={8} style={styles.badge} />}
        </View>
        <IconButton
          icon="account-circle"
          size={30}
          iconColor={c.navy}
          onPress={() => go('profile')}
          accessibilityLabel="Tài khoản"
        />
      </View>
      {preview && (
        <TouchableRipple
          onPress={leavePreview}
          accessibilityRole="button"
          accessibilityLabel="Thoát xem mẫu"
        >
          <View style={styles.preview}>
            <Text variant="labelSmall" style={ui.blue}>
              DỮ LIỆU MẪU • {role} • Chạm để về đăng nhập
            </Text>
          </View>
        </TouchableRipple>
      )}
      <KeyboardAvoidingView
        style={ui.grow}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          key={screen}
          contentContainerStyle={ui.page}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {['contract', 'checklist', 'security', 'preferences', 'notifications'].includes(
            screen,
          ) && (
            <View style={ui.row}>
              <IconButton
                icon="arrow-left"
                accessibilityLabel="Quay lại"
                onPress={() =>
                  go(
                    screen === 'checklist'
                      ? 'contract'
                      : ['security', 'preferences'].includes(screen)
                        ? 'profile'
                        : homeScreen[role],
                  )
                }
              />
              <Text variant="labelSmall" style={ui.muted}>
                Quay lại
              </Text>
            </View>
          )}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.tabs}>
        {tabs[role].map((tab) => (
          <TouchableRipple
            key={tab.screen}
            onPress={() => go(tab.screen)}
            style={ui.grow}
            accessibilityRole="tab"
            accessibilityState={{ selected: active === tab.screen }}
            accessibilityLabel={tab.title}
          >
            <View style={styles.tab}>
              <View
                style={[styles.indicator, active === tab.screen && { backgroundColor: c.tint }]}
              >
                <Icon
                  source={tab.icon}
                  size={22}
                  color={active === tab.screen ? c.primary : c.muted}
                />
              </View>
              <Text
                variant="labelSmall"
                style={{ color: active === tab.screen ? c.primary : c.muted }}
              >
                {tab.title}
              </Text>
            </View>
          </TouchableRipple>
        ))}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 8,
    minHeight: 64,
    borderBottomColor: '#eef0f8',
    borderBottomWidth: 1,
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.red },
  preview: { paddingVertical: 5, alignItems: 'center', backgroundColor: c.tint },
  tabs: {
    flexDirection: 'row',
    borderTopColor: c.border,
    borderTopWidth: 1,
    backgroundColor: c.white,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 64,
    paddingVertical: 6,
  },
  indicator: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 },
});
