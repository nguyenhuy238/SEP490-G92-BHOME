import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuItem } from '@mui/material';
import { TextField, ValidatedForm, ValidatedInput } from './ValidatedForm';
import { catalogError, UserFeedbackError } from '../../../../../packages/client-core/src/api';

describe('application-managed HTML constraints', () => {
  it('preserves only explicitly trusted local feedback through domain catalogs', () => {
    expect(catalogError(new UserFeedbackError('Vui lòng chọn bằng chứng.'))).toBe(
      'Vui lòng chọn bằng chứng.',
    );
    expect(catalogError(new Error('Private provider detail'))).toBeUndefined();
  });
  it('keeps semantic constraints, blocks all invalid fields and focuses the first without native popups', () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <ValidatedForm aria-label="Hồ sơ" onSubmit={submit}>
        <TextField label="Họ tên" required slotProps={{ htmlInput: { minLength: 2 } }} />
        <TextField label="Email" required type="email" defaultValue="invalid" />
        <button type="submit">Lưu</button>
      </ValidatedForm>,
    );
    const form = screen.getByRole('form');
    expect(form).toHaveAttribute('novalidate');
    fireEvent.submit(form);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Họ tên/)).toHaveFocus();
    expect(screen.getByLabelText(/Họ tên/)).toHaveAttribute('required');
    expect(screen.getByText('Vui lòng nhập thông tin này.')).toBeVisible();
    expect(screen.getByText('Vui lòng nhập địa chỉ email hợp lệ.')).toBeVisible();
    fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: '  ' } });
    fireEvent.submit(form);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText(/Họ tên/), { target: { value: 'Nguyễn tổng hợp' } });
    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'test@example.invalid' } });
    fireEvent.submit(form);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains drafts and business feedback while validating numeric bounds and programmatic lengths', () => {
    render(
      <ValidatedForm aria-label="Giá trị">
        <TextField label="Mã" defaultValue="x" slotProps={{ htmlInput: { minLength: 2 } }} />
        <TextField
          label="Số lượng"
          type="number"
          defaultValue="-1"
          slotProps={{ htmlInput: { min: 0 } }}
        />
        <TextField label="Ghi chú" defaultValue="Giữ nguyên" error helperText="Lỗi nghiệp vụ" />
      </ValidatedForm>,
    );
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByText('Vui lòng nhập ít nhất 2 ký tự.')).toBeVisible();
    expect(screen.getByText('Giá trị phải từ 0 trở lên.')).toBeVisible();
    expect(screen.getByText('Lỗi nghiệp vụ')).toBeVisible();
    expect(screen.getByLabelText('Ghi chú')).toHaveValue('Giữ nguyên');
  });

  it('validates native select constraints and ignores disabled/read-only controls', () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <ValidatedForm aria-label="Lựa chọn" onSubmit={submit}>
        <TextField
          select
          label="Loại"
          required
          defaultValue=""
          slotProps={{ select: { native: true } }}
        >
          <option value="">Chọn</option>
          <option value="existing">Đã có</option>
        </TextField>
        <TextField label="Khóa" required disabled />
        <TextField label="Chỉ đọc" required slotProps={{ htmlInput: { readOnly: true } }} />
        <TextField select label="Tùy chọn" defaultValue="known">
          <MenuItem value="known">Đã biết</MenuItem>
        </TextField>
      </ValidatedForm>,
    );
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByLabelText(/Loại/)).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Loại/), { target: { value: 'existing' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('associates required plain file feedback without losing the selected file', () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <ValidatedForm aria-label="Bằng chứng" onSubmit={submit}>
        <label>
          Tệp
          <ValidatedInput type="file" required />
        </label>
      </ValidatedForm>,
    );
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByText('Vui lòng chọn tệp.')).toBeVisible();
    expect(screen.getByLabelText(/Tệp/)).toHaveAttribute('aria-invalid', 'true');
    const file = new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Tệp/), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('form'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/Tệp/) as HTMLInputElement).files?.[0]).toBe(file);
  });
});
