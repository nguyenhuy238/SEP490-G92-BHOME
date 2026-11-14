import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AnonymousSigningPage from './pages/AnonymousSigningPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const token = 'A'.repeat(64);
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
it('keeps token in request body and requires OTP before exposing exact PDF and acceptance', async () => {
  window.history.replaceState(null, '', '/contract-signing#token=' + token);
  const fetch = vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/info'))
      return Promise.resolve(json({ maskedEmail: 's***@example.invalid', accepted: false }));
    if (path.endsWith('/otp')) return Promise.resolve(new Response(null, { status: 204 }));
    if (path.endsWith('/verify'))
      return Promise.resolve(
        json({
          session: 'B'.repeat(64),
          documentHash: 'HASH',
          consentVersion: 'internal-acceptance-v1',
        }),
      );
    if (path.endsWith('/document')) return Promise.resolve(new Response('%PDF-test'));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal('fetch', fetch);
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-private-pdf');
  URL.revokeObjectURL = vi.fn();
  render(<AnonymousSigningPage />);
  await screen.findByText(/s\*\*\*@example.invalid/);
  expect(window.location.hash).toBe('');
  expect(screen.queryByTitle('PDF hợp đồng cần chấp thuận')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mã OTP' }));
  await screen.findByText(/Đã yêu cầu gửi/);
  fireEvent.change(screen.getByLabelText('Mã OTP 6 chữ số'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác minh và xem hợp đồng' }));
  expect(await screen.findByTitle('PDF hợp đồng cần chấp thuận')).toHaveAttribute(
    'src',
    'blob:synthetic-private-pdf',
  );
  expect(screen.getByRole('button', { name: 'Chấp thuận hợp đồng' })).toBeDisabled();
  expect(screen.getByText('Mã tài liệu: HASH')).toBeInTheDocument();
  for (const [path, init] of fetch.mock.calls) {
    expect(path).not.toContain(token);
    expect(JSON.parse(init.body).token).toBe(token);
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  }
});
it('does not claim delivery when email is unavailable', async () => {
  window.history.replaceState(null, '', '/contract-signing#token=' + token);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ maskedEmail: 's***@example.invalid', accepted: false }))
      .mockResolvedValue(
        new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
      ),
  );
  render(<AnonymousSigningPage />);
  await screen.findByText(/s\*\*\*@example.invalid/);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mã OTP' }));
  expect(await screen.findByText(/Chưa cấu hình dịch vụ gửi mã/)).toBeInTheDocument();
  expect(screen.queryByText(/Đã yêu cầu gửi/)).not.toBeInTheDocument();
});
