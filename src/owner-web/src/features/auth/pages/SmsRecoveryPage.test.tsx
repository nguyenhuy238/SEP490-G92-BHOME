import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../../../../../packages/client-core/src/auth';
import { theme } from '../../../theme/theme';
import SmsRecoveryPage from './SmsRecoveryPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  return render(
    <ThemeProvider theme={theme}>
      <AuthProvider restoreOnMount={false}>
        <MemoryRouter>
          <SmsRecoveryPage />
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}
function enter(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it('completes anonymous SMS recovery with a resend countdown and password confirmation', async () => {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    if (url.endsWith('/request'))
      return Response.json(
        { challengeId: 'synthetic-challenge', retryAfterSeconds: 60, expiresInSeconds: 300 },
        { status: 202 },
      );
    if (url.endsWith('/verify'))
      return Response.json({ authorization: 'synthetic-authorization', expiresInSeconds: 300 });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  setup();
  enter(/Tài khoản/, 'tenant.sms-demo');
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mã xác minh' }));
  await screen.findByLabelText('Mã xác minh');
  expect(screen.getByRole('button', { name: /Gửi lại sau/ })).toBeDisabled();
  enter(/Mã xác minh/, '123456');
  fireEvent.click(screen.getByRole('button', { name: 'Xác minh' }));
  await screen.findByLabelText('Mật khẩu mới');
  enter(/^Mật khẩu mới/, 'Next!Password-927');
  enter(/^Xác nhận/, 'mismatch');
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('không khớp');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  enter(/^Xác nhận/, 'Next!Password-927');
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  await screen.findByText('Đã đặt lại mật khẩu');
  expect(screen.getByRole('link', { name: 'Quay lại đăng nhập' })).toHaveAttribute(
    'href',
    '/login',
  );
  expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({
    identifier: 'tenant.sms-demo',
    challengeId: 'synthetic-challenge',
    authorization: 'synthetic-authorization',
    newPassword: 'Next!Password-927',
    confirmPassword: 'Next!Password-927',
  });
});
it('shows generic service and OTP errors without exposing account existence', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  setup();
  enter(/Tài khoản/, 'unknown');
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mã xác minh' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('chưa khả dụng'));
  expect(screen.queryByLabelText('Mã xác minh')).not.toBeInTheDocument();
});
