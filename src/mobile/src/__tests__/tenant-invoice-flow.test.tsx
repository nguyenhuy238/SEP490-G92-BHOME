// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MobileApi } from '../lib/api';
import type { TenantMeterReading } from '../../../../packages/client-core/src/tenantReadings';
import { TenantInvoicesScreen } from '../features/tenant/billing/TenantInvoicesScreen';
import { TenantMeterHistoryScreen } from '../features/tenant/room/TenantMeterHistoryScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { NotificationBadge } from '../components/NotificationBadge';

vi.mock('../components/IncidentEvidencePicker', () => ({
  IncidentEvidencePicker: () => null,
  incidentPhotoUri: () => '',
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: () => null,
}));
vi.mock('../components/ToastHost', () => ({ ToastHost: () => null }));

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
  settlementContractId: undefined as string | undefined,
  settlementChargeId: undefined as string | undefined,
  newRequest: undefined as string | undefined,
  rawViewText: vi.fn(),
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
    settlementContractId: mocks.settlementContractId,
    settlementChargeId: mocks.settlementChargeId,
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
  }: Children & { accessibilityLabel?: string; accessibilityRole?: string }) => {
    React.Children.toArray(children).forEach((item) => {
      if (typeof item === 'string') mocks.rawViewText(item);
    });
    return (
      <div aria-label={accessibilityLabel} role={accessibilityRole}>
        {children}
      </div>
    );
  },
  ScrollView: ({ children }: Children) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: Children) => <div>{children}</div>,
  Modal: ({ children, visible }: Children & { visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
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
  Portal: Object.assign(({ children }: Children) => <>{children}</>, {
    Host: ({ children }: Children) => <>{children}</>,
  }),
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    disabled,
  }: {
    accessibilityLabel?: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  Checkbox: {
    Item: ({ label, status, onPress }: { label: string; status: string; onPress: () => void }) => (
      <input type="checkbox" aria-label={label} checked={status === 'checked'} onChange={onPress} />
    ),
  },
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

const currentPeriod = (hasInvoice: boolean, draftDates: string[] = []) => ({
  billingPeriod: '2026-11-01',
  businessDate: '2026-11-26',
  hasInvoice,
  draftDates,
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
  mocks.settlementContractId = undefined;
  mocks.settlementChargeId = undefined;
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
    expect(screen.getByText(/Dự kiến phát hành:/)).toBeTruthy();
    expect(screen.queryByText(/Còn thiếu:/)).toBeNull();
    expect(
      screen.queryByText(`Phòng ${draftInvoice.roomNumber} · ${draftInvoice.locationName}`),
    ).toBeNull();
    expect(screen.getByText('Chưa có chỉ số đã xác nhận')).toBeTruthy();
    expect(screen.queryByText('Chưa tính')).toBeNull();
    expect(screen.getAllByText('Tổng tạm tính')).toHaveLength(2);
    expect(screen.getAllByText('4.290.000 ₫')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Tiền thuê phòng tháng 11, xem chi tiết' }));
    expect(screen.queryByText('Ngày tính tiền')).toBeNull();
    expect(screen.queryByText('Áp dụng từ')).toBeNull();

    // Expand Electricity, Water, and Other charges to verify breakdown
    fireEvent.click(screen.getByRole('button', { name: 'Tiền điện sinh hoạt, xem chi tiết' }));
    expect(screen.getByText('1.000 kWh')).toBeTruthy();
    expect(screen.getByText('1.120 kWh')).toBeTruthy();
    expect(screen.getByText('120 kWh')).toBeTruthy();
    expect(screen.getByText('3.500 đ/kWh')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tiền nước sinh hoạt, xem chi tiết' }));
    expect(screen.getByText('50 m³')).toBeTruthy();
    expect(screen.getByText('58 m³')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Phí gửi xe máy, xem chi tiết' }));
    expect(screen.getByText('100.000 đ')).toBeTruthy();

    // Draft invoice must NOT request or display VietQR or payment panel
    expect(screen.queryByText('Xem mã QR thanh toán')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/payment'))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/transfer-instructions'))).toBe(
      false,
    );
  });

  it('shows missing utilities in the charge card without inventing monetary lines', async () => {
    mocks.invoiceId = invoiceId;
    const draft = {
      ...baseInvoice,
      total: '3500000',
      lines: sampleLines.filter((line) => line.category === 'Rent'),
      missingInputs: ['confirmed_reading_Electricity', 'baseline_Water'],
    };
    setApi(
      vi
        .fn<Transport>()
        .mockImplementation(async (url) =>
          json(String(url).endsWith(`/invoices/${invoiceId}`) ? draft : page([])),
        ),
    );
    render(<TenantInvoicesScreen />);
    await screen.findByText('Bản nháp');
    expect(screen.getByText('Tiền điện')).toBeTruthy();
    expect(screen.getByText('Tiền nước')).toBeTruthy();
    expect(screen.getByText('Chưa có chỉ số đã xác nhận')).toBeTruthy();
    expect(screen.getByText('Chưa có chỉ số trước')).toBeTruthy();
    expect(screen.getAllByText('Chưa tính')).toHaveLength(2);
    expect(screen.queryByText('0 ₫', { exact: true })).toBeNull();
    expect(screen.queryByText(/Còn thiếu:/)).toBeNull();
  });

  it('opens invoice meter evidence only on demand from authenticated Tenant reading endpoint', async () => {
    mocks.invoiceId = invoiceId;
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith(`/invoices/${invoiceId}`)) return json(baseInvoice);
      if (path.endsWith(`/tenant/meter-readings/${readingId}/evidence`))
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      throw new Error(`Unexpected endpoint ${path}`);
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    await screen.findByText('Bản nháp');
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('/tenant/meter-readings/')),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Tiền điện sinh hoạt, xem chi tiết' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh công tơ đã xác nhận' }));
    expect(await screen.findByAltText('Ảnh công tơ đã xác nhận')).toBeTruthy();
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/tenant/meter-readings/')).length,
    ).toBe(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/capture/readings/'))).toBe(
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
          bankIdentifier: '970422',
          accountNumber: '0123456789',
          accountHolder: 'CONG TY BHOME',
          transferDescription: 'BHOME P202 T11',
          qrImageDataUri: qrDataUri,
        });
      return json(page([]));
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    await screen.findByText('Đã thanh toán một phần');
    expect(screen.getByText('Đã phát hành')).toBeTruthy();
    expect(screen.getByText('3.290.000 ₫')).toBeTruthy();

    expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/transfer-instructions'))).toBe(
      false,
    );
    fireEvent.click(screen.getByText('Xem mã QR thanh toán'));
    expect(mocks.go).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    const qrImg = await screen.findByAltText('QR chuyển khoản hóa đơn');
    expect(qrImg.getAttribute('src')).toBe(qrDataUri);
    expect(screen.getByText('Ngân hàng')).toBeTruthy();
    expect(screen.getByText('MBBank')).toBeTruthy();
    expect(screen.queryByText('970422')).toBeNull();
    expect(screen.getByText(/0123456789/)).toBeTruthy();
    expect(screen.getByText(/CONG TY BHOME/)).toBeTruthy();
    expect(screen.getByText(/BHOME P202 T11/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Sao chép số tài khoản'));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('0123456789'));

    fireEvent.click(screen.getByLabelText('Sao chép số tiền'));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('3290000'));

    fireEvent.click(screen.getByLabelText('Sao chép nội dung chuyển khoản'));
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('BHOME P202 T11'));
    fireEvent.click(screen.getByLabelText('Đóng mã QR thanh toán'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
    expect(screen.getByText('Xem mã QR thanh toán')).toBeTruthy();
  });

  it('opens the real move-out receivable detail, shows QR only while unpaid and removes it after verified webhook payment', async () => {
    const contractId = '77777777-7777-4777-8777-777777777777';
    const chargeId = '88888888-8888-4888-8888-888888888888';
    mocks.view = 'settlement';
    mocks.settlementContractId = contractId;
    mocks.settlementChargeId = chargeId;
    let bankPaid = false;
    const qr =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith(`/contracts/${contractId}/move-out/receivables`))
        return json({
          contractId,
          roomId,
          roomNumber: 'P202',
          reference: 'server-snapshot',
          availableDeposit: '0',
          receivables: [
            {
              charge: {
                id: chargeId,
                contractId,
                roomId,
                kind: 'TenantDamage',
                assetId: null,
                description: 'Bồi thường tường sau kiểm tra trả phòng',
                amount: '720000',
              },
              allocated: bankPaid ? '720000' : '600000',
              outstanding: bankPaid ? '0' : '120000',
              status: bankPaid ? 'Paid' : 'PartiallyPaid',
            },
          ],
          offsets: [
            {
              id: 'offset-1',
              receivableId: chargeId,
              amount: '600000',
              reason: 'Cấn trừ cọc đã duyệt',
            },
          ],
        });
      if (
        path.endsWith(
          `/contracts/${contractId}/move-out/receivables/${chargeId}/transfer-instructions`,
        )
      )
        return json({
          availability: bankPaid ? 'Settled' : 'Available',
          outstandingAmount: bankPaid ? '0' : '120000',
          bankIdentifier: 'TEST-BANK',
          accountNumber: '000111222',
          accountHolder: 'BHOME TEST',
          transferReference: 'BH12345678',
          qrImageDataUri: bankPaid ? null : qr,
          isDevelopmentDemo: false,
        });
      throw new Error(`Unexpected invoice request: ${path}`);
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    expect(await screen.findByText('Bồi thường tường sau kiểm tra trả phòng')).toBeTruthy();
    expect(await screen.findByAltText('Mã chuyển khoản khoản phải thu')).toHaveProperty('src', qr);
    expect(screen.getByText(/không phải hóa đơn điện nước hoặc tiền phòng định kỳ/)).toBeTruthy();
    expect(screen.getByText(/Còn phải thanh toán: 120.000/)).toBeTruthy();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/v1/invoices/'))).toBe(
      false,
    );

    // The bank webhook updates the authoritative receivable balance on the server.
    bankPaid = true;
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật trạng thái thanh toán' }));
    expect(
      await screen.findByText('Máy chủ đã xác nhận thanh toán đủ. Không còn mã QR cần thanh toán.'),
    ).toBeTruthy();
    expect(screen.getByText('Đã thanh toán')).toBeTruthy();
    expect(screen.queryByAltText('Mã chuyển khoản khoản phải thu')).toBeNull();
  });

  it('rejects an invalid move-out receivable deep link before requesting payment instructions', async () => {
    mocks.view = 'settlement';
    mocks.settlementContractId = 'forged-contract';
    mocks.settlementChargeId = 'forged-receivable';
    const fetcher = vi.fn<Transport>().mockResolvedValue(json({}));
    setApi(fetcher);
    render(<TenantInvoicesScreen />);
    expect(screen.getByText('Liên kết khoản phải thu không hợp lệ.')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Mã chuyển khoản khoản phải thu')).toBeNull();
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

  it('Test 6: shows compact invoice rows with verified status and total', async () => {
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
      if (path.endsWith('/invoices/current-period')) return json(currentPeriod(true));
      return json(page([first, second]));
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    expect(await screen.findByText('Hóa đơn tháng 11/2026')).toBeTruthy();
    expect(screen.getByText('Hóa đơn tháng 10/2026')).toBeTruthy();
    expect(await screen.findByText('Đã thanh toán một phần')).toBeTruthy();
    expect(screen.getByText('Đã thanh toán')).toBeTruthy();
    expect(screen.getByText('4.290.000 ₫')).toBeTruthy();
    expect(screen.getByText('3.500.000 ₫')).toBeTruthy();
    expect(screen.queryByText('1.290.000 ₫')).toBeNull();
    expect(screen.queryByText('120 kWh')).toBeNull();
    expect(screen.queryByText('Phí Internet & vệ sinh')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Khoản phải thu khi trả phòng')).toBeNull();
    expect(
      screen.queryByText('Xem từng hóa đơn các kỳ trước và trạng thái thanh toán.'),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem hóa đơn phòng P202, kỳ 2026-10' }));
    expect(mocks.go).toHaveBeenCalledWith('invoice', { invoiceId: secondInvoiceId });
  });

  it("does not mistake last month's invoice for a new bill, but keeps history accessible", async () => {
    const oldInvoice = {
      ...baseInvoice,
      status: 'Final' as const,
      billingPeriod: '2026-10-01',
      id: secondInvoiceId,
    };
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/invoices/current-period'))
        return json(currentPeriod(false, ['2026-11-27']));
      if (path.includes('/payment-invoices?')) return json(page([]));
      return json(page([oldInvoice]));
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);

    expect(await screen.findByText('Chưa có hóa đơn kỳ này')).toBeTruthy();
    expect(await screen.findByText('Hóa đơn sẽ được phát hành trong ngày 27/11.')).toBeTruthy();
    expect(await screen.findByText('Hóa đơn tháng 10/2026')).toBeTruthy();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith('/invoices/current-period')),
    ).toBe(true);
  });

  it.each([
    {
      date: '2027-01-27',
      today: '2026-12-31',
      expected: 'Hóa đơn sẽ được phát hành trong ngày 27/1.',
    },
    {
      date: '2026-12-25',
      today: '2026-12-27',
      expected: 'Ngày phát hành hóa đơn theo lịch: 25/12.',
    },
    { date: null, today: '2026-12-27', expected: 'Chưa có lịch phát hành hóa đơn nháp.' },
  ])(
    'uses the server business date and configured draft date ($date)',
    async ({ date, today, expected }) => {
      setApi(
        vi.fn<Transport>().mockImplementation(async (url) =>
          String(url).endsWith('/invoices/current-period')
            ? json({
                billingPeriod: today.slice(0, 7) + '-01',
                businessDate: today,
                hasInvoice: false,
                draftDates: date ? [date] : [],
              })
            : json(page([])),
        ),
      );
      render(<TenantInvoicesScreen />);
      expect(await screen.findByText(expected)).toBeTruthy();
    },
  );

  it('pages the invoice list inside the box without showing stale payment status', async () => {
    const first = { ...baseInvoice, status: 'Final' as const };
    const second = { ...first, id: secondInvoiceId, billingPeriod: '2026-10-01' };
    const fetcher = vi.fn<Transport>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/invoices/current-period')) return json(currentPeriod(true));
      if (path.includes('/payment-invoices?')) return json(page([]));
      if (path.includes('page=2&')) return json(page([second], 21, 2));
      return json(page([first], 21));
    });
    setApi(fetcher);
    render(<TenantInvoicesScreen />);
    expect(await screen.findByText('Hóa đơn tháng 11/2026')).toBeTruthy();
    expect(screen.getByText('Chưa xác định thanh toán')).toBeTruthy();
    expect(screen.queryByText('Đã thanh toán')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(await screen.findByText('Hóa đơn tháng 10/2026')).toBeTruthy();
    expect(screen.queryByText('Hóa đơn tháng 11/2026')).toBeNull();
    expect(screen.queryByText('Chưa có hóa đơn kỳ này')).toBeNull();
    expect(screen.getByText('Trang 2 / 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(await screen.findByText('Hóa đơn tháng 11/2026')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Xem yêu cầu' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await screen.findByRole('tab', { name: 'Yêu cầu của tôi' });
    await screen.findByRole('button', { name: 'Xem yêu cầu của tôi' });
    expect(mocks.rawViewText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Đóng yêu cầu điều chỉnh'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu điều chỉnh' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Lý do yêu cầu điều chỉnh')).toBeTruthy();
    expect(mocks.rawViewText).not.toHaveBeenCalled();
    expect(mocks.go).not.toHaveBeenCalled();
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
      await screen.findByRole('button', { name: 'Xem yêu cầu' });
      expect(!!screen.queryByRole('button', { name: 'Gửi yêu cầu điều chỉnh' })).toBe(!paid);
    },
  );
  it('promotes verified paid amount and hides the zero outstanding summary for a settled invoice', async () => {
    mocks.invoiceId = invoiceId;
    setApi(
      redesignApi({
        ...finalPayment,
        paymentStatus: 'Paid',
        paidAmount: finalPayment.payableAmount,
        outstandingAmount: '0',
      }),
    );
    render(<TenantInvoicesScreen />);
    expect(await screen.findByText('Số tiền đã thanh toán')).toBeTruthy();
    expect(screen.getByText('4.280.000 ₫')).toBeTruthy();
    expect(screen.queryByText('Còn phải thanh toán', { exact: true })).toBeNull();
    expect(screen.queryByText('0 ₫', { exact: true })).toBeNull();
    expect(screen.queryByText(/^Đã thanh toán:/)).toBeNull();
    expect(screen.getByText('Đã thanh toán', { exact: true })).toBeTruthy();
  });

  it('keeps the outstanding amount prominent when the invoice is partially paid', async () => {
    mocks.invoiceId = invoiceId;
    setApi(redesignApi());
    render(<TenantInvoicesScreen />);
    expect(await screen.findByText('Còn phải thanh toán', { exact: true })).toBeTruthy();
    expect(screen.getByText('3.280.000 ₫')).toBeTruthy();
    expect(screen.getByText('Đã thanh toán: 1.000.000 ₫')).toBeTruthy();
    expect(screen.queryByText('Số tiền đã thanh toán')).toBeNull();
    expect(screen.getByText('Xem mã QR thanh toán')).toBeTruthy();
  });

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
  it('keeps paid invoices read-only even on the old new-adjustment link', async () => {
    mocks.invoiceId = invoiceId;
    mocks.focus = 'adjustment';
    mocks.newRequest = 'true';
    setApi(redesignApi({ ...finalPayment, paymentStatus: 'Paid', outstandingAmount: '0' }));
    render(<TenantInvoicesScreen />);
    await screen.findByText('Đã từ chối');
    expect(screen.queryByRole('button', { name: 'Gửi yêu cầu điều chỉnh' })).toBeNull();
    expect(screen.queryByLabelText('Lý do yêu cầu điều chỉnh')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Yêu cầu của tôi' })).toBeTruthy();
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
