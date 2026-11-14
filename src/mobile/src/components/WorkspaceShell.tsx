import { KeyboardFormScrollView } from './KeyboardFormScrollView';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Badge, Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useNavigation } from 'expo-router';
import { colors as c, staffColors as s } from '../theme/theme';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { WorkspaceTabsContext } from '../features/workspace/WorkspaceTabsContext';
import {
  activeWorkspaceTab,
  homeScreen,
  isWorkspaceTabDestination,
  workspaceTabHref,
  roleLabel,
  tabs,
  type WorkspaceScreen,
} from '../features/workspace/navigation';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { ui } from './WorkspaceKit';
import { NotificationBadge } from './NotificationBadge';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { queryPolicies } from '../lib/queryPolicies';
import type { Named } from '../lib/api';
import { WorkspaceHeaderContext, type WorkspaceHeaderAction } from './WorkspaceHeaderContext';
import { WorkspaceFooterContext } from './WorkspaceFooter';

function StaffLocationSubtitle() {
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations', {
    cache: queryPolicies.rooms,
  });
  return (
    <Text variant="labelSmall" numberOfLines={2} style={styles.staffSubtitle}>
      {locations.loading
        ? 'Đang tải cơ sở…'
        : locations.data?.length
          ? locations.data.map((item) => item.label).join(' · ') +
            (locations.error ? ' · Chưa cập nhật được' : '')
          : locations.error
            ? 'Chưa tải được cơ sở'
            : 'Chưa có cơ sở được phân công'}
    </Text>
  );
}
function TenantLocationSubtitle() {
  const contracts = useWorkspaceQuery<{
    items: { locationName: string; roomNumber: string; kind?: string }[];
  }>('/api/v1/contracts?page=1&pageSize=20&status=Active', { cache: queryPolicies.contracts });
  const current = contracts.data?.items.find((item) => item.kind !== 'Holding');
  return (
    <Text variant="labelSmall" numberOfLines={2} style={styles.staffSubtitle}>
      {contracts.loading
        ? 'Đang tải phòng…'
        : current
          ? `${current.locationName} · Phòng ${current.roomNumber}${contracts.error ? ' · Chưa cập nhật được' : ''}`
          : contracts.error
            ? 'Chưa tải được phòng'
            : 'Chưa có hợp đồng đang hiệu lực'}
    </Text>
  );
}

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
  const insideTabs = useContext(WorkspaceTabsContext);
  const navigation = useNavigation();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [workflowFooter, setWorkflowFooter] = useState<{
    screen: WorkspaceScreen;
    content: React.ReactNode;
  } | null>(null);
  const registerWorkflowFooter = useCallback(
    (content: React.ReactNode) => {
      setWorkflowFooter({ screen, content });
      return () => setWorkflowFooter(null);
    },
    [screen],
  );
  const [headerAction, setHeaderAction] = useState<WorkspaceHeaderAction | null>(null);
  const registerHeaderAction = useCallback((action: WorkspaceHeaderAction) => {
    setHeaderAction(action);
    return () => setHeaderAction(null);
  }, []);
  useEffect(() => {
    if (navigation.isFocused()) scroll.current?.scrollTo({ y: 0, animated: false });
  }, [screen, scrollRevision, contentRevision, navigation]);
  if (!role) return null;
  const staff = role === 'Staff';
  const tenantFeatures = role === 'Tenant' && screen === 'tenant-features';
  const tenantHomeLayout = role === 'Tenant' && ['tenant-home', 'tenant-features'].includes(screen);
  const compactContracts = staff && ['signing', 'contract'].includes(screen) && !preview;
  const compactTasks = staff && ['work-orders', 'task-detail'].includes(screen) && !preview;
  const compactTaskDetail = compactTasks && screen === 'task-detail';
  const tenantRoom = role === 'Tenant' && screen === 'tenant-room' && !preview;
  const tenantResidence = role === 'Tenant' && screen === 'residence' && !preview;
  const tenantLedger = role === 'Tenant' && screen === 'billing-history' && !preview;
  const tenantIncidentForm = role === 'Tenant' && screen === 'incidents';
  const dashboard =
    !preview &&
    (screen === 'tenant-home' ||
      screen === 'staff-home' ||
      (role === 'Owner' && screen === 'owner-home'));
  const profile = !preview && screen === 'profile';
  const profileEdit = screen === 'profile-edit';
  const notificationInbox = screen === 'notifications' && !preview;
  const tenantInvoice =
    role === 'Tenant' && ['invoice', 'adjustment', 'billing-history'].includes(screen) && !preview;
  const visibleTabs = tabs[role];
  const active = activeWorkspaceTab(role, screen);
  function back() {
    if (onBack) return onBack();
    const fallback =
      screen === 'incident-inbox'
        ? role === 'Tenant'
          ? 'tenant-requests'
          : role === 'Staff'
            ? 'staff-incidents'
            : 'owner-incidents'
        : screen === 'checklist'
          ? 'contract'
          : ['security', 'preferences', 'profile-edit'].includes(screen)
            ? 'profile'
            : staff && screen === 'task-detail'
              ? 'work-orders'
              : homeScreen[role!];
    if (!staff && role !== 'Tenant' && !profileEdit && screen !== 'incident-inbox')
      return go(fallback);
    requestNavigation(() => {
      if (router.canGoBack()) router.back();
      else if (isWorkspaceTabDestination(role!, fallback))
        router.replace(workspaceTabHref(fallback));
      else router.replace({ pathname: '/workspace/[screen]', params: { screen: fallback } });
    });
  }
  return (
    <SafeAreaView
      style={[styles.root, tenantHomeLayout && { backgroundColor: '#173654' }]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style="light" />
      <View style={[styles.header, tenantHomeLayout && styles.tenantHeader]}>
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
            <View style={[styles.logo, tenantHomeLayout && styles.tenantLogo]}>
              <Icon source="home-roof" size={tenantHomeLayout ? 24 : 32} color={s.blue} />
            </View>
            <View style={ui.grow}>
              <Text variant={tenantHomeLayout ? 'titleMedium' : 'titleLarge'} style={ui.white}>
                {tenantHomeLayout
                  ? 'BHOME'
                  : `BHOME ${staff ? 'Nhân viên' : role === 'Tenant' ? 'Khách thuê' : role.toUpperCase()}`}
              </Text>
              {tenantHomeLayout ? (
                <Text variant="labelSmall" style={styles.staffSubtitle}>
                  {tenantFeatures ? 'Tiện ích cư dân' : 'Chào mừng trở lại!'}
                </Text>
              ) : staff && !preview ? (
                <StaffLocationSubtitle />
              ) : role === 'Tenant' && !preview ? (
                tenantRoom || tenantInvoice || tenantIncidentForm || tenantResidence ? (
                  <Text variant="labelSmall" style={styles.staffSubtitle}>
                    {tenantResidence
                      ? 'Theo dõi tạm trú'
                      : tenantRoom
                        ? 'Phòng thuê & hợp đồng'
                        : tenantIncidentForm
                          ? 'Hỗ trợ cư dân'
                          : 'Thông tin tài chính của phòng'}
                  </Text>
                ) : (
                  <TenantLocationSubtitle />
                )
              ) : (
                <Text variant="labelSmall" style={styles.staffSubtitle}>
                  {!preview
                    ? 'Phạm vi theo tài khoản'
                    : role === 'Owner'
                      ? 'Tất cả cơ sở (5/5)'
                      : staff
                        ? 'Cơ sở Đống Đa - Tòa B'
                        : 'BHOME Cầu Giấy • P.301'}
                </Text>
              )}
            </View>
          </View>
        </TouchableRipple>
        <View>
          <IconButton
            icon="bell-outline"
            iconColor={c.white}
            size={tenantHomeLayout ? 20 : 22}
            onPress={() => go('notifications')}
            accessibilityLabel="Thông báo"
          />
          {preview && <Badge size={8} style={styles.badge} />}
          {!preview && <NotificationBadge />}
        </View>
        {staff && (
          <IconButton
            icon="account-circle-outline"
            iconColor={c.white}
            size={24}
            onPress={() => go('profile')}
            accessibilityLabel="Mở tài khoản cá nhân"
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
            <Text variant="labelSmall" style={[ui.blue, styles.staffPreviewText]}>
              DỮ LIỆU MẪU • {roleLabel[role]} • Chạm để về đăng nhập
            </Text>
          </View>
        </TouchableRipple>
      )}
      <KeyboardAvoidingView
        style={[ui.grow, styles.staffBody]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {notificationInbox || (staff && screen === 'rooms') ? (
          children
        ) : (
          <KeyboardFormScrollView
            ref={scroll}
            key={screen}
            contentContainerStyle={[
              ui.page,
              styles.staffPage,
              (compactContracts || compactTasks) && { gap: 12, paddingTop: 8 },
              (profile || profileEdit) && { gap: 16 },
              tenantRoom && { gap: 12, paddingTop: 8 },
              tenantResidence && { gap: 12, paddingTop: 8 },
              tenantInvoice && { gap: 12, paddingTop: 8 },
              tenantHomeLayout && { gap: 20, paddingTop: 12 },
              screen === 'meter-reading' && { gap: 12, paddingTop: 8 },
              screen === 'rooms' && { gap: 12, paddingTop: 8, paddingBottom: 100 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={
              (dashboard ||
                tenantRoom ||
                tenantInvoice ||
                profile ||
                compactTasks ||
                compactContracts ||
                tenantResidence) &&
              headerAction ? (
                <RefreshControl
                  refreshing={headerAction.disabled}
                  onRefresh={headerAction.onRefresh}
                />
              ) : undefined
            }
          >
            {!tenantIncidentForm &&
              (profileEdit ||
                tenantInvoice ||
                (staff && !['staff-home', 'profile'].includes(screen)) ||
                (role === 'Tenant' && !visibleTabs.some((tab) => tab.screen === screen)) ||
                ['contract', 'checklist', 'security', 'preferences', 'notifications'].includes(
                  screen,
                )) && (
                <View style={ui.row}>
                  <IconButton
                    icon="arrow-left"
                    accessibilityLabel="Quay lại"
                    disabled={backDisabled || (profileEdit && !!headerAction?.disabled)}
                    onPress={headerAction?.onBack ? headerAction.onBack : back}
                  />
                  <Text
                    variant={
                      !!headerAction?.title ||
                      compactContracts ||
                      compactTasks ||
                      tenantResidence ||
                      tenantInvoice ||
                      tenantFeatures ||
                      profileEdit
                        ? 'titleMedium'
                        : 'labelSmall'
                    }
                    style={
                      !!headerAction?.title ||
                      compactContracts ||
                      compactTasks ||
                      tenantResidence ||
                      tenantInvoice ||
                      tenantFeatures ||
                      profileEdit
                        ? [ui.grow, { color: c.primary, fontWeight: '700' }]
                        : ui.muted
                    }
                  >
                    {profileEdit
                      ? 'Chỉnh sửa hồ sơ'
                      : tenantResidence
                        ? 'Đăng ký tạm trú'
                        : tenantFeatures
                          ? 'Tất cả chức năng'
                          : tenantInvoice
                            ? (headerAction?.title ?? 'Hóa đơn của tôi')
                            : compactTasks
                              ? compactTaskDetail
                                ? 'Chi tiết công việc'
                                : 'Công việc vận hành'
                              : compactContracts
                                ? (headerAction?.title ?? 'Hợp đồng')
                                : (headerAction?.title ?? 'Quay lại')}
                  </Text>
                  {(compactContracts || compactTasks || tenantInvoice || tenantResidence) &&
                    headerAction && (
                      <>
                        <IconButton
                          icon="refresh"
                          accessibilityLabel={
                            tenantResidence
                              ? 'Tải lại hồ sơ tạm trú'
                              : compactTasks
                                ? 'Tải lại công việc'
                                : tenantLedger
                                  ? 'Tải lại giao dịch'
                                  : tenantInvoice
                                    ? 'Tải lại hóa đơn'
                                    : 'Tải lại hợp đồng'
                          }
                          disabled={headerAction.disabled}
                          onPress={headerAction.onRefresh}
                        />
                      </>
                    )}
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
            <WorkspaceHeaderContext.Provider
              value={
                dashboard ||
                compactContracts ||
                compactTasks ||
                tenantRoom ||
                tenantResidence ||
                tenantInvoice ||
                profile ||
                profileEdit
                  ? registerHeaderAction
                  : null
              }
            >
              <WorkspaceFooterContext.Provider value={registerWorkflowFooter}>
                {children}
              </WorkspaceFooterContext.Provider>
            </WorkspaceHeaderContext.Provider>
          </KeyboardFormScrollView>
        )}
        {(profileEdit || compactTaskDetail) && headerAction?.footer}
        {workflowFooter?.screen === screen && workflowFooter.content}
      </KeyboardAvoidingView>
      {!insideTabs && <WorkspaceTabBar role={role} screen={screen} active={active} onSelect={go} />}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  tenantHeader: { minHeight: 64, paddingLeft: 16 },
  tenantLogo: { width: 32, height: 32, borderRadius: 10 },
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
});
