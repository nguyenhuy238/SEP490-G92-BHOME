// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi } from '../lib/api';

const taskId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const roomId = '55555555-5555-4555-8555-555555555555';
const assetId = '66666666-6666-4666-8666-666666666666';
const inspectionId = '77777777-7777-4777-8777-777777777777';
const unitId = '88888888-8888-4888-8888-888888888888';

const state = vi.hoisted(() => ({
  api: null as unknown,
  role: 'Staff',
  go: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | void) => useEffect(callback, [callback]),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: state.api,
    session: { userId: actorId, roles: [state.role] },
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: state.role,
    preview: false,
    staffLocationId: locationId,
    go: state.go,
  }),
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: () => false,
}));
vi.mock('../components/CameraCapture', () => ({ CameraCapture: () => null }));
vi.mock('../components/KeyboardFormScrollView', () => ({
  KeyboardFormScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native', () => {
  const View = ({
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
  );
  return {
    AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) },
    Image: () => null,
    KeyboardAvoidingView: View,
    Modal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? <div role="dialog">{children}</div> : null,
    Platform: { OS: 'web' },
    StyleSheet: { create: (value: unknown) => value },
    View,
  };
});
vi.mock('react-native-paper', () => {
  const Button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <button
      type="button"
      role={accessibilityRole ?? 'button'}
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
  const TextInput = ({
    label,
    value,
    onChangeText,
    disabled,
    multiline,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled?: boolean;
    multiline?: boolean;
  }) =>
    multiline ? (
      <textarea
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChangeText(event.target.value)}
      />
    ) : (
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChangeText(event.target.value)}
      />
    );
  return {
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="status" aria-label={accessibilityLabel}>
        Đang tải
      </span>
    ),
    Button,
    Checkbox: {
      Item: ({
        label,
        onPress,
        disabled,
      }: {
        label: string;
        onPress?: () => void;
        disabled?: boolean;
      }) => (
        <button disabled={disabled} onClick={onPress}>
          {label}
        </button>
      ),
    },
    Icon: () => null,
    IconButton: ({
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} />,
    Text: ({
      children,
      accessibilityRole,
    }: {
      children?: React.ReactNode;
      accessibilityRole?: string;
    }) => <span role={accessibilityRole}>{children}</span>,
    TextInput,
    TouchableRipple: Button,
  };
});
vi.mock('../components/WorkspaceKit', () => ({
  ui: { card: {}, red: {}, green: {}, muted: {}, soft: {}, grow: {} },
  Box: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <div>
      <h3>{title}</h3>
      {detail && <span>{detail}</span>}
    </div>
  ),
  Row: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
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
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));
vi.mock('../lib/toast', () => ({
  conciseMessage: (value: string) => value,
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));
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
    greenSoft: '#efe',
    navy: '#123',
  },
}));

import { StaffTaskDetailScreen } from '../screens/StaffTaskDetailScreen';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function task(
  kind: 'LocationAssetHandover' | 'AdHoc',
  status: 'Assigned' | 'InProgress' | 'PendingVerification',
  version = 1,
) {
  return {
    id: taskId,
    locationId,
    kind,
    title:
      kind === 'LocationAssetHandover'
        ? 'Kiểm tra tài sản toàn cơ sở'
        : 'Kiểm tra thiết bị định kỳ',
    requirements: 'Kiểm tra và cập nhật kết quả theo đúng phân công.',
    priority: 'Normal',
    dueAt: null,
    evidenceRequired: false,
    status,
    isOverdue: false,
    currentResponsibleStaffUserId: actorId,
    responsibilityAvailable: true,
    assignedStaffUserId: actorId,
    result: null,
    version,
    verifiedAt: null,
    target: null,
    createdAt: '2026-11-21T08:00:00+07:00',
    updatedAt: '2026-11-21T08:00:00+07:00',
  };
}

function inventory(
  status: 'Assigned' | 'InProgress',
  version: number,
  checked = false,
  condition: 'Unassessed' | 'Intact' = 'Unassessed',
) {
  return {
    taskId,
    locationId,
    assignmentId: '99999999-9999-4999-8999-999999999999',
    status,
    version,
    totalCount: 1,
    checkedCount: checked ? 1 : 0,
    items: [
      {
        id: itemId,
        roomId,
        roomNumber: 'P.101',
        assetId,
        name: 'Quạt trần',
        quantity: 1,
        commonArea: null,
        checked,
        inherited: false,
        condition,
        note: null,
        incidentId: null,
      },
    ],
    pendingOwnerRooms: [],
    pendingOwnerCommonAssets: false,
  };
}

function history() {
  return {
    items: [
      {
        id: 'h1',
        action: 'created',
        note: 'Tạo công việc',
        occurredAt: '2026-11-21T08:00:00+07:00',
        taskVersion: 1,
      },
      {
        id: 'h2',
        action: 'start',
        note: 'Bắt đầu',
        occurredAt: '2026-11-21T08:10:00+07:00',
        taskVersion: 1,
      },
      {
        id: 'h3',
        action: 'progress',
        note: 'Đã kiểm tra khu vực sảnh',
        occurredAt: '2026-11-21T08:20:00+07:00',
        taskVersion: 1,
      },
      {
        id: 'h4',
        action: 'location_asset_inventory_item_checked',
        note: 'Hạng mục thứ tư',
        occurredAt: '2026-11-21T08:30:00+07:00',
        taskVersion: 1,
      },
    ],
    page: 1,
    pageSize: 20,
    totalCount: 4,
  };
}

