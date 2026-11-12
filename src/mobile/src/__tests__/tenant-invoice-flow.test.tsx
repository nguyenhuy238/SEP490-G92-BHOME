// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MobileApi } from '../lib/api';
import type { TenantMeterReading } from '../../../../packages/client-core/src/tenantReadings';
import { TenantInvoicesScreen } from '../screens/TenantInvoicesScreen';
import { TenantMeterHistoryScreen } from '../screens/TenantMeterHistoryScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { NotificationBadge } from '../components/NotificationBadge';

vi.mock('../components/IncidentEvidencePicker', () => ({
  IncidentEvidencePicker: () => null,
  incidentPhotoUri: () => '',
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: () => null,
}));

const mocks = vi.hoisted(() => ({
  role: 'Tenant',
  userId: 'tenant-1',
  api: null as MobileApi | null,
  go: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  setParams: vi.fn(),
  canGoBack: vi.fn(() => false),
  copy: vi.fn<(text: string) => Promise<boolean>>(async () => true),
  expired: vi.fn(),
  invoiceId: undefined as string | undefined,
  roomId: undefined as string | undefined,
  historyTab: undefined as string | undefined,
  returnTo: undefined as string | undefined,
  focus: undefined as string | undefined,
  view: undefined as string | undefined,
  newRequest: undefined as string | undefined,
}));

type Children = { children?: React.ReactNode };

vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: mocks.api,
    session: { userId: mocks.userId, roles: [mocks.role] },
  }),
}));

vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    role: mocks.role,
    preview: null,
    go: mocks.go,
    requestNavigation: (action: () => void) => action(),
  }),
}));

vi.mock('expo-router', () => ({
  router: {
    push: mocks.push,
    replace: mocks.replace,
    setParams: mocks.setParams,
    canGoBack: mocks.canGoBack,
    back: mocks.back,
  },
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  useLocalSearchParams: () => ({
    invoiceId: mocks.invoiceId,
    roomId: mocks.roomId,
    historyTab: mocks.historyTab,
    returnTo: mocks.returnTo,
    focus: mocks.focus,
    view: mocks.view,
    newRequest: mocks.newRequest,
  }),
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: (text: string) => mocks.copy(text),
}));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  StyleSheet: { create: (styles: unknown) => styles },
  Platform: { OS: 'ios' },
  View: ({
    children,
    accessibilityLabel,
    accessibilityRole,
  }: Children & { accessibilityLabel?: string; accessibilityRole?: string }) => (
    <div aria-label={accessibilityLabel} role={accessibilityRole}>
      {children}
    </div>
  ),
  ScrollView: ({ children }: Children) => <div>{children}</div>,
  RefreshControl: ({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) => (
    <button aria-label="Kéo để tải lại" disabled={refreshing} onClick={onRefresh} />
  ),
  Image: ({
    source,
    accessibilityLabel,
  }: {
    source?: { uri?: string };
    accessibilityLabel?: string;
  }) => <img alt={accessibilityLabel ?? 'Ảnh kết quả'} src={source?.uri} />,
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
    refreshControl,
  }: {
    data: { id: string }[];
    renderItem: (info: { item: { id: string } }) => React.ReactNode;
    keyExtractor: (item: { id: string }) => string;
    ListHeaderComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    refreshControl?: React.ReactNode;
  }) => (
    <div data-testid="virtual-list">
      {ListHeaderComponent}
      {refreshControl}
      {data.length
        ? data.map((item) => <div key={keyExtractor(item)}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));

vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Icon: () => null,
  Surface: ({ children }: Children) => <div>{children}</div>,
  Text: ({ children, accessibilityRole }: Children & { accessibilityRole?: string }) => (
    <span role={accessibilityRole}>{children}</span>
  ),
  Badge: ({ children, accessibilityLabel }: Children & { accessibilityLabel?: string }) => (
    <span aria-label={accessibilityLabel}>{children}</span>
  ),
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
  }: Children & {
    onPress?: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { expanded?: boolean; selected?: boolean };
  }) => (
    <button
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-expanded={accessibilityState?.expanded}
      aria-selected={accessibilityState?.selected}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  IconButton: ({
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} />,
  TouchableRipple: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
  }: Children & {
    onPress?: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { expanded?: boolean; selected?: boolean };
  }) => (
    <button
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-expanded={accessibilityState?.expanded}
      aria-selected={accessibilityState?.selected}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
    <span role="progressbar" aria-label={accessibilityLabel} />
  ),
  Menu: Object.assign(
    ({ anchor, visible, children }: Children & { anchor: React.ReactNode; visible: boolean }) => (
      <>
        {anchor}
        {visible && <div role="menu">{children}</div>}
      </>
    ),
    {
      Item: ({ title, onPress }: { title: string; onPress: () => void }) => (
        <button role="menuitem" onClick={onPress}>
          {title}
        </button>
      ),
    },
  ),
}));

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const caches: MobileApi[] = [];
const invoiceId = '11111111-1111-4111-8111-111111111111';
const secondInvoiceId = '22222222-2222-4222-8222-222222222222';
const roomId = '33333333-3333-4333-8333-333333333333';
const locationId = '44444444-4444-4444-8444-444444444444';
const readingId = '55555555-5555-4555-8555-555555555555';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const page = <T,>(items: T[], totalCount = items.length, pageNumber = 1, pageSize = 20) => ({
  items,
  totalCount,
  page: pageNumber,
  pageSize,
});

