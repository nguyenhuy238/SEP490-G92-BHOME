// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MobileApi } from '../lib/api';
import { loadTenantRefunds } from '../services/tenantRefunds';
const state = vi.hoisted(() => ({
  role: 'Tenant',
  error: '',
  loading: false,
  total: 21,
  empty: false,
  query: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: [state.role] } }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.query(path);
    return {
      data:
        path && !state.error && !state.loading
          ? {
              items: state.empty ? [] : [row],
              totalCount: state.total,
              page: Number(new URLSearchParams(path.split('?')[1]).get('page')),
              pageSize: 20,
            }
          : null,
      error: state.error,
      loading: state.loading,
      reload: state.reload,
    };
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Action: ({
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
}));
vi.mock('../components/InvoiceDetailUi', () => ({
  InvoiceFeedback: ({
    error,
    loading,
    reload,
  }: {
    error: string;
    loading: boolean;
    reload: () => void;
  }) =>
    error ? (
      <button onClick={reload}>{error}</button>
    ) : loading ? (
      <div>Đang tải hoàn tiền</div>
    ) : null,
  InvoicePager: ({
    page,
    total,
    onChange,
  }: {
    page: number;
    total: number;
    onChange: (value: number) => void;
  }) => (
    <button disabled={page * 20 >= total} onClick={() => onChange(page + 1)}>
      Trang hoàn tiếp
    </button>
  ),
}));
import { TenantRefundPanel } from '../screens/TenantRefundPanel';
const row = {
  id: 'refund',
  amount: '50000',
  sourceKind: 'ReceiptExcess',
  status: 'APPROVED',
  requestedAt: '2026-11-11T00:00:00Z',
  decidedAt: '2026-11-11T01:00:00Z',
  executedAt: null,
  isDevelopmentDemo: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { role: 'Tenant', error: '', loading: false, total: 21, empty: false });
});
afterEach(cleanup);
it('loads own refund status on demand, keeps approval pending actual execution and paginates from the backend', () => {
  render(<TenantRefundPanel />);
  expect(state.query).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: 'Xem hoàn tiền của tôi' }));
  expect(state.query).toHaveBeenLastCalledWith('/api/v1/tenant/refunds?page=1&pageSize=20');
  expect(screen.getByText('Đã duyệt · chờ hoàn thực tế')).toBeTruthy();
  expect(screen.queryByText('Đã hoàn thực tế')).toBeNull();
  expect(screen.getByText(/Hoàn tiền chuyển dư · 50.000/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Trang hoàn tiếp' }));
  expect(state.query).toHaveBeenLastCalledWith('/api/v1/tenant/refunds?page=2&pageSize=20');
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại hoàn tiền' }));
  expect(state.reload).toHaveBeenCalledOnce();
});
it('shows a failure with retry, and an empty result separately', () => {
  state.error = 'Không tải được hoàn tiền';
  const view = render(<TenantRefundPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem hoàn tiền của tôi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Không tải được hoàn tiền' }));
  expect(state.reload).toHaveBeenCalledOnce();
  state.error = '';
  state.empty = true;
  view.rerender(<TenantRefundPanel />);
  expect(screen.getByText('Chưa có yêu cầu hoàn tiền cho bạn.')).toBeTruthy();
});
it.each(['Staff', 'Owner'])('does not fetch or present Tenant refunds for %s', (role) => {
  state.role = role;
  render(<TenantRefundPanel />);
  expect(state.query).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole('button')).toBeNull();
});
function api(value: unknown) {
  return { request: vi.fn().mockResolvedValue(value) } as unknown as MobileApi;
}
const path = '/api/v1/tenant/refunds?page=1&pageSize=20';
it('retains only the least-privilege refund fields', async () => {
  const result = await loadTenantRefunds(
    api({
      items: [
        {
          ...row,
          bankReference: 'PRIVATE',
          reason: 'PRIVATE',
          executionIntent: { objectKey: 'PRIVATE' },
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 20,
    }),
    path,
    new AbortController().signal,
  );
  expect(result.items).toEqual([row]);
});
it.each([
  { amount: '-1' },
  { status: 'UNKNOWN' },
  { status: 'COMPLETED', executedAt: null },
  { sourceKind: 'UNKNOWN' },
  { executedAt: 'invalid' },
])('rejects invalid refund metadata %j', async (patch) => {
  await expect(
    loadTenantRefunds(
      api({ items: [{ ...row, ...patch }], totalCount: 1, page: 1, pageSize: 20 }),
      path,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 502 });
});
