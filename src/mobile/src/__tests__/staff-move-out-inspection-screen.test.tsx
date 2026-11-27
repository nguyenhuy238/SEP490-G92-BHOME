// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { roomHandoverChecks } from '../services/moveInHandover';
import { businessToday } from '../../../../packages/client-core/src/contracts';

const contractId = '11111111-1111-4111-8111-111111111111';
const roomId = '22222222-2222-4222-8222-222222222222';
const locationId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
type DraftState = {
  contractId: string;
  version: number;
  status: 'Draft';
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  assets: {
    id: string;
    condition: string;
    checked?: boolean;
    observedQuantity?: number;
    missingQuantity?: number;
    notes?: string;
    evidenceIds: string[];
    physicalObservations?: { id: string; quantity: number; condition: string }[];
  }[];
  physicalItemEvidence: {
    assetId: string;
    physicalAssetId: string;
    notes: string;
    evidenceIds: string[];
  }[];
  roomChecks: { code: string; status: string; notes: string | null; evidenceIds: string[] }[];
  accessItems: { type: string; quantity: number; notes: string }[];
  evidenceIds: string[];
  keyEvidenceIds: string[];
  electricityReadingId: string | null;
  waterReadingId: string | null;
  inventoryToken: string | null;
  proposedCompensation: string | null;
  updatedAt: string;
};
const state = vi.hoisted(() => {
  const request = vi.fn();
  return {
    request,
    api: { request, queryCache: { invalidate: vi.fn() } },
    reload: vi.fn(),
    go: vi.fn(),
    assigned: true,
    scopedRoom: true,
    noBaseline: false,
    noInventory: false,
    openingRoomCheck: null as null | {
      code: string;
      status: 'Passed' | 'Issue';
      notes: string;
      evidenceIds: string[];
    },
    ensureEmpty: false,
    proposedDate: '2026-11-18',
    taskStatus: 'InProgress',
    taskTitle: 'Kiểm tra trả phòng R.101',
    responsibleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    taskId: '55555555-5555-4555-8555-555555555555',
    routeId: '11111111-1111-4111-8111-111111111111',
    draft: null as DraftState | null,
    meterTasks: [] as {
      id: string;
      contractId: string;
      roomId: string;
      locationId: string;
      purpose: number;
      utilityType: number;
      readingDate: string;
      status: number;
      confirmedReadingId: string | null;
    }[],
  };
});
type Children = { children?: React.ReactNode };
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ contractId: state.routeId, taskId: state.taskId }),
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  router: { push: vi.fn() },
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: state.api,
    session: { roles: ['Staff'], userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: 'Staff',
    preview: false,
    staffLocationId: locationId,
    go: state.go,
  }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => ({
    data: path?.startsWith('/api/v1/operational-tasks/')
      ? {
          id: state.taskId,
          locationId,
          title: state.taskTitle,
          status: state.taskStatus,
          currentResponsibleStaffUserId: state.responsibleId,
          version: 4,
          target: { contractId, roomId },
        }
      : path?.endsWith('/rooms')
        ? state.scopedRoom
          ? [{ id: roomId, label: 'R.101' }]
          : []
        : state.assigned
          ? [
              {
                contractId,
                roomId,
                roomNumber: 'R.101',
                locationName: 'Cơ sở kiểm thử',
                status: 'Approved',
                proposedDate: state.proposedDate,
                scheduledAt: null,
              },
            ]
          : [],
    loading: false,
    error: '',
    reload: state.reload,
  }),
}));
vi.mock('react-native', () => ({
  Image: ({
    source,
    accessibilityLabel,
  }: {
    source: { uri: string };
    accessibilityLabel: string;
  }) => <img src={source.uri} alt={accessibilityLabel} />,
  View: ({ children }: Children) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: Children) => <div>{children}</div>,
  ScrollView: ({ children }: Children) => <div>{children}</div>,
  Modal: ({ children, visible }: Children & { visible: boolean }) =>
    visible ? <section data-testid="work-modal">{children}</section> : null,
  Platform: { OS: 'web' },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, height: 800 }),
}));
vi.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  Paths: { cache: '/private-move-out-cache' },
}));
// The inspection exercises authenticated preview bytes, not the native share
// sheet. Expo Sharing must not initialize an unavailable native module in jsdom.
vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => false),
  shareAsync: vi.fn(),
}));
vi.mock('../theme/theme', () => ({
  colors: {
    blue: '#236abc',
    green: '#1a8c4f',
    amber: '#9b6800',
    muted: '#5a6a84',
    border: '#e5e7eb',
    tint: '#edf4ff',
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: Children) => <div>{children}</div>,
  Button: ({
    children,
    onPress,
    disabled,
  }: Children & { onPress: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Icon: () => null,
  IconButton: ({
    accessibilityLabel,
    onPress,
    disabled,
  }: {
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      X
    </button>
  ),
  ProgressBar: ({ progress }: { progress: number }) => <progress value={progress} max={1} />,
  SegmentedButtons: ({
    value,
    buttons,
    onValueChange,
  }: {
    value: string;
    buttons: { value: string; label: string; disabled?: boolean }[];
    onValueChange: (value: string) => void;
  }) => (
    <div>
      {buttons.map((option) => (
        <button
          key={option.value}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  RadioButton: {
    Item: ({
      label,
      onPress,
      disabled,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button disabled={disabled} onClick={onPress}>
        {label}
      </button>
    ),
  },
  TouchableRipple: ({
    children,
    accessibilityLabel,
    disabled,
    onPress,
  }: Children & {
    accessibilityLabel: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: Children) => <section>{children}</section>,
  Row: ({ children }: Children) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Pill: ({ children }: Children) => <span>{children}</span>,
  ui: {},
  Action: ({
    children,
    disabled,
    onPress,
  }: Children & {
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({
    onCapture,
    disabled,
  }: {
    onCapture: (bytes: Uint8Array<ArrayBuffer>) => Promise<unknown>;
    disabled: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => void onCapture(new Uint8Array([255, 216, 255, 217]))}
    >
      Chụp ảnh
    </button>
  ),
}));
vi.mock('../app/meter', () => ({
  MeterTaskScreen: ({
    taskId,
    embedded,
    onReturn,
  }: {
    taskId: string;
    embedded: boolean;
    onReturn: () => void;
  }) => {
    const task = state.meterTasks.find((item) => item.id === taskId);
    return (
      <div data-testid="embedded-meter">
        <span>{embedded ? 'Phòng R.101' : 'Không nhúng'}</span>
        <span>Chỉ số trước: 10 kWh</span>
        <button
          onClick={() => {
            if (task) {
              task.status = 2;
              task.confirmedReadingId =
                task.utilityType === 0
                  ? '77777777-7777-4777-8777-777777777777'
                  : '88888888-8888-4888-8888-888888888888';
            }
            onReturn();
          }}
        >
          Xác nhận chỉ số
        </button>
        <button onClick={onReturn}>Về tổng quan phòng</button>
      </div>
    );
  },
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (s: string) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Chọn</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../lib/toast', () => ({ showSuccess: vi.fn() }));
import { StaffMoveOutInspectionScreen } from '../screens/StaffMoveOutInspectionScreen';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:private-preview');
  URL.revokeObjectURL = vi.fn();
  state.request.mockReset();
  state.reload.mockReset();
  state.go.mockReset();
  state.assigned = true;
  state.scopedRoom = true;
  state.noBaseline = false;
  state.noInventory = false;
  state.openingRoomCheck = null;
  state.ensureEmpty = false;
  state.proposedDate = '2026-11-18';
  state.taskStatus = 'InProgress';
  state.taskTitle = 'Kiểm tra trả phòng R.101';
  state.responsibleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  state.taskId = '55555555-5555-4555-8555-555555555555';
  state.routeId = contractId;
  state.meterTasks = ([0, 1] as const).map((utilityType) => ({
    id:
      utilityType === 0
        ? '99999999-1111-4111-8111-111111111111'
        : '99999999-2222-4222-8222-222222222222',
    contractId,
    roomId,
    locationId,
    purpose: 2,
    utilityType,
    readingDate: businessToday(),
    status: 1,
    confirmedReadingId: null,
  }));
  state.draft = {
    contractId,
    version: 0,
    status: 'Draft',
    roomCondition: '',
    keysAndAccess: '',
    notes: '',
    assets: [],
    physicalItemEvidence: [],
    roomChecks: [],
    accessItems: [],
    evidenceIds: [],
    keyEvidenceIds: [],
    electricityReadingId: null,
    waterReadingId: null,
    inventoryToken: null,
    proposedCompensation: null,
    updatedAt: '2026-11-21T00:00:00Z',
  };
  let image = 0;
  state.request.mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith('/start') && init?.method === 'POST') {
        state.taskStatus = 'InProgress';
        return { status: 'InProgress' };
      }
      if (path.endsWith('/final-meter-tasks/ensure') && init?.method === 'POST')
        return state.ensureEmpty ? [] : state.meterTasks.map((task) => task.id);
      if (path.startsWith('/api/v1/capture/meter-tasks?')) return structuredClone(state.meterTasks);
      if (path.startsWith('/api/v1/capture/meter-tasks/') && init?.method !== 'POST')
        return structuredClone(state.meterTasks.find((item) => path.endsWith(item.id)));
      if (path.endsWith('/move-out/evidence') && init?.method === 'POST') {
        image++;
        return { id: `66666666-6666-4666-8666-${String(image).padStart(12, '0')}` };
      }
      if (path.includes('/move-out/evidence/') && init?.method !== 'POST') {
        return new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' });
      }
      if (path.endsWith('/move-out/inspection-draft')) {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(init.body ?? '{}') as Partial<DraftState> & { version: number };
          const previous = state.draft!;
          const mergeBy = <T extends { id?: string; code?: string }>(
            existing: T[],
            incoming: T[],
            field: 'id' | 'code',
          ) =>
            existing
              .filter((entry) => !incoming.some((next) => next[field] === entry[field]))
              .concat(incoming);
          state.draft = {
            ...previous,
            ...body,
            assets: body.assets ? mergeBy(previous.assets, body.assets, 'id') : previous.assets,
            physicalItemEvidence: body.physicalItemEvidence
              ? previous.physicalItemEvidence
                  .filter(
                    (entry) =>
                      !(body.physicalItemEvidence ?? []).some(
                        (next) =>
                          next.assetId === entry.assetId &&
                          next.physicalAssetId === entry.physicalAssetId,
                      ),
                  )
                  .concat(body.physicalItemEvidence)
              : previous.physicalItemEvidence,
            roomChecks: body.roomChecks
              ? mergeBy(previous.roomChecks, body.roomChecks, 'code')
              : previous.roomChecks,
            version: previous.version + 1,
            updatedAt: '2026-11-21T01:00:00Z',
          };
        }
        return structuredClone(state.draft);
      }
      if (path.endsWith('/move-out/inspection') && init?.method === 'POST')
        return ((state.taskStatus = 'PendingVerification'), { status: 'Inspected' });
      if (path.endsWith('/move-out/inspection-preparation'))
        return {
          baseline: state.noBaseline
            ? null
            : {
                version: 1,
                snapshot: {
                  roomCondition: 'Tường nguyên vẹn',
                  keysAndAccess: '2 chìa khóa',
                  accessItems: [{ type: 'RoomKey', quantity: 2, notes: '' }],
                  assets: [{ id: assetId, handedOverQuantity: 2, condition: 'Tốt' }],
                  roomChecks: state.openingRoomCheck ? [state.openingRoomCheck] : [],
                },
              },
          legacyExceptionRequired: state.noBaseline,
          finalReadings: [
            {
              id: '77777777-7777-4777-8777-777777777777',
              utilityType: 0,
              meterCode: 'E1',
              value: '100',
              date: businessToday(),
            },
            {
              id: '88888888-8888-4888-8888-888888888888',
              utilityType: 1,
              meterCode: 'W1',
              value: '50',
              date: businessToday(),
            },
          ],
          inventory: state.noInventory
            ? null
            : { stateToken: 'token-inventory', groups: [], noAssetsConfirmed: false },
          inspectionGroups: state.noInventory
            ? []
            : [
                {
                  id: assetId,
                  name: 'Giường đơn',
                  configuredQuantity: 2,
                  handedOverQuantity: 2,
                  inventoryCondition: 'Tốt',
                  observedCondition: '',
                  checked: false,
                },
              ],
        };
      if (path.endsWith('/move-out'))
        return {
          id: '99999999-9999-4999-8999-999999999999',
          status: 'Approved',
          proposedDate: state.proposedDate,
          inspectionScheduledAt: null,
          version: 3,
        };
      return {
        id: contractId,
        roomId,
        locationId,
        roomNumber: 'R.101',
        locationName: 'Cơ sở kiểm thử',
        status: 'Active',
      };
    },
  );
});
afterEach(cleanup);
async function saveCurrentItem() {
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  await waitFor(() => expect(screen.queryByTestId('work-modal')).toBeNull());
}
async function captureCurrentPhoto() {
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
}

it('refuses opening a contract that is no longer a Location move-out task', () => {
  state.assigned = false;
  render(<StaffMoveOutInspectionScreen />);
  expect(screen.getByText(/không nằm trong danh sách nhiệm vụ của cơ sở đang chọn/)).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});

it('routes the legacy shortcut back to the Location work-order queue', () => {
  state.routeId = '';
  render(<StaffMoveOutInspectionScreen />);
  fireEvent.click(screen.getByText('Xem nhiệm vụ trả phòng'));
  expect(state.go).toHaveBeenCalledWith('staff-handovers', { tab: 'MoveOut' });
});

it('only shows tasks for rooms in the selected authorized Location', () => {
  state.scopedRoom = false;
  render(<StaffMoveOutInspectionScreen />);
  expect(screen.getByText(/không nằm trong danh sách nhiệm vụ của cơ sở đang chọn/)).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});

it('does not expose the inspection with a missing or unrelated work order', () => {
  state.taskId = '';
  const view = render(<StaffMoveOutInspectionScreen />);
  expect(
    screen.getByText(/mở nhiệm vụ kiểm tra trả phòng từ mục Bàn giao \/ Trả phòng/),
  ).toBeTruthy();
  expect(screen.queryByText('4 phần kiểm tra trả phòng')).toBeNull();
  state.taskId = '55555555-5555-4555-8555-555555555555';
  state.taskTitle = 'Bàn giao vào phòng R.101';
  view.rerender(<StaffMoveOutInspectionScreen />);
  expect(screen.getByText('Nhiệm vụ không thuộc hợp đồng hoặc cơ sở này.')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});

it('blocks another Staff after the work order has already been started by its owner', () => {
  state.responsibleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  render(<StaffMoveOutInspectionScreen />);
  expect(
    screen.getByText(/Chỉ người đã bắt đầu mới có thể cập nhật kết quả kiểm tra/),
  ).toBeTruthy();
  expect(screen.queryByText('4 phần kiểm tra trả phòng')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});

it('shows Assigned job with Start action; cannot fill or submit before start', async () => {
  state.taskStatus = 'Assigned';
  const page = render(<StaffMoveOutInspectionScreen />);
  expect(screen.getByText('Bắt đầu công việc')).toBeTruthy();
  expect(screen.queryByText('4 phần kiểm tra trả phòng')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Bắt đầu công việc'));
  await waitFor(() =>
    expect(state.request.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(true),
  );
  expect(
    state.request.mock.calls.find(([path]) => path.endsWith('/start'))?.[1].headers[
      'Idempotency-Key'
    ],
  ).toBeTruthy();
  page.rerender(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
});

it('reuses the same start idempotency key after an uncertain server response', async () => {
  state.taskStatus = 'Assigned';
  let starts = 0;
  const defaultRequest = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/start') && init?.method === 'POST' && ++starts === 1)
      throw new Error('Network timeout');
    return defaultRequest(path, init);
  });
  render(<StaffMoveOutInspectionScreen />);
  fireEvent.click(screen.getByText('Bắt đầu công việc'));
  await screen.findByText(/Không kết nối được máy chủ/);
  fireEvent.click(screen.getByText('Bắt đầu công việc'));
  await waitFor(() => expect(starts).toBe(2));
  const requests = state.request.mock.calls.filter(([path]) => path.endsWith('/start'));
  expect(requests[0]![1].headers['Idempotency-Key']).toBe(
    requests[1]![1].headers['Idempotency-Key'],
  );
});

it('previews and removes a photo attached only to the selected room check', async () => {
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  expect(screen.queryByText('Xác nhận hoàn thành')).toBeNull();
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
  expect(screen.getByText(/Ảnh kiểm tra khu vực .*1 ảnh/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh minh chứng 1' }));
  await waitFor(() => {
    expect(screen.queryByRole('img', { name: 'Ảnh minh chứng 1' })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview');
  });
  expect(screen.getByText('Ảnh kiểm tra khu vực (bắt buộc)')).toBeTruthy();
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/move-out/inspection'))).toBe(
    false,
  );
});

it('saves a single room check with version and restores it after reopening the screen', async () => {
  const label = roomHandoverChecks[0]!.label;
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: 'Đạt' }));
  await captureCurrentPhoto();
  expect(state.draft?.version).toBe(0);
  await saveCurrentItem();
  expect(state.draft?.version).toBe(1);
  expect(state.draft?.roomChecks).toMatchObject([
    {
      code: roomHandoverChecks[0]!.code,
      status: 'Passed',
      evidenceIds: ['66666666-6666-4666-8666-000000000001'],
    },
  ]);
  expect(
    state.request.mock.calls.some(
      ([path, init]) => path.endsWith('/move-out/inspection-draft') && init?.method === 'PATCH',
    ),
  ).toBe(true);
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/move-out/inspection'))).toBe(
    false,
  );
  cleanup();
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  expect(screen.getByRole('button', { name: label }).textContent).toContain('Đã lưu');
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('button', { name: 'Đạt' }).getAttribute('disabled')).toBeNull();
});

it('loads a saved room-check photo through the private evidence API after remount', async () => {
  const id = '66666666-6666-4666-8666-000000000001';
  state.draft!.roomChecks = [
    { code: roomHandoverChecks[0]!.code, status: 'Passed', notes: null, evidenceIds: [id] },
  ];
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith(`/move-out/evidence/${id}`)) {
      const photo = new Blob([new Uint8Array([255, 216, 255, 217])], {
        type: 'image/jpeg',
      });
      Object.defineProperty(photo, 'slice', {
        value: () => ({ arrayBuffer: async () => Uint8Array.from([255, 216, 255, 217]).buffer }),
      });
      return photo;
    }
    return original(path, init);
  });
  const view = render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  expect(screen.getByText(/Ảnh kiểm tra khu vực .*1 ảnh/)).toBeTruthy();
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
  expect(state.request.mock.calls.some(([path]) => path.endsWith(`/move-out/evidence/${id}`))).toBe(
    true,
  );
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview');
});

it('discards unsaved item changes on Để sau without sending a draft PATCH', async () => {
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  fireEvent.click(screen.getByRole('button', { name: 'Có vấn đề' }));
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Ghi chú chưa lưu' },
  });
  fireEvent.click(screen.getByText('Để sau'));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  expect((screen.getByLabelText('Ghi chú (không bắt buộc)') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  expect(await screen.findByText(/Hãy chọn kết quả kiểm tra/)).toBeTruthy();
  expect(state.draft?.version).toBe(0);
  expect(
    state.request.mock.calls.filter(
      ([path, init]) => path.endsWith('/move-out/inspection-draft') && init?.method === 'PATCH',
    ),
  ).toHaveLength(0);
});

it('does not show saved progress on timeout and retries the same draft idempotency key', async () => {
  const original = state.request.getMockImplementation()!;
  let saves = 0;
  state.request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/move-out/inspection-draft') && init?.method === 'PATCH' && ++saves === 1)
      throw new Error('Network timeout');
    return original(path, init);
  });
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  fireEvent.click(screen.getByRole('button', { name: 'Không áp dụng' }));
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  await screen.findByText(/Không kết nối được máy chủ/);
  expect(state.draft?.version).toBe(0);
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  await waitFor(() => expect(state.draft?.version).toBe(1));
  const requests = state.request.mock.calls.filter(
    ([path, init]) => path.endsWith('/move-out/inspection-draft') && init?.method === 'PATCH',
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]![1].headers['Idempotency-Key']).toBe(
    requests[1]![1].headers['Idempotency-Key'],
  );
});

it('reloads latest draft version after conflict and preserves local changes for retry', async () => {
  const original = state.request.getMockImplementation()!;
  let rejected = false;
  state.request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/move-out/inspection-draft') && init?.method === 'PATCH' && !rejected) {
      rejected = true;
      state.draft!.version = 2;
      throw Object.assign(new Error('Draft version changed'), { status: 409 });
    }
    return original(path, init);
  });
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  fireEvent.click(screen.getByRole('button', { name: 'Có vấn đề' }));
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Vết ẩm đã được ghi nhận' },
  });
  await captureCurrentPhoto();
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  await screen.findByText(/Phiếu đã thay đổi trên máy chủ/);
  expect((screen.getByLabelText('Ghi chú (không bắt buộc)') as HTMLInputElement).value).toBe(
    'Vết ẩm đã được ghi nhận',
  );
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  await waitFor(() => expect(state.draft?.version).toBe(3));
  const requests = state.request.mock.calls.filter(
    ([path, init]) => path.endsWith('/move-out/inspection-draft') && init?.method === 'PATCH',
  );
  expect(JSON.parse(requests[0]![1].body).version).toBe(0);
  expect(JSON.parse(requests[1]![1].body).version).toBe(2);
  expect(state.draft?.roomChecks).toMatchObject([
    { code: roomHandoverChecks[0]!.code, status: 'Issue', notes: 'Vết ẩm đã được ghi nhận' },
  ]);
});

