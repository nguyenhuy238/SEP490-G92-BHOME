// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { roomHandoverChecks } from '../services/moveInHandover';

const contractId = '11111111-1111-4111-8111-111111111111';
const roomId = '22222222-2222-4222-8222-222222222222';
const locationId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  reload: vi.fn(),
  go: vi.fn(),
  assigned: true,
  routeId: '11111111-1111-4111-8111-111111111111',
}));
type Children = { children?: React.ReactNode };
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ contractId: state.routeId }),
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  router: { push: vi.fn() },
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: { request: state.request }, session: { roles: ['Staff'] } }),
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
  useWorkspaceQuery: () => ({
    data: state.assigned
      ? [
          {
            contractId,
            roomId,
            roomNumber: 'R.101',
            locationName: 'Cơ sở kiểm thử',
            status: 'Approved',
            scheduledAt: '2026-11-18T00:00:00Z',
          },
        ]
      : [],
    loading: false,
    error: '',
    reload: state.reload,
  }),
}));
vi.mock('react-native', () => ({ View: ({ children }: Children) => <div>{children}</div> }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: Children) => <div>{children}</div>,
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
      disabled?: boolean;
    }) => (
      <button disabled={disabled} aria-pressed={status === 'checked'} onClick={onPress}>
        {label}
      </button>
    ),
  },
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
vi.mock('../features/contracts/HandoverAssetFields', () => ({
  HandoverAssetFields: ({
    asset,
    set,
  }: {
    asset: { id: string; name: string };
    set: (name: string, value: string) => void;
  }) => (
    <button
      onClick={() => {
        set(`asset-${asset.id}`, 'Tốt');
        set(`${asset.id}.observedQuantity`, '2');
        set(`${asset.id}.handedOverQuantity`, '2');
        set(`${asset.id}.goodQuantity`, '2');
        set(`${asset.id}.wornQuantity`, '0');
        set(`${asset.id}.damagedQuantity`, '0');
        set(`${asset.id}.checked`, 'true');
      }}
    >
      Đã kiểm kê {asset.name}
    </button>
  ),
}));
vi.mock('../lib/toast', () => ({ showSuccess: vi.fn() }));
import { StaffMoveOutInspectionScreen } from '../screens/StaffMoveOutInspectionScreen';

beforeEach(() => {
  state.request.mockReset();
  state.reload.mockReset();
  state.go.mockReset();
  state.assigned = true;
  state.routeId = contractId;
  let image = 0;
  state.request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/move-out/evidence') && init?.method === 'POST') {
      image++;
      return { id: `66666666-6666-4666-8666-${String(image).padStart(12, '0')}` };
    }
    if (path.endsWith('/move-out/inspection') && init?.method === 'POST')
      return { status: 'Inspected' };
    if (path.endsWith('/move-out/inspection-preparation'))
      return {
        baseline: {
          version: 1,
          snapshot: {
            roomCondition: 'Tường nguyên vẹn',
            keysAndAccess: '2 chìa khóa',
            accessItems: [{ type: 'RoomKey', quantity: 2, notes: '' }],
            assets: [],
            roomChecks: [],
          },
        },
        legacyExceptionRequired: false,
        finalReadings: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            utilityType: 0,
            meterCode: 'E1',
            value: '100',
            date: '2026-11-18',
          },
          {
            id: '88888888-8888-4888-8888-888888888888',
            utilityType: 1,
            meterCode: 'W1',
            value: '50',
            date: '2026-11-18',
          },
        ],
        inventory: { stateToken: 'token-inventory', groups: [], noAssetsConfirmed: false },
        inspectionGroups: [
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
        proposedDate: '2026-11-18',
        inspectionScheduledAt: '2026-11-18T00:00:00Z',
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
  });
});
afterEach(cleanup);

it('refuses opening a contract that is no longer a Staff assignment', () => {
  state.assigned = false;
  render(<StaffMoveOutInspectionScreen />);
  expect(screen.getByText(/không nằm trong danh sách Staff được giao/)).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});

it('records four factual sections and submits authenticated versioned inspection for Owner review', async () => {
  render(<StaffMoveOutInspectionScreen />);
  await screen.findByText('4 phần kiểm tra trả phòng');
  expect(screen.getByText('0/4 đã điền')).toBeTruthy();
  fireEvent.click(screen.getAllByText('Mở mục kiểm tra')[0]!);
  fireEvent.change(screen.getByLabelText('Chỉ số điện chốt'), {
    target: { value: '77777777-7777-4777-8777-777777777777' },
  });
  fireEvent.change(screen.getByLabelText('Chỉ số nước chốt'), {
    target: { value: '88888888-8888-4888-8888-888888888888' },
  });
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getAllByText('Mở mục kiểm tra')[1]!);
  fireEvent.change(screen.getByLabelText('Hiện trạng tổng quan khi trả'), {
    target: { value: 'Phòng nguyên vẹn, kiểm tra đủ bảy mục' },
  });
  for (const { label } of roomHandoverChecks) {
    fireEvent.change(screen.getByLabelText(`Kết quả · ${label}`), { target: { value: 'Passed' } });
  }
  fireEvent.change(screen.getByLabelText('Tóm tắt kiểm tra'), {
    target: { value: 'Đã kiểm tra trực tiếp tất cả hạng mục' },
  });
  fireEvent.click(screen.getByText('Chụp ảnh'));
  await waitFor(() => expect(screen.getByText(/Ảnh toàn cảnh phòng .*1 ảnh đã tải/)).toBeTruthy());
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getAllByText('Mở mục kiểm tra')[2]!);
  fireEvent.click(screen.getByText('Đã kiểm kê Giường đơn'));
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  fireEvent.click(screen.getAllByText('Mở mục kiểm tra')[3]!);
  fireEvent.change(screen.getByLabelText('Số chìa khóa phòng thực tế đã nhận lại'), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByText('Về 4 mục trả phòng'));
  expect(screen.getByText('4/4 đã điền')).toBeTruthy();
  fireEvent.click(screen.getByText('Tôi đã đối chiếu thực tế đủ 4 phần và các ảnh đúng hạng mục'));
  fireEvent.click(screen.getByText('Gửi biên bản kiểm tra trả phòng cho Owner'));
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
    roomCondition: 'Phòng nguyên vẹn, kiểm tra đủ bảy mục',
    electricityReadingId: '77777777-7777-4777-8777-777777777777',
    waterReadingId: '88888888-8888-4888-8888-888888888888',
    accessItems: [{ type: 'RoomKey', quantity: 2, notes: '' }],
  });
  expect(body.roomChecks).toHaveLength(7);
  expect(body.roomChecks.every((item: { status: string }) => item.status === 'Passed')).toBe(true);
  expect(body.assets[0]).toMatchObject({
    id: assetId,
    condition: 'Tốt',
    checked: true,
    observedQuantity: 2,
    goodQuantity: 2,
  });
  expect(body.evidenceIds).toHaveLength(1);
  expect(request[1].headers['Idempotency-Key']).toBeTruthy();
});
