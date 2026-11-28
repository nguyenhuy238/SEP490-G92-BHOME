// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MobileApi } from '../lib/api';
import {
  formatMoneyInput,
  tryParseMoneyInput,
} from '../../../../packages/client-core/src/moneyInput';
import {
  createTenantRefundRequest,
  loadTenantRefundRequestSources,
  loadTenantRefundRequests,
  refundRequestFormError,
  tenantRefundRequestPath,
} from '../services/tenantRefundRequests';

const paymentId = 'aaaa0000-0000-4000-8000-000000000001';
const contractId = 'bbbb0000-0000-4000-8000-000000000002';
const refundId = 'cccc0000-0000-4000-8000-000000000003';
const row = {
  id: refundId,
  amount: '50000',
  reason: 'Tiền chuyển thừa',
  status: 'REJECTED',
  sourcePaymentId: null,
  sourceContractId: null,
  moveOutProposalId: null,
  createdAt: '2026-11-15T03:00:00Z',
  decidedAt: '2026-11-15T04:00:00Z',
  decisionReason: 'Cần bổ sung chứng cứ',
  executedAt: null,
  externalReference: null,
  hasEvidence: false,
  version: 1,
};
const state = vi.hoisted(() => ({
  route: {} as Record<string, string>,
  role: 'Tenant',
  error: '',
  empty: false,
  proof: false,
  status: 'REJECTED',
  linked: false,
  moveOutLinked: false,
  waiting: false,
  go: vi.fn(),
  requests: vi.fn(),
  reload: vi.fn(),
  send: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
vi.mock('../features/incidents/TenantIncidentStyle', () => ({ reportUi: {} }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    session: { userId: 'tenant-user', roles: [state.role] },
    api: { request: state.send },
  }),
}));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => 'dddd0000-0000-4000-8000-000000000004' }));
vi.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useLocalSearchParams: () => state.route,
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: () => false,
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.requests(path);
    const sources = path?.endsWith('/sources');
    return {
      data: sources
        ? {
            payments: [{ id: paymentId, label: 'Giao dịch 50.000' }],
            contracts: [{ id: contractId, label: 'Hợp đồng phòng 101' }],
          }
        : state.empty
          ? { items: [], page: 1, pageSize: 20, totalCount: 0 }
          : {
              items: [
                state.proof
                  ? {
                      ...row,
                      status: 'COMPLETED',
                      executedAt: '2026-11-15T05:00:00Z',
                      hasEvidence: true,
                    }
                  : {
                      ...row,
                      status: state.status,
                      sourcePaymentId: state.linked ? paymentId : null,
                      sourceContractId: state.linked ? contractId : null,
                      moveOutProposalId: state.moveOutLinked
                        ? '22220000-0000-4000-8000-000000000009'
                        : null,
                    },
              ],
              page: 1,
              pageSize: 20,
              totalCount: 1,
            },
      error: sources ? '' : state.error,
      loading: state.waiting,
      reload: state.reload,
    };
  },
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <div role="img" aria-label={accessibilityLabel} />
  ),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  IconButton: ({
    accessibilityLabel,
    onPress,
  }: {
    accessibilityLabel: string;
    onPress: () => void;
  }) => <button aria-label={accessibilityLabel} onClick={onPress} />,
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    label,
    value,
    onChangeText,
    disabled,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  Checkbox: {
    Item: ({ label, onPress, status }: { label: string; onPress: () => void; status: string }) => (
      <button aria-pressed={status === 'checked'} onClick={onPress}>
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/MoneyTextInput', () => ({
  MoneyTextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => (
        <option value={item.id} key={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceQueryState', () => ({
  QueryState: ({ error }: { error: string }) => (error ? <div>{error}</div> : null),
  Pagination: () => null,
}));

import {
  TenantRefundRequestsScreen,
  TenantRefundHistoryScreen,
} from '../features/tenant/billing/TenantRefundRequestsScreen';

beforeEach(() => {
  vi.clearAllMocks();
  state.route = {};
  Object.assign(state, {
    role: 'Tenant',
    error: '',
    empty: false,
    proof: false,
    status: 'REJECTED',
    linked: false,
    moveOutLinked: false,
    waiting: false,
  });
  state.send.mockResolvedValue(row);
});
afterEach(cleanup);

function api(value: unknown) {
  return { request: vi.fn().mockResolvedValue(value) } as unknown as MobileApi;
}

it('validates money, reason, IDs and allows two optional source associations', () => {
  expect(
    refundRequestFormError({
      amount: '0',
      reason: 'Thừa tiền',
      sourcePaymentId: null,
      sourceContractId: null,
    }),
  ).toMatch(/lớn hơn 0/);
  expect(
    refundRequestFormError({
      amount: '50',
      reason: ' ',
      sourcePaymentId: null,
      sourceContractId: null,
    }),
  ).toMatch(/lý do/);
  expect(
    refundRequestFormError({
      amount: '50',
      reason: 'Thừa tiền',
      sourcePaymentId: paymentId,
      sourceContractId: contractId,
    }),
  ).toBe('');
  expect(
    refundRequestFormError({
      amount: '120000',
      reason: 'Hoàn cọc trả phòng',
      moveOutProposalId: 'not-a-guid',
      sourceContractId: contractId,
    }),
  ).toMatch(/đề xuất/);
});

it('MoneyTextInput normalizes displayed VND grouping into accepted integer digits', () => {
  const raw = tryParseMoneyInput('01.234.567');
  expect(raw).toBe('1234567');
  expect(formatMoneyInput(raw!)).toBe('1.234.567');
  expect(
    refundRequestFormError({
      amount: raw!,
      reason: 'Hoàn tiền thừa',
      sourcePaymentId: null,
      sourceContractId: null,
    }),
  ).toBe('');
  expect(tryParseMoneyInput('1.200,50')).toBeNull();
  expect(tryParseMoneyInput('-500')).toBeNull();
});

it('shows only history including rejection reason on the sent route', () => {
  render(<TenantRefundHistoryScreen />);
  expect(screen.getByText(/Cần bổ sung chứng cứ/)).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Số tiền yêu cầu hoàn (VND)' })).toBeNull();
  expect(state.requests).not.toHaveBeenCalledWith('/api/v1/tenant/refund-requests/sources');
});

it('displays payment and contract associations together when both exist', () => {
  state.linked = true;
  render(<TenantRefundHistoryScreen />);
  expect(screen.getByText('Có liên kết giao dịch')).toBeTruthy();
  expect(screen.getByText('Có liên kết hợp đồng')).toBeTruthy();
  expect(screen.queryByText('Yêu cầu độc lập')).toBeNull();
});

it('identifies an Owner-reviewed move-out refund request separately from verified money transfer', () => {
  state.linked = true;
  state.moveOutLinked = true;
  render(<TenantRefundHistoryScreen />);
  expect(screen.getByText('Liên kết đề xuất trả phòng')).toBeTruthy();
  expect(screen.getByText(/Tiền hoàn thực tế sẽ được đối chiếu qua quyết toán cọc/)).toBeTruthy();
});

it('shows an independent request label when neither source exists', () => {
  render(<TenantRefundHistoryScreen />);
  expect(screen.getByText('Yêu cầu độc lập')).toBeTruthy();
  expect(screen.queryByText('Có liên kết giao dịch')).toBeNull();
  expect(screen.queryByText('Có liên kết hợp đồng')).toBeNull();
});

it('sends a Tenant-owned independent request with a stable idempotency key', async () => {
  const client = api(row);
  const result = await createTenantRefundRequest(
    client,
    { amount: '50000', reason: ' Hoàn khoản thừa ', sourcePaymentId: null, sourceContractId: null },
    'dddd0000-0000-4000-8000-000000000004',
  );
  expect(result.id).toBe(refundId);
  expect(client.request).toHaveBeenCalledWith('/api/v1/tenant/refund-requests', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'dddd0000-0000-4000-8000-000000000004' },
    body: JSON.stringify({
      amount: '50000',
      reason: 'Hoàn khoản thừa',
      sourcePaymentId: null,
      sourceContractId: null,
    }),
  });
});