it('keeps a started job visible but prevents inspection before the proposed move-out date', async () => {
  state.proposedDate = '2099-11-18';
  render(<StaffMoveOutInspectionScreen />);
  expect(await screen.findByText(/Bạn có thể kiểm tra từ ngày trả phòng đã duyệt/)).toBeTruthy();
  expect(screen.queryByText('4 phần kiểm tra trả phòng')).toBeNull();
  expect(
    state.request.mock.calls.some(([path]) => path.endsWith('/move-out/inspection-draft')),
  ).toBe(false);
});

it('inspects MoveOut independently without any MoveIn handover or asset baseline', async () => {
  state.noBaseline = true;
  state.noInventory = true;
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  expect(screen.queryByText(/Thiếu biên bản bàn giao đầu vào hợp lệ/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  expect(
    screen
      .getAllByRole('button')
      .filter((item) =>
        roomHandoverChecks.some(({ label }) => item.getAttribute('aria-label') === label),
      ),
  ).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  fireEvent.click(screen.getByRole('button', { name: 'Đạt' }));
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
  await saveCurrentItem();
  expect(state.draft?.roomChecks[0]).toMatchObject({
    status: 'Passed',
    evidenceIds: ['66666666-6666-4666-8666-000000000001'],
  });
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getByRole('button', { name: /3\. Kiểm kê tài sản/ }));
  expect(screen.getByText(/Không có danh sách tài sản để đối chiếu, không có nghĩa/)).toBeTruthy();
  expect(screen.getByText(/không có nghĩa là phòng không có tài sản/)).toBeTruthy();
  expect(screen.queryByText('Đã xác nhận phòng không có tài sản cần kiểm kê.')).toBeNull();
});

it('requires photo evidence but not notes for a room issue', async () => {
  const { code, label } = roomHandoverChecks[0]!;
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: 'Có vấn đề' }));
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  expect(await screen.findByText(/Chụp ít nhất một ảnh/)).toBeTruthy();
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
  await saveCurrentItem();
  expect(state.draft?.roomChecks).toMatchObject([
    {
      code,
      status: 'Issue',
      notes: null,
      evidenceIds: ['66666666-6666-4666-8666-000000000001'],
    },
  ]);
  expect(screen.getByRole('button', { name: label }).textContent).toContain('Có vấn đề · đã lưu');
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  expect(screen.getByText('1/8 đã kiểm tra')).toBeTruthy();
});

