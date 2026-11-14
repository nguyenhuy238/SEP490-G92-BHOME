import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { SettlementSummary } from '../../../../../packages/client-core/src/contracts';
import { DepositDeductionsPanel } from './DepositDeductionsPanel';
afterEach(cleanup);
it('retains the approved historical decision and evidence count without another write form', () => {
  const summary = {
    depositDeductions: {
      version: 2,
      approvedAt: '2026-11-11T00:00:00Z',
      total: '100000',
      reason: 'Synthetic historical decision',
      items: [{ description: 'Synthetic damage', amount: '100000', evidenceIds: ['proof'] }],
    },
  } as unknown as SettlementSummary;
  render(<DepositDeductionsPanel summary={summary} />);
  expect(screen.getByText(/Phiên bản 2 · Đã duyệt: 100.000/)).toBeInTheDocument();
  expect(screen.getByText(/Synthetic damage · 100.000.*1 ảnh biên bản/)).toBeInTheDocument();
  expect(screen.getByText('Synthetic historical decision')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('directs new damage to separate receivables instead of inventing a legacy plan', () => {
  render(
    <DepositDeductionsPanel
      summary={{ depositDeductions: null } as unknown as SettlementSummary}
    />,
  );
  expect(screen.getByText(/Thiệt hại mới được ghi thành khoản phải thu riêng/)).toBeInTheDocument();
  expect(screen.getByText('Chưa có quyết định khấu trừ theo luồng cũ.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
