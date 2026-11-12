import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TenantAccountStatus, type ResidentAccount } from './TenantAccountStatus';
afterEach(cleanup);
const base: ResidentAccount = {
  isActive: true,
  emailConfirmed: false,
  invitationAcceptedAt: null,
  invitationDispatchState: null,
  jobState: 'Pending',
  deliveryState: null,
};
it.each([
  ['Pending', 'Đang chờ xử lý / thử lại'],
  ['Queued', 'Đã xếp hàng gửi email'],
  ['Processing', 'Đang xử lý'],
  ['Sent', 'Máy chủ email đã tiếp nhận thư'],
  ['PendingReview', 'Cần kiểm tra thủ công kết quả gửi email'],
  ['PermanentlyFailed', 'Gửi email thất bại'],
])('shows existing %s delivery state without claiming mailbox delivery', (status, label) => {
  render(<TenantAccountStatus account={{ ...base, deliveryState: status }} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText(/không bảo đảm thư đã đến hộp thư/)).toBeInTheDocument();
});
it('shows setup completion only with the server invitation acceptance evidence', () => {
  render(
    <TenantAccountStatus
      account={{ ...base, emailConfirmed: true, invitationAcceptedAt: '2026-11-12T12:00:00Z' }}
    />,
  );
  expect(
    screen.getByText(/Đã chấp nhận lời mời và hoàn tất thiết lập mật khẩu/),
  ).toBeInTheDocument();
});