it('shows the verified handover room condition next to the current inspection without changing the draft', async () => {
  state.openingRoomCheck = {
    code: roomHandoverChecks[0]!.code,
    status: 'Issue',
    notes: 'Tường từng bị ố trước khi nhận',
    evidenceIds: [],
  };
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: roomHandoverChecks[0]!.label }));
  expect(screen.getByText('Khi bàn giao: Có vấn đề · Tường từng bị ố trước khi nhận')).toBeTruthy();
  expect(state.draft?.roomChecks).toHaveLength(0);
});

it('compares opening asset quantity with actual count, requiring matching condition and photo', async () => {
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /3\. Kiểm kê tài sản/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Giường đơn' }));
  expect(screen.getByText(/Số lượng lúc nhận: 2/)).toBeTruthy();
  expect(screen.getByLabelText('Ghi chú (không bắt buộc)')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Số lượng lúc trả'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đủ' }));
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  expect(await screen.findByText(/Tài sản Đạt phải đủ 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thiếu' }));
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  expect(await screen.findByText(/Chụp ít nhất một ảnh tài sản/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Thiếu một giường so với khi nhận' },
  });
  await captureCurrentPhoto();
  await saveCurrentItem();
  expect(state.draft?.assets[0]).toMatchObject({
    id: assetId,
    condition: 'Missing',
    checked: true,
    observedQuantity: 1,
    missingQuantity: 1,
    notes: 'Thiếu một giường so với khi nhận',
  });
  expect(screen.getByRole('button', { name: 'Giường đơn' }).textContent).toContain('Có vấn đề');
});

