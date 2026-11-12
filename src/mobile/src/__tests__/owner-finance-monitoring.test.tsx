// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ request: vi.fn(), reload: vi.fn(), go: vi.fn() }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    paymentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    adjustmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: { request: state.request }, session: { roles: ['Owner'] } }),
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
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../components/OwnerMobileKit', () => ({
  OwnerScreenIntro: ({ title }: { title: string }) => <h1>{title}</h1>,
  OwnerSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  OwnerSurface: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  OwnerDivider: () => <hr />,
  OwnerLinkRow: ({ title, onPress }: { title: string; onPress: () => void }) => (
    <button onClick={onPress}>{title}</button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({ ChoiceField: () => <input /> }));
vi.mock('../components/WorkspaceQueryState', () => ({
  QueryState: () => null,
  Pagination: () => null,
}));
vi.mock('./../screens/TenantAdjustmentPanel', () => ({ AdjustmentEvidenceImage: () => null }));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string) => ({
    reload: state.reload,
    loading: false,
    error: '',
    data: path.includes('announcements')
      ? [
          {
            id: 'sent',
            title: 'Synthetic sent notice',
            body: 'Synthetic body',
            status: 'Sent',
            recipientCount: 3,
            sentAt: '2026-11-11T00:00:00Z',
          },
        ]
      : path.includes('invoice-adjustments')
        ? {
            status: 'Pending',
            submittedAt: '2026-11-11T00:00:00Z',
            proposedAmount: '100000',
            invoiceId: 'invoice',
            reason: 'Synthetic request',
            evidence: [],
            lineSnapshot: [],
          }
        : {
            status: 'PendingReview',
            amount: '50000',
            occurredAt: '2026-11-11T00:00:00Z',
            bankReference: 'SYNTHETIC',
            providerIdentity: 'SYNTHETIC',
            transferDescription: 'Synthetic description',
            statementReference: 'Synthetic proof',
            verificationReason: 'Synthetic Owner check',
          },
  }),
}));
import {
  OwnerAdjustmentReviewScreen,
  OwnerPaymentReviewScreen,
  OwnerAnnouncementScreen,
} from '../screens/OwnerDecisionScreens';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('shows bank receipt monitoring without allocation or rejection controls', () => {
  render(<OwnerPaymentReviewScreen />);
  expect(screen.getByText('50.000 ₫')).toBeTruthy();
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Phân bổ vào hóa đơn' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Từ chối' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
it('shows adjustment status without approving or changing money on Mobile', () => {
  render(<OwnerAdjustmentReviewScreen />);
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Phê duyệt' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
it('keeps sent announcements visible and directs composition to Owner Web', () => {
  render(<OwnerAnnouncementScreen />);
  expect(screen.getByText('Synthetic sent notice')).toBeTruthy();
  expect(screen.getByText('Thực hiện trên Owner Web')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi thông báo' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
