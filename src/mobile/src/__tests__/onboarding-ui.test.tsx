// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const state = vi.hoisted(() => ({
  json: vi.fn(),
  request: vi.fn(),
  image: vi.fn(),
  protect: vi.fn(),
  platform: 'android',
  go: vi.fn(),
  replace: vi.fn(),
  resetScroll: vi.fn(),
  unregisterExitGuard: vi.fn(),
  registerExitGuard: vi.fn(),
  requestNavigation: vi.fn(),
  disablePrevention: vi.fn(),
  preventRemove: vi.fn(),
  listeners: [] as ((value: string) => void)[],
  failConfirm: false,
  multipleLocations: false,
  serial: 0,
  uuidSerial: 0,
}));
vi.mock('../features/contracts/MainDraftScreen', () => ({
  MainDraftScreen: (props: {
    visible: boolean;
    roomId: string;
    residentIds: string[];
    onPrevious: () => void;
    onReleased: (id: string) => void;
    onList: () => void;
  }) =>
    props.visible ? (
      <div role="dialog" aria-label="Contract preparation">
        <span>
          Room: {props.roomId}; Residents: {props.residentIds.join(',')}
        </span>
        <button onClick={props.onPrevious}>Previous identity step</button>
        <button onClick={() => props.onReleased('released-contract')}>Web released contract</button>
        <button onClick={props.onList}>Contract list</button>
      </div>
    ) : null,
}));
vi.mock('expo-router', () => ({
  router: { replace: state.replace },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => () => void) => useEffect(cb, [cb]),
  usePreventRemove: (dirty: boolean) => {
    state.preventRemove(dirty);
    return state.disablePrevention;
  },
}));
vi.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++state.uuidSerial).padStart(12, '0')}`,
}));
vi.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: state.protect,
  enableAppSwitcherProtectionAsync: vi.fn(),
  disableAppSwitcherProtectionAsync: vi.fn(),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ ...state, role: 'Staff', preview: false }),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: { json: state.json, image: state.image, request: state.request },
    session: { roles: ['Staff'] },
  }),
}));
vi.mock('react-native', () => ({
  Modal: ({
    children,
    onRequestClose,
    animationType,
  }: {
    children: React.ReactNode;
    onRequestClose: () => void;
    animationType: string;
  }) => (
    <div role="dialog" data-animation={animationType}>
      <button onClick={onRequestClose}>Android Back</button>
      {children}
    </div>
  ),
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  AppState: {
    addEventListener: (_event: string, listener: (value: string) => void) => {
      state.listeners.push(listener);
      return { remove: () => {} };
    },
  },
  StyleSheet: { create: (value: unknown) => value },
  View: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties | React.CSSProperties[];
  }) => (
    <div style={Object.assign({}, ...(Array.isArray(style) ? style : [style]))}>{children}</div>
  ),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-paper-dates', () => ({
  registerTranslation: vi.fn(),
  DatePickerModal: ({
    onConfirm,
    onDismiss,
  }: {
    onConfirm: (params: { date: Date }) => void;
    onDismiss: () => void;
  }) => (
    <div role="dialog" aria-label="Lịch chọn ngày">
      <button onClick={() => onConfirm({ date: new Date(2000, 0, 1) })}>Chọn ngày mẫu</button>
      <button onClick={onDismiss}>Đóng lịch</button>
    </div>
  ),
}));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Text: ({
    children,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    accessibilityRole?: React.AriaRole;
  }) => <span role={accessibilityRole}>{children}</span>,
  Icon: () => null,
  ActivityIndicator: () => <span>Đang tải</span>,
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { checked?: boolean };
  }) => (
    <button
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-checked={accessibilityState?.checked}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  ProgressBar: () => null,
  IconButton: ({
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel: string;
  }) => <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress} />,
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    label,
    disabled,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    accessibilityLabel?: string;
    label: string;
    disabled?: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel ?? label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  HelperText: ({ children }: { children: React.ReactNode }) => <span role="alert">{children}</span>,
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
      <button
        role="checkbox"
        aria-label={label}
        aria-checked={status === 'checked'}
        onClick={onPress}
        disabled={disabled}
      >
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <>
      <h2>{title}</h2>
      <span>{detail}</span>
    </>
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
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" />
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({
    label,
    onCapture,
    disabled,
    presentation,
    onManual,
    documentSide,
  }: {
    label: string;
    onCapture: (b: Uint8Array<ArrayBuffer>) => Promise<void>;
    disabled: boolean;
    presentation?: string;
    onManual?: () => void;
    documentSide?: string;
  }) => (
    <>
      <button disabled={disabled} onClick={() => void onCapture(new Uint8Array([1, 2]))}>
        {presentation === 'document'
          ? documentSide === 'back'
            ? 'Chụp ảnh mặt sau'
            : 'Chụp ảnh mặt trước'
          : label}
      </button>
      {onManual && <button onClick={onManual}>Nhập thủ công</button>}
    </>
  ),
}));
vi.mock('../features/onboarding/useCaptureScope', () => ({
  useCaptureScope: ({ autoSelectAssignedLocation = false } = {}) => {
    const [location, setLocation] = useState(autoSelectAssignedLocation ? 'location' : ''),
      [room, setRoom] = useState('');
    return {
      location,
      room,
      locations: [
        { id: 'location', label: 'Cơ sở mẫu' },
        ...(state.multipleLocations ? [{ id: 'other-location', label: 'Cơ sở thứ hai' }] : []),
      ],
      rooms: location
        ? [
            { id: 'room', label: '101', status: 'Available', capacity: 2 },
            {
              id: 'occupied',
              label: '102',
              status: 'Occupied',
              capacity: 2,
              remainingCapacity: 1,
              currentTenantLabels: ['Người thuê mẫu'],
            },
            { id: 'full', label: '105', status: 'Occupied', capacity: 2, remainingCapacity: 0 },
            { id: 'held', label: '103', status: 'OnHold', capacity: 2 },
            {
              id: 'waiting',
              label: '106',
              status: 'Occupied',
              capacity: 2,
              remainingCapacity: 1,
              waitingForOwnerSignature: true,
            },
            { id: 'unavailable', label: '104', status: 'Unavailable' },
          ]
        : [],
      loading: false,
      error: '',
      selectLocation: (id: string) => {
        setLocation(id);
        setRoom('');
      },
      setRoom,
      reload: vi.fn(),
    };
  },
}));
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { MobileApiError } from '../lib/api';
import { ContractProgress, signerState } from '../features/contracts/ContractProgress';
import type { ContractView, Signature } from '../../../../packages/client-core/src/contracts';
it('blocks a full room immediately at selection while allowing another room', () => {
  render(<OnboardingScreen />);
  const room = screen.getByRole('combobox', { name: 'Phòng *' });
  expect(screen.queryByRole('option', { name: /106/ })).toBeNull();
  fireEvent.change(room, { target: { value: 'full' } });
  expect(screen.getByRole('alert').textContent).toContain('Phòng đã đủ người');
  expect(screen.getByRole('button', { name: 'Tiếp tục' })).toHaveProperty('disabled', true);
  fireEvent.change(room, { target: { value: 'occupied' } });
  expect(screen.getByText('Người đang thuê: Người thuê mẫu')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Tiếp tục' })).toHaveProperty('disabled', false);
});
it('shows empty and occupied rooms together without a reception-type selector', () => {
  render(<OnboardingScreen />);
  expect(screen.queryByRole('combobox', { name: 'Nhu cầu tiếp nhận' })).toBeNull();
  const room = screen.getByRole('combobox', { name: 'Phòng *' });
  expect(within(room).getByRole('option', { name: '101' })).toBeTruthy();
  expect(within(room).getByRole('option', { name: /^102/ })).toBeTruthy();
  expect(within(room).queryByRole('option', { name: '103' })).toBeTruthy();
  expect(within(room).queryByRole('option', { name: '104' })).toBeNull();
  fireEvent.change(room, { target: { value: 'occupied' } });
  expect((screen.getByRole('button', { name: 'Tiếp tục' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(screen.getByText('CCCD của người ở')).toBeTruthy();
});
beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  vi.clearAllMocks();
  state.registerExitGuard.mockReturnValue(state.unregisterExitGuard);
  state.listeners = [];
  state.failConfirm = false;
  state.multipleLocations = false;
  state.serial = 0;
  state.uuidSerial = 0;
  state.platform = 'android';
  state.request.mockResolvedValue([]);
  state.image.mockRejectedValue(new Error('OCR tạm thời không khả dụng'));
  state.json.mockImplementation(async (path: string) => {
    if (path.endsWith('/confirm')) {
      if (state.failConfirm) throw new Error('Lưu hồ sơ thất bại');
      return { id: path.split('/').at(-2), verificationStatus: 1 };
    }
    return { id: `resident-${++state.serial}` };
  });
});
afterEach(cleanup);
function selectRoom() {
  const location = screen.queryByRole('combobox', { name: 'Cơ sở được phân công *' });
  if (location) fireEvent.change(location, { target: { value: 'location' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Phòng *' }), {
    target: { value: 'room' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
}
it('allows switching assigned locations without an exit guard while choosing a room', () => {
  state.multipleLocations = true;
  render(<OnboardingScreen />);
  const location = screen.getByRole('combobox', { name: 'Cơ sở được phân công *' });
  expect(state.registerExitGuard).not.toHaveBeenCalled();
  fireEvent.change(location, { target: { value: 'other-location' } });
  expect((location as HTMLSelectElement).value).toBe('other-location');
  expect(state.registerExitGuard).not.toHaveBeenCalled();
  expect(state.preventRemove).not.toHaveBeenCalledWith(true);
});

it('guards navigation only after CCCD data is entered and releases the guard after saving', async () => {
  render(<OnboardingScreen />);
  selectRoom();
  await openIdentity();
  expect(state.preventRemove).toHaveBeenLastCalledWith(false);
  manualIdentity();
  expect(state.preventRemove).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await screen.findByText('Đã xác nhận 1/1 người ở');
  expect(state.preventRemove).toHaveBeenLastCalledWith(false);
});

it('removes the exit guard when the CCCD editor is closed even if its draft stays in memory', async () => {
  render(<OnboardingScreen />);
  selectRoom();
  await openIdentity();
  manualIdentity();
  expect(state.registerExitGuard).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng xác minh CCCD' }));
  expect(state.preventRemove).toHaveBeenLastCalledWith(false);
  expect(state.unregisterExitGuard).toHaveBeenCalledOnce();
});
it('offers room selection without a test-data generator in development', () => {
  render(<OnboardingScreen />);
  expect(screen.queryByText('Tạo nhanh dữ liệu kiểm thử')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sinh hợp đồng mẫu' })).toBeNull();

  selectRoom();

  expect(screen.getByRole('button', { name: 'Bắt đầu quét CCCD' })).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});

function addFamilyMember() {
  fireEvent.click(screen.getByRole('radio', { name: 'Hộ gia đình' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm người ở' }));
}
function openMemberEditor() {
  const actions = screen.getAllByRole('button', { name: 'Nhập thủ công' });
  fireEvent.click(actions[actions.length - 1]);
}
it('limits a family to the database room capacity and allows adding again after removing a draft member', () => {
  render(<OnboardingScreen />);
  selectRoom();
  addFamilyMember();
  expect(screen.getByText('2/2 người')).toBeTruthy();
  const add = screen.getByRole('button', { name: 'Thêm người ở' });
  expect(add).toHaveProperty('disabled', true);
  fireEvent.click(add);
  expect(screen.getAllByRole('button', { name: 'Bắt đầu quét CCCD' })).toHaveLength(2);
  expect(screen.queryByRole('textbox', { name: 'CCCD (nếu có)' })).toBeNull();
  openMemberEditor();
  expect(screen.getByRole('textbox', { name: 'Họ tên thành viên' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'CCCD (nếu có)' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn thông tin' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xóa Người ở 2' }));
  expect(screen.getByRole('button', { name: 'Thêm người ở' })).toHaveProperty('disabled', false);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm người ở' }));
  expect(screen.getByText('2/2 người')).toBeTruthy();
  expect(screen.getAllByText('Người ở 2')).toHaveLength(2);
  expect(screen.queryByRole('textbox', { name: 'Họ tên thành viên' })).toBeNull();
  expect(state.json).not.toHaveBeenCalled();
});
it('limits new occupants to the remaining place when a two-person room already has one occupant', () => {
  render(<OnboardingScreen />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Phòng *' }), {
    target: { value: 'occupied' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Hộ gia đình' }));
  expect(screen.getByText('1/1 người')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thêm người ở' })).toHaveProperty('disabled', true);
  expect(screen.getAllByRole('button', { name: 'Bắt đầu quét CCCD' })).toHaveLength(1);
});
it.each(['Nhập thủ công', 'Bắt đầu quét CCCD'] as const)(
  'creates an identity through %s without collecting email or reserving an account',
  async (entry) => {
    render(<OnboardingScreen />);
    selectRoom();

    expect(screen.queryByLabelText('Email người ở')).toBeNull();
    expect(state.json).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: entry }));
    await screen.findByRole('dialog');
    expect(state.json).toHaveBeenCalledOnce();
    expect(state.json.mock.calls[0][1]).toMatchObject({
      roomId: 'room',
      displayLabel: 'Người ở 1',
    });
    expect(state.json.mock.calls[0][1]).not.toHaveProperty('email');
    expect(state.request.mock.calls.some(([path]) => path.includes('/residents'))).toBe(false);
  },
);
it('opens manual identity on Web without mounting the unsupported native screen-capture hook', async () => {
  state.platform = 'web';
  render(<OnboardingScreen />);
  selectRoom();

  fireEvent.click(screen.getByRole('button', { name: 'Nhập thủ công' }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('textbox', { name: 'Số CCCD (12 chữ số)' })).toBeTruthy();
  expect(screen.getByRole('dialog').getAttribute('data-animation')).toBe('fade');
  cleanup();
  expect(state.protect).not.toHaveBeenCalled();
});
it('keeps native screen-capture protection on Android', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  expect(state.protect).toHaveBeenCalledWith('identity-wizard-resident-1');
  expect(screen.getByRole('dialog').getAttribute('data-animation')).toBe('slide');
});
async function openIdentity(index = 0) {
  if (screen.queryByRole('dialog')) closeIdentity();
  fireEvent.click(
    screen.getAllByRole('button', {
      name: /^(Bắt đầu quét CCCD|Tiếp tục quét|Kiểm tra thông tin|Xem thông tin)$/,
    })[index],
  );
  await screen.findByRole('dialog');
}
function closeIdentity() {
  fireEvent.click(screen.getByRole('button', { name: 'Đóng xác minh CCCD' }));
}
function manualIdentity() {
  const openForm = within(screen.getByRole('dialog')).queryByRole('button', {
    name: 'Nhập thủ công',
  });
  if (openForm) fireEvent.click(openForm);
  for (const [label, value] of [
    ['Số CCCD (12 chữ số)', '000000000001'],
    ['Họ và tên', 'NGƯỜI Ở MẪU'],
    ['Ngày sinh (dd/MM/yyyy)', '01/01/2000'],
  ]) {
    fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
  }
}
it('opens a calendar for each CCCD date and applies selections without confirming the identity', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  manualIdentity();
  for (const label of [
    'Ngày sinh (dd/MM/yyyy)',
    'Ngày cấp (dd/MM/yyyy)',
    'Ngày hết hạn (dd/MM/yyyy)',
  ]) {
    fireEvent.click(screen.getByRole('button', { name: `Chọn ${label}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày mẫu' }));
    expect((screen.getByRole('textbox', { name: label }) as HTMLInputElement).value).toBe(
      '01/01/2000',
    );
  }
  expect(state.json.mock.calls.some(([path]) => String(path).endsWith('/confirm'))).toBe(false);
});
it('opens CCCD directly with Individual selected and forbids a second person', () => {
  render(<OnboardingScreen />);
  selectRoom();
  expect(screen.queryByLabelText('Tên gọi hồ sơ')).toBeNull();
  expect(screen.getByRole('radio', { name: 'Cá nhân' }).getAttribute('aria-checked')).toBe('true');
  const add = screen.getByRole('button', { name: 'Thêm người ở' }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.click(add);
  expect(screen.getAllByRole('button', { name: 'Bắt đầu quét CCCD' })).toHaveLength(1);
  expect(state.json).not.toHaveBeenCalled();
});
it('retains a family selection through Back and keeps draft members separate', () => {
  render(<OnboardingScreen />);
  selectRoom();
  addFamilyMember();
  expect(screen.getAllByRole('button', { name: 'Bắt đầu quét CCCD' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect((screen.getByRole('combobox', { name: 'Phòng *' }) as HTMLSelectElement).value).toBe(
    'room',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(screen.getAllByRole('button', { name: 'Bắt đầu quét CCCD' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Chọn Người ở 2 làm đại diện' }));
  expect(screen.queryByRole('button', { name: 'Chọn Người ở 2 làm đại diện' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa Người ở 2' }));
  expect(screen.getAllByRole('button', { name: 'Bắt đầu quét CCCD' })).toHaveLength(1);
  expect(state.json).not.toHaveBeenCalled();
});
it('creates only the representative identity and keeps family members editable without requiring CCCD', async () => {
  render(<OnboardingScreen />);
  selectRoom();
  addFamilyMember();
  await openIdentity();
  closeIdentity();
  expect(state.json.mock.calls[0][1]).toMatchObject({ residentType: 0, displayLabel: 'Người ở 1' });
  expect(state.json).toHaveBeenCalledTimes(1);
  openMemberEditor();
  expect(screen.getByRole('textbox', { name: 'Họ tên thành viên' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xóa Người ở 2' })).toHaveProperty('disabled', false);
  expect((screen.getByRole('radio', { name: 'Cá nhân' }) as HTMLButtonElement).disabled).toBe(true);
});
it('allows manual confirmation after OCR failure and completes only after the server accepts it', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  await screen.findByText('OCR chưa thành công; nhập thủ công vẫn khả dụng.');
  expect(state.image.mock.calls[0][0]).toBe('/api/v1/ocr/identity/resident-1/front');
  manualIdentity();
  expect(
    (screen.getByRole('button', { name: 'Xác nhận thông tin' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  state.failConfirm = true;
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await within(screen.getByRole('dialog')).findByText(
    'Không thể hoàn thành. Kiểm tra kết nối và địa chỉ HTTPS.',
  );
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  state.failConfirm = false;
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await screen.findByText('Đã xác nhận 1/1 người ở');
  expect(screen.queryByRole('button', { name: 'Hoàn tất tiếp nhận' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }));
  expect(screen.getByRole('dialog', { name: 'Contract preparation' })).toBeTruthy();
  expect(screen.getByText('Room: room; Residents: resident-1')).toBeTruthy();
  expect(state.go).not.toHaveBeenCalledWith('prepare-contract', expect.anything());
  fireEvent.click(screen.getByText('Previous identity step'));
  expect(screen.queryByRole('dialog', { name: 'Contract preparation' })).toBeNull();
  expect(screen.getByText('Đã xác nhận 1/1 người ở')).toBeTruthy();
});
it('does not blindly create another Resident after a timeout with an unknown save result', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  state.json.mockRejectedValueOnce(new MobileApiError(0, 'request_timeout'));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu quét CCCD' }));
  await screen.findByRole('button', { name: 'Kiểm tra danh sách người ở' });
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu quét CCCD' }));
  expect(state.json).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['Web released contract', 'Contract list'])(
  'keeps Staff on authorized contract routes after %s',
  async (action) => {
    render(<OnboardingScreen />);
    selectRoom();

    await openIdentity();
    manualIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
    await screen.findByText('Đã xác nhận 1/1 người ở');
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }));
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(state.replace).toHaveBeenCalledWith({
      pathname: '/workspace/[screen]',
      params: {
        screen: 'signing',
        contractId: action === 'Web released contract' ? 'released-contract' : '',
      },
    });
    expect(state.disablePrevention).toHaveBeenCalled();
    expect(state.go.mock.calls.some(([destination]) => destination === 'contract')).toBe(false);
  },
);
async function submitAlreadyConfirmed() {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  manualIdentity();
  state.json.mockRejectedValueOnce(new MobileApiError(409, 'identity_already_confirmed'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await screen.findByRole('button', { name: 'Dùng hồ sơ đã xác nhận' });
}
it('recovers identity_already_confirmed only after explicit use of the same server-verified resident', async () => {
  await submitAlreadyConfirmed();
  expect(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Xác nhận thông tin' })).toHaveProperty(
    'disabled',
    true,
  );
  state.request.mockResolvedValueOnce([
    { id: 'resident-1', roomId: 'room', verificationStatus: 1 },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Dùng hồ sơ đã xác nhận' }));
  await screen.findByText('Đã xác nhận 1/1 người ở');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.json).toHaveBeenCalledTimes(2); // Create + rejected confirm, no overwrite/replay.
  act(() => state.listeners.forEach((listener) => listener('background')));
  expect(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' })).toHaveProperty(
    'disabled',
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }));
  expect(screen.getByRole('dialog', { name: 'Contract preparation' })).toBeTruthy();
  expect(screen.getByText('Room: room; Residents: resident-1')).toBeTruthy();
  expect(state.go).not.toHaveBeenCalledWith('prepare-contract', expect.anything());
  fireEvent.click(screen.getByText('Previous identity step'));
  expect(screen.queryByRole('dialog', { name: 'Contract preparation' })).toBeNull();
  expect(screen.getByText('Đã xác nhận 1/1 người ở')).toBeTruthy();
});
it.each(['wrong-id', 'wrong-room', 'pending', 'rejected', 'forbidden'])(
  'keeps identity recovery blocked when the scoped lookup is unsuitable (%s)',
  async (scenario) => {
    await submitAlreadyConfirmed();
    if (scenario === 'forbidden') state.request.mockRejectedValueOnce(new MobileApiError(403));
    else
      state.request.mockResolvedValueOnce([
        {
          id: scenario === 'wrong-id' ? 'other' : 'resident-1',
          roomId: scenario === 'wrong-room' ? 'other' : 'room',
          verificationStatus: scenario === 'pending' ? 0 : scenario === 'rejected' ? 2 : 1,
        },
      ]);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng hồ sơ đã xác nhận' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dùng hồ sơ đã xác nhận' })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    expect(screen.getByText('Đã xác nhận 0/1 người ở')).toBeTruthy();
    expect(state.go).not.toHaveBeenCalled();
    expect(state.json).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' })).toHaveProperty(
      'disabled',
      true,
    );
  },
);
it('keeps a rejected confirmation error visible after closing the form and can read back a committed save', async () => {
  await submitAlreadyConfirmed();
  closeIdentity();
  expect(screen.getByRole('alert').textContent).toContain('Dữ liệu vừa nhập không được ghi đè');
  state.request.mockResolvedValueOnce([
    { id: 'resident-1', roomId: 'room', verificationStatus: 1 },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái đã lưu' }));
  await screen.findByText('Đã xác nhận 1/1 người ở');
  act(() => state.listeners.forEach((listener) => listener('background')));
  expect(screen.getByText('Đã xác nhận 1/1 người ở')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(state.json).toHaveBeenCalledTimes(2);
});
it('recovers a committed confirmation after the app backgrounds before its response arrives', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  manualIdentity();
  let complete!: (result: unknown) => void;
  state.json.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  act(() => state.listeners.forEach((listener) => listener('background')));
  await act(async () => complete({ id: 'resident-1', verificationStatus: 1 }));
  expect(screen.getByText('Đã xác nhận 0/1 người ở')).toBeTruthy();
  state.request.mockResolvedValueOnce([
    { id: 'resident-1', roomId: 'room', verificationStatus: 1 },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái đã lưu' }));
  await screen.findByText('Đã xác nhận 1/1 người ở');
  expect(state.json).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' })).toHaveProperty(
    'disabled',
    false,
  );
});
it.each(['pending', 'wrong-id', 'wrong-room', 'forbidden'])(
  'does not recover an unverified or inaccessible saved status (%s)',
  async (scenario) => {
    render(<OnboardingScreen />);
    selectRoom();

    await openIdentity();
    closeIdentity();
    if (scenario === 'forbidden') state.request.mockRejectedValueOnce(new MobileApiError(403));
    else
      state.request.mockResolvedValueOnce([
        {
          id: scenario === 'wrong-id' ? 'other' : 'resident-1',
          roomId: scenario === 'wrong-room' ? 'other' : 'room',
          verificationStatus: scenario === 'pending' ? 0 : 1,
        },
      ]);
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái đã lưu' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Đã xác nhận 0/1 người ở')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(state.json).toHaveBeenCalledOnce();
  },
);
it('retains unconfirmed identity edits across steps and keeps each person separate', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  addFamilyMember();

  await openIdentity();
  manualIdentity();
  closeIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  await openIdentity();
  expect((screen.getByRole('textbox', { name: 'Họ và tên' }) as HTMLInputElement).value).toBe(
    'NGƯỜI Ở MẪU',
  );
  closeIdentity();
  openMemberEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ tên thành viên' }), {
    target: { value: 'THÀNH VIÊN KIỂM THỬ' },
  });
  expect(state.json).toHaveBeenCalledTimes(1);
});
it('keeps OCR suggestions and Staff edits in memory without confirming them when backgrounded', async () => {
  state.image.mockResolvedValue({
    proposedFields: {
      citizenIdentityNumber: '000000000001',
      fullName: 'NGƯỜI Ở MẪU',
      dateOfBirth: '2000-01-01',
    },
    warnings: ['blur_or_low_detail'],
    missingFields: [],
    confidence: {},
    isFallback: false,
  });
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chụp ảnh mặt sau' }));
  await screen.findByText(/Ảnh mờ hoặc thiếu chi tiết/);
  expect(screen.getByText('Chờ bạn kiểm tra và xác nhận')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Họ và tên' }) as HTMLInputElement).value).toBe(
    'NGƯỜI Ở MẪU',
  );
  expect(state.json).toHaveBeenCalledTimes(1); // Creating the draft does not confirm OCR fields.
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ và tên' }), {
    target: { value: 'TÊN ĐÃ SỬA' },
  });
  act(() => {
    state.listeners.forEach((listener) => listener('background'));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  await openIdentity();
  expect((screen.getByRole('textbox', { name: 'Họ và tên' }) as HTMLInputElement).value).toBe(
    'TÊN ĐÃ SỬA',
  );
  expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  expect(state.json).toHaveBeenCalledTimes(1);
});
it('scans both existing endpoints and uses the back-side issue date in confirmation', async () => {
  state.image.mockResolvedValue({
    proposedFields: {
      citizenIdentityNumber: '000000000001',
      fullName: 'NGƯỜI Ở MẪU',
      dateOfBirth: '2000-01-01',
    },
    warnings: [],
    missingFields: [],
    confidence: {},
    isFallback: false,
  });
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  await screen.findByRole('button', { name: 'Chụp ảnh mặt sau' });
  expect(screen.queryByRole('textbox', { name: 'Họ và tên' })).toBeNull();
  state.image.mockResolvedValueOnce({
    proposedFields: { dateOfIssue: '2021-06-15' },
    warnings: [],
    missingFields: [],
    confidence: {},
    isFallback: false,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt sau' }));
  await screen.findByRole('textbox', { name: 'Họ và tên' });
  expect(screen.queryByRole('button', { name: 'Nhập thủ công / Kiểm tra thông tin' })).toBeNull();
  expect((screen.getByRole('textbox', { name: 'Họ và tên' }) as HTMLInputElement).value).toBe(
    'NGƯỜI Ở MẪU',
  );
  expect(
    (screen.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' }) as HTMLInputElement).value,
  ).toBe('15/06/2021');
  fireEvent.change(screen.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' }), {
    target: { value: '16/06/2021' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await screen.findByText('Đã xác nhận 1/1 người ở');
  expect(state.image).toHaveBeenCalledTimes(2);
  expect(state.image.mock.calls[0][0]).toBe('/api/v1/ocr/identity/resident-1/front');
  expect(state.image.mock.calls[1][0]).toBe('/api/v1/ocr/identity/resident-1/back');
  expect(state.json.mock.calls.at(-1)?.[1]).toMatchObject({
    dateOfIssue: '2021-06-16',
    dateOfBirth: '2000-01-01',
  });
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('retries the back side independently and preserves Staff edits and front fields', async () => {
  const proposal = (proposedFields: Record<string, string>) => ({
    proposedFields,
    warnings: [],
    missingFields: [],
    confidence: {},
    isFallback: false,
  });
  state.image
    .mockResolvedValueOnce(
      proposal({
        citizenIdentityNumber: '000000000001',
        fullName: 'NGƯỜI MẪU',
        dateOfBirth: '2000-01-01',
      }),
    )
    .mockResolvedValueOnce(proposal({ dateOfIssue: '2020-02-03' }))
    .mockResolvedValueOnce(proposal({ dateOfIssue: '2021-04-05' }))
    .mockResolvedValueOnce({ ...proposal({}), isFallback: true })
    .mockResolvedValueOnce(proposal({ dateOfIssue: '2022-06-07' }));
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chụp ảnh mặt sau' }));
  await screen.findByRole('textbox', { name: 'Họ và tên' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ và tên' }), {
    target: { value: 'STAFF ĐÃ SỬA' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại mặt sau' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt sau' }));
  await screen.findByRole('textbox', { name: 'Họ và tên' });
  expect((screen.getByRole('textbox', { name: 'Họ và tên' }) as HTMLInputElement).value).toBe(
    'STAFF ĐÃ SỬA',
  );
  expect(
    (screen.getByRole('textbox', { name: 'Ngày sinh (dd/MM/yyyy)' }) as HTMLInputElement).value,
  ).toBe('01/01/2000');
  expect(
    (screen.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' }) as HTMLInputElement).value,
  ).toBe('05/04/2021');
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại mặt sau' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt sau' }));
  expect(await screen.findByDisplayValue('05/04/2021')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' }), {
    target: { value: '06/04/2021' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại mặt sau' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt sau' }));
  await screen.findByRole('textbox', { name: 'Họ và tên' });
  expect(
    (screen.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' }) as HTMLInputElement).value,
  ).toBe('06/04/2021');
  expect(state.image.mock.calls.map((call) => call[0].split('/').at(-1))).toEqual([
    'front',
    'back',
    'back',
    'back',
    'back',
  ]);
});
it('resumes the back camera after closing and leaves a missing issue date empty on fallback', async () => {
  state.image
    .mockResolvedValueOnce({
      proposedFields: { fullName: 'NGƯỜI MẪU' },
      warnings: [],
      missingFields: [],
      confidence: {},
      isFallback: false,
    })
    .mockResolvedValueOnce({
      proposedFields: {},
      warnings: [],
      missingFields: [],
      confidence: {},
      isFallback: true,
    });
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  await screen.findByRole('button', { name: 'Chụp ảnh mặt sau' });
  closeIdentity();
  expect(screen.getByRole('button', { name: 'Tiếp tục quét' })).toBeTruthy();
  expect(screen.getAllByText('Đã nhận diện')).toHaveLength(1);
  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt sau' }));
  await screen.findByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' });
  expect(
    (screen.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)' }) as HTMLInputElement).value,
  ).toBe('');
  expect(screen.getByText('Chưa đọc được Ngày cấp. Vui lòng nhập theo giấy tờ.')).toBeTruthy();
  closeIdentity();
  expect(screen.getAllByText('Đã nhận diện')).toHaveLength(1);
  expect(screen.getByText('Đã chụp')).toBeTruthy();
});
it('does not mark a person confirmed when the response lacks a verified status', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  manualIdentity();
  state.json.mockResolvedValueOnce({ id: 'resident-1', verificationStatus: 0 });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await within(screen.getByRole('dialog')).findByText(
    'Không thể hoàn thành. Kiểm tra kết nối và địa chỉ HTTPS.',
  );
  expect(screen.getByText('Đã xác nhận 0/1 người ở')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('requires verified representative identity and member details before review', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  addFamilyMember();

  await openIdentity();
  manualIdentity();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await screen.findByText('Đã xác nhận 1/2 người ở');
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  openMemberEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ tên thành viên' }), {
    target: { value: 'THÀNH VIÊN KIỂM THỬ' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Ngày sinh thành viên (dd/MM/yyyy)' }), {
    target: { value: '01/01/2015' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Quan hệ với người đại diện' }), {
    target: { value: 'Con' },
  });
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('persists a household before common step 3, retries safely and retains editable members on Back', async () => {
  render(<OnboardingScreen />);
  selectRoom();
  addFamilyMember();
  await openIdentity();
  manualIdentity();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  await screen.findByText('Đã xác nhận 1/2 người ở');
  openMemberEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ tên thành viên' }), {
    target: { value: 'THÀNH VIÊN KIỂM THỬ' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Ngày sinh thành viên (dd/MM/yyyy)' }), {
    target: { value: '31/02/2015' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Quan hệ với người đại diện' }), {
    target: { value: 'Con' },
  });
  const next = () => screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' });
  expect(next()).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Ngày sinh thành viên (dd/MM/yyyy)' }), {
    target: { value: '01/01/2015' },
  });
  state.request.mockRejectedValueOnce(new MobileApiError(0, 'request_timeout'));
  fireEvent.click(next());
  await screen.findByRole('alert');
  expect(screen.queryByRole('dialog', { name: 'Contract preparation' })).toBeNull();
  const response = {
    representativeResidentId: 'resident-1',
    version: 1,
    members: [{ residentId: 'saved-child', clientKey: 'person-2' }],
  };
  state.request.mockResolvedValueOnce(response);
  fireEvent.click(next());
  await screen.findByRole('dialog', { name: 'Contract preparation' });
  expect(screen.getByText('Room: room; Residents: resident-1,saved-child')).toBeTruthy();
  const saves = () => state.request.mock.calls.filter(([path]) => path.endsWith('/household'));
  expect(saves()).toHaveLength(2);
  expect(saves()[0][1].headers['Idempotency-Key']).toBe(saves()[1][1].headers['Idempotency-Key']);
  expect(JSON.parse(saves()[1][1].body)).toMatchObject({
    expectedVersion: 0,
    humanConfirmed: true,
    members: [{ fullName: 'THÀNH VIÊN KIỂM THỬ', dateOfBirth: '2015-01-01' }],
  });
  fireEvent.click(screen.getByText('Previous identity step'));
  fireEvent.click(next());
  await screen.findByRole('dialog', { name: 'Contract preparation' });
  expect(saves()).toHaveLength(2);
  fireEvent.click(screen.getByText('Previous identity step'));
  openMemberEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ tên thành viên' }), {
    target: { value: 'THÀNH VIÊN ĐÃ SỬA' },
  });
  state.request.mockResolvedValueOnce({ ...response, version: 2 });
  fireEvent.click(next());
  await screen.findByRole('dialog', { name: 'Contract preparation' });
  expect(saves()).toHaveLength(3);
  expect(JSON.parse(saves()[2][1].body)).toMatchObject({
    expectedVersion: 1,
    members: [{ residentId: 'saved-child', fullName: 'THÀNH VIÊN ĐÃ SỬA' }],
  });
  expect(saves()[2][1].headers['Idempotency-Key']).not.toBe(
    saves()[1][1].headers['Idempotency-Key'],
  );
});
it('handles Android Back without losing the selected step or manual edits', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  expect(screen.queryByRole('button', { name: 'Chụp ảnh mặt trước' })).toBeNull();
  await openIdentity();
  manualIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Android Back' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng' })).toBeTruthy();
  await openIdentity();
  expect((screen.getByRole('textbox', { name: 'Họ và tên' }) as HTMLInputElement).value).toBe(
    'NGƯỜI Ở MẪU',
  );
  expect(state.json).toHaveBeenCalledTimes(1);
});
it('shows existing validation errors at each field without sending invalid data', async () => {
  render(<OnboardingScreen />);
  selectRoom();

  await openIdentity();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Nhập thủ công' }),
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thông tin' }));
  expect(screen.getByText('Nhập đủ 12 chữ số CCCD.')).toBeTruthy();
  expect(screen.getByText('Nhập họ và tên theo giấy tờ.')).toBeTruthy();
  expect(screen.getByText('Nhập ngày hợp lệ theo dd/MM/yyyy.')).toBeTruthy();
  expect(state.json).toHaveBeenCalledTimes(1);
});
it('aborts a closed representative OCR flow and ignores a late response while editing the family member', async () => {
  let finish!: (value: unknown) => void;
  state.image.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<OnboardingScreen />);
  selectRoom();

  addFamilyMember();

  await openIdentity();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  closeIdentity();
  expect(state.image.mock.calls[0][2].aborted).toBe(true);
  openMemberEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Họ tên thành viên' }), {
    target: { value: 'THÀNH VIÊN KIỂM THỬ' },
  });
  await act(async () =>
    finish({
      proposedFields: { fullName: 'LATE RESULT' },
      warnings: [],
      missingFields: [],
      confidence: {},
      isFallback: false,
    }),
  );
  expect(
    (screen.getByRole('textbox', { name: 'Họ tên thành viên' }) as HTMLInputElement).value,
  ).toBe('THÀNH VIÊN KIỂM THỬ');
  expect(screen.queryByText('LATE RESULT')).toBeNull();
});
const signature = (id: string, status: string): Signature => ({
  id,
  signerUserId: id,
  status,
  signedAt: null,
});
it('keeps a one-sided contract at signing and never presents it as active or paid', () => {
  const contract = {
    status: 'PendingSigning',
    signatures: [signature('owner', 'Signed')],
    ownerSignerId: 'owner',
    tenantUserId: 'tenant',
  } as ContractView;
  render(<ContractProgress contract={contract} readiness={null} />);
  expect(screen.getByText('Đang chờ khách thuê ký')).toBeTruthy();
  expect(screen.getByText('Bước 5/7')).toBeTruthy();
  expect(screen.queryByText('Hợp đồng đã được kích hoạt.')).toBeNull();
  expect(screen.queryByText('Tiền cọc đã được đối chiếu đầy đủ.')).toBeNull();
});
it('does not count simulated or failed signatures as verified signatures', () => {
  expect(signerState([signature('owner', 'Simulated')], 'owner')).toBe('unsigned');
  expect(signerState([signature('owner', 'Failed')], 'owner')).toBe('unsigned');
  expect(signerState([signature('owner', 'Requested')], 'owner')).toBe('waiting');
});
it('moves the display to payment only after both verified signatures without activating the contract', () => {
  const contract = {
    status: 'PendingActivation',
    signatures: [signature('owner', 'Signed'), signature('tenant', 'Signed')],
    ownerSignerId: 'owner',
    tenantUserId: 'tenant',
  } as ContractView;
  render(<ContractProgress contract={contract} readiness={null} />);
  expect(screen.getByText('Bước 6/7')).toBeTruthy();
  expect(screen.getByText('Chưa có thông tin đối chiếu tiền cọc.')).toBeTruthy();
  expect(screen.queryByText('Hợp đồng đã được kích hoạt.')).toBeNull();
});