function setApi(fetcher: Mock<Transport>) {
  const api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-token',
    async () => undefined,
    mocks.expired,
    fetcher as typeof fetch,
  );
  caches.push(api);
  mocks.api = api;
  return api;
}

const sampleLines = [
  {
    id: 'line-rent',
    category: 'Rent',
    chargeCode: 'RENT',
    name: 'Tiền thuê phòng tháng 11',
    policyId: null,
    policyVersion: 1,
    rateDate: '2026-11-01',
    rate: '3500000',
    quantity: '1',
    occupiedDays: 30,
    periodDays: 30,
    amount: '3500000',
    meterReadingId: null,
    previousReading: null,
    confirmedReading: null,
    calculatedAmount: null,
    correctionRequestId: null,
  },
  {
    id: 'line-elec',
    category: 'Electricity',
    chargeCode: 'ELEC',
    name: 'Tiền điện sinh hoạt',
    policyId: null,
    policyVersion: 2,
    rateDate: '2026-11-01',
    rate: '3500',
    quantity: '120',
    occupiedDays: 30,
    periodDays: 30,
    amount: '420000',
    meterReadingId: readingId,
    previousReading: '1000',
    confirmedReading: '1120',
    calculatedAmount: null,
    correctionRequestId: null,
  },
  {
    id: 'line-water',
    category: 'Water',
    chargeCode: 'WATER',
    name: 'Tiền nước sinh hoạt',
    policyId: null,
    policyVersion: 1,
    rateDate: '2026-11-01',
    rate: '15000',
    quantity: '8',
    occupiedDays: 30,
    periodDays: 30,
    amount: '120000',
    meterReadingId: readingId,
    previousReading: '50',
    confirmedReading: '58',
    calculatedAmount: null,
    correctionRequestId: null,
  },
  {
    id: 'line-fee',
    category: 'ServiceFee',
    chargeCode: 'WIFI',
    name: 'Phí Internet & vệ sinh',
    policyId: null,
    policyVersion: 1,
    rateDate: '2026-11-01',
    rate: '150000',
    quantity: '1',
    occupiedDays: 30,
    periodDays: 30,
    amount: '150000',
    meterReadingId: null,
    previousReading: null,
    confirmedReading: null,
    calculatedAmount: null,
    correctionRequestId: null,
  },
  {
    id: 'line-other',
    category: 'Other',
    chargeCode: 'PARKING',
    name: 'Phí gửi xe máy',
    policyId: null,
    policyVersion: 1,
    rateDate: '2026-11-01',
    rate: '100000',
    quantity: '1',
    occupiedDays: 30,
    periodDays: 30,
    amount: '100000',
    meterReadingId: null,
    previousReading: null,
    confirmedReading: null,
    calculatedAmount: null,
    correctionRequestId: null,
  },
];

const baseInvoice = {
  id: invoiceId,
  roomId,
  locationId,
  roomNumber: 'P202',
  locationName: 'Cơ sở Quận 7',
  billingPeriod: '2026-11-01',
  status: 'Draft' as const,
  version: 1,
  total: '4290000',
  missingInputs: [] as string[],
  scheduledFinalDate: '2026-11-05',
  dueDate: '2026-11-15',
  finalizedAt: null as string | null,
  representativeTenantUserId: 'tenant-1',
  lines: sampleLines,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'Tenant';
  mocks.userId = 'tenant-1';
  mocks.invoiceId = undefined;
  mocks.roomId = undefined;
  mocks.historyTab = undefined;
  mocks.returnTo = undefined;
  mocks.focus = undefined;
  mocks.view = undefined;
  mocks.newRequest = undefined;
});

