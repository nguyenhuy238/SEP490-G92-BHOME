// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  LocationAssetInventory,
  LocationAssetInventoryItem,
} from '../services/locationAssetInventory';
import type { OperationalTask } from '../services/operationalTasks';

const state = vi.hoisted(() => ({ request: vi.fn(), go: vi.fn() }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
vi.mock('react-native', async () => {
  // Use RN-Web's compiled View and StyleSheet, not native Flow syntax.
  // @ts-expect-error react-native-web does not ship declarations for this direct entry.
  return import('react-native-web/dist/cjs/index.js');
});
vi.mock('../theme/theme', () => ({
  colors: {
    white: '#ffffff',
    ink: '#222222',
    primary: '#14213d',
    muted: '#555555',
    blue: '#2563eb',
    green: '#008000',
    greenSoft: '#e6f6e6',
    tint: '#eaf2ff',
    soft: '#f4f4f4',
    border: '#cccccc',
    red: '#b91c1c',
    redSoft: '#fff0f0',
    amber: '#7a4400',
    amberSoft: '#fff7db',
  },
}));
vi.mock('react-native-paper', () => {
  const Content = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;
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
    accessibilityState?: { selected?: boolean; expanded?: boolean };
  }) => (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={accessibilityLabel}
      role={accessibilityRole || 'button'}
      aria-selected={accessibilityState?.selected}
      aria-expanded={accessibilityState?.expanded}
    >
      {children}
    </button>
  );
  return {
    Text: ({
      children,
      accessibilityRole,
    }: {
      children?: React.ReactNode;
      accessibilityRole?: string;
    }) => <span role={accessibilityRole}>{children}</span>,
    Button,
    TouchableRipple: Button,
    Surface: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ActivityIndicator: () => <span>Đang tải</span>,
    ProgressBar: () => <div role="progressbar" />,
    TextInput: ({
      label,
      value,
      onChangeText,
    }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
    }) => (
      <label>
        {label}
        <textarea value={value} onChange={(event) => onChangeText(event.target.value)} />
      </label>
    ),
    Icon: Content,
    Chip: Content,
  };
});
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: { request: state.request } }),
}));
vi.mock('../features/workspace/useCachedWorkspaceQuery', () => ({
  useCachedWorkspaceQuery: (path: string) => {
    const [data, setData] = React.useState<LocationAssetInventory | null>(null);
    const [error, setError] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => {
      let cancelled = false;
      void state.request(path).then(
        (result: LocationAssetInventory) => {
          if (!cancelled) setData(result);
        },
        (failure: unknown) => {
          if (!cancelled) setError(String(failure));
        },
      );
      return () => {
        cancelled = true;
      };
    }, [path, revision]);
    const reload = React.useCallback(() => setRevision((r) => r + 1), []);
    return { data, error, loading: !data && !error, fetching: false, reload, setData };
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ui: { muted: {}, red: {}, grow: {}, green: {} },
}));
vi.mock('../components/CameraCapture', () => ({ CameraCapture: () => null }));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
vi.mock('../lib/toast', () => ({ showSuccess: vi.fn() }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));

import { LocationAssetInventoryChecklist } from '../screens/LocationAssetInventoryChecklist';
import { TaskCard } from '../screens/StaffTaskListScreen';

