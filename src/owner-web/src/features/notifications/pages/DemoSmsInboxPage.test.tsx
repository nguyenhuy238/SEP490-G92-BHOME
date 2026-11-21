import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DemoSmsInboxPage from './DemoSmsInboxPage';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../meters/useMeterApi', () => ({ useMeterApi: () => ({ request }) }));
afterEach(() => {
  cleanup();
  request.mockReset();
});
it('labels dynamic inbox content as simulated and masks the recipient', async () => {
  request.mockResolvedValue([
    {
      id: 'synthetic-message',
      recipientId: 'synthetic-user',
      maskedPhone: '***0003',
      templateId: 'SMS-01',
      content: 'Synthetic OTP message',
      createdAt: '2026-11-13T10:00:00Z',
      mode: 'Mock',
      status: 'Simulated',
    },
  ]);
  render(<DemoSmsInboxPage />);
  await screen.findByText('Synthetic OTP message');
  expect(screen.getByText('***0003')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('không gửi qua mạng di động');
  expect(screen.getByText('Mô phỏng')).toBeInTheDocument();
});
it('does not display messages when the backend denies access', async () => {
  request.mockRejectedValue(new Error('denied'));
  render(<DemoSmsInboxPage />);
  expect(await screen.findByText(/không có quyền/)).toBeInTheDocument();
});
