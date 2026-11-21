// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => {
  const Wrap = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Icon: () => null,
    Portal: Wrap,
    Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
      <button onClick={onPress}>{children}</button>
    ),
    Dialog: Object.assign(
      ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
        visible ? <div role="dialog">{children}</div> : null,
      { Title: Wrap, Content: Wrap, Actions: Wrap },
    ),
  };
});
import { HoldingConfirmationSummary } from '../features/contracts/HoldingConfirmationSummary';
afterEach(cleanup);
it('renders actual values as text without editable fields or calendars', () => {
  const name = 'Người giữ chỗ có họ tên dài để kiểm tra xuống dòng';
  const email = 'long.email.for.holding.confirmation@example.invalid';
  render(
    <HoldingConfirmationSummary
      location="Cơ sở kiểm thử"
      room="S102"
      name={name}
      email={email}
      birthDate="1995-05-20"
      verified
      deposit="3750000"
      startDate="2026-11-12"
      endDate="2026-12-12"
    />,
  );
  for (const text of [
    'Cơ sở kiểm thử',
    'S102',
    name,
    email,
    '20/05/1995',
    'Đã xác minh',
    '3.750.000 ₫',
    '12/11/2026',
    '12/12/2026',
  ])
    expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
it('opens the exact backend terms only on request and closes without changing any data', () => {
  const terms = 'Nội dung điều khoản thật do backend cung cấp. '.repeat(60);
  render(<HoldingConfirmationSummary verified terms={terms} />);
  expect(screen.queryByText(terms.trim())).toBeNull();
  fireEvent.click(screen.getByText('Xem chi tiết'));
  expect(screen.getByRole('dialog').textContent).toContain(terms);
  fireEvent.click(screen.getByText('Đóng'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Xem mẫu hợp đồng')).toBeNull();
});
it('does not generate missing dates, money, verification or an empty terms action', () => {
  render(<HoldingConfirmationSummary verified={false} terms=" " />);
  expect(screen.getAllByText('Chưa có dữ liệu')).toHaveLength(7);
  expect(screen.getByText('Chưa xác minh')).toBeTruthy();
  expect(screen.queryByText('0 ₫')).toBeNull();
  expect(screen.queryByText('Xem chi tiết')).toBeNull();
});
