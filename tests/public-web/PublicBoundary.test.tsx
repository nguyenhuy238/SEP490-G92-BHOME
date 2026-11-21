import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/public-web/src/app/App';
import { businessTimeZone, formatVnd } from '@bhome/client-core/localization.ts';

it('keeps the public shell information-only', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByText('Hiện chưa có thông tin được công bố.')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /đăng nhập|đặt phòng|thanh toán/i }),
  ).not.toBeInTheDocument();
});
it('centralizes Vietnamese currency and business timezone', () => {
  expect(businessTimeZone).toBe('Asia/Ho_Chi_Minh');
  expect(formatVnd(1200000)).toMatch(/1\.200\.000/);
});
