// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useWorkspace: () => ({ role: s.role, preview: s.preview, go: s.go }),
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
  }: C & { onPress: () => void; disabled: boolean; accessibilityLabel: string }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
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
    description: 'Ống nước bị vỡ trong phòng',
    severity: 'Normal',
    status: 'Submitted',
    type: null,
    category: null,
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
afterEach(() => {
  cleanup();
  api.queryCache.dispose();
});
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
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
  await screen.findByRole('option', { name: 'Cơ sở thử nghiệm' });
  choose('Cơ sở', lid);
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
it('Tenant detail shows history but never requests or exposes WorkOrder finances and actors', async () => {
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
        path.endsWith('/emergency-actions'),
    ),
  ).toBe(false);
});
it.each(['Owner', 'Staff', 'Tenant'])(
  'preserves the separate incident inbox entry from the %s incident feature',
  async (role) => {
    s.role = role;
    render(<IncidentListScreen />);
    await screen.findByText('INC-SYNTHETIC');
    fireEvent.click(screen.getByText('Thông báo sự cố và bảo trì'));
    expect(s.go).toHaveBeenCalledWith('incident-inbox');
    expect(s.request.mock.calls.some(([path]) => path.startsWith('/api/v1/notifications'))).toBe(
      false,
    );
  },
);
it('filters real report list by backend status and retains existing invoice adjustment navigation', async () => {
  s.role = 'Tenant';
  render(<IncidentListScreen />);
  await screen.findByText('INC-SYNTHETIC');
  choose('Trạng thái báo cáo', 'Resolved');
  await waitFor(() =>
    expect(s.request.mock.calls.some(([path]) => path.includes('status=Resolved'))).toBe(true),
  );
  fireEvent.click(screen.getByText('Yêu cầu điều chỉnh hóa đơn'));
  expect(s.go).toHaveBeenCalledWith('invoice', { focus: 'adjustment' });
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
  choose('Nội dung / kết quả thực hiện', 'Đã sửa và kiểm tra');
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
    choose('Nội dung / kết quả thực hiện', 'Đã kiểm tra đường ống');
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
it.each([
  ['PendingApproval', 'Quyết định phương án'],
  ['PendingVerification', 'Nghiệm thu hoàn thành'],
] as const)(
  'Owner can perform guarded %s WorkOrder decisions on mobile',
  (status, expectedAction) => {
    s.role = 'Owner';
    work.status = status;
    render(<IncidentActionPanel report={report} work={work} role="Owner" />);
    expect(screen.getByLabelText('Chọn thao tác')).toBeTruthy();
    expect(screen.getByRole('option', { name: expectedAction })).toBeTruthy();
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
  choose('Nội dung / kết quả thực hiện', 'Đã khóa van và cô lập khu vực');
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
    init?.method === 'POST'
      ? Promise.reject(
          new MobileApiError(409, 'stale_version', path, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        )
      : respond(path, init),
  );
  render(<IncidentActionPanel report={report} role="Staff" />);
  choose('Chọn thao tác', 'emergency-actions');
  choose('Nội dung / kết quả thực hiện', 'Đã khóa van');

  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Ghi hành động khẩn cấp' }));
  await screen.findByText(/Dữ liệu đã thay đổi.*aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  expect(s.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Nội dung / kết quả thực hiện')).toHaveProperty(
    'value',
    'Đã khóa van',
  );
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
  expect(screen.queryByLabelText('Chọn thao tác')).toBeNull();
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
  await screen.findByLabelText('Chọn thao tác');
  choose('Chọn thao tác', 'start');
  confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu sửa chữa' }));
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Cập nhật tiến độ' })).toBeTruthy(),
  );
  expect(
    s.request.mock.calls.filter(([path]) => path === `/api/v1/work-orders/${wid}`).length,
  ).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole('option', { name: 'Bắt đầu sửa chữa' })).toBeNull();
});

it.each(['Submitted', 'InProgress'] as const)(
  'Owner receives guarded incident quick actions while status is %s',
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
    expect(screen.getByLabelText('Chọn thao tác')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Phân loại sự cố' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Quyết định chi phí khẩn cấp' })).toBeTruthy();
    expect(mutations()).toHaveLength(0);
    expect(s.success).not.toHaveBeenCalled();
  },
);
it('does not offer Owner mutations after an Incident is resolved', () => {
  s.role = 'Owner';
  report.status = 'Resolved';
  render(<IncidentActionPanel report={report} role="Owner" />);
  expect(screen.queryByLabelText('Chọn thao tác')).toBeNull();
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
