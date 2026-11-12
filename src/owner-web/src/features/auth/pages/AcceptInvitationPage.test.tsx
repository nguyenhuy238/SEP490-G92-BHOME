import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import AcceptInvitationPage from './AcceptInvitationPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fill(repeat = 'Synthetic!NewPassword493') {
  fireEvent.change(screen.getByLabelText(/Email nhận/), {
    target: { value: 'synthetic@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText(/Mã lời mời/), {
    target: { value: 'synthetic-invitation-token' },
  });
  fireEvent.change(screen.getByLabelText(/Mật khẩu mới/), {
    target: { value: 'Synthetic!NewPassword493' },
  });
  fireEvent.change(screen.getByLabelText(/Xác nhận mật khẩu/), { target: { value: repeat } });
}
it('reads invitation credentials from the fragment without sending them on page load', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter
      initialEntries={['/accept-invitation#userName=staff%40example.invalid&token=synthetic-link']}
    >
      <AcceptInvitationPage />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText(/Email nhận/)).toHaveValue('staff@example.invalid');
  expect(screen.getByLabelText(/Mã lời mời/)).toHaveValue('synthetic-link');
  expect(fetch).not.toHaveBeenCalled();
});
it('accepts invitation anonymously once and waits for server confirmation', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <AcceptInvitationPage />
    </MemoryRouter>,
  );
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  expect(screen.getByRole('button', { name: 'Thiết lập mật khẩu' })).toBeDisabled();
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(fetch.mock.calls[0]![0])).toMatch(/\/api\/v1\/auth\/accept-invitation$/);
  const request = fetch.mock.calls[0]![1] as RequestInit;
  expect(new Headers(request.headers).has('Authorization')).toBe(false);
  expect(JSON.parse(request.body as string)).toEqual({
    userName: 'synthetic@example.invalid',
    token: 'synthetic-invitation-token',
    newPassword: 'Synthetic!NewPassword493',
  });
  finish(new Response(null, { status: 204 }));
  expect(await screen.findByText(/Đã thiết lập mật khẩu/)).toBeInTheDocument();
});
it('blocks mismatched password and does not send request', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <AcceptInvitationPage />
    </MemoryRouter>,
  );
  fill('Different!Password493');
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('khớp');
});
it('keeps expired invitation error visible and allows correction', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 400, headers: { 'Content-Type': 'application/json' } }),
      ),
  );
  render(
    <MemoryRouter>
      <AcceptInvitationPage />
    </MemoryRouter>,
  );
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('chưa hợp lệ'));
  expect(screen.queryByText(/Đã thiết lập mật khẩu/)).not.toBeInTheDocument();
});
