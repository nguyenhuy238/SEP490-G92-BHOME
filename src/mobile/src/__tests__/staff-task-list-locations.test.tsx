// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OperationalTask, TaskPage } from '../services/operationalTasks';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  go: vi.fn(),
  cache: new Map<string, unknown>(),
}));

vi.mock('react-native', () => ({
  View: ({
    children,
    accessibilityRole,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    accessibilityRole?: string;
    accessibilityLabel?: string;
  }) => (
    <div role={accessibilityRole} aria-label={accessibilityLabel}>
      {children}
    </div>
  ),
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('react-native-paper', () => {
  const Button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityState?: { selected?: boolean };
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={accessibilityLabel}
      role={accessibilityRole ?? 'button'}
      aria-selected={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  );
  return {
    Button,
    IconButton: ({
      icon,
      ...props
    }: {
      icon: string;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => <Button {...props}>{icon}</Button>,
    TouchableRipple: Button,
    Text: ({
      children,
      accessibilityRole,
    }: {
      children?: React.ReactNode;
      accessibilityRole?: string;
    }) => <span role={accessibilityRole}>{children}</span>,
    Icon: () => null,
    ActivityIndicator: () => <span>Đang tải</span>,
  };
});
vi.mock('../theme/theme', () => ({
  colors: {
    white: '#fff',
    ink: '#222',
    primary: '#123',
    muted: '#666',
    blue: '#26f',
    green: '#080',
    tint: '#eef',
    soft: '#eee',
    border: '#ccc',
    red: '#b00',
    amber: '#a70',
    redSoft: '#fee',
    amberSoft: '#ffc',
  },
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: () => false,
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    const [result, setResult] = React.useState<{
      path: string;
      data: unknown;
      error: string;
    } | null>(null);
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => {
      if (!path) return;
      let active = true;
      if (state.cache.has(path)) return;
      void Promise.resolve()
        .then(() => state.request(path))
        .then(
          (data) => {
            if (active) {
              state.cache.set(path, data);
              setResult({ path, data, error: '' });
            }
          },
          (error: unknown) => {
            if (active) setResult({ path, data: null, error: String(error) });
          },
        );
      return () => {
        active = false;
      };
    }, [path, revision]);
    const current =
      result?.path === path
        ? result
        : path && state.cache.has(path)
          ? { path, data: state.cache.get(path), error: '' }
          : null;
    return {
      data: current?.data ?? null,
      error: current?.error ?? '',
      fetching: !!path && !current,
      reload: () => setRevision((value) => value + 1),
    };
  },
}));

import { StaffTaskListScreen, TaskCard } from '../screens/StaffTaskListScreen';

const loc1 = '11111111-1111-4111-8111-111111111111';
const loc2 = '22222222-2222-4222-8222-222222222222';
const loc3 = '33333333-3333-4333-8333-333333333333';
function task(
  id: string,
  locationId: string,
  kind: OperationalTask['kind'] = 'AdHoc',
): OperationalTask {
  return {
    id,
    locationId,
    kind,
    title: `Công việc ${id}`,
    requirements: '',
    priority: 'Normal',
    dueAt: null,
    evidenceRequired: false,
    status: 'Assigned',
    isOverdue: false,
    currentResponsibleStaffUserId: 'staff',
    responsibilityAvailable: true,
    result: null,
    version: 1,
    verifiedAt: null,
  };
}
const page = (
  items: OperationalTask[],
  pageNumber = 1,
  totalCount = items.length,
): TaskPage<OperationalTask> => ({
  items,
  page: pageNumber,
  pageSize: 20,
  totalCount,
});

beforeEach(() => {
  state.request.mockReset();
  state.go.mockReset();
  state.cache.clear();
});
afterEach(() => cleanup());

it('loads the Location directory once for all visible task kinds and preserves page navigation', async () => {
  const initial = Array.from({ length: 20 }, (_, i) =>
    task(String(i + 1), i % 2 === 0 ? loc1 : loc2, i === 0 ? 'LocationAssetHandover' : 'AdHoc'),
  );
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/locations/assigned-to-me')
      return [
        { id: loc1, name: 'Cơ sở Phú Thọ' },
        { id: loc2, name: 'Cơ sở Hà Nội' },
      ];
    if (path.includes('page=2')) return page([task('next', loc2, 'MoveInInventory')], 2, 21);
    return page(initial, 1, 21);
  });
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getAllByText('Cơ sở: Cơ sở Phú Thọ')).toHaveLength(10));
  expect(screen.getAllByText('Cơ sở: Cơ sở Hà Nội')).toHaveLength(10);
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await waitFor(() => expect(screen.getByText('Công việc next')).toBeTruthy());
  expect(screen.getByText('Cơ sở: Cơ sở Hà Nội')).toBeTruthy();
  expect(screen.getByText('Trang 2 / 2')).toBeTruthy();
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(1);
});

it('shows an explicit Location label for ordinary cards even without a matching directory entry', async () => {
  state.request.mockImplementation(async (path: string) =>
    path === '/api/v1/locations/assigned-to-me'
      ? [{ id: loc1, name: 'Cơ sở Phú Thọ' }]
      : page([task('one', loc1), task('two', loc3, 'MoveInInventory')]),
  );
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getByText('Cơ sở: Cơ sở Phú Thọ')).toBeTruthy());
  expect(screen.getByText('Cơ sở: Chưa xác định tên cơ sở')).toBeTruthy();
  expect(screen.getAllByText(/^Cơ sở:/)).toHaveLength(2);
});

it('preserves task cards when the directory fails and supports retrying Location names only', async () => {
  let directoryAttempts = 0;
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/locations/assigned-to-me') {
      directoryAttempts++;
      if (directoryAttempts === 1) throw new Error('Lỗi tên cơ sở');
      return [{ id: loc1, name: 'Cơ sở Phú Thọ' }];
    }
    return page([task('one', loc1)]);
  });
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getByText('Cơ sở: Chưa tải được tên cơ sở')).toBeTruthy());
  expect(screen.getByText('Công việc one')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại tên cơ sở' }));
  await waitFor(() => expect(screen.getByText('Cơ sở: Cơ sở Phú Thọ')).toBeTruthy());
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(2);
  expect(
    state.request.mock.calls.filter(([path]) => path.startsWith('/api/v1/operational-tasks?')),
  ).toHaveLength(1);
});

it('does not request Location names for an empty task page and retains empty-state wording', async () => {
  state.request.mockResolvedValue(page([]));
  render(<StaffTaskListScreen />);
  await waitFor(() => expect(screen.getByText('Chưa có công việc được giao')).toBeTruthy());
  expect(
    state.request.mock.calls.filter(([path]) => path === '/api/v1/locations/assigned-to-me'),
  ).toHaveLength(0);
});

it('always renders a Location row for a standalone ordinary task card', () => {
  render(<TaskCard task={task('one', loc1)} onPress={vi.fn()} />);
  expect(screen.getByText('Cơ sở: Chưa xác định tên cơ sở')).toBeTruthy();
});
