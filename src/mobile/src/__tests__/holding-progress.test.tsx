// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ProgressBar: ({
    progress,
    accessibilityLabel,
  }: {
    progress: number;
    accessibilityLabel: string;
  }) => <progress aria-label={accessibilityLabel} value={progress} max={1} />,
}));
import { HoldingProgress } from '../features/contracts/HoldingProgress';
afterEach(cleanup);
it('shows only current and next steps until the process is expanded', () => {
  const view = render(<HoldingProgress current={0} />);
  expect(screen.getByText('Bước 1/8')).toBeTruthy();
  expect(screen.getByText('Tiếp theo: Người giữ chỗ')).toBeTruthy();
  expect(screen.queryByText('6. Phê duyệt')).toBeNull();
  expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(0.125);
  fireEvent.click(screen.getByText('Xem quy trình giữ chỗ'));
  expect(screen.getByText(/8\. Cọc & giữ chỗ/)).toBeTruthy();
  fireEvent.click(screen.getByText('Xem quy trình giữ chỗ'));
  expect(screen.queryByText(/8\. Cọc & giữ chỗ/)).toBeNull();
  view.rerender(<HoldingProgress current={7} />);
  expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1);
});
