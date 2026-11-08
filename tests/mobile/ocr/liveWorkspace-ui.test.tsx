vi.mock('../../../src/mobile/src/components/IncidentEvidencePicker', () => ({
  IncidentEvidencePicker: () => null,
  incidentPhotoUri: () => '',
}));
// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi, MobileApiError } from '../../../src/mobile/src/lib/api';
import { getToastSnapshot } from '../../../src/mobile/src/lib/toast';
import type { OperationalTask } from '../../../src/mobile/src/services/operationalTasks';

const mocks = vi.hoisted(() => ({
  role: 'Staff',
  actor: 'staff',
  api: null as MobileApi | null,
  go: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
  onStateChange: null as ((state: string) => void) | null,
  taskId: '00000000-0000-0000-0000-000000000001',
  invoiceId: undefined as string | undefined,
  historyTab: undefined as string | undefined,
  returnTo: undefined as string | undefined,
  setParams: vi.fn(),
  canGoBack: vi.fn(() => false),
  back: vi.fn(),
  copy: vi.fn(),
}));
type Children = { children?: React.ReactNode };
type Button = Children & { onPress: () => void; disabled?: boolean };
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: Children) => <div>{children}</div>,
}));
vi.mock('../../../src/mobile/node_modules/react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: Children) => <div>{children}</div>,
}));
vi.mock('expo-router', () => ({
  router: {
    push: vi.fn(),
    replace: mocks.replace,
    setParams: mocks.setParams,
    canGoBack: mocks.canGoBack,
    back: mocks.back,
  },
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  useLocalSearchParams: () => ({
    taskId: mocks.taskId,
    invoiceId: mocks.invoiceId,
    historyTab: mocks.historyTab,
    returnTo: mocks.returnTo,
  }),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mocks.copy(...args) }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  Platform: { OS: 'ios' },
  View: ({ children }: Children) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: Children) => <div>{children}</div>,
  ScrollView: ({ children }: Children) => <div>{children}</div>,
  RefreshControl: () => null,
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    data: { id: string }[];
    renderItem: (info: { item: { id: string } }) => React.ReactNode;
    keyExtractor: (item: { id: string }) => string;
    ListHeaderComponent: React.ReactNode;
    ListEmptyComponent: React.ReactNode;
    ListFooterComponent: React.ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.length
        ? data.map((item) => <div key={keyExtractor(item)}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
  Modal: ({ visible, children }: Children & { visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
  Image: () => <img alt="Ảnh kết quả" />,
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.onStateChange = listener;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('react-native-paper', () => ({
  Portal: ({ children }: Children) => <>{children}</>,
  Dialog: Object.assign(
    ({ visible, children }: Children & { visible: boolean }) =>
      visible ? <div role="dialog">{children}</div> : null,
    {
      Title: ({ children }: Children) => <h2>{children}</h2>,
      Content: ({ children }: Children) => <div>{children}</div>,
      Actions: ({ children }: Children) => <div>{children}</div>,
    },
  ),
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Icon: () => null,
  Avatar: { Text: ({ label }: { label: string }) => <span>{label}</span> },
  IconButton: ({
    onPress,
    accessibilityLabel,
  }: {
    onPress: () => void;
    accessibilityLabel: string;
  }) => <button onClick={onPress} aria-label={accessibilityLabel} />,
  ProgressBar: () => null,
  Menu: Object.assign(
    ({ anchor, visible, children }: Children & { anchor: React.ReactNode; visible: boolean }) => (
      <>
        {anchor}
        {visible && children}
      </>
    ),
    {
      Item: ({ title, onPress }: { title: string; onPress: () => void }) => (
        <button onClick={onPress}>{title}</button>
      ),
    },
  ),
  useTheme: () => ({ colors: { surface: '#fff', onSurfaceVariant: '#64748b' } }),
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
    accessibilityState?: { expanded?: boolean; selected?: boolean };
    accessibilityRole?: string;
  }) => (
    <button
      onClick={onPress}
      aria-label={accessibilityLabel}
      role={accessibilityRole}
      aria-expanded={accessibilityState?.expanded}
      aria-selected={accessibilityState?.selected}
    >
      {children}
    </button>
  ),
  Text: ({
    children,
    accessibilityRole,
    numberOfLines,
  }: Children & { accessibilityRole?: string; numberOfLines?: number }) => (
    <span role={accessibilityRole} data-lines={numberOfLines}>
      {children}
    </span>
  ),
  ActivityIndicator: () => <span>Đang tải dữ liệu</span>,
  TextInput: ({
    label,
    value,
    onChangeText,
    disabled,
    secureTextEntry,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled?: boolean;
    secureTextEntry?: boolean;
  }) => (
    <label>
      {label}
      <input
        type={secureTextEntry ? 'password' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(event) => onChangeText(event.target.value)}
      />
    </label>
  ),
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
}));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
  Action: ({ children, onPress, disabled }: Button) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Box: ({ children }: Children) => <div>{children}</div>,
  Row: ({ children }: Children) => <div>{children}</div>,
  Heading: ({
    title,
    detail,
    action,
    onPress,
  }: {
    title: string;
    detail?: string;
    action?: string;
    onPress?: () => void;
  }) => (
    <div>
      <h1>{title}</h1>
      {detail && <span>{detail}</span>}
      {action && <button onClick={onPress}>{action}</button>}
    </div>
  ),
  Pill: ({ children }: Children) => <span>{children}</span>,
  Metric: ({ label, value }: { label: string; value: string }) => (
    <span>
      {label}: {value}
    </span>
  ),
  QuickActions: ({ items }: { items: { label: string; onPress: () => void }[] }) => (
    <div>
      {items.map((item) => (
        <button key={item.label} onClick={item.onPress}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  InfoRow: ({ title, onPress }: { title: string; onPress: () => void }) => (
    <button onClick={onPress}>{title}</button>
  ),
  ui: {},
}));
vi.mock('../../../src/mobile/src/components/WorkflowControls', () => ({
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
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Chọn</option>
        {options
          .filter((option) => option.id)
          .map((option) => (
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
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
    </label>
  ),
}));
vi.mock('../../../src/mobile/src/components/CameraCapture', () => ({
  CameraCapture: ({
    label,
    disabled,
    onCapture,
  }: {
    label: string;
    disabled: boolean;
    onCapture: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  }) =>
    ['Chụp ảnh bằng chứng điều chỉnh', 'Thêm ảnh minh chứng'].includes(label) ? (
      <button disabled={disabled} onClick={() => void onCapture(new Uint8Array([137, 80, 78, 71]))}>
        {label}
      </button>
    ) : (
      <span>Camera</span>
    ),
}));
vi.mock('../../../src/mobile/src/lib/SessionProvider', () => ({
  useSession: () => ({
    api: mocks.api,
    logout: mocks.logout,
    session: { roles: [mocks.role], userId: mocks.actor },
  }),
}));
vi.mock('../../../src/mobile/src/features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: mocks.role, go: mocks.go }),
}));
import {
  OperationalTaskDetail,
  OperationalTasksScreen,
  TaskWorkForm,
} from '../../../src/mobile/src/screens/OperationalTaskScreens';
import {
  TaskNotificationsScreen,
  TenantHomeScreen,
  MeterTasksScreen,
} from '../../../src/mobile/src/screens/LiveWorkspaceScreens';
import { NotificationsScreen } from '../../../src/mobile/src/screens/NotificationsScreen';
import { TenantDashboard } from '../../../src/mobile/src/screens/TenantDashboard';
import { TenantFeaturesScreen } from '../../../src/mobile/src/screens/TenantFeaturesScreen';
import { TenantFeatureDirectory } from '../../../src/mobile/src/components/TenantFeatureDirectory';
import { AccountSecurityScreen } from '../../../src/mobile/src/screens/AccountSecurityScreen';
import { TenantInvoicesScreen } from '../../../src/mobile/src/screens/TenantInvoicesScreen';
import { TenantPaymentPanel } from '../../../src/mobile/src/screens/TenantPaymentPanel';
import { TenantPaymentHistoryScreen } from '../../../src/mobile/src/screens/TenantPaymentHistoryScreen';
import { TenantRoomScreen } from '../../../src/mobile/src/screens/TenantRoomScreen';
import { TenantMeterHistoryScreen } from '../../../src/mobile/src/screens/TenantMeterHistoryScreen';
import {
  TenantIncidentScreen,
  TenantRequestsScreen,
  TenantResidenceScreen,
} from '../../../src/mobile/src/screens/TenantServiceScreens';
import { TenantProfileScreen } from '../../../src/mobile/src/screens/TenantProfileScreen';
import { validateTenantEvidence } from '../../../src/mobile/src/components/TenantEvidenceDraft';
import {
  positiveAmount,
  sameAmount,
} from '../../../src/mobile/src/features/tenant/paymentPresentation';
import { TenantAdjustmentPanel } from '../../../src/mobile/src/screens/TenantAdjustmentPanel';
import type { Invoice } from '../../../packages/client-core/src/invoices';

const id = '00000000-0000-0000-0000-000000000001';
const fileId = '00000000-0000-0000-0000-000000000002';
const page = <T,>(items: T[], totalCount = items.length) => ({
  items,
  page: 1,
  pageSize: 20,
  totalCount,
});
const task: OperationalTask = {
  id,
  locationId: id,
  kind: 'AdHoc',
  title: 'Kiểm tra hành lang',
  requirements: 'Đối chiếu checklist',
  priority: 'Normal',
  dueAt: '2026-11-02T02:00:00Z',
  evidenceRequired: true,
  status: 'InProgress',
  isOverdue: false,
  currentResponsibleStaffUserId: 'staff',
  responsibilityAvailable: true,
  result: null,
  version: 7,
  verifiedAt: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  mocks.role = 'Staff';
  mocks.actor = 'staff';
  mocks.taskId = id;
  mocks.invoiceId = undefined;
  mocks.historyTab = undefined;
  mocks.returnTo = undefined;
  mocks.setParams.mockReset();
  mocks.canGoBack.mockReset().mockReturnValue(false);
  mocks.back.mockReset();
  mocks.go.mockClear();
  mocks.logout.mockReset().mockResolvedValue(undefined);
  mocks.replace.mockClear();
  mocks.copy.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);
it('opens a Tenant invoice only after authorized target resolution and read persistence', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/target')) return json({ objectType: 'Invoice', objectId: id });
    if (String(url).endsWith('/unread-count')) return json({ unreadCount: 1 });
    if (init?.method === 'POST') return new Response(null, { status: 204 });
    return json(
      page([
        {
          id,
          category: 'Invoice',
          title: 'Hóa đơn tự động tổng hợp',
          summary: 'Đã phát hành',
          createdAt: '2026-11-02T00:00:00Z',
          readAt: null,
          relatedObjectType: 'Invoice',
          relatedObjectId: id,
          deliveryState: 'Unconfigured',
        },
      ]),
    );
  });
  setApi(fetcher);
  render(<NotificationsScreen />);
  await screen.findByText('Hóa đơn tự động tổng hợp');
  fireEvent.click(screen.getByRole('button', { name: 'Hóa đơn tự động tổng hợp' }));
  await waitFor(() => expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId: id }));
  expect(
    fetcher.mock.calls.some(
      ([url, init]) => String(url).endsWith('/read') && init?.method === 'POST',
    ),
  ).toBe(true);
});
it('keeps a notification readable without opening a revoked target', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) =>
    init?.method === 'POST'
      ? new Response(null, { status: 204 })
      : String(url).endsWith('/unread-count')
        ? json({ unreadCount: 1 })
        : String(url).endsWith('/target')
          ? json({}, 404)
          : json(
              page([
                {
                  id,
                  category: 'Task',
                  title: 'Tác vụ tổng hợp',
                  summary: 'Được giao',
                  createdAt: '2026-11-02T00:00:00Z',
                  readAt: null,
                  relatedObjectType: 'OperationalTask',
                  relatedObjectId: id,
                  deliveryState: 'Unconfigured',
                },
              ]),
            ),
  );
  setApi(fetcher);
  render(<NotificationsScreen />);
  await screen.findByText('Tác vụ tổng hợp');
  fireEvent.click(screen.getByRole('button', { name: 'Tác vụ tổng hợp' }));
  await waitFor(() =>
    expect(getToastSnapshot().toast?.message).toMatch(/Hồ sơ không còn khả dụng/),
  );
  expect(mocks.go).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
});
it('sends room scope and due-date filters before paging but keeps status filtering on room groups', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(String(url).includes('/meter-tasks') ? [] : [{ id, label: 'Cơ sở tổng hợp' }]),
    );
  setApi(fetcher);
  render(<MeterTasksScreen />);
  await screen.findByText('Cơ sở tổng hợp');
  fireEvent.change(screen.getByLabelText('Cơ sở'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Lọc kỳ ghi & trạng thái' }));
  fireEvent.change(screen.getByLabelText('Hạn ghi số (yyyy-MM-dd)'), {
    target: { value: '2026-11-10' },
  });
  fireEvent.change(screen.getByLabelText('Trạng thái tác vụ'), { target: { value: '2' } });
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url]) =>
          String(url).includes(`locationId=${id}`) &&
          String(url).includes('dueDate=2026-11-10') &&
          !String(url).includes('status='),
      ),
    ).toBe(true),
  );
});

