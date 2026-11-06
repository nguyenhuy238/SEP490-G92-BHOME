import { KeyboardFormScrollView } from './KeyboardFormScrollView';
import React, { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Badge, Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
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
  onBack,
  backDisabled = false,
  contentRevision,
}: {
  screen: WorkspaceScreen;
  children: React.ReactNode;
  onBack?: () => void;
  backDisabled?: boolean;
  contentRevision?: number;
}) {
  const { role, preview, go, leavePreview, scrollRevision, requestNavigation } = useWorkspace();
  const insets = useSafeAreaInsets();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [screen, scrollRevision, contentRevision]);
  if (!role) return null;
  const staff = role === 'Staff';
  const visibleTabs = tabs[role];
  const active = activeWorkspaceTab(role, screen);
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={styles.header}>
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
            <View style={styles.logo}>
              <Icon source="home-roof" size={32} color={s.blue} />
            </View>
            <View style={ui.grow}>
              <Text variant="titleLarge" style={ui.white}>
                BHOME{' '}
                {staff
                  ? 'Staff'
                  : role === 'Tenant'
                    ? screen === 'tenant-home'
                      ? 'Tenant'
                      : 'RESIDENT'
                    : role.toUpperCase()}
              </Text>
              <Text variant="labelSmall" style={styles.staffSubtitle}>
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
            iconColor={c.white}
            size={22}
            onPress={() => go('notifications')}
            accessibilityLabel="Thông báo"
          />
          {preview && <Badge size={8} style={styles.badge} />}
          {!preview && <NotificationBadge />}
        </View>
      </View>
      {preview && (
        <TouchableRipple
          onPress={leavePreview}
          accessibilityRole="button"
          accessibilityLabel="Thoát xem mẫu"
        >
          <View style={styles.preview}>
            <Text variant="labelSmall" style={[ui.blue, styles.staffPreviewText]}>
              DỮ LIỆU MẪU • {role} • Chạm để về đăng nhập
            </Text>
          </View>
        </TouchableRipple>
      )}
      <KeyboardAvoidingView
        style={[ui.grow, styles.staffBody]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <KeyboardFormScrollView
          ref={scroll}
          key={screen}
          contentContainerStyle={[
            ui.page,
            styles.staffPage,
            screen === 'meter-reading' && { gap: 16 },
          ]}
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
                disabled={backDisabled}
                onPress={() =>
                  onBack
                    ? onBack()
                    : go(
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
          {__DEV__ && !preview && (role === 'Owner' || staff) && screen === homeScreen[role] && (
            <Button
              mode="contained-tonal"
              icon="test-tube"
              onPress={() => requestNavigation(() => router.push('/ocr-test'))}
            >
              Test OCR
            </Button>
          )}
          {children}
        </KeyboardFormScrollView>
      </KeyboardAvoidingView>
      <View style={[styles.tabs, { paddingBottom: insets.bottom }]}>
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
                style={[styles.indicator, active === tab.screen && { backgroundColor: s.blueSoft }]}
              >
                <Icon
                  source={tab.icon}
                  size={22}
                  color={active === tab.screen ? s.blue : c.muted}
                />
              </View>
              <Text
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  lineHeight: 14,
                  fontWeight: active === tab.screen ? '700' : '500',
                  color: active === tab.screen ? s.blue : c.muted,
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
  root: { flex: 1, backgroundColor: s.navy },
  staffSubtitle: { color: '#d5e4ff', marginTop: 3 },
  staffBody: {
    backgroundColor: s.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  staffPage: { padding: 16, paddingBottom: 24, gap: 24 },
  staffPreviewText: { textAlign: 'center', paddingHorizontal: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 8,
    minHeight: 72,
    paddingBottom: 6,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: 12, right: 12, backgroundColor: c.red },
  preview: { paddingVertical: 5, alignItems: 'center', backgroundColor: c.tint },
  tabs: {
    flexDirection: 'row',
    backgroundColor: c.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    boxShadow: '0 -3px 16px rgba(25, 52, 82, 0.06)',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 60,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  indicator: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 },
});
