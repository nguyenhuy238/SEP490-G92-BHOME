import { KeyboardFormScrollView } from './KeyboardFormScrollView';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Badge,
  Button,
  Dialog,
  Icon,
  IconButton,
  Portal,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { colors as c, staffColors as s } from '../theme/theme';
import { staffHomePalette, staffLayout } from '../theme/staffLayout';
import { fontStyle } from '../theme/typography';
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
import {
  WorkspaceHeaderContext,
  WorkspaceInlineHeaderContext,
  type WorkspaceHeaderAction,
} from './WorkspaceHeaderContext';
import { WorkspaceFooterContext } from './WorkspaceFooter';

// Metro requires a literal path for native image bundling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const brandMark = require('../../assets/bhome-mark.png');

function StaffLocationSubtitle() {
  const { staffLocationId, staffLocations, staffLocationsLoading, staffLocationsError } =
    useWorkspace();
  const selected = staffLocations.find((location) => location.id === staffLocationId);
  return (
    <View style={styles.locationSubtitleRow}>
      <Text
        variant="labelSmall"
        numberOfLines={2}
        style={[styles.staffLocationCaption, styles.locationSubtitleText]}
      >
        {staffLocationsLoading
          ? 'Đang tải cơ sở…'
          : selected
            ? selected.label + (staffLocationsError ? ' · Chưa cập nhật được' : '')
            : staffLocationsError
              ? 'Chưa tải được cơ sở'
              : 'Chưa có cơ sở được phân công'}
      </Text>
      <Icon source="chevron-down" size={14} color={c.muted} />
    </View>
  );
}
function TenantLocationSubtitle() {
  const contracts = useWorkspaceQuery<{
    items: { locationName: string; roomNumber: string; kind?: string }[];
  }>('/api/v1/contracts?page=1&pageSize=20&status=Active', { cache: queryPolicies.contracts });
  const current = contracts.data?.items.find((item) => item.kind !== 'Holding');
  return (
    <Text variant="labelSmall" numberOfLines={2} style={styles.staffLocationCaption}>
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
  const {
    role,
    preview,
    go,
    leavePreview,
    scrollRevision,
    requestNavigation,
    staffLocationId,
    staffLocations,
    staffLocationsLoading,
    staffLocationsError,
    selectStaffLocation,
    reloadStaffLocations,
  } = useWorkspace();
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const { width } = useWindowDimensions();
  const narrowStaff = (role === 'Staff' || role === 'Tenant') && width <= 360;
  const insideTabs = useContext(WorkspaceTabsContext);
  const navigation = useNavigation();
  // Navigation focus is mutable external state. React warns when read during
  // render; useFocusEffect synchronizes it after the screen becomes active.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const webHomeScrollY = useRef(0);
  const webHomePull = useRef<{ x: number; y: number } | null>(null);
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
  const [inlineHeaderVisible, setInlineHeaderVisible] = useState(false);
  const registerInlineHeader = useCallback(() => {
    setInlineHeaderVisible(true);
    return () => setInlineHeaderVisible(false);
  }, []);
  const registerHeaderAction = useCallback((action: WorkspaceHeaderAction) => {
    setHeaderAction(action);
    return () => setHeaderAction(null);
  }, []);
  useEffect(() => {
    if (navigation.isFocused()) scroll.current?.scrollTo({ y: 0, animated: false });
  }, [screen, scrollRevision, contentRevision, navigation]);
  if (!role) return null;
  const staff = role === 'Staff';
  const tenant = role === 'Tenant';
  const lightWorkspace = staff || tenant;
  const lightHome = (staff && screen === 'staff-home') || (tenant && screen === 'tenant-home');
  const staffInspection = staff && ['move-in', 'move-out'].includes(screen) && !preview;
  const webStaffHome = staff && screen === 'staff-home' && !preview && Platform.OS === 'web';
  const owner = role === 'Owner' && !preview;
  const tenantFeatures = role === 'Tenant' && screen === 'tenant-features';
  const compactContracts = staff && ['signing', 'contract'].includes(screen) && !preview;
  const compactTasks =
    staff &&
    ['work-orders', 'task-detail', 'staff-handovers', 'maintenance-detail'].includes(screen) &&
    !preview;
  const compactTaskDetail = compactTasks && screen === 'task-detail';
  const compactMeter = staff && screen === 'meter-reading' && !preview;
  const staffIncidentList = staff && screen === 'staff-incidents' && !preview;
  const tenantRoom = role === 'Tenant' && screen === 'tenant-room' && !preview;
  const tenantResidence = role === 'Tenant' && screen === 'residence' && !preview;
  const tenantLedger = role === 'Tenant' && screen === 'billing-history' && !preview;
  const tenantIncidentForm = role === 'Tenant' && screen === 'incidents';
  const tenantRefundForm = role === 'Tenant' && screen === 'refund-requests';
  const tenantHandovers = role === 'Tenant' && screen === 'tenant-handovers';
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
    // The handover queue is a child of the staff dashboard, not of an inspection
    // that may still be present in the navigation history.
    if (staff && screen === 'staff-handovers') return go('staff-home');
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
            : owner && ['incident-detail', 'maintenance-detail', 'task-detail'].includes(screen)
              ? 'operations'
              : owner && screen === 'signing'
                ? 'approvals'
                : staff && ['move-in', 'move-out', 'staff-handover-archive'].includes(screen)
                  ? 'staff-handovers'
                  : staff && screen === 'task-detail'
                    ? 'work-orders'
                    : homeScreen[role!];
    if (!staff && !owner && role !== 'Tenant' && !profileEdit && screen !== 'incident-inbox')
      return go(fallback);
    requestNavigation(() => {
      if (router.canGoBack()) router.back();
      else if (isWorkspaceTabDestination(role!, fallback))
        router.replace(workspaceTabHref(fallback));
      else
        router.replace({
          pathname: '/workspace/[screen]',
          params: { screen: fallback, ...(screen === 'move-out' ? { tab: 'MoveOut' } : {}) },
        });
    });
  }
  return (
    <SafeAreaView
      aria-hidden={owner ? !focused : undefined}
      importantForAccessibility={owner && !focused ? 'no-hide-descendants' : 'auto'}
      style={[styles.root, lightWorkspace && styles.staffRoot, lightHome && styles.staffHomeRoot]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style={lightWorkspace ? 'dark' : 'light'} />
      <View
        style={[
          styles.header,
          narrowStaff && styles.narrowHeader,
          lightWorkspace && styles.compactStaffHeader,
          lightHome && styles.staffHomeHeader,
        ]}
      >
        <TouchableRipple
          onPress={() => {
            if (staff && !preview) {
              setLocationPickerOpen(true);
              return;
            }
            go(preview ? homeScreen[role] : role === 'Owner' ? 'operations' : 'contract');
          }}
          accessibilityRole="button"
          accessibilityLabel={
            staff && !preview
              ? 'Đổi cơ sở'
              : role === 'Tenant'
                ? 'Xem hợp đồng của bạn'
                : 'Xem cơ sở được phép'
          }
          style={[ui.grow, lightWorkspace && styles.staffBrandAction]}
        >
          <View style={[ui.row, lightWorkspace && styles.staffBrandRow]}>
            <View
              style={[
                styles.logo,
                narrowStaff && styles.narrowLogo,
                lightWorkspace && styles.compactStaffLogo,
              ]}
            >
              <Image
                source={brandMark}
                resizeMode="contain"
                accessible={false}
                style={{
                  width: lightWorkspace ? 34 : 30,
                  height: lightWorkspace ? 34 : 30,
                }}
              />
            </View>
            <View style={ui.grow}>
              <Text
                variant={lightWorkspace ? 'titleMedium' : 'titleLarge'}
                numberOfLines={1}
                style={lightWorkspace ? styles.staffBrandTitle : ui.white}
              >
                {`BHome ${staff ? 'Nhân viên' : tenant ? 'Khách thuê' : 'Chủ cơ sở'}`}
              </Text>
              {lightHome ? null : tenantFeatures ? (
                <Text variant="labelSmall" style={styles.staffLocationCaption}>
                  Tiện ích cư dân
                </Text>
              ) : staff && !preview ? (
                <StaffLocationSubtitle />
              ) : role === 'Tenant' && !preview ? (
                tenantRoom || tenantInvoice || tenantIncidentForm || tenantResidence ? (
                  <Text variant="labelSmall" style={styles.staffLocationCaption}>
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
                <Text
                  variant="labelSmall"
                  style={lightWorkspace ? styles.staffLocationCaption : styles.staffSubtitle}
                >
                  {!preview
                    ? 'Theo dõi cơ sở của bạn'
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
        <View style={lightWorkspace ? styles.staffNotificationAction : undefined}>
          <IconButton
            icon="bell-outline"
            iconColor={lightWorkspace ? s.navy : c.white}
            size={lightWorkspace ? 23 : 22}
            style={lightWorkspace ? styles.compactStaffHeaderButton : undefined}
            onPress={() => go('notifications')}
            accessibilityLabel="Thông báo"
          />
          {preview && <Badge size={8} style={styles.badge} />}
          {!preview && <NotificationBadge />}
        </View>
        {lightWorkspace && (
          <IconButton
            icon="account-circle-outline"
            iconColor={s.navy}
            size={26}
            style={styles.compactStaffHeaderButton}
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
        style={[
          ui.grow,
          styles.staffBody,
          lightWorkspace && styles.compactStaffBody,
          lightHome && styles.staffHomeRoot,
        ]}
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
              lightWorkspace && styles.compactStaffPage,
              lightHome && styles.staffHomePage,
              (compactContracts || compactTasks) && { gap: 12, paddingTop: 8 },
              (profile || profileEdit) && { gap: 16 },
              tenantRoom && { gap: 12, paddingTop: 8 },
              tenantResidence && { gap: 12, paddingTop: 8 },
              tenantInvoice && { gap: 12, paddingTop: 8 },
              tenantFeatures && { gap: 14, paddingTop: 8 },
              screen === 'meter-reading' && { gap: 12, paddingTop: 8 },
              staffInspection && {
                gap: 12,
                paddingTop: 12,
                paddingHorizontal: width <= 380 ? 10 : 16,
              },
              screen === 'rooms' && { gap: 12, paddingTop: 8, paddingBottom: 100 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onScroll={
              webStaffHome
                ? (event) => {
                    webHomeScrollY.current = event.nativeEvent.contentOffset.y;
                  }
                : undefined
            }
            onTouchStart={
              webStaffHome
                ? (event) => {
                    const touch = event.nativeEvent.touches[0];
                    webHomePull.current =
                      webHomeScrollY.current <= 1 && event.nativeEvent.touches.length === 1 && touch
                        ? { x: touch.pageX, y: touch.pageY }
                        : null;
                  }
                : undefined
            }
            onTouchCancel={
              webStaffHome
                ? () => {
                    webHomePull.current = null;
                  }
                : undefined
            }
            onTouchEnd={
              webStaffHome
                ? (event) => {
                    const start = webHomePull.current;
                    webHomePull.current = null;
                    const touch = event.nativeEvent.changedTouches[0];
                    if (
                      start &&
                      touch &&
                      event.nativeEvent.touches.length === 0 &&
                      touch.pageY - start.y >= 72 &&
                      Math.abs(touch.pageX - start.x) < 48 &&
                      webHomeScrollY.current <= 1 &&
                      headerAction &&
                      !headerAction.disabled
                    ) {
                      headerAction.onRefresh();
                    }
                  }
                : undefined
            }
            refreshControl={
              // On web RefreshControl wraps the entire ScrollView. Removing it
              // while a Staff work screen unregisters its header remounts the
              // content and resets the selected tab to the route default.
              (staff &&
                ['work-orders', 'maintenance-detail', 'task-detail'].includes(screen) &&
                !preview) ||
              ((dashboard ||
                owner ||
                tenantRoom ||
                tenantInvoice ||
                profile ||
                compactTasks ||
                compactContracts ||
                tenantResidence) &&
                headerAction) ? (
                <RefreshControl
                  refreshing={headerAction?.disabled ?? false}
                  onRefresh={() => headerAction?.onRefresh()}
                />
              ) : undefined
            }
          >
            {!tenantIncidentForm &&
              !tenantRefundForm &&
              !staffInspection &&
              (profileEdit ||
                (owner && !visibleTabs.some((tab) => tab.screen === screen)) ||
                tenantInvoice ||
                (staff && !['staff-home', 'profile'].includes(screen) && !inlineHeaderVisible) ||
                (role === 'Tenant' && !visibleTabs.some((tab) => tab.screen === screen)) ||
                ['contract', 'checklist', 'security', 'preferences', 'notifications'].includes(
                  screen,
                )) && (
                <View style={[ui.row, staffIncidentList && styles.incidentHeaderRow]}>
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
                      compactMeter ||
                      staffIncidentList ||
                      tenantResidence ||
                      tenantInvoice ||
                      tenantFeatures ||
                      tenantHandovers ||
                      profileEdit
                        ? 'titleMedium'
                        : 'labelSmall'
                    }
                    style={
                      !!headerAction?.title ||
                      compactContracts ||
                      compactTasks ||
                      compactMeter ||
                      staffIncidentList ||
                      tenantResidence ||
                      tenantInvoice ||
                      tenantFeatures ||
                      tenantHandovers ||
                      profileEdit
                        ? [
                            ui.grow,
                            { color: c.primary, fontWeight: '700' },
                            staffIncidentList && { textAlign: 'center' },
                          ]
                        : ui.muted
                    }
                  >
                    {profileEdit
                      ? 'Chỉnh sửa hồ sơ'
                      : tenantResidence
                        ? 'Đăng ký tạm trú'
                        : tenantHandovers
                          ? 'Bàn giao / Chấm dứt hợp đồng'
                          : tenantFeatures
                            ? 'Tất cả chức năng'
                            : tenantInvoice
                              ? (headerAction?.title ?? 'Hóa đơn của tôi')
                              : staffIncidentList
                                ? (headerAction?.title ?? 'Báo cáo sự cố')
                                : compactTasks
                                  ? compactTaskDetail || screen === 'maintenance-detail'
                                    ? 'Chi tiết công việc'
                                    : screen === 'staff-handovers'
                                      ? 'Bàn giao / Trả phòng'
                                      : (headerAction?.title ?? 'Công việc vận hành')
                                  : compactContracts
                                    ? (headerAction?.title ?? 'Hợp đồng')
                                    : compactMeter
                                      ? 'Ghi chỉ số điện nước'
                                      : (headerAction?.title ?? 'Quay lại')}
                  </Text>
                  {(compactContracts ||
                    compactTasks ||
                    compactMeter ||
                    staffIncidentList ||
                    tenantInvoice ||
                    tenantResidence) &&
                    headerAction && (
                      <>
                        {headerAction.disabled || headerAction.action?.disabled ? (
                          <Button
                            compact
                            disabled
                            onPress={() => undefined}
                            accessibilityLabel={
                              headerAction.action?.accessibilityLabel ??
                              (compactMeter
                                ? 'Tải lại danh sách ghi chỉ số'
                                : compactTasks
                                  ? `Tải lại ${headerAction?.title ?? 'công việc'}`
                                  : 'Tải lại')
                            }
                            icon={() => <ActivityIndicator size="small" />}
                          >
                            Đang tải dữ liệu
                          </Button>
                        ) : (
                          <IconButton
                            icon={headerAction.action?.icon ?? 'refresh'}
                            accessibilityLabel={
                              headerAction.action?.accessibilityLabel ??
                              (tenantResidence
                                ? 'Tải lại hồ sơ tạm trú'
                                : compactMeter
                                  ? 'Tải lại danh sách ghi chỉ số'
                                  : compactTasks
                                    ? `Tải lại ${headerAction?.title ?? 'công việc'}`
                                    : tenantLedger
                                      ? 'Tải lại giao dịch'
                                      : tenantInvoice
                                        ? 'Tải lại hóa đơn'
                                        : 'Tải lại hợp đồng')
                            }
                            disabled={headerAction.action?.disabled ?? headerAction.disabled}
                            onPress={headerAction.action?.onPress ?? headerAction.onRefresh}
                          />
                        )}
                      </>
                    )}
                </View>
              )}
            <WorkspaceHeaderContext.Provider
              value={
                dashboard ||
                owner ||
                compactContracts ||
                compactTasks ||
                compactMeter ||
                staffIncidentList ||
                tenantRoom ||
                tenantResidence ||
                tenantInvoice ||
                profile ||
                profileEdit
                  ? registerHeaderAction
                  : null
              }
            >
              <WorkspaceInlineHeaderContext.Provider value={registerInlineHeader}>
                <WorkspaceFooterContext.Provider value={registerWorkflowFooter}>
                  {children}
                </WorkspaceFooterContext.Provider>
              </WorkspaceInlineHeaderContext.Provider>
            </WorkspaceHeaderContext.Provider>
            {staffInspection && !inlineHeaderVisible && (
              <IconButton
                icon="arrow-left"
                accessibilityLabel="Quay lại"
                disabled={backDisabled}
                onPress={headerAction?.onBack ?? back}
                style={{ alignSelf: 'flex-start', margin: 0 }}
              />
            )}
          </KeyboardFormScrollView>
        )}
        {(profileEdit || compactTaskDetail) && headerAction?.footer}
        {workflowFooter?.screen === screen && workflowFooter.content}
      </KeyboardAvoidingView>
      {!insideTabs && <WorkspaceTabBar role={role} screen={screen} active={active} onSelect={go} />}
      {staff && !preview && locationPickerOpen && (
        <Portal>
          <Dialog visible onDismiss={() => setLocationPickerOpen(false)}>
            <Dialog.Title>Đổi cơ sở</Dialog.Title>
            <Dialog.Content>
              {staffLocationsLoading ? (
                <Text>Đang tải cơ sở…</Text>
              ) : staffLocationsError ? (
                <View style={{ gap: 8 }}>
                  <Text accessibilityRole="alert">{staffLocationsError}</Text>
                  <Button onPress={reloadStaffLocations}>Tải lại cơ sở</Button>
                </View>
              ) : staffLocations.length === 0 ? (
                <Text>Chưa có cơ sở được phân công.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 360 }}>
                  {staffLocations.map((location) => (
                    <Button
                      key={location.id}
                      mode={location.id === staffLocationId ? 'contained-tonal' : 'text'}
                      icon={location.id === staffLocationId ? 'check' : undefined}
                      onPress={() => {
                        setLocationPickerOpen(false);
                        if (location.id !== staffLocationId) selectStaffLocation(location.id);
                      }}
                    >
                      {location.label}
                    </Button>
                  ))}
                </ScrollView>
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setLocationPickerOpen(false)}>Đóng</Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  narrowHeader: { paddingLeft: 12, paddingRight: 0, minHeight: 64 },
  narrowLogo: { width: 34, height: 34, borderRadius: 10 },
  narrowHeaderButton: { margin: 0 },
  compactStaffHeader: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 4,
    backgroundColor: c.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  compactStaffLogo: { width: 36, height: 36, borderRadius: 0, backgroundColor: 'transparent' },
  staffBrandAction: {
    minHeight: staffLayout.touch,
    justifyContent: 'center',
    minWidth: 0,
    borderRadius: 8,
  },
  staffBrandRow: { gap: 9, alignItems: 'center' },
  staffBrandTitle: { ...fontStyle('bold', 16, 22), color: s.navy },
  staffLocationCaption: { ...fontStyle('regular', 12, 16), color: c.muted, marginTop: 1 },
  staffNotificationAction: { width: staffLayout.touch, height: staffLayout.touch },
  compactStaffHeaderButton: { margin: 0, width: staffLayout.touch, height: staffLayout.touch },
  compactStaffBody: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  staffHomeHeader: {
    backgroundColor: staffHomePalette.background,
    borderBottomWidth: 0,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  staffHomePage: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 16, gap: 14 },
  compactStaffPage: { padding: 12, paddingBottom: 20, gap: 16, maxWidth: staffLayout.pageWidth },
  root: { flex: 1, backgroundColor: s.navy },
  staffRoot: { backgroundColor: c.white },
  staffHomeRoot: { backgroundColor: staffHomePalette.background },
  staffSubtitle: { color: '#d5e4ff', marginTop: 3 },
  locationSubtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locationSubtitleText: { flexShrink: 1 },
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
  incidentHeaderRow: { justifyContent: 'space-between' },
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