it('collects all pages before grouping rooms and filtering billing periods', async () => {
  const sample = {
    meterId: id,
    roomId: id,
    locationId: id,
    location: 'Cơ sở tổng hợp',
    room: '101',
    meterCode: 'E101',
    utilityType: 0,
    decimalPlaces: 2,
    purpose: 1,
    readingDate: '2026-11-03',
    billingPeriod: '2026-10-01',
    status: 0,
    previousValue: '100',
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (!path.includes('/meter-tasks')) return json([{ id, label: 'Cơ sở tổng hợp' }]);
    if (path.includes('page=2'))
      return json([
        {
          ...sample,
          id: 'water-next-page',
          utilityType: 1,
          meterCode: 'W101',
          billingPeriod: '2026-11-01',
        },
      ]);
    return json(
      Array.from({ length: 100 }, (_, index) => ({ ...sample, id: `electric-${index}` })),
    );
  });
  setApi(fetcher);
  render(<MeterTasksScreen />);
  await screen.findByText('2 phòng / kỳ ghi phù hợp');
  fireEvent.click(screen.getByRole('button', { name: 'Lọc kỳ ghi & trạng thái' }));
  fireEvent.change(screen.getByLabelText('Kỳ ghi chỉ số'), { target: { value: '2026-11-01' } });
  await screen.findByText('1 phòng / kỳ ghi phù hợp');
  expect(screen.getByText('Nước')).toBeTruthy();
  expect(screen.queryByText('Điện')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Mở phòng' })).toHaveLength(1);
});
it('shows an actionable empty state and never invents meter tasks', async () => {
  setApi(vi.fn<typeof fetch>().mockImplementation(async () => json([])));
  render(<MeterTasksScreen />);
  await screen.findByText('Chưa có tác vụ phù hợp');
  expect(screen.getByText(/Đổi phòng hoặc kỳ ghi/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Mở phòng' })).toBeNull();
});

it('shows a pending and a completed utility under one room even when filtering pending work', async () => {
  const task = {
    id: 'electric',
    meterId: 'meter-electric',
    roomId: id,
    locationId: id,
    location: 'Cơ sở tổng hợp',
    room: '101',
    meterCode: 'E101',
    utilityType: 0,
    decimalPlaces: 2,
    purpose: 1,
    readingDate: '2026-11-04',
    billingPeriod: '2026-11-01',
    status: 0,
    previousValue: '100',
  };
  setApi(
    vi.fn<typeof fetch>().mockImplementation(async (url) =>
      json(
        String(url).includes('/meter-tasks')
          ? [
              task,
              {
                ...task,
                id: 'water',
                meterId: 'meter-water',
                meterCode: 'W101',
                utilityType: 1,
                status: 2,
                confirmedReadingId: 'reading-water',
              },
            ]
          : [{ id, label: 'Cơ sở tổng hợp' }],
      ),
    ),
  );
  render(<MeterTasksScreen />);
  await screen.findByText('1 phòng / kỳ ghi phù hợp');
  fireEvent.click(screen.getByRole('button', { name: 'Lọc kỳ ghi & trạng thái' }));
  fireEvent.change(screen.getByLabelText('Trạng thái tác vụ'), { target: { value: '0' } });
  expect(screen.getByText('Điện')).toBeTruthy();
  expect(screen.getByText('Nước')).toBeTruthy();
  expect(screen.getByText('Đã ghi')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Mở phòng' })).toHaveLength(1);
});

it('shows real transfer instructions, copies exact amount and removes QR when the shared invoice becomes Paid', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  let settled = false;
  const instructions = {
    invoiceId: id,
    availability: 'Available',
    accountNumber: '000000000000',
    bankIdentifier: '970415',
    accountHolder: 'BHOME SYNTHETIC DEMO',
    outstandingAmount: '100000',
    transferDescription: 'SYNTHETICREF',
    qrImageDataUri: 'data:image/png;base64,AA==',
    isDevelopmentDemo: true,
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).endsWith('/invoices/' + id)
      ? json({ ...adjustmentInvoice, id })
      : String(url).includes('adjustments')
        ? json(page([]))
        : json(
            String(url).endsWith('/payment')
              ? {
                  invoiceId: id,
                  payableAmount: '100000',
                  paymentStatus: settled ? 'Paid' : 'Unpaid',
                  outstandingAmount: settled ? '0' : '100000',
                  paidAmount: settled ? '100000' : '0',
                  dueDate: '2026-11-01',
                  overdueDays: 0,
                  pendingReview: false,
                  history: settled
                    ? [
                        {
                          id: 'allocation',
                          amount: '100000',
                          paidAt: '2026-11-01T01:00:00Z',
                          paidBy: 'Khách thuê khác trong hóa đơn',
                          verifiedAt: '2026-11-01T02:00:00Z',
                        },
                      ]
                    : [],
                }
              : instructions,
          ),
  );
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  fireEvent.click(await screen.findByText('Xem QR thanh toán'));
  await screen.findByText('Tài khoản tổng hợp demo. Không chuyển tiền thật.');
  fireEvent.click(screen.getByText('Sao chép số tiền'));
  await screen.findByText('Đã sao chép.');
  expect(mocks.copy).toHaveBeenCalledWith('100000', { android: { isSensitive: true } });
  settled = true;
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại hóa đơn' }));
  await screen.findByText('Đã thanh toán');
  fireEvent.click(await screen.findByText('Khoản thanh toán đã xác minh (1)'));
  await screen.findByText(/Người trả: Khách thuê khác trong hóa đơn/);
  expect(screen.queryByText('Sao chép số tiền')).toBeNull();
  expect(fetcher.mock.calls.every((call) => !call[1]?.method || call[1].method === 'GET')).toBe(
    true,
  );
});

it('Tenant reads persisted invoice consumption and amount without a fake payment state', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const invoice = {
    ...adjustmentInvoice,
    id: 'bill',
    roomNumber: 'P101',
    locationName: 'Synthetic',
    billingPeriod: '2026-10-01',
    status: 'Final',
    total: '3119250',
    missingInputs: [],
    dueDate: '2026-11-10',
    lines: [
      {
        id: 'line',
        name: 'Điện tổng hợp',
        category: 'Electricity',
        rateDate: '2026-10-01',
        rate: '3500',
        quantity: '25.5',
        amount: '89250',
        occupiedDays: 0,
        periodDays: 0,
        meterReadingId: 'reading',
        previousReading: '100',
        confirmedReading: '125.5',
      },
    ],
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const route = String(url);
    if (route.endsWith('/payment'))
      return json({
        invoiceId: 'bill',
        paymentStatus: 'Unpaid',
        payableAmount: '3119250',
        outstandingAmount: '3119250',
        paidAmount: '0',
        dueDate: '2026-11-10',
        overdueDays: 0,
        pendingReview: false,
        history: [],
      });
    if (route.endsWith('/transfer-instructions'))
      return json({ availability: 'ReceivingAccountUnavailable' });
    if (route.includes('/payment-invoices'))
      return json(
        page([
          {
            invoiceId: 'bill',
            paymentStatus: 'Unpaid',
            outstandingAmount: '3119250',
            paidAmount: '0',
            dueDate: '2026-11-10',
            overdueDays: 0,
          },
        ]),
      );
    if (route.includes('/invoice-adjustments') || route.includes('/adjustments?'))
      return json(page([]));
    return json(route.includes('/invoices/bill') ? invoice : page([invoice]));
  });
  setApi(fetcher);
  const view = render(<TenantInvoicesScreen />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Xem hóa đơn phòng P101, kỳ 2026-10' }),
  );
  expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId: 'bill' });
  mocks.invoiceId = 'bill';
  view.rerender(<TenantInvoicesScreen />);
  await screen.findByText('Điện tổng hợp');
  expect(screen.queryByText('Chỉ số cũ')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Điện tổng hợp, xem chi tiết' }));
  expect(screen.getByText('25,5 kWh')).toBeTruthy();
  expect(screen.getByText('100')).toBeTruthy();
  expect(screen.queryByText(/Đã thanh toán|Paid|Thanh toán thành công/)).toBeNull();
  expect(fetcher.mock.calls.some((call) => String(call[0]).endsWith('/api/v1/invoices/bill'))).toBe(
    true,
  );
});
it('Tenant invoice detail failure removes prior data and offers reload', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        page([
          {
            id: 'bill',
            roomNumber: 'P101',
            locationName: 'Synthetic',
            billingPeriod: '2026-10-01',
            status: 'Draft',
            total: '3000000',
            missingInputs: [],
          },
        ]),
      ),
    )
    .mockResolvedValue(json({}, 404));
  setApi(fetcher);
  const view = render(<TenantInvoicesScreen />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Xem hóa đơn phòng P101, kỳ 2026-10' }),
  );
  expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId: 'bill' });
  mocks.invoiceId = 'bill';
  view.rerender(<TenantInvoicesScreen />);
  await screen.findByText(/Tài nguyên không khả dụng/);
  expect(screen.queryByText('Tổng hóa đơn')).toBeNull();
  expect(screen.getByLabelText('Quay lại danh sách hóa đơn')).toBeTruthy();
});
function setApi(fetcher: typeof fetch) {
  mocks.api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-access',
    async () => undefined,
    vi.fn(),
    fetcher,
  );
}
const adjustmentInvoice: Invoice = {
  id: 'bill',
  locationId: id,
  roomId: id,
  locationName: 'Synthetic',
  roomNumber: 'P101',
  billingPeriod: '2026-10-01',
  status: 'Final',
  version: 2,
  total: '100000',
  missingInputs: [],
  dueDate: '2026-11-30',
  scheduledFinalDate: '2026-11-01',
  finalizedAt: '2026-11-01T00:00:00Z',
  representativeTenantUserId: 'tenant',
  lines: [],
};
it('Tenant uploads private evidence and retries the same adjustment command without inventing success', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  let attempts = 0;
  const request = {
    id: 'request',
    invoiceId: 'bill',
    status: 'Pending',
    chargeCode: null,
    submittedAt: '2026-11-01T00:00:00Z',
    reason: 'Sai khoản thuê',
    currentAmount: '100000',
    proposedAmount: '90000',
    decision: null,
    evidence: [],
    financials: null,
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const route = String(url);
    if (init?.method === 'PUT') return json({ id: fileId, contentType: 'image/jpeg', length: 4 });
    if (init?.method === 'POST') {
      attempts++;
      return attempts === 1 ? json({}, 503) : json(request);
    }
    if (route.endsWith('/invoice-adjustments/request')) return json(request);
    return json(page([]));
  });
  setApi(fetcher);
  render(<TenantAdjustmentPanel invoice={adjustmentInvoice} />);
  fireEvent.click(screen.getByText('Gửi yêu cầu điều chỉnh'));
  expect((screen.getByText('Gửi yêu cầu cho Owner') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu điều chỉnh'), {
    target: { value: 'Sai khoản thuê' },
  });
  fireEvent.change(screen.getByLabelText('Giá trị đề xuất (VND, tùy chọn)'), {
    target: { value: '90000' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra ảnh bằng chứng'));
  fireEvent.click(screen.getByText('Chụp ảnh bằng chứng điều chỉnh'));
  await screen.findByText('Đã tải 1/5 ảnh.');
  fireEvent.click(screen.getByText('Gửi yêu cầu cho Owner'));
  fireEvent.click(screen.getByText('Gửi yêu cầu cho Owner'));
  await screen.findByText('Chưa xác nhận thành công. Hãy tải lại và thử lại.');
  expect(attempts).toBe(1);
  expect(screen.queryByText('Kết quả yêu cầu')).toBeNull();
  fireEvent.click(screen.getByText('Gửi yêu cầu cho Owner'));
  await screen.findByText('Kết quả yêu cầu');
  await screen.findByText('Chờ Owner xem xét');
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(new Headers(posts[0]![1]!.headers).get('Idempotency-Key')).toBe(
    new Headers(posts[1]![1]!.headers).get('Idempotency-Key'),
  );
  expect(JSON.parse(posts[1]![1]!.body as string)).toEqual({
    invoiceLineId: null,
    proposedAmount: '90000',
    reason: 'Sai khoản thuê',
    evidenceIds: [fileId],
    expectedInvoiceVersion: 2,
  });
});
it('Tenant sees the Owner rejection and no approval control', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const request = {
    id: 'request',
    status: 'Rejected',
    chargeCode: null,
    submittedAt: '2026-11-01T00:00:00Z',
    reason: 'Sai khoản thuê',
    currentAmount: '100000',
    proposedAmount: '90000',
    evidence: [],
    decision: {
      reason: 'Không có sai lệch sau kiểm tra',
      delta: '0',
      decidedAt: '2026-11-01T01:00:00Z',
    },
    financials: null,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(
        String(url).endsWith('/invoice-adjustments/request')
          ? request
          : String(url).includes('/invoice-adjustments?')
            ? page([request])
            : page([]),
      ),
    );
  setApi(fetcher);
  render(<TenantAdjustmentPanel invoice={adjustmentInvoice} />);
  fireEvent.click(await screen.findByText('Xem yêu cầu của tôi'));
  await screen.findByText('Quyết định Owner: Không có sai lệch sau kiểm tra');
  expect(screen.queryByText('Phê duyệt điều chỉnh')).toBeNull();
});
it('Tenant retains visible excess after a downward paid adjustment without a refund success', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    json(
      String(url).endsWith('/payment')
        ? {
            invoiceId: 'bill',
            paymentStatus: 'Paid',
            outstandingAmount: '0',
            paidAmount: '100000',
            payableAmount: '90000',
            originalIssuedAmount: '100000',
            approvedAdjustmentTotal: '-10000',
            potentialExcessAmount: '10000',
            reviewStatus: 'PendingReview',
            history: [],
            dueDate: '2026-11-30',
            overdueDays: 0,
            pendingReview: true,
          }
        : { availability: 'Settled' },
    ),
  );
  setApi(fetcher);
  render(<TenantPaymentPanel invoiceId="bill" />);
  await screen.findByText(/Tiền thừa chờ xem xét: 10.000/);
  expect(screen.queryByText('Sao chép số tiền')).toBeNull();
  expect(screen.queryByText(/Hoàn tiền thành công/)).toBeNull();
});

