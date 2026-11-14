import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import FinanceHomePage from './FinanceHomePage';

it('provides a task-first route to every finance workflow without requiring user IDs or input', () => {
  render(
    <MemoryRouter>
      <FinanceHomePage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole('heading', { name: 'Tài chính & Hóa đơn', level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Chu kỳ hóa đơn' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Có vấn đề cần xử lý?' })).not.toBeInTheDocument();

  const billingDestinations = [
    ['Xem chỉ số', '/meters'],
    ['Xem hóa đơn', '/invoices'],
    ['Xem lịch tự động', '/billing-automation'],
    ['Đến thanh toán', '/payments'],
  ] as const;
  for (const [label, href] of billingDestinations) {
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Xử lý phát sinh' }));
  expect(screen.getByRole('heading', { name: 'Có vấn đề cần xử lý?' })).toBeInTheDocument();
  const issueDestinations = [
    ['Xem công nợ', '/debts'],
    ['Xem yêu cầu', '/invoice-adjustments'],
    ['Xem biểu phí', '/pricing'],
  ] as const;
  for (const [label, href] of issueDestinations) {
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Quản lý & báo cáo' }));
  const managementDestinations = [
    ['Quản lý khoản chi', '/expenses'],
    ['Mở báo cáo', '/reports'],
    ['Phân tích kịch bản', '/what-if'],
  ] as const;
  for (const [label, href] of managementDestinations) {
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
});
