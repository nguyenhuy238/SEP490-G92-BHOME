// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  WorkspaceHeaderContext,
  type WorkspaceHeaderAction,
} from '../components/WorkspaceHeaderContext';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApiError } from '../lib/api';
import { QueryCache } from '../lib/queryCache';
import type { Incident, WorkOrder } from '../services/incidents';

const s = vi.hoisted(() => ({
  role: 'Staff',
  preview: false,
  params: {} as Record<string, string>,
  request: vi.fn(),
  go: vi.fn(),
  success: vi.fn(),
  gallery: vi.fn(),
}));
const actor = '11111111-1111-4111-8111-111111111111';
const api = { request: s.request, queryCache: new QueryCache() };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api,
    session: { userId: '11111111-1111-4111-8111-111111111111', roles: [s.role] },
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: s.role,
    preview: s.preview,
    go: s.go,
    staffLocationId: '44444444-4444-4444-8444-444444444444',
    selectStaffLocation: vi.fn(),
  }),
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  useLocalSearchParams: () => s.params,
}));
vi.mock('../components/ContextPortal', () => ({
  ContextPortal: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../lib/toast', () => ({
  conciseMessage: (v: string) => v,
  showError: vi.fn(),
  showSuccess: s.success,
  clearToasts: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: s.gallery,
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: async () => ({
    canceled: false,
    assets: [{ uri: 'file:///synthetic.png', mimeType: 'image/png' }],
  }),
}));
vi.mock('expo-file-system', () => ({
  File: class {
    size = 8;
    async bytes() {
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    }
  },
}));
type C = { children?: React.ReactNode };
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: 'ios' },
  ScrollView: ({ children }: C) => <div>{children}</div>,
  View: ({ children }: C) => <div>{children}</div>,
  Image: ({
    source,
    accessibilityLabel,
  }: {
    source: { uri: string };
    accessibilityLabel: string;
  }) => <img alt={accessibilityLabel} src={source.uri} />,
  Modal: ({ visible, children }: C & { visible: boolean }) =>
    visible ? <div>{children}</div> : null,
}));
vi.mock('react-native-paper', () => {
  const Button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: C & {
    onPress: () => void;
    disabled: boolean;
    accessibilityLabel: string;
    accessibilityRole?: string;
    accessibilityState?: { selected?: boolean };
  }) => (
    <button
      role={accessibilityRole ?? 'button'}
      aria-selected={accessibilityState?.selected}
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Icon: () => null,
    TouchableRipple: Button,
    TextInput: ({
      label,
      value,
      onChangeText,
      onBlur,
      disabled,
    }: {
      label: string;
      value: string;
      onChangeText: (v: string) => void;
      onBlur?: () => void;
      disabled?: boolean;
    }) => (
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
      />
    ),
    Text: ({ children }: C) => <span>{children}</span>,
    Button,
    Portal: ({ children }: C) => <>{children}</>,
    Dialog: Object.assign(
      ({ visible, children }: C & { visible: boolean }) =>
        visible ? <div role="dialog">{children}</div> : null,
      {
        Title: ({ children }: C) => <h3>{children}</h3>,
        Content: ({ children }: C) => <div>{children}</div>,
        Actions: ({ children }: C) => <div>{children}</div>,
      },
    ),
    IconButton: Button,
    ActivityIndicator: () => <span>Đang tải</span>,
    Checkbox: {
      Item: ({
        label,
        status,
        onPress,
        disabled,
      }: {
        label: string;
        status: string;
        onPress: () => void;
        disabled: boolean;
      }) => (
        <label>
          <input
            type="checkbox"
            checked={status === 'checked'}
            onChange={onPress}
            disabled={disabled}
          />
          {label}
        </label>
      ),
    },
  };
});
vi.mock('../components/WorkspaceKit', () => ({
  Action: ({ children, onPress, disabled }: C & { onPress: () => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Row: ({ children }: C) => <div>{children}</div>,
  Box: ({ children }: C) => <section>{children}</section>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <>
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
    </>
  ),
  Pill: ({ children }: C) => <span>{children}</span>,
  ui: {},
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
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Chọn…</option>
      {options
        .filter((o) => o.id)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
    </select>
  ),
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({
    label,
    disabled,
    onCapture,
  }: {
    label: string;
    disabled: boolean;
    onCapture: (b: Uint8Array) => Promise<void>;
  }) => (
    <button
      disabled={disabled}
      onClick={() => void onCapture(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))}
    >
      {label}
    </button>
  ),
}));

import {
  StaffIncidentReportScreen,
  StaffMaintenanceScreen,
  StaffEmergencyScreen,
} from '../screens/StaffIncidentScreens';
import { IncidentReportForm } from '../features/incidents/IncidentReportForm';
import {
  IncidentDetailScreen,
  IncidentListScreen,
  MaintenanceListScreen,
  MaintenanceDetailScreen,
} from '../features/incidents/IncidentScreens';
import { IncidentActionPanel, incidentActions } from '../features/incidents/IncidentActions';
import { IncidentEvidencePicker } from '../components/IncidentEvidencePicker';
import { EvidenceImage, eventFacts } from '../features/incidents/IncidentUi';

const id = '22222222-2222-4222-8222-222222222222',
  wid = '33333333-3333-4333-8333-333333333333';
const lid = '44444444-4444-4444-8444-444444444444',
  rid = '55555555-5555-4555-8555-555555555555',
  eid = '66666666-6666-4666-8666-666666666666';