it('loads and sanitizes history and Tenant-owned sources', async () => {
  const path = tenantRefundRequestPath(1);
  const history = await loadTenantRefundRequests(
    api({
      items: [{ ...row, privateBankAccount: 'SECRET' }],
      page: 1,
      pageSize: 20,
      totalCount: 1,
    }),
    path,
    new AbortController().signal,
  );
  expect(history.items).toEqual([row]);
  const sources = await loadTenantRefundRequestSources(
    api({
      payments: [{ id: paymentId, label: 'Giao dịch' }],
      contracts: [{ id: contractId, label: 'Hợp đồng' }],
    }),
    '/api/v1/tenant/refund-requests/sources',
    new AbortController().signal,
  );
  expect(sources.payments).toEqual([{ id: paymentId, label: 'Giao dịch' }]);
});

it.each([
  { amount: '-10' },
  { status: 'UNKNOWN' },
  { sourcePaymentId: 'invalid' },
  { status: 'COMPLETED', executedAt: null },
  { hasEvidence: 'true' },
])('rejects corrupted history %j', async (patch) => {
  await expect(
    loadTenantRefundRequests(
      api({ items: [{ ...row, ...patch }], page: 1, pageSize: 20, totalCount: 1 }),
      tenantRefundRequestPath(1),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 502 });
});

