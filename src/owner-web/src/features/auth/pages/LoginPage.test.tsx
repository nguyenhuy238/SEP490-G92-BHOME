import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material';
import { AuthProvider } from '../../../../../../packages/client-core/src/auth';
import { theme } from '../../../theme/theme';
import { LoginPage } from './LoginPage';

afterEach(() => vi.unstubAllGlobals());

const session = {
  userId: 'synthetic-owner',
  roles: ['Owner'],
  accessToken: 'synthetic-token',
  sessionId: 'synthetic-session',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function setup() {
  // Empty base skips startup refresh, while exercising real web SessionClient requests.
  return render(
    <ThemeProvider theme={theme}>
      <AuthProvider transport="web">
        <LoginPage />
      </AuthProvider>
    </ThemeProvider>,
  );
}

function fillLogin() {
  fireEvent.change(screen.getByLabelText('Email hoặc Số điện thoại'), {
    target: { value: ' synthetic-owner@example.invalid ' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), {
    target: { value: ' Synthetic!Password-493 ' },
  });
}

it('keeps required fields empty, masks the password, and explains unsupported remember-login', () => {
  setup();
  const identifier = screen.getByLabelText('Email hoặc Số điện thoại');
  expect(identifier).toBeRequired();
  expect(identifier).toHaveValue('');
  expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password');
  expect(screen.getByRole('checkbox', { name: 'Ghi nhớ đăng nhập' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
  expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
  expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password');
});

it('does not send an empty or whitespace-only identifier', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fireEvent.change(screen.getByLabelText('Email hoặc Số điện thoại'), { target: { value: '   ' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'synthetic' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }).closest('form')!);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uses the confirmed web contract, preserves password whitespace and clears credentials on success', async () => {
  const fetchMock = vi.fn().mockResolvedValue(json(session));
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Đăng nhập thành công');
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/v1/auth/login');
  expect(JSON.parse(options.body)).toEqual({
    email: 'synthetic-owner@example.invalid',
    password: ' Synthetic!Password-493 ',
  });
  expect(options.credentials).toBe('include');
  expect(options.headers.get('X-BHome-Client')).toBe('web');
  expect(screen.queryByLabelText('Mật khẩu')).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic-token')).not.toBeInTheDocument();
});

it('shows pending state and disables duplicate submission', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }));
  expect(screen.getByRole('button', { name: 'Đang xác thực...' })).toBeDisabled();
  expect(screen.getByLabelText('Mật khẩu')).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish(json(session));
  await screen.findByText(/Đăng nhập thành công/);
});

it.each([401, 429, 503])(
  'shows a safe error for HTTP %s and clears the password for retry',
  async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, status)));
    setup();
    fillLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 429 ? 'quá nhiều lần' : 'Không thể đăng nhập',
    );
    await waitFor(() => expect(screen.getByLabelText('Mật khẩu')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' })).toBeEnabled();
  },
);

it('rejects a Staff login and revokes the session instead of displaying Owner success', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ ...session, roles: ['Staff'] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập vào hệ thống' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'không có quyền truy cập Owner Portal',
  );
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/logout');
  expect(screen.queryByText(/Đăng nhập thành công/)).not.toBeInTheDocument();
});

it('reports unavailable reset delivery without claiming an email was sent', async () => {
  const fetchMock = vi.fn().mockResolvedValue(json({}, 503));
  vi.stubGlobal('fetch', fetchMock);
  setup();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
  expect(screen.getByRole('textbox', { name: /Tên đăng nhập/ })).toHaveValue(
    ' synthetic-owner@example.invalid ',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Gửi hướng dẫn' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Chưa thể gửi hướng dẫn');
  expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/forgot-password');
});
