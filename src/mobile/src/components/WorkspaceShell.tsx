import React, { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Badge, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors as c, staffColors as s } from '../theme/theme';
import {
  activeWorkspaceTab,
  homeScreen,
  tabs,
  type WorkspaceScreen,
} from '../features/workspace/navigation';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { ui } from './WorkspaceKit';
import { NotificationBadge } from './NotificationBadge';

export function WorkspaceShell({
  screen,
  children,
}: {
  screen: WorkspaceScreen;
  children: React.ReactNode;
}) {
  const { role, preview, go, leavePreview, scrollRevision } = useWorkspace();
  const insets = useSafeAreaInsets();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [screen, scrollRevision]);
  if (!role) return null;
  const staff = role === 'Staff';
  const visibleTabs = tabs[role];
  const active = activeWorkspaceTab(role, screen);
  return (
    <SafeAreaView style={[styles.root, staff && styles.staffRoot]} edges={['top', 'left', 'right']}>
      <StatusBar style={staff ? 'light' : 'auto'} />
      <View style={[styles.header, staff && styles.staffHeader]}>
        <TouchableRipple
          onPress={() =>
            go(
              preview
                ? homeScreen[role]
                : role === 'Owner'
                  ? 'operations'
                  : role === 'Staff'
                    ? 'rooms'
                    : 'contract',
            )
          }
          accessibilityRole="button"
          accessibilityLabel={role === 'Tenant' ? 'Xem hợp đồng của bạn' : 'Xem cơ sở được phép'}
          style={ui.grow}
        >
          <View style={ui.row}>
            {(role === 'Owner' || staff) && (
              <View style={[styles.logo, staff && styles.staffLogo]}>
                {staff ? (
                  <Icon source="home-roof" size={32} color={s.blue} />
                ) : (
                  <Text style={ui.white}>B</Text>
                )}
              </View>
            )}
            <View style={ui.grow}>
              <Text
                variant={staff ? 'titleLarge' : 'labelMedium'}
                style={{ color: staff ? c.white : c.navy }}
              >
                BHOME {staff ? 'Staff' : role === 'Tenant' ? 'RESIDENT' : role.toUpperCase()}
              </Text>
              <Text variant="labelSmall" style={staff ? styles.staffSubtitle : ui.muted}>
                {!preview
                  ? 'Phạm vi theo tài khoản'
                  : role === 'Owner'
                    ? 'Tất cả cơ sở (5/5)'
                    : staff
                      ? 'Cơ sở Đống Đa - Tòa B'
                      : 'BHOME Cầu Giấy • P.301'}
              </Text>
            </View>
          </View>
        </TouchableRipple>
        <View>
          <IconButton
            icon="bell-outline"
            iconColor={staff ? c.white : c.navy}
            size={22}
            onPress={() => go('notifications')}
            accessibilityLabel="Thông báo"
          />
          {preview && <Badge size={8} style={styles.badge} />}
          {!preview && <NotificationBadge />}
        </View>
        {!staff && (
          <IconButton
            icon="account-circle"
            size={30}
            iconColor={c.navy}
            onPress={() => go('profile')}
            accessibilityLabel="Tài khoản"
          />
        )}
      </View>
      {preview && (
        <TouchableRipple
          onPress={leavePreview}
          accessibilityRole="button"
          accessibilityLabel="Thoát xem mẫu"
        >
          <View style={styles.preview}>
            <Text variant="labelSmall" style={[ui.blue, staff && styles.staffPreviewText]}>
              DỮ LIỆU MẪU • {role} • Chạm để về đăng nhập
            </Text>
          </View>
        </TouchableRipple>
      )}
      <KeyboardAvoidingView
        style={[ui.grow, staff && styles.staffBody]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          key={screen}
          contentContainerStyle={[ui.page, staff && styles.staffPage]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {((staff && !['staff-home', 'profile'].includes(screen)) ||
            ['contract', 'checklist', 'security', 'preferences', 'notifications'].includes(
              screen,
            )) && (
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
      <View style={[styles.tabs, staff && styles.staffTabs, { paddingBottom: insets.bottom }]}>
        {visibleTabs.map((tab) => (
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
                style={[
                  styles.indicator,
                  active === tab.screen && { backgroundColor: staff ? s.blueSoft : c.tint },
                ]}
              >
                <Icon
                  source={tab.icon}
                  size={22}
                  color={active === tab.screen ? (staff ? s.blue : c.primary) : c.muted}
                />
              </View>
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: 14,
                  fontWeight: active === tab.screen ? '700' : '500',
                  color: active === tab.screen ? (staff ? s.blue : c.primary) : c.muted,
                }}
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
  staffRoot: { backgroundColor: s.navy },
  staffHeader: { minHeight: 72, borderBottomWidth: 0, paddingBottom: 6 },
  staffLogo: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.white },
  staffSubtitle: { color: '#d5e4ff', marginTop: 3 },
  staffBody: {
    backgroundColor: s.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  staffPage: { padding: 16, paddingBottom: 24, gap: 24 },
  staffPreviewText: { textAlign: 'center', paddingHorizontal: 12 },
  staffTabs: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 0,
    boxShadow: '0 -3px 16px rgba(25, 52, 82, 0.06)',
  },
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
    height: 60,
    paddingVertical: 4,
  },
  indicator: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 },
});