it('uses server list, pagination and role navigation instead of preview work orders', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(
        page([{ ...task, title: String(url).includes('page=2') ? 'Trang hai' : task.title }], 21),
      ),
    );
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  expect(screen.queryByText(/CV-1042/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `Xem chi tiết: ${task.title}` }));
  expect(mocks.go).toHaveBeenCalledWith('task-detail', { taskId: id });
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await screen.findByText('Trang hai');
  expect(fetcher.mock.calls[1]![0]).toContain('page=2');
});
it('does not show stale records after a forbidden reload or failed filter', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(page([task])))
    .mockResolvedValueOnce(json({}, 403));
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại công việc' }));
  await screen.findByText(/Tài khoản không được phép/);
  expect(screen.queryByRole('button', { name: `Xem chi tiết: ${task.title}` })).toBeNull();
});
it('shows compact previews, optional result/evidence and the server overdue flag in Vietnam time', async () => {
  const result = 'Đã kiểm tra, chờ Owner đối chiếu';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      json(page([{ ...task, isOverdue: true, dueAt: '2026-11-03T09:21:00Z', result }])),
    );
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  expect(screen.getByText(task.requirements).getAttribute('data-lines')).toBe('2');
  expect(screen.getByText(/Kết quả gần nhất:/).parentElement?.getAttribute('data-lines')).toBe('1');
  expect(screen.getByText(/Quá hạn · 16:21.*03\/11\/2026/)).toBeTruthy();
  expect(screen.getByText('Cần ảnh minh chứng')).toBeTruthy();
  expect(screen.getByText('1 quá hạn')).toBeTruthy();
  expect(screen.queryByText(/currentResponsibleStaffUserId|version|AdHoc/)).toBeNull();
});
it('hides absent result and optional evidence metadata and routes meter tasks without a mutation', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json(page([{ ...task, kind: 'MeterReading', evidenceRequired: false }])));
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  expect(screen.queryByText(/Kết quả gần nhất/)).toBeNull();
  expect(screen.queryByText('Cần ảnh minh chứng')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: `Xem chi tiết: ${task.title}` }));
  expect(mocks.go).toHaveBeenCalledWith('meter-reading');
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('shows loading then an empty list without fabricating summary counts', async () => {
  let finish!: (response: Response) => void;
  setApi(
    vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  render(<OperationalTasksScreen />);
  expect(screen.getByText('Đang tải công việc…')).toBeTruthy();
  expect(screen.queryByText('0 công việc')).toBeNull();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  finish(json(page([])));
  await screen.findByText('Chưa có công việc được giao');
  expect(screen.getByText('0 công việc')).toBeTruthy();
});
it('filters on the server, resets pagination and clears the filter from an empty state', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(String(url).includes('status=Assigned') ? page([]) : page([task], 21)),
    );
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Trang công việc sau' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('tab', { name: 'Cần làm' }));
  await screen.findByText('Không có công việc phù hợp');
  expect(String(fetcher.mock.calls[2]![0])).toContain('page=1&pageSize=20&status=Assigned');
  expect(screen.queryByText(task.title)).toBeNull();
  expect(screen.getByRole('tab', { name: 'Cần làm' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByText('Xem tất cả'));
  await screen.findByText(task.title);
  expect(screen.getByRole('tab', { name: 'Tất cả' }).getAttribute('aria-selected')).toBe('true');
});
it('keeps loaded tasks during refresh, reports a transient failure and permits retry', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(page([task])))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(json(page([{ ...task, title: 'Danh sách đã cập nhật' }])));
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại công việc' }));
  expect(screen.getByText(task.title)).toBeTruthy();
  expect(screen.getByText('Đang cập nhật…')).toBeTruthy();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  finish(json({}, 503));
  await screen.findByText('Chưa cập nhật được danh sách');
  expect(screen.getByText(task.title)).toBeTruthy();
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText('Danh sách đã cập nhật');
  expect(screen.queryByText('Chưa cập nhật được danh sách')).toBeNull();
});
it('requires result and evidence before Staff submits, blocks duplicates, and uses the current version', async () => {
  let resolveMutation!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST')
      return new Promise((resolve) => {
        resolveMutation = resolve;
      });
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence'))
      return json([{ id: fileId, createdAt: '2026-11-01T00:00:00Z' }]);
    return json(task);
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật công việc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi kết quả' }));
  expect(
    (screen.getByRole('button', { name: 'Gửi Owner kiểm tra' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Kết quả thực hiện'), {
    target: { value: 'Đã kiểm tra' },
  });
  expect(
    (screen.getByRole('button', { name: 'Gửi Owner kiểm tra' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText('Dùng ảnh 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi Owner kiểm tra' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi Owner kiểm tra' }));
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({
    version: 7,
    note: 'Đã kiểm tra',
    evidenceIds: [fileId],
  });
  expect(new Headers(posts[0]![1]?.headers).get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/);
  expect(screen.queryByText('Máy chủ đã ghi nhận thao tác.')).toBeNull();
  await act(async () =>
    resolveMutation(
      json({ ...task, status: 'PendingVerification', version: 8, result: 'Đã kiểm tra' }),
    ),
  );
  await screen.findByText('Kết quả đã gửi');
  expect(getToastSnapshot().toast?.message).toBe('Đã gửi kết quả. Chờ Owner kiểm tra.');
  expect(screen.queryByRole('button', { name: 'Cập nhật công việc' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Thêm ảnh minh chứng' })).toBeNull();
});
it('retains the idempotency key after an uncertain mutation response and never claims success', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST') throw new MobileApiError(0, 'request_timeout');
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json([]);
    return json({ ...task, status: 'Assigned' });
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu công việc' }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Bắt đầu công việc' }),
  );
  await screen.findByText(/Kết quả lần gửi trước chưa được xác nhận/);
  await waitFor(() =>
    expect((screen.getByText('Thử lại thao tác') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText('Thử lại thao tác'));
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(new Headers(posts[0]![1]?.headers).get('Idempotency-Key')).toBe(
    new Headers(posts[1]![1]?.headers).get('Idempotency-Key'),
  );
  expect(screen.queryByText('Máy chủ đã ghi nhận thao tác.')).toBeNull();
});
it('starts an Assigned Staff task using the returned TaskView and hides upload until started', async () => {
  let current = {
    ...task,
    status: 'Assigned' as OperationalTask['status'],
    evidenceRequired: false,
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json([]);
    if (init?.method === 'POST') {
      current = { ...current, status: 'InProgress', version: 8 };
      return json(current);
    }
    return json(current);
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  expect(screen.queryByRole('button', { name: 'Thêm ảnh minh chứng' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu công việc' }));
  fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), {
    target: { value: 'Bắt đầu kiểm tra' },
  });
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Bắt đầu công việc' }),
  );
  await screen.findByText('Đang thực hiện');
  expect(screen.getByRole('button', { name: 'Cập nhật công việc' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thêm ảnh minh chứng' })).toBeTruthy();
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(String(post[0])).toContain('/start');
  expect(JSON.parse(post[1]!.body as string)).toEqual({
    version: 7,
    note: 'Bắt đầu kiểm tra',
    evidenceIds: [],
  });
});
it.each([
  ['progress', 'Cập nhật tiến độ', 'Nội dung cập nhật', 'Lưu tiến độ'],
  ['blockers', 'Báo vướng mắc', 'Mô tả khó khăn đang gặp', 'Gửi báo cáo'],
])(
  'saves %s in real history while preserving the backend result and status',
  async (action, label, field, button) => {
    let current = { ...task, result: 'Kết quả trước đó' };
    let changed = false;
    const note = 'Nội dung cập nhật thử nghiệm';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes('/history'))
        return json(
          page(changed ? [{ id: fileId, action, note, occurredAt: '2026-11-08T10:00:00Z' }] : []),
        );
      if (String(url).endsWith('/evidence')) return json([]);
      if (init?.method === 'POST') {
        changed = true;
        current = { ...current, version: 8 };
        return json(current);
      }
      return json(current);
    });
    setApi(fetcher);
    render(<OperationalTaskDetail />);
    await screen.findByText(task.title);
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật công việc' }));
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.change(screen.getByLabelText(field), { target: { value: note } });
    fireEvent.click(screen.getByRole('button', { name: button }));
    await screen.findByText(note);
    expect(screen.getByText('Đang thực hiện')).toBeTruthy();
    expect(screen.getByText('Kết quả trước đó')).toBeTruthy();
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(String(post[0])).toContain('/' + action);
  },
);
it('retains notes on 409, reloads version and requires explicit review before retry', async () => {
  let current = task;
  let attempts = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json([]);
    if (init?.method === 'POST') {
      attempts++;
      if (attempts === 1) {
        current = { ...current, version: 9 };
        return json({ code: 'stale_version' }, 409);
      }
      current = { ...current, version: 10 };
      return json(current);
    }
    return json(current);
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật công việc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật tiến độ' }));
  fireEvent.change(screen.getByLabelText('Nội dung cập nhật'), {
    target: { value: 'Giữ nội dung này' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ' }));
  await screen.findByText(/Công việc đã thay đổi/);
  expect((screen.getByLabelText('Nội dung cập nhật') as HTMLInputElement).value).toBe(
    'Giữ nội dung này',
  );
  expect(
    (screen.getByRole('button', { name: 'Xác nhận gửi lại' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra dữ liệu mới'));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Xác nhận gửi lại' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gửi lại' }));
  await waitFor(() => expect(attempts).toBe(2));
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(posts[1]![1]!.body as string)).toEqual({
    version: 9,
    note: 'Giữ nội dung này',
    evidenceIds: [],
  });
  expect(new Headers(posts[0]![1]?.headers).get('Idempotency-Key')).not.toBe(
    new Headers(posts[1]![1]?.headers).get('Idempotency-Key'),
  );
});
it('uploads raw bytes, reads the incremented version and attaches the returned ID to submit', async () => {
  let current = task;
  let uploaded = false;
  const file = {
    id: fileId,
    contentType: 'image/png',
    createdAt: '2026-11-08T10:00:00Z',
    submissionId: null,
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'PUT') {
      uploaded = true;
      current = { ...current, version: 8 };
      return json(file);
    }
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json(uploaded ? [file] : []);
    if (String(url).includes('/evidence/')) return new Response(new Uint8Array([137, 80, 78, 71]));
    if (init?.method === 'POST') {
      current = { ...current, status: 'PendingVerification', version: 9, result: 'Đã hoàn thành' };
      return json(current);
    }
    return json(current);
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh minh chứng' }));
  await waitFor(() => expect(getToastSnapshot().toast?.message).toBe('Đã tải ảnh minh chứng.'));
  const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(put[1]!.body).toBeInstanceOf(Uint8Array);
  expect(new Headers(put[1]!.headers).get('Content-Type')).toBe('image/jpeg');
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật công việc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi kết quả' }));
  fireEvent.change(screen.getByLabelText('Kết quả thực hiện'), {
    target: { value: 'Đã hoàn thành' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi Owner kiểm tra' }));
  await screen.findByText('Đã gửi kết quả. Đang chờ Chủ trọ xác nhận.');
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toEqual({
    version: 8,
    note: 'Đã hoàn thành',
    evidenceIds: [fileId],
  });
});
it('does not upload twice when refreshing TaskView fails after upload success', async () => {
  let uploaded = false;
  let readFailed = false;
  const file = { id: fileId, contentType: 'image/jpeg', createdAt: '2026-11-08T10:00:00Z' };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'PUT') {
      uploaded = true;
      return json(file);
    }
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json(uploaded ? [file] : []);
    if (String(url).includes('/evidence/')) return new Response(new Uint8Array([1]));
    if (uploaded && !readFailed) {
      readFailed = true;
      return json({}, 503);
    }
    return json({ ...task, version: uploaded ? 8 : 7 });
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh minh chứng' }));
  await screen.findByRole('button', { name: 'Thử lại tải ảnh' });
  expect(screen.queryByRole('button', { name: 'Cập nhật công việc' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại tải ảnh' }));
  await waitFor(() => expect(getToastSnapshot().toast?.message).toBe('Đã tải ảnh minh chứng.'));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
});
it.each(['PendingVerification', 'Completed', 'Cancelled', 'FutureStatus'])(
  'renders %s read-only without exposing enums or Staff mutation controls',
  async (status) => {
    setApi(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          json(
            String(url).includes('/history')
              ? page([])
              : String(url).endsWith('/evidence')
                ? []
                : { ...task, status, isOverdue: true, result: 'Kết quả Backend' },
          ),
        ),
    );
    render(<OperationalTaskDetail />);
    await screen.findByText(task.title);
    expect(screen.queryByRole('button', { name: 'Bắt đầu công việc' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cập nhật công việc' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm ảnh minh chứng' })).toBeNull();
    expect(screen.queryByText('FutureStatus')).toBeNull();
    if (status === 'PendingVerification') expect(screen.queryByText(/Quá hạn ·/)).toBeNull();
  },
);
it.each([{ responsibilityAvailable: false }, { currentResponsibleStaffUserId: 'other-staff' }])(
  'does not offer writes without current Staff responsibility: %j',
  async (patch) => {
    setApi(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          json(
            String(url).includes('/history')
              ? page([])
              : String(url).endsWith('/evidence')
                ? []
                : { ...task, ...patch },
          ),
        ),
    );
    render(<OperationalTaskDetail />);
    await screen.findByText(task.title);
    expect(screen.queryByRole('button', { name: 'Cập nhật công việc' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm ảnh minh chứng' })).toBeNull();
  },
);
it('retries an uncertain upload with the original bytes and idempotency key', async () => {
  const uploads: { key: string | null; bytes: number[] }[] = [];
  let uploaded = false;
  const file = { id: fileId, contentType: 'image/png', createdAt: '2026-11-08T10:00:00Z' };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'PUT') {
      uploads.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        bytes: Array.from(init.body as Uint8Array),
      });
      if (uploads.length === 1) throw new MobileApiError(0, 'request_timeout');
      uploaded = true;
      return json(file);
    }
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json(uploaded ? [file] : []);
    if (String(url).includes('/evidence/')) return new Response(new Uint8Array([1]));
    return json({ ...task, version: uploaded ? 8 : 7 });
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh minh chứng' }));
  await screen.findByRole('button', { name: 'Thử lại tải ảnh' });
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại tải ảnh' }));
  await waitFor(() => expect(getToastSnapshot().toast?.message).toBe('Đã tải ảnh minh chứng.'));
  expect(uploads).toHaveLength(2);
  expect(uploads[0]).toEqual(uploads[1]);
  expect(uploads[0]!.bytes).toEqual([137, 80, 78, 71]);
});
it('shows Owner verification only after server data loads and sends the matching version', async () => {
  mocks.role = 'Owner';
  mocks.actor = 'owner';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json([]);
    return json({ ...task, status: init?.method === 'POST' ? 'Completed' : 'PendingVerification' });
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.change(screen.getByLabelText('Thao tác'), { target: { value: 'verify' } });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  await screen.findByText('Máy chủ đã ghi nhận thao tác.');
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toContain('/verify');
  expect(JSON.parse(post[1]!.body as string).version).toBe(7);
});
it('rejects invalid task deep links before loading private data', () => {
  const fetcher = vi.fn<typeof fetch>();
  setApi(fetcher);
  mocks.taskId = '../other';
  render(<OperationalTaskDetail />);
  expect(screen.getByText(/Mã công việc không hợp lệ/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
it('renders Tenant contracts from the scoped endpoint without fetching Owner or Staff records', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    json(
      String(url).includes('/contracts?')
        ? page([
            {
              id,
              roomNumber: 'T.101',
              locationName: 'Cơ sở kiểm thử',
              status: 'Active',
              kind: 'MainTenancy',
              startDate: '2026-11-01',
              endDate: '2027-10-31',
              monthlyRent: '3000000',
            },
          ])
        : page([]),
    ),
  );
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Phòng T.101');
  expect(screen.getByText('Cơ sở kiểm thử')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Xem hợp đồng phòng này' }));
  expect(mocks.go).toHaveBeenCalledWith('contract', { contractId: id });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
    expect.arrayContaining([
      'https://api.example.invalid/api/v1/contracts?page=1&pageSize=20&status=Active',
      'https://api.example.invalid/api/v1/invoices?page=1&pageSize=20',
    ]),
  );
  expect(
    fetcher.mock.calls.every(
      ([url]) => !String(url).includes('/capture/') && !String(url).includes('/operational-tasks'),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả chức năng' }));
  expect(mocks.go).toHaveBeenLastCalledWith('tenant-features', { contractId: id });
  expect(screen.queryByRole('button', { name: 'Thanh toán' })).toBeNull();
  cleanup();
  render(<TenantFeaturesScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Thanh toán' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { focus: 'payment' });
  fireEvent.click(screen.getByRole('button', { name: 'Tạm trú VNeID' }));
  expect(mocks.go).toHaveBeenLastCalledWith('residence');
  expect(screen.queryByRole('button', { name: 'Phê duyệt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tiếp nhận người thuê' })).toBeNull();
});

it('shows an empty Tenant dashboard without preview contract or payment values', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(page([])));
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Chưa có hợp đồng đang hiệu lực.');
  expect(screen.queryByText(/5.420.000|Hoàng Tuấn Anh|Phòng 301/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Báo sự cố' }));
  expect(mocks.go).toHaveBeenLastCalledWith('incidents');
});
it('shows current invoice, backend payment status and confirmed utility quantities without initiating payment', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const month = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 7);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith('/payment')) return json({ paymentStatus: 'Paid', outstandingAmount: '0' });
    if (path.includes('/invoices?'))
      return json(
        page([
          {
            id,
            billingPeriod: month + '-01',
            status: 'Final',
            total: '4000000',
            lines: [
              { category: 'Electricity', meterReadingId: 'confirmed-electric', quantity: '42.5' },
              { category: 'Water', meterReadingId: 'confirmed-water', quantity: '3' },
            ],
          },
        ]),
      );
    if (path.includes('/notifications?'))
      return json(
        page([
          { id, title: 'Thông báo kiểm thử', summary: 'Không đưa nội dung dài lên dashboard' },
        ]),
      );
    return json(page([]));
  });
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Đã thanh toán');
  expect(screen.getByText((_, node) => node?.textContent === '42,5 kWh')).toBeTruthy();
  expect(screen.getByText((_, node) => node?.textContent === '3 m³')).toBeTruthy();
  expect(screen.getByText('Thông báo kiểm thử')).toBeTruthy();
  expect(
    fetcher.mock.calls.some(
      ([url]) => String(url).includes('/notifications?') && String(url).includes('unread=true'),
    ),
  ).toBe(true);
  expect(screen.queryByText('Không đưa nội dung dài lên dashboard')).toBeNull();
  expect(screen.queryByText('4.000.000 ₫')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem hóa đơn' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { invoiceId: id });
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('does not show an old invoice as this month or fabricate consumption', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(
        page(
          String(url).includes('/invoices?')
            ? [{ id, billingPeriod: '2024-10-01', total: '5420000', status: 'Final', lines: [] }]
            : [],
        ),
      ),
    );
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Chưa có hóa đơn tháng này.');
  expect(screen.queryByText(/5.420.000/)).toBeNull();
  expect(screen.queryByText('— kWh')).toBeNull();
  expect(screen.queryByText('— m³')).toBeNull();
  expect(screen.getAllByText('Chưa có chỉ số')).toHaveLength(2);
});
it('keeps Tenant preview free of fixture finance and preserves all feature destinations', () => {
  mocks.role = 'Tenant';
  render(<TenantDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả chức năng' }));
  expect(mocks.go).toHaveBeenLastCalledWith('tenant-features');
  cleanup();
  render(<TenantFeaturesScreen />);
  const destinations = [
    ['Báo sự cố', 'incidents'],
    ['Phòng của tôi', 'tenant-room'],
    ['Hợp đồng', 'contract'],
    ['Tạm trú VNeID', 'residence'],
    ['Lịch sử thanh toán', 'billing-history'],
    ['Yêu cầu của tôi', 'tenant-requests'],
    ['Bàn giao / Trả phòng', 'checklist'],
    ['Điện nước', 'tenant-meters'],
  ];
  for (const [label, destination] of destinations) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(mocks.go).toHaveBeenLastCalledWith(destination);
  }
  expect(screen.queryByText(/Hoàng Tuấn Anh|CCCD|5.420.000|105 kWh/)).toBeNull();
  expect(screen.queryByText('SỰ CỐ & HỖ TRỢ')).toBeNull();
  expect(screen.queryByText('THÔNG BÁO')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem yêu cầu hỗ trợ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Liên hệ Ban quản lý' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tài khoản và cài đặt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tất cả hợp đồng' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh hóa đơn' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { focus: 'adjustment' });
});
it('keeps notifications unread and shows rejection when the server refuses marking read', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? json({}, 403)
        : json(
            page([
              { id, taskId: id, event: 'rework', readAt: null, createdAt: '2026-11-01T00:00:00Z' },
            ]),
          ),
    );
  setApi(fetcher);
  render(<TaskNotificationsScreen />);
  await screen.findByText('Yêu cầu làm lại');
  fireEvent.click(screen.getByText('Đánh dấu đã đọc'));
  await screen.findByText(/Tài khoản không được phép/);
  expect(screen.getByText('Chưa đọc')).toBeTruthy();
  expect(mocks.go).not.toHaveBeenCalled();
});
it('creates a real task with Vietnam offset and rejects impossible calendar dates before mutation', async () => {
  mocks.role = 'Owner';
  const saved = vi.fn();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      json(init?.method === 'POST' ? task : [{ id, label: 'Cơ sở mẫu kiểm thử' }]),
    );
  setApi(fetcher);
  render(<TaskWorkForm onCancel={vi.fn()} onSaved={saved} />);
  await screen.findByText('Cơ sở mẫu kiểm thử');
  fireEvent.change(screen.getByLabelText('Cơ sở'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Tên công việc'), { target: { value: 'Kiểm tra' } });
  fireEvent.change(screen.getByLabelText('Yêu cầu & kết quả cần đạt'), {
    target: { value: 'Theo checklist' },
  });
  const date = screen.getByLabelText('Thời hạn (dd/MM/yyyy HH:mm, giờ Việt Nam)');
  fireEvent.change(date, { target: { value: '30/02/2027 09:00' } });
  fireEvent.click(screen.getByText('Lưu công việc'));
  expect(screen.getByText(/Nhập thời hạn/)).toBeTruthy();
  expect(saved).not.toHaveBeenCalled();
  fireEvent.change(date, { target: { value: '28/02/2027 09:00' } });
  fireEvent.click(screen.getByText('Lưu công việc'));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string).work.dueAt).toBe('2027-02-28T09:00:00+07:00');
});

it('validates password confirmation and keeps the session when the server rejects the change', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 400));
  setApi(fetcher);
  render(<AccountSecurityScreen />);
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
    target: { value: 'Synthetic-Old!2026' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  await screen.findByText(/Dữ liệu chưa hợp lệ/);
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it('clears password fields in the background and logs out only after a successful server change', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  setApi(fetcher);
  render(<AccountSecurityScreen />);
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
    target: { value: 'Synthetic-Old!2026' },
  });
  await act(async () => mocks.onStateChange?.('background'));
  expect((screen.getByLabelText('Mật khẩu hiện tại') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
    target: { value: 'Synthetic-Old!2026' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    currentPassword: 'Synthetic-Old!2026',
    newPassword: 'Synthetic-New!2026',
  });
  expect(mocks.replace).toHaveBeenCalledWith('/');
  expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).value).toBe('');
});

const tenantContract = {
  id,
  roomNumber: 'T.101',
  locationName: 'Cơ sở của tôi',
  status: 'Active',
  kind: 'Main',
  startDate: '2026-11-01',
  endDate: '2027-11-01',
  monthlyRent: '3000000',
};
const tenantRoomDetail = { ...tenantContract, requiredDeposit: '6000000', occupants: [] };
const tenantHandover = {
  status: 'Confirmed',
  tenantConfirmedAt: null,
  snapshot: {
    date: '2026-11-01',
    roomCondition: 'Hiện trạng đã ghi nhận',
    keysAndAccess: 'Hai chìa khóa',
    electricity: { value: '125.5' },
    water: { value: '32' },
    assets: [{ id: 'asset', name: 'Điều hòa', observedCondition: 'Hoạt động' }],
  },
};
it('loads My Room through authorized contracts and handover without requesting Staff capture data', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/contracts?')) return json(page([tenantContract]));
    if (path.endsWith('/handover')) return json(tenantHandover);
    return json({
      ...tenantRoomDetail,
      occupants: [{ id: 'occupant', label: 'Người cùng ở được cấp quyền', representative: false }],
      citizenIdentityNumber: 'PRIVATE-ID-MUST-NOT-RENDER',
    });
  });
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findByText('Điều hòa: Hoạt động');
  expect(screen.getByText('Người cùng ở được cấp quyền')).toBeTruthy();
  expect(screen.queryByText('PRIVATE-ID-MUST-NOT-RENDER')).toBeNull();
  fireEvent.click(screen.getByText('Xem biên bản bàn giao'));
  expect(mocks.go).toHaveBeenLastCalledWith('checklist', { contractId: id, section: 'handover' });
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/capture/'))).toBe(true);
});
it('renders the complete compact room summary without a selector or pagination for one contract', async () => {
  mocks.role = 'Tenant';
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contracts?')
          ? json(page([tenantContract]))
          : String(url).endsWith('/handover')
            ? json(tenantHandover)
            : json(tenantRoomDetail),
      ),
  );
  render(<TenantRoomScreen />);
  await screen.findByText('125.5 kWh');
  expect(screen.getByText('32 m³')).toBeTruthy();
  expect(screen.getByText(/^3\.000\.000\s₫$/)).toBeTruthy();
  expect(screen.getByText(/^6\.000\.000\s₫$/)).toBeTruthy();
  expect(screen.getAllByText('01/11/2026').length).toBeGreaterThan(0);
  expect(screen.getByText('Hai chìa khóa')).toBeTruthy();
  expect(screen.getByText('Chưa có thông tin người ở trong hợp đồng này.')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByText('Tải lại dữ liệu')).toBeNull();
  expect(screen.queryByLabelText('Trang hợp đồng sau')).toBeNull();
  fireEvent.click(screen.getByText('Xem chi tiết hợp đồng'));
  expect(mocks.go).toHaveBeenLastCalledWith('contract', { contractId: id, section: 'overview' });
});
it('turns only a handover 404 into absence after the selected contract was successfully loaded', async () => {
  mocks.role = 'Tenant';
  let resolveDetail!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes('/contracts?')) return json(page([tenantContract]));
    if (String(url).endsWith('/handover'))
      return json({ code: 'contract_resource_not_found' }, 404);
    return new Promise<Response>((resolve) => {
      resolveDetail = resolve;
    });
  });
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await waitFor(() => expect(resolveDetail).toBeDefined());
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/handover'))).toBe(false);
  await act(async () => resolveDetail(json(tenantRoomDetail)));
  await screen.findByText('Chưa có biên bản bàn giao');
  expect(screen.getByText('Biên bản sẽ hiển thị khi được tạo cho hợp đồng này.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
it.each([403, 404, 401])(
  'keeps contract lookup errors (%s) as errors and never reads handover',
  async (status) => {
    mocks.role = 'Tenant';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contracts?')
          ? json(page([tenantContract]))
          : json({ secret: 'PRIVATE' }, status),
      );
    setApi(fetcher);
    render(<TenantRoomScreen />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Chưa có biên bản bàn giao')).toBeNull();
    expect(screen.queryByText('PRIVATE')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/handover'))).toBe(false);
  },
);
it('requires an explicit choice for multiple contracts and never silently switches after removal', async () => {
  mocks.role = 'Tenant';
  const secondId = '00000000-0000-0000-0000-000000000002';
  const second = { ...tenantContract, id: secondId, startDate: '2026-10-01' };
  let items = [tenantContract, second];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes('/contracts?')) return json(page(items));
    if (String(url).endsWith('/handover')) return json(tenantHandover);
    const contractId = String(url).split('/').pop();
    return json({
      ...tenantRoomDetail,
      id: contractId,
      occupants: [
        {
          id: 'person',
          label: contractId === id ? 'Người hợp đồng A' : 'Người hợp đồng B',
          representative: true,
        },
      ],
    });
  });
  setApi(fetcher);
  render(<TenantRoomScreen />);
  const selector = await screen.findByLabelText('Chọn hợp đồng đang thuê');
  expect(fetcher.mock.calls.every(([url]) => String(url).includes('/contracts?'))).toBe(true);
  expect(screen.getByRole('option', { name: /01\/10\/2026/ })).toBeTruthy();
  fireEvent.change(selector, { target: { value: secondId } });
  await screen.findByText('Người hợp đồng B');
  fireEvent.click(screen.getByText('Xem chi tiết hợp đồng'));
  expect(mocks.go).toHaveBeenLastCalledWith('contract', {
    contractId: secondId,
    section: 'overview',
  });
  fireEvent.change(selector, { target: { value: id } });
  expect(screen.queryByText('Người hợp đồng B')).toBeNull();
  await screen.findByText('Người hợp đồng A');
  items = [second];
  await waitFor(() => expect(screen.queryByText('Đang tải bàn giao…')).toBeNull());
  fireEvent.click(screen.getByLabelText('Tải lại phòng của tôi'));
  await screen.findByText(/Hợp đồng đã chọn không còn trên trang này/);
  expect(screen.queryByText('Người hợp đồng B')).toBeNull();
  expect(screen.queryByText('Xem chi tiết hợp đồng')).toBeNull();
  fireEvent.change(screen.getByLabelText('Chọn hợp đồng đang thuê'), {
    target: { value: secondId },
  });
  await screen.findByText('Người hợp đồng B');
});
it.each([null, {}, { items: null }, page([{ ...tenantContract, id: '../invalid' }])])(
  'rejects an invalid list response without requesting a contract (%j)',
  async (payload) => {
    mocks.role = 'Tenant';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(payload));
    setApi(fetcher);
    render(<TenantRoomScreen />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Chưa có hợp đồng đang hiệu lực trên trang này.')).toBeNull();
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('/contracts?'))).toBe(true);
  },
);
it.each([
  null,
  { ...tenantRoomDetail, id: '00000000-0000-0000-0000-000000000002' },
  { ...tenantRoomDetail, occupants: {} },
])('rejects malformed or mismatched detail (%j) before handover', async (payload) => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes('/contracts?') ? json(page([tenantContract])) : json(payload),
    );
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findByRole('alert');
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/handover'))).toBe(false);
});
it('shows a retry for handover server errors and recovers without inventing data', async () => {
  mocks.role = 'Tenant';
  let failed = true;
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contracts?')
          ? json(page([tenantContract]))
          : String(url).endsWith('/handover')
            ? failed
              ? json({}, 503)
              : json(tenantHandover)
            : json(tenantRoomDetail),
      ),
  );
  render(<TenantRoomScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText('Chưa có biên bản bàn giao')).toBeNull();
  failed = false;
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText('125.5 kWh');
});
it('limits the asset preview and renders nullable occupants without inventing people', async () => {
  mocks.role = 'Tenant';
  const assets = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    name: `Tài sản ${index}`,
    observedCondition: 'Tốt',
  }));
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contracts?')
          ? json(page([tenantContract]))
          : String(url).endsWith('/handover')
            ? json({ ...tenantHandover, snapshot: { ...tenantHandover.snapshot, assets } })
            : json({ ...tenantRoomDetail, occupants: null }),
      ),
  );
  render(<TenantRoomScreen />);
  await screen.findByText('Tài sản 2: Tốt');
  expect(screen.queryByText('Tài sản 3: Tốt')).toBeNull();
  expect(screen.getByText('Xem thêm 5 tài sản trong biên bản.')).toBeTruthy();
  expect(screen.getByText('Chưa có thông tin người ở trong hợp đồng này.')).toBeTruthy();
});
it('does not load private room details when no active rental contract exists', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json(page([{ ...tenantContract, kind: 'Holding' }])));
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findByText('Chưa có hợp đồng đang hiệu lực trên trang này.');
  expect(fetcher.mock.calls.every(([url]) => String(url).includes('/contracts?'))).toBe(true);
});
it('shows a real empty Active page without requesting detail or handover', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(page([])));
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findByText('Chưa có hợp đồng đang hiệu lực trên trang này.');
  expect(fetcher.mock.calls.every(([url]) => String(url).includes('/contracts?'))).toBe(true);
});
it.each([403, 500])('does not convert a handover error %s into absence', async (status) => {
  mocks.role = 'Tenant';
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contracts?')
          ? json(page([tenantContract]))
          : String(url).endsWith('/handover')
            ? json({}, status)
            : json(tenantRoomDetail),
      ),
  );
  render(<TenantRoomScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText('Chưa có biên bản bàn giao')).toBeNull();
});
it('handles a malformed handover as an invalid response instead of crashing or making an empty record', async () => {
  mocks.role = 'Tenant';
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/contracts?')
          ? json(page([tenantContract]))
          : String(url).endsWith('/handover')
            ? json({ status: 'RAW_UNKNOWN', snapshot: {} })
            : json(tenantRoomDetail),
      ),
  );
  render(<TenantRoomScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText('RAW_UNKNOWN')).toBeNull();
  expect(screen.queryByText('Chưa có biên bản bàn giao')).toBeNull();
});
it('shows a compact network error and reloads all room queries from the header', async () => {
  mocks.role = 'Tenant';
  let offline = true;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (offline) throw new TypeError('SYNTHETIC-NETWORK-DETAIL');
    return String(url).includes('/contracts?')
      ? json(page([tenantContract]))
      : String(url).endsWith('/handover')
        ? json(tenantHandover)
        : json(tenantRoomDetail);
  });
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findByRole('alert', {}, { timeout: 3000 });
  expect(screen.queryByText('SYNTHETIC-NETWORK-DETAIL')).toBeNull();
  offline = false;
  fireEvent.click(screen.getByLabelText('Tải lại phòng của tôi'));
  await screen.findByText('125.5 kWh');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('uses compact pagination for larger results and keeps selection explicit on the next page', async () => {
  mocks.role = 'Tenant';
  const secondId = '00000000-0000-0000-0000-000000000002';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes('/contracts?'))
      return json({
        ...page([
          String(url).includes('page=2') ? { ...tenantContract, id: secondId } : tenantContract,
        ]),
        page: String(url).includes('page=2') ? 2 : 1,
        totalCount: 21,
      });
    if (String(url).endsWith('/handover')) return json(tenantHandover);
    return json(tenantRoomDetail);
  });
  setApi(fetcher);
  render(<TenantRoomScreen />);
  fireEvent.change(await screen.findByLabelText('Chọn hợp đồng đang thuê'), {
    target: { value: id },
  });
  await screen.findByText('125.5 kWh');
  fireEvent.click(screen.getByLabelText('Trang hợp đồng sau'));
  await screen.findByText(/Hợp đồng đã chọn không còn trên trang này/);
  expect(screen.getByText('Trang 2 / 2')).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/' + secondId))).toBe(false);
});
it('shows room authorization errors without exposing rejected private data', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes('/contracts?')
        ? json(page([tenantContract]))
        : json({ privateName: 'OTHER-TENANT-SECRET' }, 403),
    );
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findAllByText(/Tài khoản không được phép/);
  expect(screen.queryByText('OTHER-TENANT-SECRET')).toBeNull();
});
it('shows confirmed readings from a Draft invoice but never displays an OCR proposal', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    json(
      page([
        {
          id,
          roomNumber: 'T.101',
          locationName: 'Cơ sở của tôi',
          billingPeriod: '2026-11-01',
          status: 'Draft',
          lines: [
            {
              id: 'confirmed',
              category: 'Electricity',
              meterReadingId: 'reading',
              previousReading: '100',
              confirmedReading: '125.5',
              quantity: '25.5',
            },
            {
              id: 'proposal',
              category: 'Water',
              meterReadingId: null,
              proposedValue: '999999',
              confirmedReading: null,
              quantity: '999999',
            },
          ],
        },
      ]),
    ),
  );
  setApi(fetcher);
  render(<TenantMeterHistoryScreen />);
  await screen.findByText('Đã xác nhận: 125,5');
  expect(screen.getByText('Tiêu thụ: 25,5 kWh')).toBeTruthy();
  expect(screen.queryByText(/999999/)).toBeNull();
  expect(fetcher.mock.calls.every(([url]) => String(url).includes('/invoices?'))).toBe(true);
});
it('uses reporting lookups and submits the actual Tenant incident API', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST')
      return json({ incidentId: fileId, workOrderId: null, resourceId: null }, 201);
    if (String(url).includes('reporting-rooms'))
      return json(
        page([
          {
            roomId: id,
            roomNumber: 'T.101',
            locationId: id,
            locationName: 'Cơ sở của tôi',
          },
        ]),
      );
    return json(page([]));
  });
  setApi(fetcher);
  render(<TenantIncidentScreen />);
  await screen.findByText('Phòng T.101');
  fireEvent.change(screen.getByLabelText('Mô tả sự cố'), {
    target: { value: 'Ống nước bị vỡ trong phòng' },
  });
  fireEvent.click(screen.getByText('Gửi báo cáo'));
  await waitFor(() =>
    expect(mocks.go).toHaveBeenCalledWith('incident-detail', { incidentId: fileId }),
  );
  expect(
    fetcher.mock.calls.some(
      ([url, init]) => String(url).endsWith('/api/v1/incidents') && init?.method === 'POST',
    ),
  ).toBe(true);
});
it('loads real incident requests and preserves the adjustment destination', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(page([])));
  setApi(fetcher);
  render(<TenantRequestsScreen />);
  await screen.findByText('Không có báo cáo trong phạm vi và bộ lọc này.');
  fireEvent.click(screen.getByText('Yêu cầu điều chỉnh hóa đơn'));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { focus: 'adjustment' });
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/v1/incidents?'))).toBe(true);
});
it('uses the residence API empty state without unsupported draft fields', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(page([])));
  setApi(fetcher);
  render(<TenantResidenceScreen />);
  await screen.findByText('Chưa có hồ sơ theo dõi tạm trú.');
  expect(screen.queryByLabelText('Thông tin kết quả (bản nháp)')).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/v1/residence-tasks?'))).toBe(
    true,
  );
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('uses the account profile endpoint without exposing identifiers and confirms logout', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    json({
      roles: ['Tenant'],
      userId: 'PRIVATE-USER',
      fullName: 'Synthetic Tenant',
      phone: null,
      email: null,
      isActive: true,
      version: 'PRIVATE-VERSION',
      sessionId: 'PRIVATE-SESSION',
    }),
  );
  setApi(fetcher);
  render(<TenantProfileScreen />);
  await screen.findByText('Tài khoản đang hoạt động');
  expect(fetcher.mock.calls[0][0]).toBe('https://api.example.invalid/api/v1/account/profile');
  expect(screen.queryByText(/PRIVATE-USER|PRIVATE-SESSION|PRIVATE-VERSION/)).toBeNull();
  fireEvent.click(screen.getByText('Đăng xuất'));
  fireEvent.click(screen.getByText('Ở lại'));
  expect(mocks.logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Đăng xuất'));
  fireEvent.click(screen.getAllByText('Đăng xuất').at(-1)!);
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
  expect(mocks.replace).toHaveBeenCalledWith('/');
});
it('consolidates verified payment references and outstanding invoices without synthesizing payment', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).includes('/payment-history?')
      ? json(
          page([
            {
              id,
              invoiceId: id,
              roomNumber: 'T.101',
              locationId: id,
              roomId: id,
              verificationSource: 'OwnerBankStatement',
              locationName: 'Cơ sở của tôi',
              billingPeriod: '2026-11-01',
              amount: '100000',
              paidAt: '2026-11-01T01:00:00Z',
              paidBy: 'Người trả được cấp quyền',
              bankReference: 'BANK-VERIFIED-REF',
            },
          ]),
        )
      : json(
          page([
            {
              invoiceId: fileId,
              roomNumber: 'T.101',
              locationId: id,
              roomId: id,
              payableAmount: '300000',
              paymentStatus: 'Unpaid',
              locationName: 'Cơ sở của tôi',
              billingPeriod: '2026-11-01',
              outstandingAmount: '200000',
              paidAmount: '100000',
              dueDate: '2026-11-03',
              overdueDays: 1,
            },
          ]),
        ),
  );
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Khoản thanh toán phòng T.101, xem chi tiết' }),
  );
  expect(screen.getByText('Owner đối soát sao kê')).toBeTruthy();
  expect(screen.queryByText(/BANK-VERIFIED-REF/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Công nợ' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Công nợ phòng T.101, xem chi tiết' }));
  expect(screen.getAllByText('200.000 ₫', { exact: false }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('Xem hóa đơn'));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', {
    invoiceId: fileId,
    returnTo: 'billing-history',
    historyTab: 'outstanding',
  });
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('suppresses stale transfer instructions when the outstanding amount has changed', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    json(
      String(url).endsWith('/payment')
        ? {
            invoiceId: id,
            paymentStatus: 'Unpaid',
            payableAmount: '100000',
            outstandingAmount: '50000',
            paidAmount: '50000',
            dueDate: '2026-11-05',
            overdueDays: 0,
            history: [],
          }
        : {
            invoiceId: id,
            outstandingAmount: '100000',
            accountNumber: '123',
            accountHolder: 'Synthetic',
            bankIdentifier: 'TEST',
            transferDescription: 'Synthetic',
            availability: 'Available',
            qrImageDataUri: 'data:image/png;base64,old',
          },
    ),
  );
  setApi(fetcher);
  render(<TenantPaymentPanel invoiceId={id} />);
  await screen.findByText('Đã thanh toán một phần');
  fireEvent.click(screen.getByText('Xem QR thanh toán'));
  await screen.findByText(/Thông tin chuyển khoản đang thay đổi/);
  expect(screen.getByText(/Thông tin chuyển khoản đang thay đổi/)).toBeTruthy();
  expect(screen.queryByText('Sao chép số tiền')).toBeNull();
});
it('checks image content and size locally and preserves large monetary amounts exactly', () => {
  expect(validateTenantEvidence(new Uint8Array([1, 2, 3]))).toMatch(/JPEG hoặc PNG/);
  expect(validateTenantEvidence(new Uint8Array(5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
  expect(validateTenantEvidence(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('');
  expect(positiveAmount('0.00')).toBe(false);
  expect(sameAmount('9007199254740993.00', '9007199254740993')).toBe(true);
  expect(sameAmount('9007199254740993', '9007199254740992')).toBe(false);
});
it('clears earlier tenancy details immediately when the authenticated API changes', async () => {
  mocks.role = 'Tenant';
  const first = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).includes('/contracts?')
      ? json(page([tenantContract]))
      : String(url).endsWith('/handover')
        ? json(null)
        : json({
            ...tenantRoomDetail,
            occupants: [
              { id: 'private', label: 'Earlier account occupant', representative: false },
            ],
          }),
  );
  setApi(first);
  const view = render(<TenantRoomScreen />);
  await screen.findByText('Earlier account occupant');
  mocks.actor = 'new-tenant';
  setApi(vi.fn<typeof fetch>(() => new Promise(() => {})));
  view.rerender(<TenantRoomScreen />);
  expect(screen.queryByText('Earlier account occupant')).toBeNull();
  expect(screen.queryByText('Phòng T.101')).toBeNull();
});
it('prioritizes an older outstanding invoice using server debt data instead of hiding it behind this month', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/debts?'))
      return json(page([{ invoiceId: id, outstandingAmount: '75000', overdueDays: 4 }]));
    if (path.endsWith('/payment'))
      return json({
        paymentStatus: 'Unpaid',
        paidAmount: '25000',
        outstandingAmount: '75000',
        overdueDays: 4,
      });
    if (path.endsWith('/invoices/' + id))
      return json({
        id,
        billingPeriod: '2026-10-01',
        dueDate: '2026-10-31',
        total: '100000',
        status: 'Final',
        lines: [],
      });
    if (path.includes('/contracts?')) return json(page([tenantContract]));
    if (path.endsWith('/expiry-reminders')) return json([]);
    return json(page([]));
  });
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Đã thanh toán một phần');
  expect(screen.getByText('Hóa đơn tháng 10/2026')).toBeTruthy();
  expect(screen.getAllByText('Kỳ 10/2026')).toHaveLength(1);
  expect(screen.getAllByText('Quá hạn 4 ngày')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Thanh toán ngay' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { invoiceId: id });
});
it('does not send a Tenant notification into a Staff-only operational task screen', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) =>
    init?.method === 'POST'
      ? new Response(null, { status: 204 })
      : String(url).endsWith('/unread-count')
        ? json({ unreadCount: 1 })
        : String(url).endsWith('/target')
          ? json({ objectType: 'OperationalTask', objectId: id })
          : json(
              page([
                {
                  id,
                  category: 'Task',
                  title: 'Thông báo được cấp quyền',
                  relatedObjectType: 'OperationalTask',
                  relatedObjectId: id,
                  deliveryState: 'Unconfigured',
                  summary: 'Thông tin tối thiểu',
                  createdAt: '2026-11-01T01:00:00Z',
                  readAt: null,
                },
              ]),
            ),
  );
  setApi(fetcher);
  render(<NotificationsScreen />);
  await screen.findByText('Thông báo được cấp quyền');
  fireEvent.click(screen.getByRole('button', { name: 'Thông báo được cấp quyền' }));
  await waitFor(() =>
    expect(getToastSnapshot().toast?.message).toMatch(/chưa có màn hình chi tiết trên mobile/),
  );
  expect(mocks.go).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
});
it('opens the existing invoice selector for adjustment instead of a duplicate draft form', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(page([])));
  setApi(fetcher);
  render(<TenantInvoicesScreen intent="adjustment" />);
  await screen.findByText('Bạn chưa có hóa đơn.');
  expect(screen.getByText(/Chọn hóa đơn cần kiểm tra/)).toBeTruthy();
  expect(
    fetcher.mock.calls.every(
      ([url, init]) =>
        String(url).includes('/invoices?') && (!init?.method || init.method === 'GET'),
    ),
  ).toBe(true);
});
it('updates invoice selection when another authorized deep link is opened in the same route', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith('/invoices/' + id) || path.endsWith('/invoices/' + fileId))
      return json({
        ...adjustmentInvoice,
        id: path.endsWith(fileId) ? fileId : id,
        roomNumber: path.endsWith(fileId) ? 'ROOM-B' : 'ROOM-A',
        locationName: 'Cơ sở kiểm thử',
        billingPeriod: '2026-11-01',
        status: 'Draft',
        version: 1,
        total: '100000',
        dueDate: '2026-11-20',
        missingInputs: [],
        lines: [],
      });
    return json(page([]));
  });
  setApi(fetcher);
  const view = render(<TenantInvoicesScreen />);
  await screen.findByText(/Phòng ROOM-A/);
  mocks.invoiceId = fileId;
  view.rerender(<TenantInvoicesScreen />);
  expect(screen.queryByText(/Phòng ROOM-A/)).toBeNull();
  await screen.findByText(/Phòng ROOM-B/);
});

