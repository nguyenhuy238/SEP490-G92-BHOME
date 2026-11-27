// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mockScope = vi.hoisted(() => ({
  location: 'loc-1',
  locations: [{ id: 'loc-1', label: 'BHOME SAMPLE 1' }],
  rooms: [
    { id: 'room-1', label: '101', status: 'Occupied', capacity: 3 },
    { id: 'room-2', label: '102', status: 'OnHold', capacity: 2 },
    { id: 'room-3', label: '103', status: 'Available', capacity: 1 },
  ],
  residents: [
    {
      id: 'res-1',
      roomId: 'room-1',
      displayLabel: 'Nguyễn Văn An',
      verificationStatus: 1, // Verified
      residentType: 0, // Representative
    },
    {
      id: 'res-2',
      roomId: 'room-1',
      displayLabel: 'Trần Thị Bình',
      verificationStatus: 0, // Pending
      residentType: 1, // Co-occupant
    },
    {
      id: 'res-3',
      roomId: 'room-2',
      displayLabel: 'Lê Hoàng Cường',
      verificationStatus: 1, // Verified
      residentType: 0,
    },
  ],
  loading: false,
  error: '',
  selectLocation: vi.fn(),
  reload: vi.fn(),
}));

const mockWorkspace = vi.hoisted(() => ({
  go: vi.fn(),
  preview: false,
  requestNavigation: (action: () => void) => action(),
}));

vi.mock('../features/onboarding/useCaptureScope', () => ({
  useCaptureScope: () => mockScope,
}));

vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => mockWorkspace,
}));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ api: null }) }));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({ label, value, options, onChange }: {
    label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void;
  }) => (
    <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
  ),
}));

vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Text: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <span style={style}>{children}</span>
  ),
  ActivityIndicator: () => <span>Đang tải…</span>,
  Icon: ({ source }: { source: string }) => <i data-icon={source} />,
  IconButton: ({
    icon,
    onPress,
    accessibilityLabel,
    disabled,
  }: {
    icon: string;
    onPress: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {icon}
    </button>
  ),
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <div
      role={accessibilityRole ?? 'button'}
      aria-label={accessibilityLabel}
      onClick={onPress}
      tabIndex={0}
    >
      {children}
    </div>
  ),
}));

