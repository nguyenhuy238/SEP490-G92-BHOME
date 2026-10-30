import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material';
import { PortalProvider } from '../../app/PortalProvider';
import { ResourcePage } from './ResourcePage';
import { theme } from '../../theme/theme';
import { createMockRepository } from '../../services/repositories/mockPortalRepository';
vi.mock('../../services/config', () => ({ isMockMode: true }));
beforeEach(() => localStorage.clear());
function mount() {
  render(
    <ThemeProvider theme={theme}>
      <PortalProvider>
        <MemoryRouter>
          <ResourcePage kind="locations" variant="cards" />
        </MemoryRouter>
      </PortalProvider>
    </ThemeProvider>,
  );
}
it('filters cards to an empty state and resets filters', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Quản lý cơ sở' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm Quản lý cơ sở' }), {
    target: { value: 'khong-ton-tai-demo' },
  });
  expect(screen.getByRole('status')).toHaveTextContent('Không có dữ liệu phù hợp');
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  expect(screen.getByRole('heading', { name: 'BHOME Central 1 - Bạch Đằng' })).toBeInTheDocument();
});
it('validates a create form, then persists a new location through the UI', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Quản lý cơ sở' });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm cơ sở mới' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu dữ liệu demo' }));
  expect(await screen.findByText('Nhập ít nhất 2 ký tự.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tên / Nội dung'), {
    target: { value: 'Cơ sở kiểm thử UI' },
  });
  fireEvent.change(screen.getByLabelText('Mã hồ sơ'), { target: { value: 'CS-UI-TEST' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu dữ liệu demo' }));
  expect(await screen.findByRole('heading', { name: 'Cơ sở kiểm thử UI' })).toBeInTheDocument();
  await waitFor(async () =>
    expect(
      (await createMockRepository().read()).records.locations.some(
        (row) => row.code === 'CS-UI-TEST',
      ),
    ).toBe(true),
  );
});