function equipmentDocument() {
  return {
    id: inspectionId,
    locationId,
    kind: 'EquipmentInspection',
    status: 'Draft',
    version: 7,
    recordedAt: '2026-11-21T08:00:00+07:00',
    data: {
      assetId,
      scheduleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      period: '2026-11',
      taskId,
      policyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      policyVersion: 3,
      policySnapshot: {
        name: 'Kiểm tra thiết bị định kỳ',
        evidenceRequired: false,
        checklist: [{ code: 'CLEAN', label: 'Vệ sinh thiết bị' }],
      },
      units: [{ id: unitId, version: 1, label: 'Quạt trần P.101', position: 'Trần phòng' }],
      quantitySnapshot: 1,
      answers: [],
      outcome: 'NotInspected',
      reviewNote: null,
      remediationWorkOrderId: null,
      progress: {
        total: 1,
        inspected: 0,
        passed: 0,
        failed: 0,
        notInspected: 1,
        outcome: 'NotInspected',
      },
    },
  };
}

type Scenario = {
  transport: ReturnType<typeof vi.fn<typeof fetch>>;
  api: MobileApi;
  inventoryReads: () => number;
  equipmentReads: () => number;
  savedAnswers: () => Record<string, unknown> | null;
  inventoryUpdate: () => Record<string, unknown> | null;
  requestEvents: () => { path: string; method: string }[];
};

function scenario(
  kind: 'LocationAssetHandover' | 'AdHoc',
  initialStatus: 'Assigned' | 'InProgress',
): Scenario {
  let currentStatus: 'Assigned' | 'InProgress' | 'PendingVerification' = initialStatus;
  let currentVersion = 1;
  let inventoryVersion = 1;
  let inventoryChecked = false;
  let inventoryCondition: 'Unassessed' | 'Intact' = 'Unassessed';
  let inventoryReadCount = 0;
  let equipmentReadCount = 0;
  let saved: Record<string, unknown> | null = null;
  let inventorySaved: Record<string, unknown> | null = null;
  const events: { path: string; method: string }[] = [];
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    events.push({ path, method });
    if (path === `/api/v1/operational-tasks/${taskId}`)
      return json(task(kind, currentStatus, currentVersion));
    if (path.endsWith(`/operational-tasks/${taskId}/evidence`)) return json([]);
    if (path.endsWith(`/operational-tasks/${taskId}/history`)) return json(history());
    if (path === '/api/v1/capture/locations')
      return json([{ id: locationId, label: 'Cơ sở Phú Thọ' }]);
    if (
      path.endsWith(`/operational-tasks/${taskId}/location-asset-inventory`) &&
      method === 'GET'
    ) {
      inventoryReadCount++;
      return json(
        inventory(
          currentStatus === 'Assigned' ? 'Assigned' : 'InProgress',
          inventoryVersion,
          inventoryChecked,
          inventoryCondition,
        ),
      );
    }
    if (
      path.endsWith(`/operational-tasks/${taskId}/location-asset-inventory/items/${itemId}`) &&
      method === 'PUT'
    ) {
      inventorySaved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      inventoryChecked = inventorySaved.checked === true;
      inventoryCondition = inventorySaved.condition === 'Intact' ? 'Intact' : 'Unassessed';
      inventoryVersion++;
      return json(inventory('InProgress', inventoryVersion, inventoryChecked, inventoryCondition));
    }
    if (path.endsWith(`/operational-tasks/${taskId}/location-asset-handover`))
      return json({ code: 'resource_not_found' }, 404);
    if (path.endsWith(`/operational-tasks/${taskId}/equipment-inspection`)) {
      equipmentReadCount++;
      return kind === 'AdHoc' ? json(equipmentDocument()) : new Response(null, { status: 204 });
    }
    if (path.endsWith(`/operational-tasks/${taskId}/start`) && method === 'POST') {
      currentStatus = 'InProgress';
      currentVersion++;
      return json(task(kind, currentStatus, currentVersion));
    }
    if (path.endsWith(`/operational-tasks/${taskId}/submit`) && method === 'POST') {
      currentStatus = 'PendingVerification';
      currentVersion++;
      return json(task(kind, currentStatus, currentVersion));
    }
    if (path === `/api/v1/equipment-inspections/${inspectionId}/answers` && method === 'PUT') {
      saved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const document = equipmentDocument();
      return json({ ...document, version: 8 });
    }
    return json({});
  });
  const api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-access',
    async () => undefined,
    vi.fn(),
    transport as unknown as typeof fetch,
  );
  state.api = api;
  state.role = 'Staff';
  return {
    transport,
    api,
    inventoryReads: () => inventoryReadCount,
    equipmentReads: () => equipmentReadCount,
    savedAnswers: () => saved,
    inventoryUpdate: () => inventorySaved,
    requestEvents: () => events,
  };
}