const route = vi.hoisted(() => ({
  params: {} as { roomId?: string; locationId?: string },
  back: vi.fn(),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => route.params,
  useFocusEffect: () => {},
  router: { canGoBack: () => true, back: route.back },
}));
vi.mock('react-native', () => ({
  FlatList: ({
    data,
    renderItem,
    ListEmptyComponent,
    ListHeaderComponent,
  }: {
    data: { id: string }[];
    renderItem: (info: { item: { id: string } }) => React.ReactNode;
    ListEmptyComponent: React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
  }) => (
    <div data-testid="list">
      {ListHeaderComponent}
      {data.length
        ? data.map((item) => <div key={item.id}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
    </div>
  ),
  View: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
  TextInput: ({
    value,
    onChangeText,
    placeholder,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    accessibilityLabel?: string;
  }) => (
    <input
      type="text"
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      placeholder={placeholder}
      aria-label={accessibilityLabel}
    />
  ),
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Platform: {
    OS: 'web',
  },
}));

import { RoomOverview } from '../screens/StaffRoomResidentsScreen';

describe('Staff resident directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.params = {};
    mockScope.loading = false;
    mockScope.error = '';
    mockScope.location = 'loc-1';
    mockScope.locations = [{ id: 'loc-1', label: 'BHOME SAMPLE 1' }];
    mockScope.rooms = [
      { id: 'room-1', label: '101', status: 'Occupied', capacity: 3 },
      { id: 'room-2', label: '102', status: 'OnHold', capacity: 2 },
      { id: 'room-3', label: '103', status: 'Available', capacity: 1 },
    ];
    mockScope.residents = [
      {
        id: 'res-1',
        roomId: 'room-1',
        displayLabel: 'Nguyễn Văn An',
        verificationStatus: 1,
        residentType: 0,
      },
      {
        id: 'res-2',
        roomId: 'room-1',
        displayLabel: 'Trần Thị Bình',
        verificationStatus: 0,
        residentType: 1,
      },
      {
        id: 'res-3',
        roomId: 'room-2',
        displayLabel: 'Lê Hoàng Cường',
        verificationStatus: 2,
        residentType: 0,
      },
    ];
  });
  afterEach(cleanup);

  it('opens contract actions without exposing resident intake from the room module', () => {
    render(<RoomOverview />);
    fireEvent.click(screen.getByText('Hợp đồng'));
    expect(mockWorkspace.go).toHaveBeenLastCalledWith('signing');
    fireEvent.click(screen.getByText('Tạo hợp đồng'));
    expect(mockWorkspace.go).toHaveBeenLastCalledWith('prepare-contract');
    fireEvent.click(screen.getByText('Giữ chỗ'));
    expect(mockWorkspace.go).toHaveBeenLastCalledWith('prepare-contract', { kind: 'Holding' });
    expect(screen.queryByText('Tiếp nhận cư dân')).toBeNull();
  });

  it('shows counts with units and compact rooms without individual residents', () => {
    render(<RoomOverview />);
    expect(screen.getByText('Quản lý phòng')).toBeTruthy();
    expect(screen.getByText('cư dân chờ xác minh')).toBeTruthy();
    expect(screen.getByLabelText('Phòng 101, Đang thuê, 2 cư dân trên sức chứa 3, 1 chờ xác minh')).toBeTruthy();
    expect(screen.queryByText('Nguyễn Văn An')).toBeNull();
    expect(screen.queryByText('Trần Thị Bình')).toBeNull();
    expect(screen.getByText('Đang thuê')).toBeTruthy();
    expect(screen.getByText('Đã giữ chỗ')).toBeTruthy();
    expect(screen.getByText('Phòng trống')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Phòng /)[0].getAttribute('aria-label')).toContain('101');
  });
  it('searches room numbers and accent-insensitive resident names without expanding residents', () => {
    render(<RoomOverview />);
    fireEvent.change(screen.getByLabelText('Tìm phòng hoặc cư dân'), {
      target: { value: 'tran thi binh' },
    });
    expect(screen.getByText('Phòng 101')).toBeTruthy();
    expect(screen.queryByText('Phòng 102')).toBeNull();
    expect(screen.queryByText('Trần Thị Bình')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm phòng hoặc cư dân'), { target: { value: '103' } });
    expect(screen.getByText('Phòng 103')).toBeTruthy();
  });
  it('filters pending residents accurately without counting Rejected as Pending', () => {
    render(<RoomOverview />);
    fireEvent.click(screen.getByLabelText('Cần xử lý'));
    expect(screen.getByText('Phòng 101')).toBeTruthy();
    expect(screen.queryByText('Phòng 102')).toBeNull();
    expect(screen.queryByText('Phòng 103')).toBeNull();
    fireEvent.click(screen.getByLabelText('Tất cả phòng'));
    expect(screen.getByText('Phòng 102')).toBeTruthy();
  });
  it('opens a room with only scoped reference IDs and preserves filters on rerender', () => {
    const view = render(<RoomOverview />);
    fireEvent.change(screen.getByLabelText('Tìm phòng hoặc cư dân'), { target: { value: '101' } });
    fireEvent.click(screen.getByLabelText('Cần xử lý'));
    fireEvent.click(screen.getByLabelText('Phòng 101, Đang thuê, 2 cư dân trên sức chứa 3, 1 chờ xác minh'));
    expect(mockWorkspace.go).toHaveBeenCalledWith('rooms', {
      roomId: 'room-1',
      locationId: 'loc-1',
    });
    view.rerender(<RoomOverview />);
    expect((screen.getByLabelText('Tìm phòng hoặc cư dân') as HTMLInputElement).value).toBe('101');
    expect(screen.queryByText('Phòng 102')).toBeNull();
  });
  it('limits each page to 12 rooms for 60 rooms and 120 residents; resets page on search', () => {
    mockScope.rooms = Array.from({ length: 60 }, (_, i) => ({
      id: `room-${i}`,
      label: String(100 + i),
      status: 'Occupied',
      capacity: 2,
    }));
    mockScope.residents = mockScope.rooms.flatMap((room, i) =>
      [0, 1].map((member) => ({
        id: `${room.id}-${member}`,
        roomId: room.id,
        displayLabel: `Cư dân ${i}-${member}`,
        verificationStatus: 1,
        residentType: member,
      })),
    );
    render(<RoomOverview />);
    expect(within(screen.getByTestId('list')).getAllByRole('button')).toHaveLength(12);
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('1/5 · 60 phòng')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Trang sau'));
    expect(screen.getByText('2/5 · 60 phòng')).toBeTruthy();
    expect(screen.queryByText('Phòng 100')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm phòng hoặc cư dân'), { target: { value: '159' } });
    expect(screen.getByText('1/1 · 1 phòng')).toBeTruthy();
    expect(screen.getByText('Phòng 159')).toBeTruthy();
  });
  it('uses a location dropdown and omits resident intake from room quick actions', () => {
    mockScope.locations.push({ id: 'loc-2', label: 'Cơ sở 2' });
    render(<RoomOverview />);
    fireEvent.change(screen.getByLabelText('Cơ sở'), { target: { value: 'loc-2' } });
    expect(mockScope.selectLocation).toHaveBeenCalledWith('loc-2');
    expect(screen.queryByText('Tiếp nhận cư dân')).toBeNull();
  });
  it('hides data on loading or API failure and provides retry', () => {
    mockScope.loading = true;
    const view = render(<RoomOverview />);
    expect(screen.queryByText('Phòng 101')).toBeNull();
    mockScope.loading = false;
    mockScope.error = 'Không được truy cập';
    view.rerender(<RoomOverview />);
    expect(screen.queryByText('Phòng 101')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockScope.reload).toHaveBeenCalled();
  });
  it('renders a clear empty search result', () => {
    render(<RoomOverview />);
    fireEvent.change(screen.getByLabelText('Tìm phòng hoặc cư dân'), {
      target: { value: 'Không tồn tại' },
    });
    expect(screen.getByText('Không tìm thấy phòng phù hợp')).toBeTruthy();
  });
  it('shows residents only in room detail with roles, statuses and safe navigation', () => {
    route.params = { roomId: 'room-1', locationId: 'loc-1' };
    render(<RoomOverview />);
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
    expect(screen.getAllByText('Đã xác minh').length).toBeGreaterThan(0);
    expect(screen.getByText('2/3 người')).toBeTruthy();
    expect(screen.getAllByText('Đã xác minh').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chờ xác minh').length).toBeGreaterThan(0);
    expect(screen.queryByText('Tiếp nhận cư dân')).toBeNull();
    fireEvent.click(screen.getByLabelText('Mở cư dân Trần Thị Bình, Thành viên cùng ở, Chờ xác minh'));
    fireEvent.click(screen.getByText('Xem hồ sơ cư dân'));
    expect(mockWorkspace.go).toHaveBeenCalledWith('onboarding', {
      residentId: 'res-2',
      roomId: 'room-1',
      locationId: 'loc-1',
    });
    fireEvent.click(screen.getByLabelText('Quay lại danh sách phòng'));
    expect(route.back).toHaveBeenCalled();
  });
  it('fails closed when a deep-linked room is outside the assigned location', () => {
    route.params = { roomId: 'room-1', locationId: 'removed-location' };
    render(<RoomOverview />);
    expect(screen.queryByText('Nguyễn Văn An')).toBeNull();
    expect(screen.queryByText('Tiếp nhận cư dân')).toBeNull();
    expect(screen.getByText('Phòng không còn khả dụng trong cơ sở được phân công')).toBeTruthy();
  });
});
