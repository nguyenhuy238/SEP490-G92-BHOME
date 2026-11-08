import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { WorkspaceTabBar } from '../../components/WorkspaceTabBar';
import { useWorkspace } from '../../features/workspace/WorkspaceProvider';
import { isWorkspaceScreen, tabs } from '../../features/workspace/navigation';
import { WorkspaceTabsContext } from '../../features/workspace/WorkspaceTabsContext';
import { staffColors } from '../../theme/theme';

export function NavigatorTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { role, requestNavigation } = useWorkspace();
  const current = state.routes[state.index];
  if (!role || !current || !isWorkspaceScreen(current.name)) return null;
  return (
    <View
      style={{
        backgroundColor:
          role === 'Tenant' && current.name === 'tenant-home' ? '#173654' : staffColors.navy,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <WorkspaceTabBar
        role={role}
        screen={current.name}
        active={current.name}
        onSelect={(screen) => {
          const target = state.routes.find((route) => route.name === screen);
          // Reselecting a tab preserves its scroll and local selection.
          if (!target || target.key === current.key) return;
          const event = emitter.emit({
            type: 'tabPress',
            target: target.key,
            canPreventDefault: true,
          });
          if (!event.defaultPrevented) requestNavigation(() => navigateToTab(target.key));
        }}
      />
    </View>
  );
}

// Expo invokes tabBar as a render callback inside a Context.Consumer. Return a
// React element so hooks run in NavigatorTabBar's own component render.
function renderWorkspaceTabBar(props: BottomTabBarProps) {
  return <NavigatorTabBar {...props} />;
}

export default function WorkspaceTabsLayout() {
  const { role } = useWorkspace();
  if (!role) return <Redirect href="/" />;
  return (
    <WorkspaceTabsContext.Provider value={true}>
      <Tabs
        backBehavior="firstRoute"
        screenOptions={{ headerShown: false, animation: 'none', lazy: true }}
        tabBar={renderWorkspaceTabBar}
      >
        {tabs[role].map((tab) => (
          <Tabs.Screen key={tab.screen} name={tab.screen} options={{ title: tab.title }} />
        ))}
        <Tabs.Protected guard={false}>
          {Array.from(
            new Set(
              Object.values(tabs)
                .flat()
                .map((tab) => tab.screen),
            ),
          )
            .filter((screen) => !tabs[role].some((tab) => tab.screen === screen))
            .map((screen) => (
              <Tabs.Screen key={screen} name={screen} />
            ))}
        </Tabs.Protected>
      </Tabs>
    </WorkspaceTabsContext.Provider>
  );
}
