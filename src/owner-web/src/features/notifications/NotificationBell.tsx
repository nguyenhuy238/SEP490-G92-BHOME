import { Badge, IconButton, Tooltip } from '@mui/material';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useUnreadNotifications } from './useNotifications';
export function NotificationBell() {
  const count = useUnreadNotifications();
  const navigate = useNavigate();
  return (
    <Tooltip
      title={
        count.error ? 'Không tải được số thông báo. Mở hộp thư để thử lại.' : 'Thông báo của tôi'
      }
    >
      <IconButton aria-label="Thông báo" onClick={() => navigate('/notifications')}>
        <Badge badgeContent={count.data?.unreadCount} color="error">
          <Bell size={19} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
