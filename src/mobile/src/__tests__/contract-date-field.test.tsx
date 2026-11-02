// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('react-native', () => ({
  StyleSheet: { create: (v: unknown) => v },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => {
  const Wrap = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Dialog = Object.assign(
    ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? <div role="dialog">{children}</div> : null,
    { Title: Wrap, Content: Wrap, Actions: Wrap },
  );
  return {
    Dialog,
    Portal: Wrap,
    Text: Wrap,
    Button: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      accessibilityLabel?: string;
    }) => (
      <button aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
    IconButton: ({
      accessibilityLabel,
      onPress,
    }: {
      accessibilityLabel: string;
      onPress: () => void;
    }) => <button aria-label={accessibilityLabel} onClick={onPress} />,
    TextInput: ({
      label,
      value,
      onChangeText,
    }: {
      label: string;
      value: string;
      onChangeText: (s: string) => void;
    }) => <input aria-label={label} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  };
});
import { ContractDateField } from '../components/ContractDateField';
afterEach(cleanup);
it('opens the entered month and picks a leap-day date using dd/MM/yyyy', () => {
  const change = vi.fn();
  render(
    <ContractDateField label="Ngày thuê" value="01/02/2028" onChange={change} disabled={false} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chọn Ngày thuê' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ngày 29/2/2028' }));
  expect(change).toHaveBeenCalledWith('29/02/2028');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('changes months and closing the calendar does not mutate the form', () => {
  const change = vi.fn();
  render(
    <ContractDateField label="Ngày thuê" value="01/12/2026" onChange={change} disabled={false} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chọn Ngày thuê' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
  expect(screen.getByText('Tháng 1/2027')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng lịch' }));
  expect(change).not.toHaveBeenCalled();
});