it('opens the form directly without history and sends an independent request', async () => {
  render(<TenantRefundRequestsScreen />);
  expect(screen.queryByText(/Cần bổ sung chứng cứ/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tạo yêu cầu hoàn tiền' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đã gửi' }));
  expect(state.go).toHaveBeenCalledWith('refund-history');
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền yêu cầu hoàn (VND)' }), {
    target: { value: '70000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Lý do yêu cầu *' }), {
    target: { value: 'Tôi chuyển dư tiền tháng này' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Tôi xác nhận số tiền/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đến Owner' }));
  await waitFor(() =>
    expect(state.send).toHaveBeenCalledWith(
      '/api/v1/tenant/refund-requests',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const body = JSON.parse(state.send.mock.calls[0][1].body);
  expect(body).toMatchObject({ amount: '70000', sourcePaymentId: null, sourceContractId: null });
  expect(screen.getByText(/Đã gửi yêu cầu/)).toBeTruthy();
});

it('opens a prefilled move-out refund request and links it to the Tenant contract', async () => {
  state.route = {
    moveOutProposalId: '22220000-0000-4000-8000-000000000009',
    sourceContractId: contractId,
    amount: '120000',
    reason: 'Hoàn cọc sau xác nhận trả phòng.',
  };
  render(<TenantRefundRequestsScreen />);
  expect(await screen.findByDisplayValue('120000')).toBeTruthy();
  expect(screen.getByDisplayValue('Hoàn cọc sau xác nhận trả phòng.')).toBeTruthy();
  expect(
    (screen.getByRole('combobox', { name: 'Hợp đồng liên quan (tùy chọn)' }) as HTMLSelectElement)
      .value,
  ).toBe(contractId);
  fireEvent.click(screen.getByRole('button', { name: /Tôi xác nhận số tiền/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đến Owner' }));
  await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
  const body = JSON.parse(state.send.mock.calls[0][1].body);
  expect(body).toMatchObject({
    amount: '120000',
    reason: 'Hoàn cọc sau xác nhận trả phòng.',
    sourceContractId: contractId,
    sourcePaymentId: null,
    moveOutProposalId: '22220000-0000-4000-8000-000000000009',
  });
});

it('links payment and contract from Tenant-authorized choices', async () => {
  render(<TenantRefundRequestsScreen />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền yêu cầu hoàn (VND)' }), {
    target: { value: '70000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Lý do yêu cầu *' }), {
    target: { value: 'Tôi chuyển thừa tiền phòng' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Tôi xác nhận số tiền/ }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Giao dịch liên quan (tùy chọn)' }), {
    target: { value: paymentId },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Hợp đồng liên quan (tùy chọn)' }), {
    target: { value: contractId },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đến Owner' }));
  await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
  expect(JSON.parse(state.send.mock.calls[0][1].body)).toMatchObject({
    sourcePaymentId: paymentId,
    sourceContractId: contractId,
  });
});

it('requires confirmation and rejects empty form before hitting the server', () => {
  render(<TenantRefundRequestsScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đến Owner' }));
  expect(screen.getByText(/Xác nhận số tiền và lý do/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Tôi xác nhận số tiền/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu đến Owner' }));
  expect(screen.getByText(/Nhập số tiền hoàn lớn hơn 0/)).toBeTruthy();
  expect(state.send).not.toHaveBeenCalled();
});

it('locks the submit button against double creation until the response arrives', async () => {
  let resolve!: (value: unknown) => void;
  state.send.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<TenantRefundRequestsScreen />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền yêu cầu hoàn (VND)' }), {
    target: { value: '50000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Lý do yêu cầu *' }), {
    target: { value: 'Chuyển khoản thừa' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Tôi xác nhận số tiền/ }));
  const submit = screen.getByRole('button', { name: 'Gửi yêu cầu đến Owner' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(state.send).toHaveBeenCalledOnce();
  resolve(row);
  await waitFor(() => expect(screen.getByText(/Đã gửi yêu cầu/)).toBeTruthy());
});

it('does not fetch requests or show the form for Staff and Owner', () => {
  state.role = 'Staff';
  render(<TenantRefundRequestsScreen />);
  expect(screen.getByText(/không có quyền/)).toBeTruthy();
  expect(state.requests).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Tạo yêu cầu hoàn tiền' })).toBeNull();
});

it('only loads a Completed proof through an authenticated request', async () => {
  state.proof = true;
  state.send.mockResolvedValue(Uint8Array.from([137, 80, 78, 71, 4, 2, 1, 0]));
  render(<TenantRefundHistoryScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem chứng từ chuyển khoản' }));
  await waitFor(() =>
    expect(state.send).toHaveBeenCalledWith(
      `/api/v1/tenant/refund-requests/${refundId}/evidence`,
      expect.any(Object),
      'bytes',
    ),
  );
  expect(screen.getByRole('img', { name: 'Chứng từ hoàn tiền Owner gửi' })).toBeTruthy();
});

it('does not show proof before Owner execution is completed', () => {
  state.status = 'APPROVED';
  render(<TenantRefundHistoryScreen />);
  expect(screen.getByText('Đã duyệt · chờ chuyển khoản')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xem chứng từ chuyển khoản' })).toBeNull();
  expect(state.send).not.toHaveBeenCalled();
});