it('keeps Draft charges exact, distinguishes utility fields and flags a contradictory free label', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  const base = {
    chargeCode: 'TEST',
    policyId: null,
    policyVersion: null,
    rateDate: '2026-11-01',
    rate: '3500',
    quantity: '12.5',
    occupiedDays: 0,
    periodDays: 0,
    amount: '43750',
    meterReadingId: fileId,
    previousReading: '100',
    confirmedReading: '112.5',
    calculatedAmount: null,
    correctionRequestId: null,
  };
  const invoice = {
    ...adjustmentInvoice,
    id,
    status: 'Draft',
    missingInputs: ['WaterReading'],
    total: '9007199254740993',
    lines: [
      {
        ...base,
        id: 'rent',
        category: 'Rent',
        name: 'Thuê phòng theo hợp đồng',
        occupiedDays: 15,
        periodDays: 30,
      },
      { ...base, id: 'electric', category: 'Electricity', name: 'Điện sinh hoạt' },
      {
        ...base,
        id: 'water',
        category: 'Water',
        name: 'Nước sinh hoạt',
        previousReading: null,
        confirmedReading: null,
        meterReadingId: null,
      },
      { ...base, id: 'fee', category: 'ServiceFee', name: 'Internet miễn phí' },
    ],
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(String(url).endsWith('/invoices/' + id) ? invoice : page([])),
    );
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByText('Bản nháp');
  expect(screen.getByText('9.007.199.254.740.993 ₫', { exact: false })).toBeTruthy();
  expect(screen.getByText('15/30 ngày')).toBeTruthy();
  expect(screen.queryByText('Chỉ số cũ')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Điện sinh hoạt, xem chi tiết' }));
  expect(screen.getByText('12,5 kWh')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Nước sinh hoạt, xem chi tiết' }));
  expect(screen.getAllByText('Chưa có')).toHaveLength(2);
  expect(screen.getByText('12,5 m³')).toBeTruthy();
  expect(screen.queryByText('Chưa xác nhận')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Internet miễn phí, xem chi tiết' }));
  expect(screen.getAllByText('Internet miễn phí').length).toBeGreaterThan(0);
  expect(screen.getByText(/Tên khoản thu gợi ý không thu tiền/)).toBeTruthy();
  expect(screen.queryByText(/0\/0/)).toBeNull();
  expect(screen.queryByText('Đã thanh toán')).toBeNull();
  expect(screen.queryByText('Trang 1')).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/payment'))).toBe(false);
});

it('separates Final issuance from payment obligations, lazily loads QR and approved adjustments', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith('/invoices/' + id)) return json({ ...adjustmentInvoice, id });
    if (path.endsWith('/payment'))
      return json({
        invoiceId: id,
        paymentStatus: 'Unpaid',
        payableAmount: '90000',
        paidAmount: '20000',
        outstandingAmount: '70000',
        originalIssuedAmount: '100000',
        approvedAdjustmentTotal: '-10000',
        dueDate: '2026-11-01',
        overdueDays: 0,
        pendingReview: false,
        history: [],
      });
    if (path.includes(`/invoices/${id}/adjustments?`))
      return json(
        page([
          {
            id: 'effect',
            invoiceStatus: 'Final',
            delta: '-10000',
            decidedAt: '2026-11-01T00:00:00Z',
          },
        ]),
      );
    return json(page([]));
  });
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByText('Đã thanh toán một phần');
  expect(screen.getByText('Đã phát hành')).toBeTruthy();
  expect(screen.getByText('70.000 ₫', { exact: false })).toBeTruthy();
  expect(screen.getByText('Tổng hóa đơn')).toBeTruthy();
  expect(screen.queryByText('Tiền hóa đơn gốc')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/payment'))).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('transfer-instructions'))).toBe(
    false,
  );
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes(`/invoices/${id}/adjustments?`)),
  ).toHaveLength(1);
  fireEvent.click(screen.getByText('Chi tiết tài chính'));
  expect(screen.getByText('Tiền hóa đơn gốc')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Đã duyệt' }));
  await screen.findByText('Điều chỉnh sau phát hành');
  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  expect(screen.queryByText('Tải lại dữ liệu')).toBeNull();
});

