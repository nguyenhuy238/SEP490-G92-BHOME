// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mockScope = vi.hoisted(() => ({
  location: 'loc-1',
  locations: [{ id: 'loc-1', label: 'BHOME SAMPLE 1' }],
  rooms: [
    { id: 'room-1', label: '101' },
    { id: 'room-2', label: '102' },
    { id: 'room-3', label: '103' },
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
  }: {
    data: { id: string }[];
    renderItem: (info: { item: { id: string } }) => React.ReactNode;
    ListEmptyComponent: React.ReactNode;
  }) => (
    <div data-testid="list">
      {data.length
        ? data.map((item) => <div key={item.id}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
    </div>
  ),
  View: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
      { id: 'room-1', label: '101' },
      { id: 'room-2', label: '102' },
      { id: 'room-3', label: '103' },
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

  it('shows counts with units and compact rooms without individual residents', () => {
    render(<RoomOverview />);
    expect(screen.getByText('Phòng & Cư dân')).toBeTruthy();
    expect(screen.getByText('cư dân chờ xác minh')).toBeTruthy();
    expect(screen.getByLabelText('Phòng 101, 2 cư dân, 1 chờ xác minh')).toBeTruthy();
    expect(screen.queryByText('Nguyễn Văn An')).toBeNull();
    expect(screen.queryByText('Trần Thị Bình')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Tiếp nhận cư dân' })).toHaveLength(1);
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
    fireEvent.click(screen.getByLabelText('Phòng 101, 2 cư dân, 1 chờ xác minh'));
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
  it('opens onboarding in the selected location and permits location switching', () => {
    mockScope.locations.push({ id: 'loc-2', label: 'Cơ sở 2' });
    render(<RoomOverview />);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận cư dân' }));
    expect(mockWorkspace.go).toHaveBeenCalledWith('onboarding', { locationId: 'loc-1' });
    fireEvent.click(screen.getByLabelText('Cơ sở Cơ sở 2'));
    expect(mockScope.selectLocation).toHaveBeenCalledWith('loc-2');
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
    expect(screen.getByText('Người đại diện')).toBeTruthy();
    expect(screen.getByText('Người ở cùng')).toBeTruthy();
    expect(screen.getByText('Đã xác minh')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Xem cư dân Trần Thị Bình, Người ở cùng, Chờ xác minh'));
    expect(mockWorkspace.go).toHaveBeenCalledWith('onboarding', {
      residentId: 'res-2',
      roomId: 'room-1',
      locationId: 'loc-1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp nhận cư dân' }));
    expect(mockWorkspace.go).toHaveBeenCalledWith('onboarding', {
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
    expect(screen.queryByRole('button', { name: 'Tiếp nhận cư dân' })).toBeNull();
    expect(screen.getByText('Phòng không còn khả dụng trong cơ sở được phân công')).toBeTruthy();
  });
});
