import { useState } from 'react';
import { Alert, Badge, Box, Button, Drawer, IconButton, Popover, Stack, Tab, Tabs, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { Bell, ChevronRight, X } from 'lucide-react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { type NotificationItem } from '../../../../../packages/client-core/src/notifications';
import { useNotifications, useUnreadNotifications } from './useNotifications';
import { hasNotificationTarget, useNotificationActions } from './useNotificationActions';
import { NotificationDetail, NotificationRows, NotificationSkeleton } from './NotificationRows';

export function NotificationBell() {
  const count = useUnreadNotifications();
  const api = useNotifications();
  const { session } = useAuth();
  const narrow = useMediaQuery('(max-width:599px)');
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [unread, setUnread] = useState('');
  const [detail, setDetail] = useState<NotificationItem | null>(null);
  const actions = useNotificationActions();
  const open = !!anchor;
  const list = useQuery({
    queryKey: ['notification-list', session?.userId, 'preview', unread],
    queryFn: ({ signal }) => api.list(1, '', unread, signal, 8),
    enabled: open && !!session,
  });
  function close() {
    setAnchor(null);
    setDetail(null);
    actions.clearError();
  }
  const viewDetail = (item: NotificationItem) => void actions.read(item, () => setDetail(item));
  const openItem = (item: NotificationItem) =>
    hasNotificationTarget(item) ? void actions.open(item, close) : viewDetail(item);
  const panel = open && (
    <Stack id="notification-preview" role="dialog" aria-labelledby="notification-preview-title"
      sx={{ width: { xs: '100%', sm: 432 }, maxHeight: { xs: '100dvh', sm: '76dvh' }, minHeight: 0 }}>
      <Stack direction="row" sx={{ px: 2, py: 1.25, gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography id="notification-preview-title" component="h2" variant="h6">Thông báo</Typography>
          {count.data && <Typography variant="caption" color="text.secondary">{count.data.unreadCount} chưa đọc</Typography>}
        </Box>
        <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
          <Button size="small" disabled={actions.busy || !count.data?.unreadCount} onClick={() => void actions.readAll()}>
            Đánh dấu tất cả đã đọc
          </Button>
          <IconButton aria-label="Đóng thông báo" size="small" onClick={close}><X size={18} /></IconButton>
        </Stack>
      </Stack>
      {detail ? (
        <Box sx={{ px: 1.5 }}><Button size="small" onClick={() => setDetail(null)}>Về danh sách</Button></Box>
      ) : (
        <Tabs value={unread} onChange={(_, value: string) => setUnread(value)}
          aria-label="Lọc thông báo" sx={{ px: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
          <Tab value="" label="Tất cả" /><Tab value="true" label="Chưa đọc" />
        </Tabs>
      )}
      <Box sx={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
        {actions.error && <Alert severity="error" sx={{ m: 1.5 }}>{actions.error}</Alert>}
        {detail ? (
          <NotificationDetail item={detail} busy={actions.busy} onOpen={() => void actions.open(detail, close)} />
        ) : list.isPending ? <NotificationSkeleton /> : list.isError ? (
          <Alert severity="error" sx={{ m: 1.5 }} action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}>
            Không tải được thông báo.
          </Alert>
        ) : list.data?.items.length ? (
          <NotificationRows items={list.data.items} busy={actions.busy} onOpen={openItem}
            onDetail={viewDetail} onRead={(item) => void actions.read(item)} />
        ) : (
          <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            {unread ? 'Bạn đã đọc tất cả thông báo.' : 'Bạn chưa có thông báo.'}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 0.75 }}>
        <Button fullWidth component={Link} to="/notifications" onClick={close} endIcon={<ChevronRight size={16} />}>
          Xem tất cả thông báo
        </Button>
      </Box>
    </Stack>
  );
  return (
    <>
      <Tooltip
      title={
        count.error ? 'Không tải được số thông báo. Mở hộp thư để thử lại.' : 'Thông báo của tôi'
      }
    >
        <IconButton aria-label="Thông báo" aria-haspopup="dialog" aria-expanded={open}
          aria-controls={open ? 'notification-preview' : undefined}
          sx={{ bgcolor: open ? 'action.selected' : undefined }}
          onClick={(event) => {
            if (open) close();
            else { setUnread(''); setAnchor(event.currentTarget); void count.refetch(); }
          }}>
          <Badge badgeContent={count.data?.unreadCount} max={99} color="primary">
            <Bell size={19} />
          </Badge>
        </IconButton>
      </Tooltip>
      {narrow ? (
        <Drawer anchor="right" open={open} onClose={close}
          slotProps={{ paper: { sx: { width: '100%', maxWidth: 460 } } }}>{panel}</Drawer>
      ) : (
        <Popover open={open} anchorEl={anchor} onClose={close} transitionDuration={170}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { mt: 0.75, border: '1px solid', borderColor: 'divider', borderRadius: 2,
            boxShadow: '0 12px 36px rgba(15, 23, 42, 0.14)', maxWidth: 'calc(100vw - 32px)' } } }}>
          {panel}
        </Popover>
      )}
    </>
  );
}