const inventoryTaskId = '99999999-9999-4999-8999-999999999999';
const inventoryItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let report: Incident, work: WorkOrder;
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, totalCount: items.length });
function respond(path: string, init?: RequestInit): unknown {
  if (init?.method === 'POST' || init?.method === 'PUT')
    return { incidentId: id, workOrderId: wid, resourceId: eid };
  if (path.startsWith('/api/v1/locations/')) return { name: 'Cơ sở thử nghiệm' };
  if (path.startsWith('/api/v1/rooms/')) return { roomNumber: 'A101' };
  if (path.startsWith('/api/v1/assets/')) return { name: 'Vòi nước', code: 'DEVICE-TEST' };
  if (path.includes('/reporting-rooms'))
    return page([
      { roomId: rid, roomNumber: 'A101', locationId: lid, locationName: 'Cơ sở thử nghiệm' },
    ]);
  if (path.includes('/reporting-assets')) return page([]);
  if (path === '/api/v1/capture/locations') return [{ id: lid, label: 'Cơ sở thử nghiệm' }];
  if (path.includes('/capture/locations/') && path.endsWith('/rooms'))
    return [{ id: rid, label: 'A101' }];
  if (path === `/api/v1/operational-tasks/${inventoryTaskId}/location-asset-inventory`)
    return {
      taskId: inventoryTaskId,
      locationId: lid,
      assignmentId: wid,
      status: 'InProgress',
      version: 5,
      totalCount: 1,
      checkedCount: 1,
      pendingOwnerRooms: [],
      pendingOwnerCommonAssets: false,
      items: [
        {
          id: inventoryItemId,
          roomId: rid,
          roomNumber: 'A101',
          assetId: eid,
          name: 'Quạt trần',
          quantity: 1,
          commonArea: null,
          checked: true,
          inherited: false,
          condition: 'Damaged',
          note: 'Cánh quạt bị nứt.',
          incidentId: null,
        },
      ],
    };
  if (path.startsWith('/api/v1/assets?')) return { ...page([]), pageSize: 100 };
  if (path.startsWith('/api/v1/staff-location-assignments'))
    return [{ id, staffUserId: actor, startDate: '2020-01-01', endDate: '2099-01-01' }];
  if (path === '/api/v1/capture/staff') return [{ id: actor, label: 'Nhân viên thử nghiệm' }];
  if (path.includes('/history?'))
    return page([
      {
        id: eid,
        workOrderId: wid,
        action: 'progress',
        note: 'Đã kiểm tra thực tế',
        occurredAt: '2026-11-06T01:00:00Z',
        actorId: 'PRIVATE-ACTOR',
        dataJson: '{"Vendor":"PRIVATE-VENDOR","ActualCost":999999}',
      },
    ]);
  if (path === `/api/v1/incidents/${id}/progress`)
    return {
      currentStep: 'Đang xử lý',
      events: [{ message: 'Đã kiểm tra thực tế', occurredAt: '2026-11-06T01:00:00Z' }],
    };
  if (
    path.endsWith('/evidence') ||
    path.endsWith('/expenses') ||
    path.endsWith('/emergency-actions')
  )
    return [];
  if (path.includes('/maintenance-history?')) return page([]);
  if (path.startsWith('/api/v1/work-orders?')) return page([work]);
  if (path === '/api/v1/work-orders/' + wid) return { ...work };
  if (path.startsWith('/api/v1/incidents?')) return page([report]);
  if (path === '/api/v1/incidents/' + id) return { ...report };
  throw new Error('Unexpected endpoint: ' + path);
}
beforeEach(() => {
  api.queryCache.dispose();
  api.queryCache = new QueryCache();
  vi.clearAllMocks();
  s.role = 'Staff';
  s.preview = false;
  s.params = {};
  report = {
    id,
    code: 'INC-SYNTHETIC',
    locationId: lid,
    roomId: rid,
    commonArea: null,
    assetId: null,
    roomNumber: 'P.101',
    locationName: 'Cơ sở thử nghiệm',
    assetName: 'Bóng đèn',
    description: 'Ống nước bị vỡ trong phòng',
    severity: 'Normal',
    status: 'Submitted',
    type: 'Thiếu đồ',
    category: 'Bàn học',
    acknowledgedAt: null,
    resolutionNote: null,
    version: 4,
    createdAt: '2026-11-06T01:00:00Z',
    staffAvailable: true,
    escalationEnabled: false,
  };
  work = {
    id: wid,
    incidentId: id,
    locationId: lid,
    roomId: rid,
    assetId: null,
    assignedStaffId: actor,
    expectedOutcome: 'Khắc phục rò nước',
    targetCompletionAt: '2099-11-06T08:00:00Z',
    isOverdue: false,
    status: 'Assigned',
    inspectionResult: null,
    proposedSolution: null,
    estimatedMinutes: null,
    estimatedCost: null,
    vendor: null,
    proposalVersion: 0,
    planApproved: false,
    canStart: false,
    approvedById: null,
    approvedAt: null,
    result: null,
    actualCost: null,
    verifiedById: null,
    verifiedAt: null,
    version: 7,
  };
  s.request.mockImplementation(async (path, init) => respond(path, init));
  s.gallery.mockResolvedValue({ canceled: true, assets: null });
});
it('opens a proactive work order and permits Staff actions without an Incident request', async () => {
  s.params = { workOrderId: wid };
  work = {
    ...work,
    incidentId: null,
    source: 'Proactive',
    description: 'Kiểm tra phòng trống tổng hợp',
  };
  render(<MaintenanceDetailScreen />);
  expect(await screen.findByText(/Kiểm tra phòng trống tổng hợp/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Phương án' }));
  expect(await screen.findByText('Gửi phương án sửa chữa')).toBeTruthy();
  expect(
    s.request.mock.calls.some(([path]) => path === `/api/v1/work-orders/${wid}/evidence`),
  ).toBe(true);
  expect(s.request.mock.calls.some(([path]) => path.includes('/incidents/null'))).toBe(false);
});
it('shows the saved proposal of a verified WorkOrder in its own tab without mutation controls', async () => {
  s.params = { workOrderId: wid };
  work = {
    ...work,
    status: 'Verified',
    description: 'Kiểm tra bóng đèn',
    inspectionResult: 'Đèn hỏng',
    proposedSolution: 'Thay bóng mới',
    estimatedMinutes: 60,
    estimatedCost: 50000,
    proposalVersion: 1,
    planApproved: true,
    approvedAt: '2026-11-26T14:05:00Z',
    result: 'Đã thay bóng',
    actualCost: 100000,
    verifiedAt: '2026-11-26T14:12:00Z',
  };
  render(<MaintenanceDetailScreen />);
  await screen.findByText('Thông tin công việc');
  expect(screen.getByText('Đã thay bóng')).toBeTruthy();
  expect(screen.queryByText('Thay bóng mới')).toBeNull();
  expect(screen.queryByText(/Chưa ở bước bắt đầu/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Phương án' }));
  expect(await screen.findByText('Thay bóng mới')).toBeTruthy();
  expect(screen.getByText('Đèn hỏng')).toBeTruthy();
  expect(screen.getByText('60 phút')).toBeTruthy();
  expect(screen.getByText('Đã được duyệt')).toBeTruthy();
  expect(screen.queryByText('Đã thay bóng')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gửi phương án sửa chữa' })).toBeNull();
  expect(mutations()).toHaveLength(0);
});
it('shows each WorkOrder as a separate item in the embedded Staff work list', async () => {
  const secondWorkId = '88888888-8888-4888-8888-888888888888';
  s.request.mockImplementation(async (path, init) =>
    path.startsWith('/api/v1/work-orders?')
      ? page([
          work,
          {
            ...work,
            id: secondWorkId,
            incidentId: null,
            source: 'Proactive',
            description: 'Bảo trì máy bơm',
          },
        ])
      : respond(path, init),
  );
  render(<MaintenanceListScreen embedded />);
  await screen.findByText('Bảo trì máy bơm');
  expect(screen.queryByText('Công việc sửa chữa & bảo trì')).toBeNull();
  expect(
    screen.queryByText('Các việc được giao từ báo cáo sự cố hoặc kế hoạch bảo trì chủ động'),
  ).toBeNull();
  expect(screen.queryByText('Tải lại', { exact: true })).toBeNull();
  expect(screen.getAllByText('Xem chi tiết công việc')).toHaveLength(2);
  expect(screen.getByText('Bảo trì chủ động')).toBeTruthy();
  fireEvent.click(screen.getAllByText('Xem chi tiết công việc')[0]!);
  expect(s.go).toHaveBeenCalledWith('maintenance-detail', {
    workOrderId: wid,
    returnTo: 'work-orders',
  });
});
it('retains the controlled maintenance queue page and resets it on filter change', async () => {
  const setPage = vi.fn();
  const setStatus = vi.fn();
  render(
    <MaintenanceListScreen
      embedded
      queueState={{ page: 2, status: 'Assigned', setPage, setStatus }}
    />,
  );
  await waitFor(() =>
    expect(
      s.request.mock.calls.some(
        ([path]) =>
          path.startsWith('/api/v1/work-orders?') &&
          path.includes('page=2') &&
          path.includes('workOrderStatus=Assigned'),
      ),
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Trạng thái sửa chữa / bảo trì'), {
    target: { value: 'Verified' },
  });
  expect(setStatus).toHaveBeenCalledWith('Verified');
  expect(setPage).toHaveBeenCalledWith(1);
});
it('loads authenticated WorkOrder thumbnails only after Staff opens the photos tab', async () => {
  s.params = { workOrderId: wid };
  s.request.mockImplementation(async (path, init) => {
    if (path === `/api/v1/work-orders/${wid}/evidence`)
      return [
        {
          id: eid,
          workOrderId: wid,
          activityId: null,
          kind: 'Completion',
          contentType: 'image/png',
          length: 8,
        },
      ];
    if (path === `/api/v1/work-orders/${wid}/evidence/${eid}`)
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return respond(path, init);
  });
  render(<MaintenanceDetailScreen />);
  await screen.findByText(/Khắc phục rò nước/);
  expect(
    s.request.mock.calls.some(([path]) => path === `/api/v1/work-orders/${wid}/evidence/${eid}`),
  ).toBe(false);

  fireEvent.click(screen.getByRole('tab', { name: 'Ảnh' }));
  await screen.findByAltText('Ảnh minh chứng đã tải từ máy chủ');
  expect(
    s.request.mock.calls.some(([path]) => path === `/api/v1/work-orders/${wid}/evidence/${eid}`),
  ).toBe(true);
});
afterEach(() => {
  cleanup();
  api.queryCache.dispose();
});
const actionLabels: Record<string, string> = {
  proposal: 'Gửi phương án sửa chữa',
  submit: 'Gửi kết quả nghiệm thu',
  progress: 'Cập nhật tiến độ',
  blocker: 'Báo vướng mắc',
  'plan-decision': 'Quyết định phương án',
  'emergency-actions': 'Ghi hành động khẩn cấp',
  start: 'Bắt đầu sửa chữa',
  acknowledge: 'Tiếp nhận khẩn cấp',
};
const choose = (label: string, value: string) => {
  if (label === 'Chọn thao tác') {
    const actionLabel = actionLabels[value];
    if (!actionLabel) throw new Error(`Missing action label for ${value}`);
    const primary = screen.queryByRole('button', { name: actionLabel });
    if (primary) {
      fireEvent.click(primary);
      return;
    }
    const more = screen.queryByRole('button', { name: 'Thao tác khác' });
    if (more) fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: actionLabel }));
    return;
  }
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const confirm = () => fireEvent.click(screen.getByRole('checkbox'));
const mutations = () =>
  s.request.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PUT');
async function photo() {
  fireEvent.click(screen.getByText('Chụp ảnh hiện trường'));
  await screen.findByAltText('Ảnh hiện trường 1');
}

it('submits a Tenant multipart report with UTF-8 description and opens the real ID returned by backend', async () => {
  s.role = 'Tenant';
  render(<IncidentReportForm />);
  await screen.findByText('Phòng A101');
  choose('Mô tả sự cố', 'Ống nước bị vỡ, cần sửa chữa');
  fireEvent.click(screen.getByText('Khẩn cấp'));
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByAltText('Ảnh hiện trường 1');
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await waitFor(() => expect(s.go).toHaveBeenCalledWith('incident-detail', { incidentId: id }));
  expect(mutations()).toHaveLength(1);
  const [, init] = mutations()[0];
  expect(init.headers['Content-Type']).toContain('multipart/form-data');
  expect(new TextDecoder().decode(init.body)).toContain('Ống nước bị vỡ, cần sửa chữa');
  expect(new TextDecoder().decode(init.body)).not.toContain('name="category"');
});
it('links a newly created incident back to the exact damaged Location inventory item without losing its condition', async () => {
  s.params = {
    inventoryTaskId,
    locationAssetInventoryItemId: inventoryItemId,
    locationId: lid,
    roomId: rid,
    assetId: eid,
    description: 'Kiểm kê: Quạt trần bị hỏng, cánh quạt bị nứt.',
  };
  render(<IncidentReportForm />);
  await screen.findByText(/Cơ sở đang làm việc: Cơ sở thử nghiệm/);
  await waitFor(() => {
    expect((screen.getByLabelText('Phòng') as HTMLSelectElement).value).toBe(rid);
    expect((screen.getByLabelText('Tài sản liên quan (tùy chọn)') as HTMLSelectElement).value).toBe(
      eid,
    );
    expect((screen.getByText('Gửi báo cáo sự cố') as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(screen.getByText('Gửi báo cáo sự cố'));

  await waitFor(() =>
    expect(s.go).toHaveBeenCalledWith('task-detail', { taskId: inventoryTaskId }),
  );
  const link = s.request.mock.calls.find(
    ([path, init]) =>
      path ===
        `/api/v1/operational-tasks/${inventoryTaskId}/location-asset-inventory/items/${inventoryItemId}` &&
      init?.method === 'PUT',
  );
  expect(link).toBeTruthy();
  expect(JSON.parse(link![1].body)).toEqual({
    version: 5,
    checked: true,
    condition: 'Damaged',
    note: 'Cánh quạt bị nứt.',
    incidentId: id,
  });
  expect(new Headers(link![1].headers).get('Idempotency-Key')).toMatch(/^[a-f\d-]{36}$/i);
});
it('links an Incident to an inherited item without changing its Tenant/Owner baseline', async () => {
  s.params = {
    inventoryTaskId,
    locationAssetInventoryItemId: inventoryItemId,
    locationId: lid,
    roomId: rid,
    assetId: eid,
    inventoryCondition: 'Missing',
    description: 'Inventory check: ceiling fan is missing from room A101.',
  };
  const inventoryPath = `/api/v1/operational-tasks/${inventoryTaskId}/location-asset-inventory`;
  s.request.mockImplementation(async (path, init) => {
    if (path === inventoryPath && !init?.method)
      return {
        taskId: inventoryTaskId,
        locationId: lid,
        assignmentId: wid,
        status: 'InProgress',
        version: 5,
        totalCount: 1,
        checkedCount: 1,
        items: [
          {
            id: inventoryItemId,
            roomId: rid,
            roomNumber: 'A101',
            assetId: eid,
            name: 'Qu?t tr?n',
            quantity: 1,
            commonArea: null,
            checked: true,
            inherited: true,
            sourceHandoverContractId: wid,
            condition: 'Intact',
            note: null,
            incidentId: null,
          },
        ],
      };
    return respond(path, init);
  });
  render(<IncidentReportForm />);
  await waitFor(() =>
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe(rid),
  );
  await waitFor(() =>
    expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe(eid),
  );
  await screen.findByRole('button', { name: /G.*b.*c.*s.*c/ });
  fireEvent.click(screen.getByRole('button', { name: /G.*b.*c.*s.*c/ }));

  await waitFor(() =>
    expect(s.go).toHaveBeenCalledWith('task-detail', { taskId: inventoryTaskId }),
  );
  const link = s.request.mock.calls.find(
    ([path, init]) =>
      path === `${inventoryPath}/items/${inventoryItemId}` && init?.method === 'PUT',
  );
  expect(link).toBeTruthy();
  expect(JSON.parse(link![1].body)).toEqual({
    version: 5,
    checked: true,
    condition: 'Intact',
    note: null,
    incidentId: id,
  });
});

it('locks double submit and reuses the same idempotency key after ambiguous failure, without false success', async () => {
  let reject!: (e: Error) => void;
  s.request.mockImplementation(async (path, init) =>
    init?.method === 'POST'
      ? new Promise((_, r) => {
          reject = r;
        })
      : respond(path, init),
  );
  render(<StaffIncidentReportScreen />);
  await screen.findByText(/Cơ sở đang làm việc:/);
  await screen.findByRole('option', { name: 'A101' });
  choose('Phòng', rid);
  choose('Mô tả sự cố (10–8000 ký tự)', 'Ống nước đang bị rò trong phòng');
  const button = screen.getByText('Gửi báo cáo sự cố');
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(s.success).not.toHaveBeenCalled();
  reject(new MobileApiError(0, 'network_unavailable'));
  await screen.findByText(/Kết nối tới máy chủ đang gián đoạn/);
  const key = mutations()[0][1].headers['Idempotency-Key'];
  s.request.mockImplementation(async (path, init) => respond(path, init));
  fireEvent.click(button);
  await waitFor(() => expect(mutations()).toHaveLength(2));
  expect(mutations()[1][1].headers['Idempotency-Key']).toBe(key);
});
it('Tenant detail shows sanitized progress but never requests or exposes WorkOrder finances and actors', async () => {
  s.role = 'Tenant';
  s.params = { incidentId: id };
  render(<IncidentDetailScreen />);
  await screen.findByText('Đã kiểm tra thực tế');
  expect(screen.queryByText(/PRIVATE-VENDOR|PRIVATE-ACTOR|999999/)).toBeNull();
  expect(
    s.request.mock.calls.some(
      ([path]) =>
        path.includes('/work-orders') ||
        path.endsWith('/expenses') ||
        path.endsWith('/emergency-actions') ||
        path.includes('/history?'),
    ),
  ).toBe(false);
});
it.each(['Owner', 'Tenant'])(
  'preserves the separate incident inbox entry from the %s incident feature',
  async (role) => {
    s.role = role;
    render(<IncidentListScreen />);
    await screen.findByText('Ống nước bị vỡ trong phòng');
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo sự cố và bảo trì' }));
    expect(s.go).toHaveBeenCalledWith('incident-inbox');
    expect(s.request.mock.calls.some(([path]) => path.startsWith('/api/v1/notifications'))).toBe(
      false,
    );
  },
);
it('filters real report list by backend status and retains existing invoice adjustment navigation', async () => {
  s.role = 'Tenant';
  render(<IncidentListScreen />);
  await screen.findByText('Ống nước bị vỡ trong phòng');
  fireEvent.click(screen.getByRole('button', { name: 'Đã giải quyết' }));
  await waitFor(() =>
    expect(s.request.mock.calls.some(([path]) => path.includes('status=Resolved'))).toBe(true),
  );
  fireEvent.click(screen.getByText('Báo cáo sự cố mới'));
  expect(s.go).toHaveBeenCalledWith('incidents');
  fireEvent.click(screen.getByText('Yêu cầu điều chỉnh hóa đơn'));
  expect(s.go).toHaveBeenCalledWith('invoice', { focus: 'adjustment' });
});
it('presents Staff incident reports as compact mobile cards with clear location, severity, status and asset metadata', async () => {
  report = { ...report, severity: 'Emergency', status: 'InProgress' };
  render(<IncidentListScreen />);
  await screen.findByText('Phòng P.101');
  expect(screen.getAllByText('Khẩn cấp')).toHaveLength(2);
  expect(screen.getAllByText('Đang xử lý')).toHaveLength(2);
  expect(screen.getByText('Ống nước bị vỡ trong phòng')).toBeTruthy();
  expect(screen.getByText('Cơ sở thử nghiệm')).toBeTruthy();
  expect(screen.getByText('Bóng đèn')).toBeTruthy();
  expect(screen.getByText('Thiếu đồ')).toBeTruthy();
  expect(screen.getByText('Bàn học')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đang xử lý' }));
  await waitFor(() =>
    expect(s.request.mock.calls.some(([path]) => path.includes('status=InProgress'))).toBe(true),
  );
});
it('opens the new Staff incident report from the compact list action', async () => {
  render(<IncidentListScreen />);
  await screen.findByText('Ống nước bị vỡ trong phòng');
  fireEvent.click(screen.getByRole('button', { name: 'Báo cáo sự cố mới' }));
  expect(s.go).toHaveBeenCalledWith('report-incident');
  expect(screen.queryByText('Báo cáo sự cố mới')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thông báo sự cố và bảo trì' }));
  expect(s.go).toHaveBeenCalledWith('incident-inbox');
  const requestCount = s.request.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách báo cáo' }));
  await waitFor(() => expect(s.request.mock.calls.length).toBeGreaterThan(requestCount));
});
it('registers the Staff report title and incident inbox bell in the workspace header', async () => {
  const registered: { current: WorkspaceHeaderAction | null } = { current: null };
  const register = (action: WorkspaceHeaderAction) => {
    registered.current = action;
    return () => {
      registered.current = null;
    };
  };
  render(
    <WorkspaceHeaderContext.Provider value={register}>
      <IncidentListScreen />
    </WorkspaceHeaderContext.Provider>,
  );
  await screen.findByText('Ống nước bị vỡ trong phòng');
  const header = registered.current as WorkspaceHeaderAction | null;
  expect(header?.title).toBe('Báo cáo sự cố');
  expect(header?.action?.icon).toBe('bell-outline');
  expect(header?.action?.accessibilityLabel).toBe('Thông báo sự cố và bảo trì');
  header?.action?.onPress();
  expect(s.go).toHaveBeenCalledWith('incident-inbox');
  expect(screen.queryByRole('button', { name: 'Thông báo sự cố và bảo trì' })).toBeNull();
});
it('keeps reports in the Staff report inbox even when no WorkOrder has been created', async () => {
  s.role = 'Staff';
  render(<IncidentListScreen />);
  await screen.findByText('Ống nước bị vỡ trong phòng');
  expect(s.request.mock.calls.some(([path]) => path.includes('/work-orders'))).toBe(false);
});
it.each([
  ['Normal', 'staff-incidents'],
  ['Emergency', 'staff-emergencies'],
] as const)(
  'returns a %s Staff report to its matching report list',
  async (severity, destination) => {
    report = { ...report, severity };
    s.params = { incidentId: id };
    render(<IncidentDetailScreen />);
    await screen.findByText('Ống nước bị vỡ trong phòng');
    fireEvent.click(screen.getByText('Về danh sách báo cáo'));
    expect(s.go).toHaveBeenCalledWith(destination);
  },
);
it('returns Staff from the submitted-report shortcut to the incident report list', async () => {
  render(<StaffIncidentReportScreen />);
  await screen.findByText(/Cơ sở đang làm việc:/);
  fireEvent.click(screen.getByText('Xem báo cáo đã gửi'));
  expect(s.go).toHaveBeenCalledWith('staff-incidents');
});
it('separates Staff incident content, linked WorkOrders, and history into distinct tabs', async () => {
  s.params = { incidentId: id };
  render(<IncidentDetailScreen />);
  await screen.findByText('Ống nước bị vỡ trong phòng');
  expect(screen.queryByText('Khắc phục rò nước')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: 'Công việc liên quan' }));
  await screen.findByText('Khắc phục rò nước');
  expect(screen.queryByText('Đã kiểm tra thực tế')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
  await screen.findByText('Đã kiểm tra thực tế');
  expect(screen.queryByText('Khắc phục rò nước')).toBeNull();
});
it('returns from a linked WorkOrder to the exact source Incident report', async () => {
  s.params = { workOrderId: wid, returnTo: 'incident-detail', incidentId: id };
  render(<MaintenanceDetailScreen />);
  await screen.findByText(/Kết quả yêu cầu/);
  fireEvent.click(screen.getByText('Về báo cáo sự cố'));
  expect(s.go).toHaveBeenCalledWith('incident-detail', { incidentId: id });
});
it('opens a linked WorkOrder with its exact Incident return context', async () => {
  s.params = { incidentId: id };
  render(<IncidentDetailScreen />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Công việc liên quan' }));
  await screen.findByText(/Khắc phục rò nước/);
  fireEvent.click(screen.getByText('Xem chi tiết lệnh sửa chữa'));
  expect(s.go).toHaveBeenCalledWith('maintenance-detail', {
    workOrderId: wid,
    returnTo: 'incident-detail',
    incidentId: id,
  });
});
it('returns from an embedded WorkOrder to the Staff work list', async () => {
  s.params = { workOrderId: wid, returnTo: 'work-orders' };
  render(<MaintenanceDetailScreen />);
  await screen.findByText(/Kết quả yêu cầu/);
  fireEvent.click(screen.getByText('Về danh sách công việc'));
  expect(s.go).toHaveBeenCalledWith('work-orders', { tab: 'maintenance' });
});
it('shows Tenant report photos only even if an unexpected internal evidence kind is returned', async () => {
  s.role = 'Tenant';
  s.params = { incidentId: id };
  s.request.mockImplementation(async (path, init) =>
    path.endsWith('/evidence')
      ? ['Report', 'Inspection', 'Completion'].map((kind, index) => ({
          id: `evidence-${index}`,
          workOrderId: null,
          activityId: null,
          kind,
          contentType: 'image/png',
          length: 8,
        }))
      : respond(path, init),
  );
  render(<IncidentDetailScreen />);
  await screen.findByText(/Ảnh báo cáo · image\/png/);
  expect(screen.queryByText(/Ảnh kiểm tra ·/)).toBeNull();
  expect(screen.queryByText(/Ảnh kết quả ·/)).toBeNull();
  expect(screen.getAllByText('Tải ảnh minh chứng')).toHaveLength(1);
  expect(s.request.mock.calls.some(([path]) => /\/evidence\/evidence-[12]$/.test(path))).toBe(
    false,
  );
});
it('uploads Inspection evidence then submits the proposal using the WorkOrder version and exact DTO', async () => {
  render(<IncidentActionPanel report={report} work={work} role="Staff" />);
  choose('Chọn thao tác', 'proposal');
  choose('Kết quả kiểm tra', 'Ống cấp nước bị vỡ');
  choose('Phương án sửa chữa', 'Thay đoạn ống');
  choose('Thời gian dự kiến (phút)', '45');
  choose('Chi phí dự kiến (VND, tùy chọn)', '150000');
  await photo();
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi phương án sửa chữa' }));
  await waitFor(() => expect(mutations()).toHaveLength(2));
  expect(mutations()[0][0]).toContain(`/incidents/${id}/evidence?kind=2&workOrderId=${wid}`);
  expect(mutations()[1][0]).toBe(`/api/v1/work-orders/${wid}/proposal`);
  expect(JSON.parse(mutations()[1][1].body)).toEqual({
    version: 7,
    inspectionResult: 'Ống cấp nước bị vỡ',
    solution: 'Thay đoạn ống',
    estimatedMinutes: 45,
    estimatedCost: 150000,
    evidenceIds: [eid],
  });
});
it('requires completion evidence before making any mutation', async () => {
  work.status = 'InProgress';
  render(<IncidentActionPanel report={report} work={work} role="Staff" />);
  choose('Chọn thao tác', 'submit');
  choose('Kết quả sửa chữa', 'Đã sửa và kiểm tra');
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi kết quả nghiệm thu' }));
  await screen.findByText(/Cần ít nhất một ảnh kết quả/);
  expect(mutations()).toHaveLength(0);
});
it.each(['progress', 'blocker', 'submit'])(
  'sends authorized Staff %s using real Completion evidence and version',
  async (action) => {
    work.status = 'InProgress';
    render(<IncidentActionPanel report={report} work={work} role="Staff" />);
    choose('Chọn thao tác', action);
    choose(action === 'submit' ? 'Kết quả sửa chữa' : 'Nội dung cập nhật', 'Đã kiểm tra đường ống');
    await photo();
    confirm();
    fireEvent.click(
      screen.getByRole('button', {
        name:
          action === 'progress'
            ? 'Cập nhật tiến độ'
            : action === 'blocker'
              ? 'Báo vướng mắc'
              : 'Gửi kết quả nghiệm thu',
      }),
    );
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1][0]).toBe(`/api/v1/work-orders/${wid}/${action}`);
    expect(JSON.parse(mutations()[1][1].body)).toMatchObject({ version: 7, evidenceIds: [eid] });
  },
);
it.each(['PendingApproval', 'PendingVerification'] as const)(
  'Owner has state-gated mobile quick decisions for %s without Staff execution actions',
  (status) => {
    s.role = 'Owner';
    work.status = status;
    render(<IncidentActionPanel report={report} work={work} role="Owner" />);
    expect(
      screen.getByRole('button', {
        name: status === 'PendingApproval' ? 'Quyết định phương án' : 'Nghiệm thu hoàn thành',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đổi nhân viên' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bắt đầu sửa chữa' })).toBeNull();
    expect(mutations()).toHaveLength(0);
  },
);
it('refreshes all Owner maintenance detail sections through the shared pull-to-refresh action', async () => {
  s.role = 'Owner';
  s.params = { workOrderId: wid };
  let action: WorkspaceHeaderAction | undefined;
  const register = (value: WorkspaceHeaderAction) => {
    action = value;
    return () => {};
  };
  render(
    <WorkspaceHeaderContext.Provider value={register}>
      <MaintenanceDetailScreen />
    </WorkspaceHeaderContext.Provider>,
  );
  await screen.findByText('Chi tiết lệnh sửa chữa');
  await waitFor(() => expect(action?.disabled).toBe(false));
  const before = s.request.mock.calls.filter(
    ([path]) => path === `/api/v1/work-orders/${wid}`,
  ).length;
  await act(async () => action?.onRefresh());
  await waitFor(() =>
    expect(
      s.request.mock.calls.filter(([path]) => path === `/api/v1/work-orders/${wid}`).length,
    ).toBe(before + 1),
  );
  expect(
    s.request.mock.calls.filter(([path]) => path.endsWith('/evidence')).length,
  ).toBeGreaterThanOrEqual(2);
});

it('sends one confirmed Owner plan decision with the current version and idempotency key', async () => {
  s.role = 'Owner';
  work.status = 'PendingApproval';
  render(<IncidentActionPanel report={report} work={work} role="Owner" />);
  choose('Chọn thao tác', 'plan-decision');
  choose('Quyết định phê duyệt', 'true');
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Quyết định phương án' }));
  expect(mutations()).toHaveLength(0);
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(mutations()[0][0]).toBe(`/api/v1/work-orders/${wid}/plan-decision`);
  expect(JSON.parse(mutations()[0][1].body)).toEqual({
    version: 7,
    approve: true,
    reason: null,
    vendor: null,
  });
  expect(new Headers(mutations()[0][1].headers).get('Idempotency-Key')).toMatch(/^[a-f\d-]{36}$/i);
  expect(s.success).toHaveBeenCalledOnce();
});

it.each(['Assigned', 'InProgress', 'Verified', 'Cancelled'] as const)(
  'does not expose an Owner quick decision for %s',
  (status) => {
    s.role = 'Owner';
    work.status = status;
    render(<IncidentActionPanel report={report} work={work} role="Owner" />);
    expect(screen.queryByRole('button', { name: 'Quyết định phương án' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nghiệm thu hoàn thành' })).toBeNull();
    expect(mutations()).toHaveLength(0);
  },
);
it('refreshes the Incident version after uploading Emergency evidence before sending the action', async () => {
  s.role = 'Staff';
  report.severity = 'Emergency';
  report.acknowledgedAt = '2026-11-11T00:00:00Z';
  s.request.mockImplementation(async (path, init) =>
    path === `/api/v1/incidents/${id}` && !init?.method
      ? { ...report, version: 5 }
      : respond(path, init),
  );
  render(<IncidentActionPanel report={report} role="Staff" />);
  choose('Chọn thao tác', 'emergency-actions');
  choose(
    'Biện pháp an toàn đã thực hiện và khó khăn còn gặp phải',
    'Đã khóa van và cô lập khu vực',
  );
  choose('Chi phí đề nghị (VND, tùy chọn)', '50000');
  await photo();
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Ghi hành động khẩn cấp' }));
  await waitFor(() => expect(mutations()).toHaveLength(2));
  expect(JSON.parse(mutations()[1][1].body)).toMatchObject({
    version: 5,
    evidenceIds: [eid],
    requestedCost: 50000,
  });
});
it('retains input and shows backend concurrency diagnostics without reporting success', async () => {
  s.role = 'Staff';
  report.severity = 'Emergency';
  report.acknowledgedAt = '2026-11-11T00:00:00Z';
  s.request.mockImplementation(async (path, init) =>
    path.includes('/evidence?') && init?.method === 'POST'
      ? respond(path, init)
      : init?.method === 'POST'
        ? Promise.reject(
            new MobileApiError(409, 'stale_version', path, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          )
        : respond(path, init),
  );
  render(<IncidentActionPanel report={report} role="Staff" />);
  choose('Chọn thao tác', 'emergency-actions');
  choose('Biện pháp an toàn đã thực hiện và khó khăn còn gặp phải', 'Đã khóa van');
  await photo();
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Ghi hành động khẩn cấp' }));
  await screen.findByText(/Dữ liệu đã thay đổi.*aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  expect(s.success).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText('Biện pháp an toàn đã thực hiện và khó khăn còn gặp phải'),
  ).toHaveProperty('value', 'Đã khóa van');
});
it('loads authorized evidence automatically, retries on demand and supports fullscreen preview', async () => {
  s.request.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  render(
    <EvidenceImage
      incidentId={id}
      evidence={{
        id: eid,
        workOrderId: null,
        activityId: null,
        kind: 'Report',
        contentType: 'image/png',
        length: 8,
      }}
    />,
  );
  await screen.findByAltText('Ảnh minh chứng đã tải từ máy chủ');
  expect(s.request).toHaveBeenCalledTimes(1);
  expect(s.request.mock.calls[0][0]).toBe(`/api/v1/incidents/${id}/evidence/${eid}`);
  fireEvent.click(await screen.findByText('Tải lại ảnh'));
  await waitFor(() => expect(s.request).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByText('Xem ảnh toàn màn hình'));
  expect(screen.getByAltText('Ảnh minh chứng toàn màn hình')).toBeTruthy();
});
it('handles gallery size and permission errors without discarding the already chosen valid photo', async () => {
  s.gallery.mockResolvedValue({
    canceled: false,
    assets: [{ base64: 'iVBORw0KGgo=', fileSize: 8 }],
  });
  render(<IncidentEvidencePicker />);
  fireEvent.click(screen.getByText('Chọn ảnh từ thư viện'));
  await screen.findByAltText('Ảnh hiện trường 1');
  s.gallery.mockResolvedValue({
    canceled: false,
    assets: [{ base64: 'iVBORw0KGgo=', fileSize: 5_000_001 }],
  });
  fireEvent.click(screen.getByText('Chọn ảnh từ thư viện'));
  await screen.findByText('Ảnh vượt quá 5.000.000 byte.');
  s.gallery.mockRejectedValue(new Error('denied'));
  fireEvent.click(screen.getByText('Chọn ảnh từ thư viện'));
  await screen.findByText(/Không mở được thư viện ảnh/);
  expect(screen.getAllByRole('img')).toHaveLength(1);
});
it('does not call live APIs or submit while previewing', () => {
  s.preview = true;
  render(<StaffIncidentReportScreen />);
  expect(s.request).not.toHaveBeenCalled();
  expect((screen.getByText('Gửi báo cáo sự cố') as HTMLButtonElement).disabled).toBe(true);
});
it.each(['Owner', 'Tenant'])('blocks %s at all Staff component boundaries', (role) => {
  s.role = role;
  for (const Component of [
    StaffIncidentReportScreen,
    StaffMaintenanceScreen,
    StaffEmergencyScreen,
  ]) {
    render(<Component />);
    expect(screen.getByText(/không có quyền truy cập chức năng Staff/)).toBeTruthy();
    cleanup();
  }
  expect(s.request).not.toHaveBeenCalled();
});
it('does not offer execution controls for a WorkOrder assigned to another Staff member', async () => {
  s.params = { workOrderId: wid };
  work.assignedStaffId = 'other-staff';
  render(<MaintenanceDetailScreen />);
  await screen.findByText(/Khắc phục rò nước/);
  fireEvent.click(screen.getByRole('tab', { name: 'Phương án' }));
  expect(await screen.findByText(/Lệnh này được phân công cho nhân viên khác/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi phương án sửa chữa' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Bắt đầu sửa chữa' })).toBeNull();
});
it('maps known owner event fields and guards emergency acknowledgements against state/role', () => {
  expect(
    eventFacts('{"input":{"Solution":"Thay ống","EstimatedMinutes":30},"Secret":"hidden"}'),
  ).toEqual([
    { label: 'Phương án', value: 'Thay ống' },
    { label: 'Thời gian dự kiến (phút)', value: '30' },
  ]);
  expect(eventFacts('broken')).toEqual([]);
  expect(incidentActions(report, 'Staff')).toEqual([]);
  expect(incidentActions({ ...report, severity: 'Emergency' }, 'Staff')).toEqual(['acknowledge']);
  expect(incidentActions({ ...report, status: 'Resolved' }, 'Owner')).toEqual([]);
});

it('re-fetches WorkOrder detail after start instead of applying a local completion state', async () => {
  work.status = 'PendingApproval';
  work.planApproved = true;
  work.canStart = true;
  s.params = { workOrderId: wid };
  s.request.mockImplementation(async (path, init) => {
    if (path === `/api/v1/work-orders/${wid}/start` && init?.method === 'POST') {
      work = { ...work, status: 'InProgress', canStart: false, version: 8 };
      return { incidentId: id, workOrderId: wid, resourceId: null };
    }
    return respond(path, init);
  });
  render(<MaintenanceDetailScreen />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Phương án' }));
  await screen.findByRole('button', { name: 'Thao tác khác' });
  choose('Chọn thao tác', 'start');
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu sửa chữa' }));
  await screen.findByRole('button', { name: 'Gửi kết quả nghiệm thu' });
  expect(
    s.request.mock.calls.filter(([path]) => path === `/api/v1/work-orders/${wid}`).length,
  ).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole('button', { name: 'Bắt đầu sửa chữa' })).toBeNull();
});

it.each(['Submitted', 'InProgress'] as const)(
  'Owner receives Web guidance for incident management while status is %s',
  (status) => {
    s.role = 'Owner';
    report.status = status;
    report.severity = 'Emergency';
    render(
      <IncidentActionPanel
        report={report}
        role="Owner"
        emergencyActions={[{ id: eid, activityId: wid, requestedCost: 50000, costApproved: null }]}
      />,
    );
    expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Phân loại sự cố' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quyết định chi phí khẩn cấp' })).toBeNull();
    expect(mutations()).toHaveLength(0);
    expect(s.success).not.toHaveBeenCalled();
  },
);
it('does not offer Owner mutations after an Incident is resolved', () => {
  s.role = 'Owner';
  report.status = 'Resolved';
  render(<IncidentActionPanel report={report} role="Owner" />);
  expect(screen.queryByRole('button', { name: 'Quyết định phương án' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nghiệm thu hoàn thành' })).toBeNull();
  expect(mutations()).toHaveLength(0);
});
it('Staff emergency acknowledgement uses its authorized endpoint and current report version', async () => {
  report.severity = 'Emergency';
  render(<IncidentActionPanel report={report} role="Staff" />);
  choose('Chọn thao tác', 'acknowledge');
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận khẩn cấp' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(mutations()[0][0]).toBe(`/api/v1/incidents/${id}/acknowledge`);
  expect(JSON.parse(mutations()[0][1].body)).toEqual({ version: 4 });
});
