import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import AcceptInvitationPage from './AcceptInvitationPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const address = 'verified@example.invalid';
const entry = '/accept-invitation#userName=untrusted%40example.invalid&token=synthetic-link';
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">{location.pathname + location.search + location.hash}</output>
  );
}
function mount(url = entry) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Location />
      <Routes>
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="/login" element={<h1>Login destination</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
function setup(status = 'Valid') {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/validate')
        ? Response.json({ status, email: status === 'Valid' ? address : null })
        : new Response(null, { status: 204 }),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function fill(password = 'Synthetic!NewPassword493', repeat = password) {
  await screen.findByLabelText(/Email nhận/);
  fireEvent.change(screen.getByLabelText(/^Mật khẩu mới/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/^Xác nhận mật khẩu/), { target: { value: repeat } });
}
it('validates the token automatically, uses only the server email, and scrubs credentials while retaining them for submission', async () => {
  const fetch = setup();
  mount();
  const email = await screen.findByLabelText(/Email nhận/);
  expect(email).toHaveValue(address);
  expect(email).toHaveAttribute('readonly');
  expect(screen.getByTestId('location')).toHaveTextContent('/accept-invitation');
  expect(screen.queryByLabelText(/Mã lời mời|liên kết trong email/)).toBeNull();
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ token: 'synthetic-link' });
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  await screen.findByText('Login destination');
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({
    token: 'synthetic-link',
    newPassword: 'Synthetic!NewPassword493',
  });
});
it('reads a token-only link and a legacy query link without requiring email input', async () => {
  setup();
  const view = mount('/accept-invitation?token=synthetic-link');
  expect(await screen.findByLabelText(/Email nhận/)).toHaveValue(address);
  expect(screen.getByTestId('location').textContent).toBe('/accept-invitation');
  view.unmount();
  mount('/accept-invitation#token=synthetic-link');
  expect(await screen.findByLabelText(/Email nhận/)).toHaveValue(address);
});
it('never displays a password form or calls validation when the token is absent or duplicated', () => {
  const fetch = setup();
  const view = mount('/accept-invitation');
  expect(screen.getByRole('alert')).toHaveTextContent('không hợp lệ');
  expect(screen.queryByLabelText(/^Mật khẩu mới/)).toBeNull();
  view.unmount();
  mount('/accept-invitation#token=a&token=b');
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  ['Invalid', 'không hợp lệ'],
  ['Expired', 'hết hạn'],
  ['Used', 'đã được sử dụng'],
  ['Revoked', 'thu hồi'],
  ['AlreadyActivated', 'đã được kích hoạt'],
])('blocks form for %s', async (status, message) => {
  setup(status);
  mount();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  expect(screen.queryByLabelText(/^Mật khẩu mới/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Đến đăng nhập' })).toHaveAttribute('href', '/login');
});
it('retries validation after a connection failure', async () => {
  const fetch = setup();
  fetch.mockRejectedValueOnce(new TypeError('network'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByLabelText(/Email nhận/)).toHaveValue(address);
});
it('toggles both passwords independently and preserves value and pointer focus without submitting', async () => {
  const fetch = setup();
  mount();
  await fill();
  const password = screen.getByLabelText(/^Mật khẩu mới/);
  const repeat = screen.getByLabelText(/^Xác nhận mật khẩu/);
  password.focus();
  const eye = screen.getByRole('button', { name: 'Hiện mật khẩu mới' });
  fireEvent.mouseDown(eye);
  fireEvent.click(eye);
  expect(password).toHaveFocus();
  expect(password).toHaveAttribute('type', 'text');
  expect(repeat).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Hiện xác nhận mật khẩu' }));
  expect(repeat).toHaveAttribute('type', 'text');
  expect(repeat).toHaveValue('Synthetic!NewPassword493');
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu mới' }));
  expect(password).toHaveAttribute('type', 'password');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  ['short', 'short', 'Ít nhất 12'],
  ['Synthetic!NewPassword493', 'other', 'không khớp'],
])('validates password fields before sending (%s)', async (password, repeat, error) => {
  const fetch = setup();
  mount();
  await fill(password, repeat);
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  expect(screen.getAllByText(new RegExp(error)).length).toBeGreaterThan(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('prevents duplicate submit while awaiting acceptance', async () => {
  let finish!: (value: Response) => void;
  const fetch = setup();
  mount();
  await fill();
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const button = screen.getByRole('button', { name: 'Thiết lập mật khẩu' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(button).toBeDisabled();
  finish(new Response(null, { status: 204 }));
  await screen.findByText('Login destination');
});
