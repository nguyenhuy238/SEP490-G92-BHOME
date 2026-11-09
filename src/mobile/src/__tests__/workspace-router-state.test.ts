import { expect, it } from 'vitest';
// Exercise the actual reducers bundled with the installed Expo Router SDK 58.
// These imports are test-only; production uses public Expo Router entry points.
import { TabRouter } from '../../../../node_modules/expo-router/build/react-navigation/routers/TabRouter';
import { StackRouter } from '../../../../node_modules/expo-router/build/react-navigation/routers/StackRouter';
import type {
  NavigationState,
  RouterActionResult,
} from '../../../../node_modules/expo-router/build/react-navigation/routers/types';
import { tabs, type MobileRole } from '../features/workspace/navigation';

function handled<T extends NavigationState>(result: RouterActionResult<T> | unknown): T {
  expect(result).toHaveProperty('state');
  return (result as RouterActionResult<T>).state;
}
function tabFixture(role: MobileRole) {
  const names = tabs[role].map((tab) => tab.screen);
  return {
    router: TabRouter({ backBehavior: 'firstRoute' }),
    config: { routeNames: names, routeGetIdList: {} },
    state: {
      stale: false as const,
      type: 'tab' as const,
      key: 'workspace-tabs',
      routeKeySeq: 4,
      index: 0,
      routeNames: names,
      routes: names.map((name) => ({ name, key: name })),
    },
  };
}
it.each(['Staff', 'Tenant', 'Owner'] as const)(
  'keeps %s tab keys, params and route count stable across repeated switches and reselection',
  (role) => {
    const { router, config, state } = tabFixture(role);
    const originalRoutes = state.routes.map((route) => ({
      ...route,
      params: { page: 3, filter: 'fixture-filter' },
    }));
    let current = { ...state, routes: originalRoutes };
    for (const name of [
      config.routeNames[1],
      config.routeNames[2],
      config.routeNames[1],
      config.routeNames[1],
    ]) {
      current = handled<typeof current>(
        router.getStateForAction(
          current,
          {
            type: 'NAVIGATE',
            payload: { name, params: originalRoutes.find((route) => route.name === name)?.params },
          },
          config,
        ),
      );
      originalRoutes.forEach((route, index) => expect(current.routes[index]).toMatchObject(route));
      expect(current.routes).toHaveLength(4);
    }
    const home = handled<typeof current>(
      router.getStateForAction(current, { type: 'GO_BACK' }, config),
    );
    expect(home.index).toBe(0);
  },
);
it('pushes a detail and restores the same tab state and selected section on native Back', () => {
  const tab = tabFixture('Staff');
  const selected = handled<typeof tab.state>(
    tab.router.getStateForAction(
      tab.state,
      { type: 'JUMP_TO', payload: { name: 'work-orders' } },
      tab.config,
    ),
  );
  const root = StackRouter({});
  const config = { routeNames: ['(tabs)', 'workspace/[screen]'], routeGetIdList: {} };
  const initial = {
    stale: false as const,
    type: 'stack' as const,
    key: 'root',
    routeKeySeq: 1,
    index: 0,
    routeNames: config.routeNames,
    routes: [{ key: 'tabs-instance', name: '(tabs)', state: selected }],
    preloadedRoutes: [],
  };
  const detail = handled<typeof initial>(
    root.getStateForAction(
      initial,
      {
        type: 'PUSH',
        payload: {
          name: 'workspace/[screen]',
          params: { screen: 'task-detail', taskId: 'fixture' },
        },
      },
      config,
    ),
  );
  expect(detail.routes).toHaveLength(2);
  const back = handled<typeof initial>(root.getStateForAction(detail, { type: 'GO_BACK' }, config));
  expect(back.routes).toHaveLength(1);
  expect(back.routes[0].state).toBe(selected);
  expect(back.routes[0].state?.routes[selected.index].name).toBe('work-orders');
});