afterEach(() => {
  cleanup();
  caches.forEach((api) => api.queryCache.dispose());
  caches.length = 0;
});

describe('Tenant Invoice, VietQR Payment & Notification Flow', () => {
  it('Test 1 & 2: displays confirmed periodic electricity & water readings and distinguishes missing baseline vs confirmed consumption', async () => {
    mocks.roomId = roomId;
    const electricity: TenantMeterReading = {
      id: readingId,
      roomId,
      roomNumber: 'P202',
      locationName: 'Cơ sở Quận 7',
      meterCode: 'ELEC-P202',
      utilityType: 'Electricity',
      purpose: 'Periodic',
      readingDate: '2026-11-01',
      billingPeriod: '2026-11-01',
      previousValue: '1000',
      confirmedValue: '1120',
      consumption: '120',
      confirmedAt: '2026-11-01T03:00:00Z',
      status: 'Confirmed',
    };
    const readings: TenantMeterReading[] = [
      electricity,
      {
        ...electricity,
        id: secondInvoiceId,
        meterCode: 'WATER-P202',
        utilityType: 'Water',
        previousValue: '50',
        confirmedValue: '58',
        consumption: '8',
      },
      {
        ...electricity,
        id: locationId,
        purpose: 'Initial',
        billingPeriod: null,
        previousValue: null,
        confirmedValue: '1000',
        consumption: null,
      },
    ];
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      expect(String(url)).toBe(
        `https://api.example.invalid/api/v1/tenant/meter-readings?page=1&pageSize=20&roomId=${roomId}`,
      );
      return json(page(readings));
    });
    setApi(fetcher);
    render(<TenantMeterHistoryScreen />);

    expect(await screen.findAllByText('Ngày đo: 01/11/2026 · Kỳ 2026-11')).toHaveLength(2);
    expect(screen.getByText('Chỉ số trước: 1.000')).toBeTruthy();
    expect(screen.getByText('Đã xác nhận: 1.120')).toBeTruthy();
    expect(screen.getByText('Tiêu thụ: 120 kWh')).toBeTruthy();
    expect(screen.getByText('Chỉ số trước: 50')).toBeTruthy();
    expect(screen.getByText('Đã xác nhận: 58')).toBeTruthy();
    expect(screen.getByText('Tiêu thụ: 8 m³')).toBeTruthy();
    expect(screen.getByText('Chỉ số trước: Chưa có')).toBeTruthy();
    expect(screen.getByText('Tiêu thụ: Chỉ số mốc')).toBeTruthy();

    fireEvent.click(screen.getByText('Xem hóa đơn và thanh toán'));
    expect(mocks.go).toHaveBeenCalledWith('billing-history');
  });

  it('Test 3: renders Draft Invoice with full charge breakdown (Rent, Electricity, Water, ServiceFee, Other) and hides VietQR payment', async () => {
    mocks.invoiceId = invoiceId;
    const draftInvoice = {
      ...baseInvoice,
      status: 'Draft' as const,
      missingInputs: ['confirmed_reading_Water'],
    };
    const fetcher = vi
      .fn<Transport>()
      .mockImplementation(async (url) =>
        json(String(url).endsWith(`/invoices/${invoiceId}`) ? draftInvoice : page([])),
      );
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    await screen.findByText('Bản nháp');
    expect(screen.getByText(/Hóa đơn tạm tính — đang chờ phát hành/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Chỉ số nước hợp lệ đã xác nhận');
    expect(screen.getAllByText('Tổng tạm tính')).toHaveLength(2);
    expect(screen.getAllByText('4.290.000 ₫')).toHaveLength(2);

    // Expand Electricity, Water, and Other charges to verify breakdown
    fireEvent.click(screen.getByRole('button', { name: 'Tiền điện sinh hoạt, xem chi tiết' }));
    expect(screen.getByText('1.000')).toBeTruthy();
    expect(screen.getByText('1.120')).toBeTruthy();
    expect(screen.getByText('120 kWh')).toBeTruthy();
    expect(screen.getByText('3.500 đ/kWh')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Phí gửi xe máy, xem chi tiết' }));
    expect(screen.getByText('100.000 đ')).toBeTruthy();

    // Draft invoice must NOT request or display VietQR or payment panel
    expect(screen.queryByText('Xem mã QR thanh toán')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/payment'))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/transfer-instructions'))).toBe(
      false,
    );
  });

  it('Test 4: renders Final Invoice with payable/paid/outstanding amounts, real VietQR image, and bank transfer copy actions', async () => {
    mocks.invoiceId = invoiceId;
    const finalInvoice = {
      ...baseInvoice,
      status: 'Final' as const,
      finalizedAt: '2026-11-05T03:00:00Z',
    };
    const qrDataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith(`/invoices/${invoiceId}`)) return json(finalInvoice);
      if (path.endsWith(`/invoices/${invoiceId}/payment`))
        return json({
          invoiceId,
          paymentStatus: 'Unpaid',
          payableAmount: '4290000',
          paidAmount: '1000000',
          outstandingAmount: '3290000',
          dueDate: '2026-11-15',
          overdueDays: 0,
          pendingReview: false,
          history: [],
        });
      if (path.endsWith(`/invoices/${invoiceId}/transfer-instructions`))
        return json({
          invoiceId,
          availability: 'Available',
          outstandingAmount: '3290000',
          bankIdentifier: 'VCB - Vietcombank',
          accountNumber: '0123456789',
          accountHolder: 'CONG TY BHOME',
          transferDescription: 'BHOME P202 T11',
          qrImageDataUri: qrDataUri,
        });
      return json(page([]));
    });
    setApi(fetcher);
    const { rerender } = render(<TenantInvoicesScreen />);

    await screen.findByText('Đã thanh toán một phần');
    expect(screen.getByText('Đã phát hành')).toBeTruthy();
    expect(screen.getByText('3.290.000 ₫')).toBeTruthy();

    expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/transfer-instructions'))).toBe(
      false,
    );
    fireEvent.click(screen.getByText('Xem mã QR thanh toán'));
    expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId, view: 'payment' });
    mocks.view = 'payment';
    rerender(<TenantInvoicesScreen />);
    const qrImg = await screen.findByAltText('QR chuyển khoản hóa đơn');
    expect(qrImg.getAttribute('src')).toBe(qrDataUri);
    expect(screen.getByText(/VCB - Vietcombank/)).toBeTruthy();
    expect(screen.getByText(/0123456789/)).toBeTruthy();
    expect(screen.getByText(/CONG TY BHOME/)).toBeTruthy();
    expect(screen.getByText(/BHOME P202 T11/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Sao chép số tài khoản'));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('0123456789'));

    fireEvent.click(screen.getByLabelText('Sao chép số tiền'));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('3290000'));

    fireEvent.click(screen.getByLabelText('Sao chép nội dung chuyển khoản'));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('BHOME P202 T11'));
  });

  it('Test 5: handles Tenant invoice & meter notifications (INVOICE_FINALIZED & METER_READING_CONFIRMED), marks read, and navigates via authorized target', async () => {
    const notifications = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        category: 'Invoice',
        title: 'Hóa đơn đã phát hành',
        summary: 'Phòng P202 kỳ 2026-11: 4.290.000 đ, hạn thanh toán 15/11/2026.',
        createdAt: '2026-11-05T03:00:00Z',
        readAt: null as string | null,
        relatedObjectType: 'Invoice',
        relatedObjectId: invoiceId,
        deliveryState: 'InApp',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        category: 'Invoice',
        title: 'Chỉ số điện/nước đã được xác nhận',
        summary: 'Phòng P202 (Điện) kỳ 2026-11: 1120.',
        createdAt: '2026-11-04T03:00:00Z',
        readAt: null as string | null,
        relatedObjectType: 'Room',
        relatedObjectId: roomId,
        deliveryState: 'InApp',
      },
    ];
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/unread-count'))
        return json({ unreadCount: notifications.filter((n) => !n.readAt).length });
      if (path.endsWith('/read')) {
        const found = notifications.find((n) => path.includes(n.id));
        if (found) found.readAt = '2026-11-05T04:00:00Z';
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/target')) {
        const isFirst = path.includes(notifications[0].id);
        return json({
          objectType: isFirst ? 'Invoice' : 'Room',
          objectId: isFirst ? invoiceId : roomId,
        });
      }
      if (path.includes('/api/v1/notifications')) return json(page(notifications));
      return json(page([]));
    });
    setApi(fetcher);
    render(
      <>
        <NotificationBadge />
        <NotificationsScreen />
      </>,
    );

    await screen.findByText('Chưa đọc (2)');
    expect(screen.getByLabelText('2 thông báo chưa đọc')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Hóa đơn đã phát hành/ }));
    await waitFor(() => expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId }));
    await screen.findByText('Chưa đọc (1)');

    fireEvent.click(screen.getByRole('button', { name: /Chỉ số điện\/nước đã được xác nhận/ }));
    await waitFor(() => expect(mocks.go).toHaveBeenCalledWith('tenant-meters', { roomId }));
    await screen.findByText('Chưa đọc (0)');
  });

  it('Test 6: reflects verified full payment, hides active VietQR, and filters multi-invoice list by status', async () => {
    const first = { ...baseInvoice, id: invoiceId, status: 'Final' as const, roomNumber: 'P202' };
    const second = {
      ...baseInvoice,
      id: secondInvoiceId,
      status: 'Final' as const,
      roomNumber: 'P202',
      billingPeriod: '2026-10-01',
      total: '3500000',
    };
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes('/payment-invoices?'))
        return json(
          page([
            {
              invoiceId,
              paymentStatus: 'Unpaid',
              outstandingAmount: '1290000',
              paidAmount: '3000000',
              dueDate: '2026-11-15',
              overdueDays: 0,
            },
            {
              invoiceId: secondInvoiceId,
              paymentStatus: 'Paid',
              outstandingAmount: '0',
              paidAmount: '3500000',
              dueDate: '2026-10-15',
              overdueDays: 0,
            },
          ]),
        );
      return json(page([first, second]));
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    await screen.findByText('1 hóa đơn cần thanh toán · 1.290.000 ₫');
    expect(screen.getByText('Tổng hóa đơn: 4.290.000 ₫')).toBeTruthy();

    // Filter by Paid
    fireEvent.click(screen.getByRole('tab', { name: 'Lọc hóa đơn: Đã thanh toán' }));
    expect(screen.getByText('Kỳ 10/2026')).toBeTruthy();
    expect(screen.queryByText('Kỳ 11/2026')).toBeNull();

    // Filter by Unpaid
    fireEvent.click(screen.getByRole('tab', { name: 'Lọc hóa đơn: Chưa thanh toán' }));
    expect(screen.getByText('Kỳ 11/2026')).toBeTruthy();
    expect(screen.queryByText('Kỳ 10/2026')).toBeNull();
  });

  it('Test 7: enforces Tenant access control on 403/404 without leaking unauthorized invoice data', async () => {
    mocks.invoiceId = secondInvoiceId;
    const fetcher = vi
      .fn<Transport>()
      .mockResolvedValue(json({ code: 'forbidden_room', secretTenantName: 'DO_NOT_LEAK' }, 403));
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Tài khoản không được phép thực hiện thao tác này.');
    expect(screen.queryByText(/DO_NOT_LEAK|forbidden_room/)).toBeNull();
    expect(screen.queryByText('Tổng hóa đơn')).toBeNull();
  });
});