beforeEach(() => {
  state.role = 'Staff';
  state.go.mockReset();
});
afterEach(() => {
  cleanup();
  const api = state.api as MobileApi | null;
  api?.queryCache.dispose();
  state.api = null;
  vi.restoreAllMocks();
});

it('keeps the handover workflow ordered, refreshes checklist after start, and collapses history', async () => {
  const s = scenario('LocationAssetHandover', 'Assigned');
  render(<StaffTaskDetailScreen id={taskId} />);

  await screen.findByText(/C. s. ph.n c.ng/);
  await screen.findByText(/Ch.a b.t/);
  await screen.findByRole('progressbar', { name: /0\/1/ });
  expect(screen.queryByText(/Ki.m tra thi.t b./)).toBeNull();
  expect(s.equipmentReads()).toBe(0);
  expect(s.requestEvents().some((event) => event.path.includes('/equipment-inspection'))).toBe(false);

  // Handover history is collapsed initially and does not compete with the checklist.
  expect(screen.queryByText(/T.o c.ng vi.c/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Xem l.ch s. \(4\)/ }));
  expect(screen.getAllByText(/T.o c.ng vi.c/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Thu g.n l.ch s./ }));
  expect(screen.queryByText(/T.o c.ng vi.c/)).toBeNull();
  expect(screen.queryByText(/minh ch.ng/)).toBeNull();

  // Assigned -> start: the footer has one clear action.
  const beforeStartReads = s.inventoryReads();
  fireEvent.click(screen.getByRole('button', { name: /B.t.*ki.m k./ }));
  const startButtons = screen.getAllByRole('button', { name: /B.t.*ki.m k./ });
  fireEvent.click(startButtons[startButtons.length - 1]!);
  await waitFor(() => expect(s.inventoryReads()).toBeGreaterThan(beforeStartReads));
  await screen.findByText(/ang ki.m k./);
  const startEventIndex = s.requestEvents().findIndex(
    (event) => event.path.endsWith('/operational-tasks/' + taskId + '/start') && event.method === 'POST',
  );
  const inventoryRefetchIndex = s.requestEvents().findIndex(
    (event, index) => index > startEventIndex &&
      event.path.endsWith('/operational-tasks/' + taskId + '/location-asset-inventory') &&
      event.method === 'GET',
  );
  expect(startEventIndex).toBeGreaterThanOrEqual(0);
  expect(inventoryRefetchIndex).toBeGreaterThan(startEventIndex);
  expect(screen.queryByRole('button', { name: /B.t.*ki.m k./ })).toBeNull();
  expect(s.equipmentReads()).toBe(0);

  // InProgress -> confirm the physical asset -> submit the complete checklist.
  fireEvent.click(screen.getAllByRole('button', { name: /Chi ti.t ki.m k./ })[0]!);
  fireEvent.click(screen.getByRole('button', { name: /X.c nh.n/ }));
  await waitFor(() => expect(s.inventoryUpdate()).toMatchObject({
    checked: true,
    condition: 'Intact',
    note: null,
    incidentId: null,
  }));
  await screen.findByRole('button', { name: /G.i ki.m k. cho Owner/ });
  fireEvent.click(screen.getByRole('button', { name: /G.i ki.m k. cho Owner/ }));
  const submitButtons = screen.getAllByRole('button', { name: /G.i ki.m k. cho Owner/ });
  fireEvent.click(submitButtons[submitButtons.length - 1]!);

  await waitFor(() => expect(s.requestEvents().some(
    (event) => event.path.endsWith('/operational-tasks/' + taskId + '/submit') && event.method === 'POST',
  )).toBe(true));
  await waitFor(() => expect(screen.queryByRole('button', { name: /G.i ki.m k. cho Owner/ })).toBeNull());
  expect(screen.queryByText(/K.t qu./)).toBeNull();
  expect(s.equipmentReads()).toBe(0);
  expect(s.requestEvents().some((event) => event.path.includes('/equipment-inspection'))).toBe(false);
});

it('keeps the AdHoc equipment inspection panel functional and saves a versioned answer batch', async () => {
  const s = scenario('AdHoc', 'InProgress');
  render(<StaffTaskDetailScreen id={taskId} />);

  await screen.findByText('Kiểm tra thiết bị');
  expect(s.equipmentReads()).toBe(1);
  expect(screen.queryByText('Danh sách kiểm kê từng phòng')).toBeNull();

  fireEvent.change(screen.getByRole('combobox', { name: 'Vệ sinh thiết bị' }), {
    target: { value: 'Passed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ kiểm tra' }));

  await waitFor(() => expect(s.savedAnswers()).not.toBeNull());
  expect(s.savedAnswers()).toMatchObject({
    expectedVersion: 7,
    submit: false,
    answers: [{ unitId, checklistCode: 'CLEAN', result: 'Passed', note: null, evidenceIds: [] }],
  });
  expect(
    s.transport.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(`/equipment-inspections/${inspectionId}/answers`) &&
        init?.method === 'PUT',
    ),
  ).toBe(true);
});
