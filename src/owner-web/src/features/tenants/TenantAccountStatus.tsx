import { Alert, Stack, Typography } from '@mui/material';
import { formatInstant } from '../../../../../packages/client-core/src/localization';

export interface ResidentAccount {
  isActive: boolean;
  emailConfirmed: boolean;
  invitationAcceptedAt: string | null;
  invitationDispatchState: string | null;
  jobState: string | null;
  deliveryState: string | null;
}
const states: Record<string, string> = {
  Pending: 'Đang chờ xử lý / thử lại',
  Processing: 'Đang xử lý',
  Completed: 'Job đã hoàn tất',
  Failed: 'Xử lý thất bại, cần kiểm tra',
  Dispatching: 'Đang tạo lời mời',
  Queued: 'Đã xếp hàng gửi email',
  Sent: 'Máy chủ email đã tiếp nhận thư',
  AcceptedByProvider: 'Nhà cung cấp đã tiếp nhận yêu cầu',
  PendingReview: 'Cần kiểm tra thủ công kết quả gửi email',
  PendingManualReview: 'Cần kiểm tra thủ công lời mời',
  PermanentlyFailed: 'Gửi email thất bại',
  Suppressed: 'Liên kết đã hết hiệu lực, không gửi',
  SupersededByExistingInvitation: 'Giữ lời mời đang còn hiệu lực',
};
export function TenantAccountStatus({ account }: { account: ResidentAccount | null | undefined }) {
  if (!account) return <Typography>Chưa có tài khoản Tenant liên kết.</Typography>;
  const review = ['Failed', 'PermanentlyFailed', 'PendingReview', 'PendingManualReview'];
  const status = account.deliveryState ?? account.invitationDispatchState ?? account.jobState;
  return (
    <Stack spacing={1}>
      <Typography>
        Tài khoản {account.isActive ? 'đang hoạt động' : 'đã ngừng hoạt động'} ·{' '}
        {account.emailConfirmed ? 'Email đã xác nhận' : 'Email chưa xác nhận'}
      </Typography>
      {account.invitationAcceptedAt ? (
        <Alert severity="success">
          Đã chấp nhận lời mời và hoàn tất thiết lập mật khẩu lúc{' '}
          {formatInstant(account.invitationAcceptedAt)}.
        </Alert>
      ) : (
        <Typography>Chưa ghi nhận chấp nhận lời mời thiết lập mật khẩu.</Typography>
      )}
      {!account.invitationAcceptedAt && status && (
        <Alert severity={review.includes(status) ? 'warning' : 'info'}>
          {states[status] ?? 'Chưa xác định kết quả lời mời.'}
        </Alert>
      )}
      {!account.invitationAcceptedAt && (
        <Typography variant="caption">
          Xếp hàng hoặc nhà cung cấp tiếp nhận không bảo đảm thư đã đến hộp thư. Tải lại để xem kết
          quả mới nhất.
        </Typography>
      )}
    </Stack>
  );
}
