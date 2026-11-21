// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'Owner', fail: false, go: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: [state.role] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => ({
    loading: false,
    error: state.fail ? 'Chưa tải được' : '',
    data:
      state.fail || !path
        ? null
        : path.includes('debts')
          ? { outstandingAmount: '90000', overdueAmount: '50000', overdueInvoiceCount: 2 }
          : {
              totalCount: path.includes('Submitted') ? 4 : 7,
              items: path.includes('Submitted')
                ? [{ id: 'synthetic-emergency', code: 'SC-01', description: 'Sự cố tổng hợp' }]
                : [],
            },
  }),
}));
import { OwnerAttentionSummary } from '../features/owner/OwnerAttentionSummary';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.role = 'Owner';
  state.fail = false;
});
it('prioritizes open emergencies from server totals and uses authoritative debt amounts', () => {
  render(<OwnerAttentionSummary />);
  expect(screen.getByText('11 đang mở')).toBeTruthy();
  expect(screen.getByText(/Còn phải thu: 90.000/)).toBeTruthy();
  fireEvent.click(screen.getByText('Mở sự cố'));
  expect(state.go).toHaveBeenCalledWith('incident-detail', { incidentId: 'synthetic-emergency' });
});
it('never interprets failed emergency/debt reads as zero', () => {
  state.fail = true;
  render(<OwnerAttentionSummary />);
  expect(screen.getByText('Chưa đủ dữ liệu')).toBeTruthy();
  expect(screen.queryByText('0 đang mở')).toBeNull();
  expect(screen.queryByText(/Còn phải thu:/)).toBeNull();
});
it('does not show Owner balances to Tenant', () => {
  state.role = 'Tenant';
  render(<OwnerAttentionSummary />);
  expect(screen.queryByText('Công nợ cần theo dõi')).toBeNull();
});