it('ensures Final meter tasks from started MoveOut before opening camera, and explains absent meters', async () => {
  state.ensureEmpty = true;
  const view = render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /1\. Ghi chỉ số điện nước/ }));
  await screen.findByText(/Phòng chưa có công tơ điện\/nước đang hoạt động/);
  const request = state.request.mock.calls.find(
    ([path, init]) => path.endsWith('/final-meter-tasks/ensure') && init?.method === 'POST',
  );
  expect(request?.[1]?.headers?.['Idempotency-Key']).toBeTruthy();
  expect(request?.[1]?.body).toBeUndefined();
  expect(screen.queryByText('Chụp chỉ số điện')).toBeNull();
  view.rerender(<StaffMoveOutInspectionScreen />);
  expect(
    state.request.mock.calls.filter(
      ([path, init]) => path.endsWith('/final-meter-tasks/ensure') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
});

it('does not provision duplicate Final tasks when React replays the effect in StrictMode', async () => {
  render(
    <React.StrictMode>
      <StaffMoveOutInspectionScreen />
    </React.StrictMode>,
  );
  await screen.findByText('4 phần kiểm tra trả phòng');
  fireEvent.click(screen.getByRole('button', { name: /1\. Ghi chỉ số điện nước/ }));
  await screen.findByText('Chụp chỉ số điện');
  expect(
    state.request.mock.calls.filter(
      ([path, init]) => path.endsWith('/final-meter-tasks/ensure') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
});

it('records four factual sections and submits authenticated versioned inspection for Owner review', async () => {
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  expect(screen.getByText('0/4 đã lưu')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /1\. Ghi chỉ số điện nước/ }));
  await screen.findByText('Chụp chỉ số điện');
  fireEvent.click(screen.getByText('Chụp chỉ số điện'));
  expect(screen.getByTestId('embedded-meter').textContent).toContain('Chỉ số trước');
  expect(screen.queryByText('Lưu tiến độ')).toBeNull();
  fireEvent.click(screen.getByText('Xác nhận chỉ số'));
  await waitFor(() =>
    expect(state.draft?.electricityReadingId).toBe('77777777-7777-4777-8777-777777777777'),
  );
  await screen.findByText('Xem chỉ số điện');
  fireEvent.click(screen.getByText('Chụp chỉ số nước'));
  fireEvent.click(screen.getByText('Xác nhận chỉ số'));
  await waitFor(() =>
    expect(state.draft?.waterReadingId).toBe('88888888-8888-4888-8888-888888888888'),
  );
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getByRole('button', { name: /2\. Hiện trạng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Hiện trạng chung' }));
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  expect(
    await screen.findByText(/Nhập ghi chú và chụp ít nhất một ảnh hiện trạng chung/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Phòng sạch khi trả' } });
  await captureCurrentPhoto();
  await saveCurrentItem();
  expect(screen.queryByText('Xác nhận hoàn thành')).toBeNull();
  for (const { label } of roomHandoverChecks) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: 'Đạt' }));
    await captureCurrentPhoto();
    await saveCurrentItem();
  }
  expect(state.draft?.roomChecks).toHaveLength(7);
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getByRole('button', { name: /3\. Kiểm kê tài sản/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Giường đơn' }));
  expect(screen.getByText(/Số lượng lúc nhận: 2/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Số lượng lúc trả'), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đủ' }));
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
  await saveCurrentItem();
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getByRole('button', { name: /4\. Chìa khóa/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Chìa khóa thu lại' }));
  fireEvent.change(screen.getByLabelText('Số chìa khóa lúc trả'), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByText('Lưu tiến độ'));
  expect(await screen.findByText(/Nhập số chìa khóa đã nhận và chụp ít nhất một ảnh/)).toBeTruthy();
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await screen.findByRole('img', { name: 'Ảnh minh chứng 1' });
  await saveCurrentItem();
  expect(state.draft?.keyEvidenceIds).toHaveLength(1);
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  expect(screen.getByText('4/4 đã lưu')).toBeTruthy();
  expect(screen.getByText('Xác nhận hoàn thành')).toBeTruthy();
  fireEvent.click(screen.getByText('Xác nhận hoàn thành'));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path, init]) => path.endsWith('/move-out/inspection') && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const request = state.request.mock.calls.find(([path]) => path.endsWith('/move-out/inspection'))!;
  const body = JSON.parse(request[1].body as string);
  expect(body).toMatchObject({
    expectedVersion: 3,
    inventoryToken: 'token-inventory',
    electricityReadingId: '77777777-7777-4777-8777-777777777777',
    waterReadingId: '88888888-8888-4888-8888-888888888888',
    accessItems: [{ type: 'RoomKey', quantity: 2, notes: '' }],
  });
  expect(body.roomCondition).toBe('Phòng sạch khi trả');
  expect(body.roomChecks).toHaveLength(7);
  expect(body.roomChecks.every((item: { status: string }) => item.status === 'Passed')).toBe(true);
  expect(body.assets[0]).toMatchObject({
    id: assetId,
    condition: 'Good',
    checked: true,
    observedQuantity: 2,
  });
  expect(body.assets[0].evidenceIds).toHaveLength(1);
  expect(body.keyEvidenceIds).toHaveLength(1);
  expect(body.evidenceIds).toHaveLength(1);
  expect(request[1].headers['Idempotency-Key']).toBeTruthy();
});