const finalPayment = {
  invoiceId,
  paymentStatus: 'Unpaid',
  payableAmount: '4280000',
  paidAmount: '1000000',
  outstandingAmount: '3280000',
  originalIssuedAmount: '4290000',
  approvedAdjustmentTotal: '-10000',
  dueDate: '2026-11-15',
  overdueDays: 0,
  pendingReview: false,
  history: [],
};
function redesignApi(payment: unknown = finalPayment, paymentStatus = 200) {
  return vi.fn<Transport>().mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith(`/invoices/${invoiceId}`)) return json({ ...baseInvoice, status: 'Final' });
    if (path.endsWith('/payment')) return json(payment, paymentStatus);
    if (path.includes('/invoice-adjustments?'))
      return json(
        page([
          {
            id: 'request-1',
            status: 'Rejected',
            submittedAt: '2026-11-10T00:00:00Z',
            reason: 'PRIVATE LONG ADJUSTMENT REASON',
          },
        ]),
      );
    return json(page([]));
  });
}
describe('Compact invoice detail navigation and financial safety', () => {
  it('hides cached QR during refresh and waits for the server before showing Paid', async () => {
    mocks.invoiceId = invoiceId;
    mocks.view = 'payment';
    let pending = false;
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith(`/invoices/${invoiceId}`)) return json({ ...baseInvoice, status: 'Final' });
      if (path.endsWith('/payment')) {
        if (pending)
          return new Promise<Response>((resolve) => {
            complete = resolve;
          });
        return json(finalPayment);
      }
      if (path.endsWith('/transfer-instructions'))
        return json({
          invoiceId,
          availability: 'Available',
          outstandingAmount: '3280000',
          bankIdentifier: '970416',
          accountNumber: '0000001234',
          accountHolder: 'SYNTHETIC TEST',
          transferDescription: 'BH12345678',
          qrImageDataUri: 'data:image/png;base64,synthetic',
        });
      return json(page([]));
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);
    await screen.findByAltText('QR chuyển khoản hóa đơn');
    pending = true;
    fireEvent.click(screen.getByText('Cập nhật trạng thái'));
    expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
    expect(screen.queryByText('Đã thanh toán')).toBeNull();
    await waitFor(() => expect(complete).toBeTypeOf('function'));
    complete(
      json({
        ...finalPayment,
        paymentStatus: 'Paid',
        paidAmount: finalPayment.payableAmount,
        outstandingAmount: '0',
      }),
    );
    await screen.findByText('Đã thanh toán');
    expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
  });
  it('keeps financial breakdown and full adjustment history off the main detail until requested', async () => {
    mocks.invoiceId = invoiceId;
    const fetcher = redesignApi();
    setApi(fetcher);
    render(<TenantInvoicesScreen />);
    await screen.findByText('Đã thanh toán một phần');
    await screen.findByText('1 yêu cầu');
    expect(screen.getByText('Đã từ chối')).toBeTruthy();
    expect(screen.queryByText('PRIVATE LONG ADJUSTMENT REASON')).toBeNull();
    expect(screen.queryByText('Tiền hóa đơn gốc')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Yêu cầu của tôi' })).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/adjustments?'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết thanh toán' }));
    expect(screen.getByText('Tiền hóa đơn gốc')).toBeTruthy();
    expect(screen.getByText('−10.000 ₫')).toBeTruthy();
    expect(screen.getByText('1.000.000 ₫')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu điều chỉnh' }));
    expect(mocks.go).toHaveBeenCalledWith('adjustment', { invoiceId, newRequest: 'true' });
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
      true,
    );
  });
  it.each([false, true])(
    'uses backend overdue days only when there is unpaid balance (paid=%s)',
    async (paid) => {
      mocks.invoiceId = invoiceId;
      setApi(
        redesignApi({
          ...finalPayment,
          paymentStatus: paid ? 'Paid' : 'Unpaid',
          outstandingAmount: paid ? '0' : '3280000',
          overdueDays: 83,
        }),
      );
      render(<TenantInvoicesScreen />);
      await screen.findByText(paid ? 'Đã thanh toán' : 'Đã thanh toán một phần');
      expect(!!screen.queryByText('Quá hạn 83 ngày')).toBe(!paid);
      expect(!!screen.queryByText('Xem mã QR thanh toán')).toBe(!paid);
    },
  );
  it('keeps issued invoice visible without inventing payment state after a payment API failure', async () => {
    mocks.invoiceId = invoiceId;
    setApi(redesignApi({ code: 'forbidden' }, 403));
    render(<TenantInvoicesScreen />);
    await screen.findByRole('alert');
    expect(screen.getByText('Đã phát hành')).toBeTruthy();
    expect(screen.queryByText('Chưa thanh toán')).toBeNull();
    expect(screen.queryByText('Xem mã QR thanh toán')).toBeNull();
    expect(screen.queryByText('0 ₫')).toBeNull();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  });
  it('returns from payment to the existing invoice via stack back', async () => {
    mocks.invoiceId = invoiceId;
    mocks.view = 'payment';
    mocks.canGoBack.mockReturnValueOnce(true);
    setApi(redesignApi({ ...finalPayment, paymentStatus: 'Paid', outstandingAmount: '0' }));
    render(<TenantInvoicesScreen />);
    fireEvent.click(await screen.findByLabelText('Quay lại chi tiết hóa đơn'));
    expect(mocks.back).toHaveBeenCalled();
    expect(mocks.go).not.toHaveBeenCalled();
  });
});