it.each([null, {}, { ...adjustmentInvoice, id, lines: null }])(
  'rejects invalid invoice payload %# without rendering amounts',
  async (payload) => {
    mocks.role = 'Tenant';
    mocks.invoiceId = id;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(payload));
    setApi(fetcher);
    render(<TenantInvoicesScreen />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Tổng hóa đơn')).toBeNull();
    expect(screen.getByText('Thử lại')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('retries invoice network failure without retaining a fake zero amount', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  let online = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (!online) throw new TypeError('Network unavailable');
    return json(
      String(url).endsWith('/invoices/' + id)
        ? { ...adjustmentInvoice, id, status: 'Draft' }
        : page([]),
    );
  });
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText('0 ₫', { exact: false })).toBeNull();
  online = true;
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText('Bản nháp');
});

it('discloses each charge independently and uses authoritative usage even without a reading link', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  const base = {
    chargeCode: 'TEST',
    policyId: null,
    policyVersion: null,
    rateDate: '2026-11-01',
    rate: '3500',
    quantity: '7.75',
    occupiedDays: 0,
    periodDays: 0,
    amount: '20000',
    meterReadingId: null,
    previousReading: '100',
    confirmedReading: '900',
    calculatedAmount: null,
    correctionRequestId: null,
  };
  const invoice = {
    ...adjustmentInvoice,
    id,
    status: 'Draft',
    lines: [
      { ...base, id: 'usage', category: 'Electricity', name: 'Điện theo kỳ' },
      {
        ...base,
        id: 'missing',
        category: 'Water',
        name: 'Nước theo kỳ',
        quantity: null,
        previousReading: null,
        confirmedReading: null,
      },
      {
        ...base,
        id: 'rent',
        category: 'Rent',
        name: 'Phòng không thu tiền',
        occupiedDays: 30,
        periodDays: 30,
      },
    ],
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(String(url).endsWith('/invoices/' + id) ? invoice : page([])),
    );
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByText('Yêu cầu của tôi (0)');
  await screen.findByText('Đã duyệt (0)');
  expect(screen.queryByText('Chỉ số cũ')).toBeNull();
  const before = fetcher.mock.calls.length;
  const electricity = screen.getByRole('button', { name: 'Điện theo kỳ, xem chi tiết' });
  expect(electricity.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(electricity);
  expect(screen.getByText('7,75 kWh')).toBeTruthy();
  expect(screen.queryByText('800 kWh')).toBeNull();
  expect(screen.queryByText('Chưa xác nhận')).toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Nước theo kỳ, xem chi tiết' })
      .getAttribute('aria-expanded'),
  ).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Điện theo kỳ, thu gọn' }));
  expect(screen.queryByText('7,75 kWh')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Nước theo kỳ, xem chi tiết' }));
  expect(screen.getByText('Chưa có dữ liệu tiêu thụ')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Phòng không thu tiền, xem chi tiết' }));
  expect(screen.getByRole('alert').textContent).toContain('số tiền trả về lớn hơn 0');
  expect(screen.getAllByText('Tổng tạm tính')).toHaveLength(1);
  expect(fetcher.mock.calls).toHaveLength(before);
});

it('uses actual adjustment counts and pagination without refetching on inline tab changes', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    return json(
      path.includes('invoice-adjustments?')
        ? {
            ...page(
              [
                {
                  id: path.includes('page=2') ? 'second' : 'first',
                  status: 'Pending',
                  submittedAt: '2026-11-01T00:00:00Z',
                },
              ],
              21,
            ),
            page: path.includes('page=2') ? 2 : 1,
          }
        : page([]),
    );
  });
  setApi(fetcher);
  render(<TenantAdjustmentPanel invoice={adjustmentInvoice} />);
  await screen.findByText('Yêu cầu của tôi (21)');
  await screen.findByText('Đã duyệt (0)');
  expect(screen.getByRole('tab', { name: 'Yêu cầu của tôi' }).getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(screen.queryByRole('button', { name: 'Tải lại điều chỉnh' })).toBeNull();
  const before = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole('tab', { name: 'Đã duyệt' }));
  expect(screen.getByText('Chưa có điều chỉnh được duyệt.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Yêu cầu của tôi' }));
  expect(fetcher.mock.calls).toHaveLength(before);
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  await screen.findByText('Trang 2 / 2');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true);
});