const taskId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const roomIds = Array.from(
  { length: 12 },
  (_, index) => `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
);
const names = ['Bóng đèn', 'Chiếu', 'Giường', 'Tủ', 'Bàn', 'Ghế', 'Quạt', 'Nệm'];
const items: LocationAssetInventoryItem[] = Array.from({ length: 42 }, (_, index) => {
  const roomIndex = index < 16 ? Math.floor(index / 4) : 4 + Math.floor((index - 16) / 3);
  return {
    id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
    roomId: index < 40 ? roomIds[roomIndex]! : null,
    roomNumber: index < 40 ? String(101 + roomIndex) : null,
    assetId: null,
    name: index < 40 ? names[index % 8]! : index === 40 ? 'Camera hành lang' : 'Bình chữa cháy',
    quantity: 1,
    commonArea: index >= 40 ? 'Hành lang' : null,
    checked: false,
    inherited: false,
    sourceHandoverContractId: null,
    note: null,
    incidentId: null,
  };
});
const completeResponse: LocationAssetInventory = {
  taskId,
  locationId,
  assignmentId: '55555555-5555-4555-8555-555555555555',
  status: 'InProgress',
  version: 1,
  totalCount: 42,
  checkedCount: 0,
  items,
};
const onRefresh = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.request.mockImplementation(async (path: string) => {
    if (path === `/api/v1/operational-tasks/${taskId}/location-asset-inventory`)
      return completeResponse;
    throw new Error(`Unexpected API request: ${path}`);
  });
});

it('renders all 42 server items into named room and common-area sections, not just the 0/42 counter', async () => {
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await waitFor(() => expect(screen.getByRole('progressbar', { name: /42/ })).toBeTruthy());
  // Regression: React Native Paper's ProgressBar grew to >1,500px inside
  // WorkspaceShell's web ScrollView and pushed every room below the screen.
  const progress = screen.getByRole('progressbar');
  expect(window.getComputedStyle(progress).height).toBe('6px');
  // Search and filters must be siblings of the clipped 6px progress track.
  expect(progress.querySelector('textarea')).toBeNull();
  expect(progress.parentElement?.querySelector('textarea')).not.toBeNull();
  expect(screen.getByText(/nh.m t.i s.n/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Xem kiểm kê/ })).toHaveLength(13);
  expect(
    screen.getByRole('button', { name: 'Xem kiểm kê Phòng 101' }).getAttribute('aria-expanded'),
  ).toBe('true');
  expect(screen.getByRole('button', { name: 'Xem kiểm kê Phòng 112' })).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Xem kiểm kê Khu vực chung · Hành lang' }),
  ).toBeTruthy();
  expect(screen.getByText('Phòng 101')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Chi tiết kiểm kê:/ })).toHaveLength(4);
  expect(screen.getByText('Bóng đèn')).toBeTruthy();
  expect(screen.getAllByText(/: 1/)).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Xem kiểm kê Khu vực chung · Hành lang' }));
  expect(screen.getAllByRole('button', { name: /^Chi tiết kiểm kê:/ })).toHaveLength(2);
  expect(screen.getByText('Camera hành lang')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết kiểm kê: Camera hành lang' }));
  expect(screen.getByRole('button', { name: /X.c nh.n .?/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /B.o v.n ?./ })).toBeTruthy();
  expect(screen.queryByText(/Chưa tải đầy đủ checklist/)).toBeNull();
});

it('reports a discrepancy on a Tenant-inherited asset without exposing baseline edit controls', async () => {
  const inherited = {
    ...items[0]!,
    checked: true,
    inherited: true,
    condition: 'Intact' as const,
    sourceHandoverContractId: '77777777-7777-4777-8777-777777777777',
  };
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    checkedCount: 1,
    items: [inherited, ...items.slice(1)],
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  const itemButtons = await screen.findAllByRole('button', { name: /Chi ti.t ki.m k./ });
  fireEvent.click(itemButtons[0]!);
  expect(screen.getByRole('button', { name: /B.o thi.u/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /B.o h.ng/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /X.c nh.n .?/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /B.o thi.u/ }));
  expect(state.go).toHaveBeenCalledWith(
    'report-incident',
    expect.objectContaining({
      inventoryTaskId: taskId,
      locationAssetInventoryItemId: inherited.id,
      locationId,
      roomId: roomIds[0],
      inventoryCondition: 'Missing',
      description: expect.stringContaining(items[0]!.name),
    }),
  );
});

it('identifies prior Staff checks as inherited provenance without signing for the successor', async () => {
  const checked = {
    ...items[0]!,
    checked: true,
    priorStaffTaskId: taskId,
    priorStaffUserId: '66666666-6666-4666-8666-666666666666',
  };
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    checkedCount: 1,
    items: [checked, ...items.slice(1)],
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText('Gi\u1eef k\u1ebft qu\u1ea3 Staff tr\u01b0\u1edbc')).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết kiểm kê: Bóng đèn' }));
  expect(
    screen.getByText(/Thông tin được tiếp nhận từ đợt kiểm kê của nhân viên trước/),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: /Ki.m tra l.i/ })).toBeTruthy();
});

it('shows an explicit incomplete-data notice rather than a blank checklist when totals disagree', async () => {
  state.request.mockResolvedValueOnce({ ...completeResponse, items: [] });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/Chưa tải đầy đủ checklist: nhận được 0\/42/)).toBeTruthy(),
  );
  expect(screen.getByText('Tải lại checklist')).toBeTruthy();
});

it('separates Owner-unconfirmed rooms from Staff checklist and prevents an empty checklist being ready', async () => {
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    totalCount: 0,
    checkedCount: 0,
    items: [],
    pendingOwnerRooms: ['102', '103'],
    pendingOwnerCommonAssets: true,
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Owner/));
  expect(screen.getByText('Chờ Owner hoàn tất kiểm kê ban đầu')).toBeTruthy();
  expect(screen.getByText('Phòng 102 · Còn tài sản chờ Owner xác nhận')).toBeTruthy();
  expect(screen.getByText('Phòng 103 · Còn tài sản chờ Owner xác nhận')).toBeTruthy();
  expect(screen.getByText('Tài sản khu vực chung · Còn tài sản chờ Owner xác nhận')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Chi tiết kiểm kê:/ })).toBeNull();
});

it('shows pending Owner rooms separately while retaining confirmed asset rows', async () => {
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    pendingOwnerRooms: ['105'],
    pendingOwnerCommonAssets: false,
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText('Phòng 105 · Còn tài sản chờ Owner xác nhận')).toBeTruthy(),
  );
  expect(screen.getByText('Bóng đèn')).toBeTruthy();
});

it('allows work on individually Owner-confirmed room assets while other assets in the room remain pending', async () => {
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    totalCount: 1,
    checkedCount: 0,
    items: [{ ...items[0]!, roomNumber: 'P.101' }],
    pendingOwnerRooms: ['101'],
    pendingOwnerCommonAssets: false,
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await screen.findByText('Phòng 101 · Còn tài sản chờ Owner xác nhận');
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết kiểm kê: Bóng đèn' }));
  expect(screen.queryByText(/Dữ liệu không nhất quán/)).toBeNull();
  expect(screen.getByRole('button', { name: /Xác nhận đủ/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Báo vấn đề/ })).toBeTruthy();
});

it('allows work on individually Owner-confirmed common assets while other common assets remain pending', async () => {
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    totalCount: 1,
    checkedCount: 0,
    items: [items[40]!],
    pendingOwnerCommonAssets: true,
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await screen.findByText('Tài sản khu vực chung · Còn tài sản chờ Owner xác nhận');
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết kiểm kê: Camera hành lang' }));
  expect(screen.getByRole('button', { name: /Xác nhận đủ/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Báo vấn đề/ })).toBeTruthy();
});

it('renders only 12 Owner-confirmed assets in three rooms while listing nine rooms awaiting Owner', async () => {
  state.request.mockResolvedValueOnce({
    ...completeResponse,
    totalCount: 12,
    checkedCount: 0,
    items: items.slice(0, 12),
    pendingOwnerRooms: Array.from({ length: 9 }, (_, index) => String(104 + index)),
    pendingOwnerCommonAssets: true,
  });
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await waitFor(() => expect(screen.getByRole('progressbar', { name: /12/ })).toBeTruthy());
  expect(screen.getAllByRole('button', { name: /^Xem kiểm kê Phòng/ })).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Xem kiểm kê Phòng 101' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xem kiểm kê Phòng 104' })).toBeNull();
  expect(screen.getByText('Phòng 104 · Còn tài sản chờ Owner xác nhận')).toBeTruthy();
  expect(screen.getByText('Phòng 112 · Còn tài sản chờ Owner xác nhận')).toBeTruthy();
  expect(screen.getByText('Tài sản khu vực chung · Còn tài sản chờ Owner xác nhận')).toBeTruthy();
  expect(screen.getByText('Bóng đèn')).toBeTruthy();
});

it('confirms an intact asset with one versioned write and uses the returned server snapshot', async () => {
  const inventoryPath = '/api/v1/operational-tasks/' + taskId + '/location-asset-inventory';
  const item = items[0]!;
  const writePath = inventoryPath + '/items/' + item.id;
  let current = completeResponse;
  state.request.mockImplementation(
    async (path: string, options?: { method?: string; body?: string }) => {
      if (path === inventoryPath && !options?.method) return current;
      if (path === writePath && options?.method === 'PUT') {
        const input = JSON.parse(options.body ?? '{}') as {
          checked: boolean;
          condition: string;
          note: string | null;
          incidentId: string | null;
          version: number;
        };
        current = {
          ...current,
          version: current.version + 1,
          checkedCount: current.checkedCount + 1,
          items: current.items.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  checked: input.checked,
                  condition: input.condition as LocationAssetInventoryItem['condition'],
                }
              : entry,
          ),
        };
        return current;
      }
      throw new Error('Unexpected API request: ' + path);
    },
  );

  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await screen.findByRole('progressbar');
  fireEvent.click(screen.getAllByRole('button', { name: /Chi ti.t ki.m k./ })[0]!);
  fireEvent.click(screen.getByRole('button', { name: /X.c nh.n .?/ }));

  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      writePath,
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const calls = state.request.mock.calls as unknown as [
    string,
    { method?: string; body?: string; headers?: Record<string, string> } | undefined,
  ][];
  await screen.findByRole('progressbar', { name: /1\/42/ });
  const gets = calls.filter(([path, options]) => path === inventoryPath && !options?.method);
  const put = calls.find(([path, options]) => path === writePath && options?.method === 'PUT');
  expect(gets).toHaveLength(1);
  expect(put).toBeTruthy();
  expect(JSON.parse(put?.[1]?.body ?? '{}')).toMatchObject({
    version: 1,
    checked: true,
    condition: 'Intact',
    note: null,
    incidentId: null,
  });
  expect(put?.[1]?.headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  expect(onRefresh).toHaveBeenCalledOnce();
});

it.each(['Missing', 'Damaged'] as const)(
  'opens the Incident form for a %s inventory issue',
  async (condition) => {
    render(
      <LocationAssetInventoryChecklist
        taskId={taskId}
        taskStatus="InProgress"
        editable={true}
        onTaskRefresh={onRefresh}
      />,
    );
    await screen.findByRole('progressbar');
    fireEvent.click(screen.getAllByRole('button', { name: /Chi ti.t ki.m k./ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: /B.o v.n ?./ }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: condition } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, {
      target: { value: 'Khong tim thay ban hoc trong phong.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /T.o b.o c.o s. c./ }));

    expect(state.go).toHaveBeenCalledWith(
      'report-incident',
      expect.objectContaining({
        inventoryTaskId: taskId,
        locationAssetInventoryItemId: items[0]!.id,
        locationId,
        roomId: roomIds[0],
        inventoryCondition: condition,
        description: expect.stringContaining('Khong tim thay ban hoc'),
      }),
    );
  },
);

it('saves NotAccessible as a blocker instead of creating an Incident', async () => {
  const inventoryPath = '/api/v1/operational-tasks/' + taskId + '/location-asset-inventory';
  const item = items[0]!;
  const writePath = inventoryPath + '/items/' + item.id;
  let current = completeResponse;
  state.request.mockImplementation(
    async (path: string, options?: { method?: string; body?: string }) => {
      if (path === inventoryPath && !options?.method) return current;
      if (path === writePath && options?.method === 'PUT') {
        const input = JSON.parse(options.body ?? '{}') as {
          checked: boolean;
          condition: string;
          note: string | null;
          incidentId: string | null;
        };
        current = {
          ...current,
          version: current.version + 1,
          checkedCount: current.checkedCount + 1,
          items: current.items.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  checked: input.checked,
                  condition: input.condition as LocationAssetInventoryItem['condition'],
                  note: input.note,
                }
              : entry,
          ),
        };
        return current;
      }
      throw new Error('Unexpected API request: ' + path);
    },
  );

  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={true}
      onTaskRefresh={onRefresh}
    />,
  );
  await screen.findByRole('progressbar');
  fireEvent.click(screen.getAllByRole('button', { name: /Chi ti.t ki.m k./ })[0]!);
  fireEvent.click(screen.getByRole('button', { name: /B.o v.n ?./ }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NotAccessible' } });
  fireEvent.change(screen.getAllByRole('textbox')[1]!, {
    target: { value: 'Khong the vao phong de kiem tra.' },
  });
  fireEvent.click(screen.getByRole('button', { name: /L.u v..ng m.c/ }));

  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      writePath,
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const put = state.request.mock.calls.find(
    ([path, options]) => path === writePath && options?.method === 'PUT',
  );
  expect(JSON.parse(String(put?.[1]?.body ?? '{}'))).toMatchObject({
    checked: true,
    condition: 'NotAccessible',
    note: 'Khong the vao phong de kiem tra.',
    incidentId: null,
  });
  expect(state.go).not.toHaveBeenCalled();
});

it('hides all checklist mutations when the current Staff is read-only', async () => {
  render(
    <LocationAssetInventoryChecklist
      taskId={taskId}
      taskStatus="InProgress"
      editable={false}
      onTaskRefresh={onRefresh}
    />,
  );
  await screen.findByRole('progressbar');
  fireEvent.click(screen.getAllByRole('button', { name: /Chi ti.t ki.m k./ })[0]!);
  expect(screen.queryByRole('button', { name: /X.c nh.n .?/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /B.o v.n ?./ })).toBeNull();
  expect(
    state.request.mock.calls.some(
      ([, options]) => (options as { method?: string } | undefined)?.method === 'PUT',
    ),
  ).toBe(false);
});

it('shows the assigned Location name directly on a Staff task card', () => {
  const task = {
    id: taskId,
    locationId,
    title: 'Kiểm kê tài sản toàn cơ sở',
    kind: 'LocationAssetHandover',
    status: 'InProgress',
    requirements: 'Kiểm tra 42 tài sản.',
    priority: 'Normal',
    dueAt: null,
    isOverdue: false,
    evidenceRequired: false,
    responsibilityAvailable: true,
    result: null,
  } as OperationalTask;
  render(<TaskCard task={task} locationName="Cơ Sở Phú Thọ" onPress={vi.fn()} />);
});
