vi.mock('../../../src/mobile/src/components/IncidentEvidencePicker', () => ({
  IncidentEvidencePicker: () => null,
  incidentPhotoUri: () => '',
}));
// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi, MobileApiError } from '../../../src/mobile/src/lib/api';
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
  copy: vi.fn(),
}));
type Children = { children?: React.ReactNode };
type Button = Children & { onPress: () => void; disabled?: boolean };
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: mocks.replace },
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  useLocalSearchParams: () => ({ taskId: mocks.taskId, invoiceId: mocks.invoiceId }),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mocks.copy(...args) }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  Platform: { OS: 'ios' },
  View: ({ children }: Children) => <div>{children}</div>,
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
  IconButton: ({
    onPress,
    accessibilityLabel,
  }: {
    onPress: () => void;
    accessibilityLabel: string;
  }) => <button onClick={onPress} aria-label={accessibilityLabel} />,
  ProgressBar: () => null,
  useTheme: () => ({ colors: { surface: '#fff', onSurfaceVariant: '#64748b' } }),
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  Text: ({ children }: Children) => <span>{children}</span>,
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
    label === 'Chụp ảnh bằng chứng điều chỉnh' ? (
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
import { AccountSecurityScreen } from '../../../src/mobile/src/screens/AccountSecurityScreen';
import { TenantInvoicesScreen } from '../../../src/mobile/src/screens/TenantInvoicesScreen';
import {
  TenantPaymentPanel,
  TenantPaymentHistoryScreen,
} from '../../../src/mobile/src/screens/TenantPaymentPanel';
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
        },
      ]),
    );
  });
  setApi(fetcher);
  render(<NotificationsScreen />);
  await screen.findByText('Hóa đơn tự động tổng hợp');
  fireEvent.click(screen.getByText('Mở hồ sơ liên quan'));
  await waitFor(() => expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId: id }));
  expect(
    fetcher.mock.calls.some(
      ([url, init]) => String(url).endsWith('/read') && init?.method === 'POST',
    ),
  ).toBe(true);
});
it('does not open or mark a notification when its target permission was revoked', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).endsWith('/target')
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
            },
          ]),
        ),
  );
  setApi(fetcher);
  render(<NotificationsScreen />);
  await screen.findByText('Tác vụ tổng hợp');
  fireEvent.click(screen.getByText('Mở hồ sơ liên quan'));
  await screen.findByText(/Tài nguyên không khả dụng/);
  expect(mocks.go).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
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
  let settled = false;
  const instructions = {
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
    json(
      String(url).endsWith('/payment')
        ? {
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
  render(<TenantPaymentPanel invoiceId={id} />);
  await screen.findByText('Tài khoản tổng hợp demo. Không chuyển tiền thật.');
  fireEvent.click(screen.getByText('Sao chép số tiền'));
  await screen.findByText('Đã sao chép.');
  expect(mocks.copy).toHaveBeenCalledWith('100000', { android: { isSensitive: true } });
  settled = true;
  fireEvent.click(screen.getByText('Tải lại dữ liệu'));
  await screen.findByText('Đã thanh toán');
  await screen.findByText('Người trả: Khách thuê khác trong hóa đơn');
  expect(screen.queryByText('Sao chép số tiền')).toBeNull();
  expect(fetcher.mock.calls.every((call) => !call[1]?.method || call[1].method === 'GET')).toBe(
    true,
  );
});

it('Tenant reads persisted invoice consumption and amount without a fake payment state', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const invoice = {
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
        paymentStatus: 'Unpaid',
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
      return json(page([{ invoiceId: 'bill', paymentStatus: 'Unpaid' }]));
    if (route.includes('/invoice-adjustments') || route.includes('/adjustments?'))
      return json(page([]));
    return json(route.includes('/invoices/bill') ? invoice : page([invoice]));
  });
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByText('Phòng P101 · 2026-10');
  fireEvent.click(screen.getByText('Xem hóa đơn'));
  await screen.findByText('Điện tổng hợp');
  expect(screen.getByText('Tiêu thụ: 25,5 kWh')).toBeTruthy();
  expect(screen.getByText(/Chỉ số trước: 100/)).toBeTruthy();
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
  render(<TenantInvoicesScreen />);
  fireEvent.click(await screen.findByText('Xem hóa đơn'));
  await screen.findByText(/Tài nguyên không khả dụng/);
  expect(screen.queryByText('Tổng tiền hóa đơn')).toBeNull();
  expect(screen.getByText('Về danh sách hóa đơn')).toBeTruthy();
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
  fireEvent.click(screen.getByText('Yêu cầu điều chỉnh'));
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
  fireEvent.click(screen.getByText('Xem chi tiết & cập nhật'));
  expect(mocks.go).toHaveBeenCalledWith('task-detail', { taskId: id });
  fireEvent.click(screen.getByText('Sau'));
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
  fireEvent.click(screen.getByText('Tải lại dữ liệu'));
  expect(screen.queryByText(task.title)).toBeNull();
  await screen.findByText(/Tài khoản không được phép/);
  expect(screen.queryByText('Xem chi tiết & cập nhật')).toBeNull();
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
  fireEvent.change(screen.getByLabelText('Thao tác'), { target: { value: 'submit' } });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  expect(screen.getByText(/Nhập kết quả/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kết quả / Nội dung / Lý do'), {
    target: { value: 'Đã kiểm tra' },
  });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  expect(screen.getByText(/Chọn ít nhất một ảnh/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Dùng ảnh 1 cho lần gửi này'));
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
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
    resolveMutation(json({ ...task, status: 'PendingVerification', version: 8 })),
  );
  await screen.findByText('Máy chủ đã ghi nhận thao tác.');
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
  fireEvent.change(screen.getByLabelText('Thao tác'), { target: { value: 'start' } });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  await screen.findByText(/15 giây/);
  await waitFor(() =>
    expect((screen.getByText('Xác nhận thao tác') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(new Headers(posts[0]![1]?.headers).get('Idempotency-Key')).toBe(
    new Headers(posts[1]![1]?.headers).get('Idempotency-Key'),
  );
  expect(screen.queryByText('Máy chủ đã ghi nhận thao tác.')).toBeNull();
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
  await screen.findByText('Phòng T.101 · Cơ sở kiểm thử');
  fireEvent.click(screen.getByRole('button', { name: 'Xem hợp đồng phòng này' }));
  expect(mocks.go).toHaveBeenCalledWith('contract', { contractId: id });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
    expect.arrayContaining([
      'https://api.example.invalid/api/v1/contracts?page=1&pageSize=5&status=Active',
      'https://api.example.invalid/api/v1/invoices?page=1&pageSize=20',
    ]),
  );
  expect(
    fetcher.mock.calls.every(
      ([url]) => !String(url).includes('/capture/') && !String(url).includes('/operational-tasks'),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả chức năng' }));
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
  await screen.findByText(
    'Chưa có hợp đồng đang hiệu lực. Bạn vẫn có thể xem các hồ sơ được cấp quyền.',
  );
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
  expect(screen.getByText('42,5 kWh')).toBeTruthy();
  expect(screen.getByText('3 m³')).toBeTruthy();
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
  expect(screen.getAllByText('Chưa có dữ liệu')).toHaveLength(2);
});
it('keeps Tenant preview free of fixture finance and preserves all feature destinations', () => {
  mocks.role = 'Tenant';
  render(<TenantDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả chức năng' }));
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
it('loads My Room through authorized contracts and handover without requesting Staff capture data', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes('/contracts?')) return json(page([tenantContract]));
    if (path.endsWith('/handover'))
      return json({
        status: 'Confirmed',
        snapshot: {
          date: '2026-11-01',
          roomCondition: 'Hiện trạng đã ghi nhận',
          assets: [{ id: 'asset', name: 'Điều hòa', observedCondition: 'Hoạt động' }],
        },
      });
    return json({
      ...tenantContract,
      occupants: [{ id: 'occupant', label: 'Người cùng ở được cấp quyền', representative: false }],
      citizenIdentityNumber: 'PRIVATE-ID-MUST-NOT-RENDER',
    });
  });
  setApi(fetcher);
  render(<TenantRoomScreen />);
  await screen.findByText('Điều hòa: Hoạt động');
  expect(screen.getByText('Người cùng ở được cấp quyền')).toBeTruthy();
  expect(screen.queryByText('PRIVATE-ID-MUST-NOT-RENDER')).toBeNull();
  fireEvent.click(screen.getByText('Xem và xác nhận bàn giao / trả phòng'));
  expect(mocks.go).toHaveBeenLastCalledWith('checklist', { contractId: id });
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/capture/'))).toBe(true);
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
      return json({ incidentId: 'new-server-incident', workOrderId: null, resourceId: null });
    if (String(url).includes('reporting-rooms'))
      return json(
        page([
          {
            roomId: id,
            roomNumber: 'T.101',
            locationId: 'location-tenant',
            locationName: 'Cơ sở của tôi',
          },
        ]),
      );
    return json(page([]));
  });
  setApi(fetcher);
  render(<TenantIncidentScreen />);
  await screen.findByRole('option', { name: 'Phòng T.101 · Cơ sở của tôi' });
  fireEvent.change(screen.getByLabelText('Phòng / cơ sở của bạn'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Mô tả sự cố (10–8000 ký tự)'), {
    target: { value: 'Ống nước bị vỡ trong phòng' },
  });
  fireEvent.click(screen.getByText('Gửi báo cáo sự cố'));
  await waitFor(() =>
    expect(mocks.go).toHaveBeenCalledWith('incident-detail', { incidentId: 'new-server-incident' }),
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
it('provides external residence guidance without pretending to save a result', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json(page([tenantContract])));
  setApi(fetcher);
  render(<TenantResidenceScreen />);
  await screen.findByRole('option', { name: 'Phòng T.101 · Cơ sở của tôi' });
  fireEvent.change(screen.getByLabelText('Thông tin kết quả (bản nháp)'), {
    target: { value: 'Đã có kết quả bên ngoài' },
  });
  expect(screen.getByText(/BHOME không nộp hồ sơ/)).toBeTruthy();
  expect(screen.queryByText(/Đã lưu kết quả|Đăng ký thành công/)).toBeNull();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('uses account identity without exposing identifiers or offering unsupported profile mutations', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      json({ roles: ['Tenant'], userId: 'PRIVATE-USER', sessionId: 'PRIVATE-SESSION' }),
    );
  setApi(fetcher);
  render(<TenantProfileScreen />);
  await screen.findByText('Đã xác thực tài khoản');
  expect(screen.queryByText(/PRIVATE-USER|PRIVATE-SESSION/)).toBeNull();
  fireEvent.click(screen.getByText('Đăng xuất tài khoản'));
  fireEvent.click(screen.getByText('Ở lại'));
  expect(mocks.logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Đăng xuất tài khoản'));
  fireEvent.click(screen.getByText('Đăng xuất'));
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
  await screen.findByText('Mã giao dịch: BANK-VERIFIED-REF');
  fireEvent.change(screen.getByLabelText('Thông tin thanh toán'), {
    target: { value: 'outstanding' },
  });
  await screen.findByText(/Còn phải trả: 200.000/);
  fireEvent.click(screen.getByText('Mở hóa đơn và thanh toán'));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { invoiceId: fileId });
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('suppresses stale transfer instructions when the outstanding amount has changed', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    json(
      String(url).endsWith('/payment')
        ? {
            paymentStatus: 'Unpaid',
            outstandingAmount: '50000',
            paidAmount: '50000',
            dueDate: '2026-11-05',
            overdueDays: 0,
            history: [],
          }
        : {
            outstandingAmount: '100000',
            accountNumber: '123',
            availability: 'Available',
            qrImageDataUri: 'data:image/png;base64,old',
          },
    ),
  );
  setApi(fetcher);
  render(<TenantPaymentPanel invoiceId={id} />);
  await screen.findByText('Đã thanh toán một phần');
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
            ...tenantContract,
            occupants: [{ id: 'private', label: 'Earlier account occupant' }],
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
  expect(screen.getByText('Hóa đơn cần thanh toán')).toBeTruthy();
  expect(screen.getAllByText('Kỳ 10/2026')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Thanh toán' }));
  expect(mocks.go).toHaveBeenLastCalledWith('invoice', { invoiceId: id });
});
it('does not send a Tenant notification into a Staff-only operational task screen', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).endsWith('/target')
      ? json({ objectType: 'OperationalTask', objectId: id })
      : json(
          page([
            {
              id,
              category: 'Task',
              title: 'Thông báo được cấp quyền',
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
  fireEvent.click(screen.getByText('Mở hồ sơ liên quan'));
  await screen.findByText(/chưa có màn hình chi tiết dành cho khách thuê/);
  expect(mocks.go).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
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
  await screen.findByText('Phòng ROOM-A · Kỳ 2026-11');
  mocks.invoiceId = fileId;
  view.rerender(<TenantInvoicesScreen />);
  expect(screen.queryByText('Phòng ROOM-A · Kỳ 2026-11')).toBeNull();
  await screen.findByText('Phòng ROOM-B · Kỳ 2026-11');
});
