import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as c, staffColors as s } from '../theme/theme';
import { fontFaces } from '../theme/typography';
import { tabs, type MobileRole, type WorkspaceScreen } from '../features/workspace/navigation';
import { ui } from './WorkspaceKit';

export function WorkspaceTabBar({
  role,
  screen,
  active,
  onSelect,
}: {
  role: MobileRole;
  screen: WorkspaceScreen;
  active: WorkspaceScreen;
  onSelect: (screen: WorkspaceScreen) => void;
}) {
  const insets = useSafeAreaInsets();
  const visibleTabs = tabs[role];
  const tenantHomeLayout = role === 'Tenant' && ['tenant-home', 'tenant-features'].includes(screen);
  return (
    <View
      style={[
        styles.tabs,
        tenantHomeLayout && { boxShadow: 'none' },
        { paddingBottom: insets.bottom, minHeight: 60 + insets.bottom },
      ]}
    >
      {visibleTabs.map((tab) => (
        <TouchableRipple
          key={tab.screen}
          onPress={() => onSelect(tab.screen)}
          style={ui.grow}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.screen }}
          accessibilityLabel={tab.title}
        >
          <View style={[styles.tab, tenantHomeLayout && { minHeight: 54 }]}>
            <View
              style={[
                styles.indicator,
                tenantHomeLayout && { borderRadius: 10, paddingHorizontal: 12 },
                active === tab.screen && { backgroundColor: s.blueSoft },
              ]}
            >
              <Icon
                source={tab.icon}
                size={tenantHomeLayout ? 20 : 22}
                color={active === tab.screen ? s.blue : c.muted}
              />
            </View>
            <Text
              style={{
                textAlign: 'center',
                fontSize: 11,
                lineHeight: 14,
                fontFamily: active === tab.screen ? fontFaces.semibold : fontFaces.medium,
                fontWeight: 'normal',
                letterSpacing: 0,
                color: active === tab.screen ? s.blue : c.muted,
              }}
            >
              {tab.title}
            </Text>
          </View>
        </TouchableRipple>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
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
