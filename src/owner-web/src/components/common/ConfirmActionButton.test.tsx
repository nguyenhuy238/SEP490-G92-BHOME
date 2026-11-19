import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmActionButton } from './ConfirmActionButton';

it('requires a separate confirmation, supports cancellation and rejects a changed snapshot', async () => {
  const save = vi.fn(async () => {});
  const props = { title: 'Duyệt khoản thu', description: 'Kiểm tra nguồn tiền', onConfirm: save };
  const view = render(
    <ConfirmActionButton {...props} confirmationKey="v1">
      Duyệt
    </ConfirmActionButton>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
  view.rerender(
    <ConfirmActionButton {...props} confirmationKey="v2">
      Duyệt
    </ConfirmActionButton>,
  );
  expect(screen.getByRole('button', { name: 'Xác nhận thực hiện' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Dữ liệu đã thay đổi');
  expect(save).not.toHaveBeenCalled();
});

it('locks duplicate clicks until the server operation finishes', async () => {
  let resolve!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(
    <ConfirmActionButton
      title="Duyệt"
      description="Đối chiếu"
      confirmationKey="v1"
      onConfirm={save}
    >
      Thực hiện
    </ConfirmActionButton>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thực hiện' }));
  const confirm = screen.getByRole('button', { name: 'Xác nhận thực hiện' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
  await act(async () => resolve());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
