import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../../../../../packages/client-core/src/auth';
import ConfirmEmailPage from './ConfirmEmailPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(entry = '/confirm-email') {
  render(
    <AuthProvider transport="web">
      <MemoryRouter initialEntries={[entry]}>
        <ConfirmEmailPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}
it('requests verification with a generic response and no account disclosure', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  setup();
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'owner@example.invalid' } });
  fireEvent.click(screen.getByText('Gửi liên kết xác nhận'));
  await screen.findByText(/Nếu tài khoản đủ điều kiện/);
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/request-email-verification');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ userName: 'owner@example.invalid' });
});
it('keeps fragment credentials in memory and confirms only after an explicit click', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  setup('/confirm-email#userName=owner%40example.invalid&token=synthetic-verification');
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^Tài khoản/)).toHaveValue('owner@example.invalid');
  fireEvent.click(screen.getByText('Xác nhận email', { selector: 'button' }));
  await screen.findByText(/Email đã được xác nhận/);
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/confirm-email');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    userName: 'owner@example.invalid',
    token: 'synthetic-verification',
  });
});
it('handles expired links and resend rate limits without showing a false success', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 400 }))
    .mockResolvedValueOnce(new Response('{}', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  setup('/confirm-email#userName=owner%40example.invalid&token=synthetic-expired');
  fireEvent.click(screen.getByText('Xác nhận email', { selector: 'button' }));
  await screen.findByText(/Liên kết không hợp lệ/);
  fireEvent.click(screen.getByText('Gửi lại liên kết'));
  await screen.findByText(/Bạn đã thử quá nhiều lần/);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ userName: 'owner@example.invalid' });
  expect(screen.queryByText(/Email đã được xác nhận/)).not.toBeInTheDocument();
});
