import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../../theme/theme';
import { ChangePasswordDialog } from './ChangePasswordDialog';

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ client: { changePassword: mocks.changePassword } }),
}));

function setup(onChanged = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <ChangePasswordDialog open onClose={vi.fn()} onChanged={onChanged} />
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

beforeEach(() => mocks.changePassword.mockReset());
afterEach(cleanup);

it('validates password confirmation without calling the backend', () => {
  setup();
  fill('Current!Password-493', 'Next!Password-493', 'Different!Password-493');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(screen.getByRole('alert')).toHaveTextContent('không khớp');
  expect(mocks.changePassword).not.toHaveBeenCalled();
});

it('submits the backend-compatible fields once and reports success', async () => {
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
  expect(mocks.changePassword).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});
