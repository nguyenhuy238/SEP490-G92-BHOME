import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../../theme/theme';
import { ChangePasswordDialog } from './ChangePasswordDialog';

const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), login: vi.fn(), clear: vi.fn() }));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({
    client: {
      changePassword: mocks.changePassword,
      login: mocks.login,
      clear: mocks.clear,
      session: { roles: ['Owner'] },
    },
  }),
}));

function setup(onChanged = vi.fn(), onReauthenticationRequired = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <ChangePasswordDialog
        open
        accountEmail="owner@example.invalid"
        onClose={vi.fn()}
        onChanged={onChanged}
        onReauthenticationRequired={onReauthenticationRequired}
      />
    </ThemeProvider>,
  );
  return onChanged;
}

function fill(current: string, next: string, confirmation = next) {
  fireEvent.change(screen.getByLabelText(/^Mật khẩu hiện tại/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Mật khẩu mới/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/^Xác nhận mật khẩu mới/), {
    target: { value: confirmation },
  });
}

beforeEach(() => {
  mocks.changePassword.mockReset();
  mocks.login.mockReset().mockResolvedValue(undefined);
  mocks.clear.mockReset();
});
afterEach(cleanup);

it('validates password confirmation without calling the backend', () => {
  setup();
  fill('Current!Password-493', 'Next!Password-493', 'Different!Password-493');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(screen.getByRole('alert')).toHaveTextContent('không khớp');
  expect(mocks.changePassword).not.toHaveBeenCalled();
});

it('changes the password then restores the current Owner session with the new password', async () => {
  let finish!: () => void;
  mocks.changePassword.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const changed = setup();
  fill('Current!Password-493', 'Next!Password-493');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(screen.getByRole('button', { name: 'Đang đổi...' })).toBeDisabled();
  expect(mocks.changePassword).toHaveBeenCalledWith('Current!Password-493', 'Next!Password-493');
  finish();
  await waitFor(() =>
    expect(mocks.login).toHaveBeenCalledWith('owner@example.invalid', 'Next!Password-493'),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it('falls back to the login route callback if password changed but session restoration fails', async () => {
  mocks.changePassword.mockResolvedValue(undefined);
  mocks.login.mockRejectedValue(new Error('network'));
  const reauthenticationRequired = vi.fn();
  setup(vi.fn(), reauthenticationRequired);
  fill('Current!Password-493', 'Next!Password-493');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  await waitFor(() => expect(reauthenticationRequired).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: 'Đăng xuất tất cả thiết bị' })).not.toBeInTheDocument();
});
