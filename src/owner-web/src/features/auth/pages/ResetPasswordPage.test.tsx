import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../../../../../packages/client-core/src/auth';
import { theme } from '../../../theme/theme';
import ResetPasswordPage from './ResetPasswordPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(entry = '/reset-password') {
  return render(
    <ThemeProvider theme={theme}>
      <AuthProvider transport="web">
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/login" element={<span>Đăng nhập bằng mật khẩu mới</span>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

it('loads one-time credentials from the email fragment without a fetch or persistent storage', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setup('/reset-password#userName=owner%40example.invalid&token=synthetic-link-token');
  expect(screen.getByLabelText(/^Email/)).toHaveValue('owner@example.invalid');
  expect(screen.getByLabelText(/^Mã đặt lại/)).toHaveValue('synthetic-link-token');
  expect(fetchMock).not.toHaveBeenCalled();
});

function fill(confirmation = 'Next!Password-493') {
  fireEvent.change(screen.getByLabelText(/^Email/), {
    target: { value: ' synthetic-owner@example.invalid ' },
  });
  fireEvent.change(screen.getByLabelText(/^Mã đặt lại mật khẩu/), {
    target: { value: ' synthetic-one-time-token ' },
  });
  fireEvent.change(screen.getByLabelText(/^Mật khẩu mới/), {
    target: { value: 'Next!Password-493' },
  });
  fireEvent.change(screen.getByLabelText(/^Xác nhận mật khẩu mới/), {
    target: { value: confirmation },
  });
}

it('validates password confirmation without sending a request', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fill('Different!Password-493');
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  expect(screen.getByRole('alert')).toHaveTextContent('không khớp');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uses the real reset contract once and returns to login after 204', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  expect(screen.getByRole('button', { name: 'Đang đặt lại...' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/reset-password');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    userName: 'synthetic-owner@example.invalid',
    token: 'synthetic-one-time-token',
    newPassword: 'Next!Password-493',
  });
  finish(new Response(null, { status: 204 }));
  expect(await screen.findByText('Đăng nhập bằng mật khẩu mới')).toBeInTheDocument();
});

it('reports an invalid or expired token without claiming success', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: 'Password reset failed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('không hợp lệ'));
  expect(screen.queryByText('Đăng nhập bằng mật khẩu mới')).not.toBeInTheDocument();
});