const ledgerHistory = {
  id: 'allocation-one',
  invoiceId: id,
  locationId: id,
  roomId: id,
  locationName: 'Cơ sở thử nghiệm',
  roomNumber: 'P501',
  billingPeriod: '2026-11-01',
  amount: '100000',
  paidAt: '2026-11-07T01:00:00Z',
  paidBy: 'Khách thuê khác trong hóa đơn',
  verificationSource: 'OwnerBankStatement',
  bankReference: null,
  verifiedByUserId: null,
};
const ledgerDebt = {
  invoiceId: id,
  locationId: id,
  roomId: id,
  locationName: 'Cơ sở thử nghiệm',
  roomNumber: 'P501',
  billingPeriod: '2026-11-01',
  dueDate: '2026-11-20',
  overdueDays: 0,
  paymentStatus: 'Unpaid',
  payableAmount: '100000',
  paidAmount: '25000',
  outstandingAmount: '75000',
  originalIssuedAmount: '110000',
  approvedAdjustmentTotal: '-10000',
  potentialExcessAmount: '3000',
};
it('keeps empty ledger states small and reuses cached pages across tabs', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(page([])));
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  await screen.findByText('Chưa có thanh toán đã xác minh.');
  expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Công nợ' }));
  await screen.findByText('Không có hóa đơn còn nợ.');
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
  await screen.findByText('Chưa có thanh toán đã xác minh.');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Tải lại dữ liệu')).toBeNull();
  expect(mocks.setParams).toHaveBeenLastCalledWith({ historyTab: 'verified' });
});
it('opens a payment from its date without duplicating summary fields or suggesting a credit', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(page([ledgerHistory])));
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  const date = await screen.findByText('08:00 07/11/2026');
  expect(date.closest('button')?.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(date);
  expect(date.closest('button')?.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByText('08:00 07/11/2026')).toHaveLength(1);
  expect(screen.getAllByText(/Người trả:/)).toHaveLength(1);
  expect(screen.queryByText(/^\+/)).toBeNull();
  fireEvent.click(screen.getByText('Xem hóa đơn liên quan'));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', {
    invoiceId: id,
    returnTo: 'billing-history',
    historyTab: 'verified',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('uses one financial heading, compact invoice cards and lazy destinations with refreshed balances', async () => {
  mocks.role = 'Tenant';
  let settled = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    json(
      String(url).includes('/payment-invoices?')
        ? page([
            {
              ...ledgerDebt,
              invoiceId: 'bill',
              paidAmount: settled ? '100000' : '25000',
              outstandingAmount: settled ? '0' : '75000',
              paymentStatus: settled ? 'Paid' : 'Unpaid',
            },
          ])
        : page([adjustmentInvoice]),
    ),
  );
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByText('Đã thanh toán một phần');
  expect(screen.getAllByText('Hóa đơn & thanh toán')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /Xem hóa đơn phòng P101/ })).toBeTruthy();
  expect(screen.queryByText('Xem hóa đơn')).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => /payment-history|\/debts\?/.test(String(url)))).toBe(
    false,
  );
  settled = true;
  fireEvent.click(screen.getByLabelText('Tải lại hóa đơn'));
  await screen.findByText('Đã thanh toán');
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes('payment-invoices?')).length,
  ).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Công nợ' }));
  expect(mocks.go).toHaveBeenLastCalledWith('billing-history', { historyTab: 'outstanding' });
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }));
  expect(mocks.go).toHaveBeenLastCalledWith('billing-history', { historyTab: 'verified' });
});
it('keeps Final as issued and labels invoice totals when payment data is unavailable', async () => {
  mocks.role = 'Tenant';
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('payment-invoices?') ? json({}, 403) : json(page([adjustmentInvoice])),
      ),
  );
  render(<TenantInvoicesScreen />);
  await screen.findByText('Đã phát hành');
  await screen.findByRole('alert');
  expect(screen.getByText('Tổng hóa đơn')).toBeTruthy();
  expect(screen.queryByText('Đã thanh toán')).toBeNull();
  expect(screen.queryByText('Còn phải thanh toán')).toBeNull();
});
it('keeps separate allocations of the same invoice and hides private references on expansion', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    json(
      page([
        { ...ledgerHistory, bankReference: 'PRIVATE-REF', verifiedByUserId: 'PRIVATE-ID' },
        {
          ...ledgerHistory,
          id: 'allocation-two',
          amount: '50000',
          verificationSource: 'unknown-source',
        },
      ]),
    ),
  );
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  const rows = await screen.findAllByRole('button', {
    name: 'Khoản thanh toán phòng P501, xem chi tiết',
  });
  expect(rows).toHaveLength(2);
  fireEvent.click(rows[1]);
  expect(screen.getByText('Nguồn xác minh khác')).toBeTruthy();
  expect(screen.queryByText(/PRIVATE-|unknown-source/)).toBeNull();
  expect(screen.queryByText('Đã thanh toán')).toBeNull();
  fireEvent.click(screen.getByText('Xem hóa đơn liên quan'));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', {
    invoiceId: id,
    returnTo: 'billing-history',
    historyTab: 'verified',
  });
});
it.each([
  { ...ledgerDebt },
  {
    ...ledgerDebt,
    outstandingAmount: '0',
    paidAmount: '100000',
    paymentStatus: 'Paid',
    potentialExcessAmount: '0',
  },
  { ...ledgerDebt, overdueDays: 5 },
  {
    ...ledgerDebt,
    paidAmount: null,
    payableAmount: null,
    originalIssuedAmount: null,
    approvedAdjustmentTotal: null,
    potentialExcessAmount: null,
  },
])(
  'renders authoritative debt financials and null values without a global total %#',
  async (debt) => {
    mocks.role = 'Tenant';
    mocks.historyTab = 'outstanding';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(page([debt])));
    setApi(fetcher);
    render(<TenantPaymentHistoryScreen />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Công nợ phòng P501, xem chi tiết' }),
    );
    expect(screen.getByText('Số tiền phải thanh toán')).toBeTruthy();
    expect(screen.getByText('Điều chỉnh đã duyệt')).toBeTruthy();
    if (debt.payableAmount === null) expect(screen.getAllByText('Chưa có dữ liệu')).toHaveLength(5);
    if (debt.overdueDays > 0)
      expect(screen.getByText(`Quá hạn ${debt.overdueDays} ngày`)).toBeTruthy();
    else expect(screen.queryByText(/Quá hạn \d+ ngày/)).toBeNull();
    if (debt.potentialExcessAmount === '3000')
      expect(screen.getByText('Khoản thừa chưa phải tiền hoàn đã xác nhận.')).toBeTruthy();
    expect(screen.queryByText('Tổng công nợ')).toBeNull();
  },
);
it('applies server filters, resets pages and sorts only loaded data without requests', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const q = new URL(String(url)).searchParams;
    return json({
      ...page([{ ...ledgerHistory, id: `allocation-${q.get('page')}` }], 21),
      page: Number(q.get('page')),
    });
  });
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  await screen.findByRole('button', { name: 'Trang sau' });
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  await screen.findByText('Trang 2 / 2');
  fireEvent.click(screen.getByText('Bộ lọc'));
  fireEvent.change(screen.getByLabelText('Tháng'), { target: { value: '11' } });
  fireEvent.change(screen.getByLabelText('Phòng'), { target: { value: id } });
  fireEvent.click(screen.getByText('Áp dụng'));
  await screen.findByText('Trang 1 / 2');
  expect(
    fetcher.mock.calls.some(([url]) =>
      String(url).includes('page=1&pageSize=20&billingPeriod=2026-11-01&roomId=' + id),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByText('Bộ lọc •'));
  const before = fetcher.mock.calls.length;
  fireEvent.change(screen.getByLabelText('Sắp xếp'), { target: { value: 'amount' } });
  expect(screen.queryByText(/Chỉ trang đang xem/)).toBeNull();
  fireEvent.click(screen.getByText('Áp dụng'));
  expect(screen.getByText(/Chỉ trang đang xem/)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(before);
  fireEvent.click(screen.getByText('Bộ lọc •'));
  fireEvent.click(screen.getByText('Xóa bộ lọc'));
  await screen.findByText('Trang 1 / 2');
});
it.each([
  null,
  { items: {} },
  { ...page([ledgerHistory]), items: [{ ...ledgerHistory, amount: {} }] },
])('handles invalid ledger data without rendering financial records %#', async (body) => {
  mocks.role = 'Tenant';
  setApi(vi.fn<typeof fetch>().mockResolvedValue(json(body)));
  render(<TenantPaymentHistoryScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/Người trả:/)).toBeNull();
  expect(screen.getByText('Thử lại')).toBeTruthy();
});
it('clears ledger and room options immediately when the account changes', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'ledger-first';
  setApi(vi.fn<typeof fetch>().mockResolvedValue(json(page([ledgerHistory]))));
  const view = render(<TenantPaymentHistoryScreen />);
  await screen.findByText(/Phòng P501/);
  mocks.actor = 'ledger-second';
  setApi(vi.fn<typeof fetch>().mockImplementation(async () => new Promise(() => {})));
  view.rerender(<TenantPaymentHistoryScreen />);
  expect(screen.queryByText(/P501|Cơ sở thử nghiệm/)).toBeNull();
});
it('returns from invoice detail to the preceding ledger or a safe tab fallback', async () => {
  mocks.role = 'Tenant';
  mocks.invoiceId = id;
  mocks.returnTo = 'billing-history';
  mocks.historyTab = 'outstanding';
  mocks.canGoBack.mockReturnValue(true);
  setApi(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        json(
          String(url).endsWith('/invoices/' + id)
            ? { ...adjustmentInvoice, id, status: 'Draft' }
            : page([]),
        ),
      ),
  );
  render(<TenantInvoicesScreen />);
  await screen.findByText('Bản nháp');
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại lịch sử và công nợ' }));
  expect(mocks.back).toHaveBeenCalledOnce();
  mocks.canGoBack.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại lịch sử và công nợ' }));
  expect(mocks.go).toHaveBeenLastCalledWith('billing-history', { historyTab: 'outstanding' });
});

it('filters overdue debts on the server and clears the filter without a fake paid option', async () => {
  mocks.role = 'Tenant';
  mocks.historyTab = 'outstanding';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(page([ledgerDebt])));
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  await screen.findByText(/Phòng P501/);
  fireEvent.click(screen.getByText('Bộ lọc'));
  fireEvent.click(screen.getByLabelText('Chỉ hóa đơn quá hạn'));
  fireEvent.click(screen.getByText('Áp dụng'));
  await screen.findByText('Chỉ quá hạn');
  expect(
    fetcher.mock.calls.some(([url]) => String(url).endsWith('page=1&pageSize=20&overdueOnly=true')),
  ).toBe(true);
  expect(screen.queryByText('Đã thanh toán')).toBeNull();
});
it('hides previous records after refresh fails and recovers with retry', async () => {
  mocks.role = 'Tenant';
  let failing = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    if (failing) throw new TypeError('Offline');
    return json(page([ledgerHistory]));
  });
  setApi(fetcher);
  render(<TenantPaymentHistoryScreen />);
  await screen.findByText(/Phòng P501/);
  failing = true;
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại giao dịch' }));
  expect(screen.queryByText(/Phòng P501/)).toBeNull();
  await screen.findByRole('alert');
  failing = false;
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText(/Phòng P501/);
});
it('does not display forbidden response contents or send ledger calls for Staff', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json({ code: 'forbidden-private-code', items: [ledgerHistory] }, 403));
  setApi(fetcher);
  const view = render(<TenantPaymentHistoryScreen />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/P501|forbidden-private-code/)).toBeNull();
  mocks.role = 'Staff';
  fetcher.mockClear();
  view.rerender(<TenantPaymentHistoryScreen />);
  expect(screen.getByText(/không có quyền xem lịch sử/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps Home compact with four shortcuts and navigates to the catalog without replacing its data', () => {
  mocks.role = 'Tenant';
  render(<TenantDashboard contracts={[tenantContract]} />);
  for (const label of ['Phòng của tôi', 'Hóa đơn', 'Báo sự cố', 'Yêu cầu của tôi'])
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Hợp đồng' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Làm mới tổng quan' })).toBeNull();
  const room = screen.getByRole('button', { name: 'Xem hợp đồng phòng này' });
  const utilities = screen.getByText('Điện & nước');
  fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả chức năng' }));
  expect(mocks.go).toHaveBeenLastCalledWith('tenant-features', { contractId: tenantContract.id });
  expect(screen.getByRole('button', { name: 'Xem hợp đồng phòng này' })).toBe(room);
  expect(screen.getByText('Điện & nước')).toBe(utilities);
  expect(screen.queryByText('Chưa hỗ trợ gửi')).toBeNull();
  expect(screen.queryByText('Chưa có dữ liệu máy chủ')).toBeNull();
});
it('reuses the feature registry and exact contract intent on the dedicated catalog', () => {
  mocks.role = 'Tenant';
  render(<TenantFeatureDirectory all contractId={id} />);
  expect(screen.getAllByRole('button')).toHaveLength(11);
  fireEvent.click(screen.getByRole('button', { name: 'Hợp đồng' }));
  expect(mocks.go).toHaveBeenLastCalledWith('contract', { contractId: id });
  fireEvent.click(screen.getByRole('button', { name: 'Bàn giao / Trả phòng' }));
  expect(mocks.go).toHaveBeenLastCalledWith('checklist', { contractId: id });
  fireEvent.click(screen.getByRole('button', { name: 'Thanh toán' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { focus: 'payment' });
  fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh hóa đơn' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { focus: 'adjustment' });
  expect(
    screen.queryByText(/Chưa hỗ trợ gửi|Chưa lưu được kết quả|Chưa có dữ liệu máy chủ/),
  ).toBeNull();
});
it('avoids duplicate billing alerts while preserving actionable contract and adjustment notices', () => {
  mocks.role = 'Tenant';
  const invoice = {
    ...adjustmentInvoice,
    id,
    lines: [
      { id: 'e', category: 'Electricity', meterReadingId: 'verified', quantity: '0' },
      { id: 'w', category: 'Water', meterReadingId: null, quantity: '0' },
    ],
  } as unknown as typeof adjustmentInvoice;
  render(
    <TenantDashboard
      invoice={invoice}
      contracts={[tenantContract]}
      payment={{
        invoiceId: id,
        paymentStatus: 'Unpaid',
        payableAmount: '100000',
        paidAmount: '25000',
        outstandingAmount: '75000',
        overdueDays: 5,
        dueDate: '2026-11-02',
        transferReference: '',
        pendingReview: false,
        history: [],
      }}
      debt={{ ...ledgerDebt, invoiceId: id, overdueDays: 5 }}
      notices={
        [
          {
            id: 'billing',
            category: 'Invoice',
            title: 'Duplicate billing notice',
            relatedObjectId: id,
          },
          {
            id: 'adjustment',
            category: 'Adjustment',
            title: 'Có kết quả điều chỉnh',
            relatedObjectId: id,
          },
        ] as never
      }
      expiryNotices={[
        {
          id: 'expiry',
          contractId: tenantContract.id,
          roomNumber: 'P1',
          locationName: 'Test',
          endDate: '2026-12-01',
          stage: 'Upcoming',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ]}
    />,
  );
  expect(screen.queryByText('Duplicate billing notice')).toBeNull();
  expect(screen.getAllByText('Quá hạn 5 ngày')).toHaveLength(1);
  expect(screen.getByText((_, node) => node?.textContent === '0 kWh')).toBeTruthy();
  expect(screen.getByText('Chưa có chỉ số')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Có kết quả điều chỉnh' }));
  expect(mocks.go).toHaveBeenLastCalledWith('notifications');
  fireEvent.click(screen.getByRole('button', { name: 'Cần xem hạn hợp đồng' }));
  expect(mocks.go).toHaveBeenLastCalledWith('contract', { contractId: tenantContract.id });
  fireEvent.click(screen.getByRole('button', { name: 'Thanh toán ngay' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { invoiceId: id });
});
it('retains Draft and error states without fabricating payment or reintroducing overview refresh', () => {
  mocks.role = 'Tenant';
  const reload = vi.fn();
  render(
    <TenantDashboard
      invoice={{ ...adjustmentInvoice, status: 'Draft' }}
      invoiceState={{ loading: false, error: 'offline', reload }}
    />,
  );
  expect(screen.getByText('Chưa phát hành')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Thanh toán ngay' })).toBeNull();
  expect(screen.queryByText('Thông tin cần chú ý')).toBeNull();
  fireEvent.click(screen.getByText('Thử lại'));
  expect(reload).toHaveBeenCalledOnce();
  expect(screen.queryByText('Làm mới tổng quan')).toBeNull();
});
it('mounts Tenant Home without redundant initial focus requests', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(String(url).endsWith('expiry-reminders') ? [] : page([])),
    );
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Chưa có hóa đơn tháng này.');
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/contracts?'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả chức năng' }));
  expect(fetcher).toHaveBeenCalledTimes(5);
});
