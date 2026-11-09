import { ResourcePage } from '../../../components/common/ResourcePage';
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import {
  notificationCategories,
  ownerNotificationRoute,
} from '../../../../../../packages/client-core/src/notifications';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { useNotifications, useUnreadNotifications } from '../useNotifications';
import { PageHeader } from '../../../components/common/PortalUI';
import { isMockMode } from '../../../services/config';
import { NotificationManagement } from '../NotificationManagement';
export default function NotificationsPage() {
  return isMockMode ? (
    <ResourcePage kind="notifications" variant="notifications" />
  ) : (
    <LiveNotificationsPage />
  );
}
export function LiveNotificationsPage() {
  const api = useNotifications();
  const { session } = useAuth();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1),
    [category, setCategory] = useState(''),
    [unread, setUnread] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const count = useUnreadNotifications();
  const list = useQuery({
    queryKey: ['notification-list', session?.userId, page, category, unread],
    queryFn: ({ signal }) => api.list(page, category, unread, signal),
    refetchInterval: 30000,
  });
  async function action(work: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['notification-list'] }),
        cache.invalidateQueries({ queryKey: ['notification-count'] }),
      ]);
    } catch (e) {
      setError(invoiceError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Thông báo của tôi"
        subtitle="Thông báo lưu trong tài khoản của bạn; quyền mở hồ sơ được kiểm tra lại khi truy cập."
      />
      <Stack spacing={2}>
        {session?.roles?.includes('Owner') && <NotificationManagement />}
        <Stack direction="row" spacing={1}>
          <Button
            onClick={() => {
              void list.refetch();
              void count.refetch();
            }}
          >
            Làm mới
          </Button>
          <Button
            disabled={busy || !count.data?.unreadCount}
            onClick={() => void action(() => api.readAll())}
          >
            Đánh dấu tất cả đã đọc
          </Button>
          <Typography>
            {count.data ? `${count.data.unreadCount} chưa đọc` : 'Đang tải số chưa đọc'}
          </Typography>
        </Stack>
        <TextField
          select
          label="Nhóm thông báo"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả nhóm</MenuItem>
          {Object.entries(notificationCategories).map(([id, label]) => (
            <MenuItem key={id} value={id}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Trạng thái đọc"
          value={unread}
          onChange={(e) => {
            setUnread(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả</MenuItem>
          <MenuItem value="true">Chưa đọc</MenuItem>
          <MenuItem value="false">Đã đọc</MenuItem>
        </TextField>
        {list.isPending && <LinearProgress />}
        {(error || list.error || count.error) && (
          <Alert severity="error">{error || invoiceError(list.error ?? count.error)}</Alert>
        )}
        {list.data?.items.length === 0 && (
          <Alert severity="info">Không có thông báo phù hợp.</Alert>
        )}
        {list.data?.items.map((n) => (
          <Paper key={n.id} sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1}>
                <Chip
                  label={
                    notificationCategories[n.category as keyof typeof notificationCategories] ??
                    n.category
                  }
                />
                <Chip
                  label={n.readAt ? 'Đã đọc' : 'Chưa đọc'}
                  color={n.readAt ? 'default' : 'primary'}
                />
              </Stack>
              <Typography variant="h6">{n.title}</Typography>
              <Typography>{n.summary}</Typography>
              <Typography variant="body2">{formatInstant(n.createdAt)}</Typography>
              <Stack direction="row">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const target = await api.target(n.id);
                      const route = ownerNotificationRoute(target);
                      if (!route) throw new Error('unsupported_notification_target');
                      await api.read(n.id);
                      navigate(route);
                    })
                  }
                >
                  Mở hồ sơ liên quan
                </Button>
                {!n.readAt && (
                  <Button disabled={busy} onClick={() => void action(() => api.read(n.id))}>
                    Đánh dấu đã đọc
                  </Button>
                )}
              </Stack>
            </Stack>
          </Paper>
        ))}
        <Stack direction="row">
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Trang trước
          </Button>
          <Typography>Trang {page}</Typography>
          <Button
            disabled={!list.data || page * 20 >= list.data.totalCount}
            onClick={() => setPage(page + 1)}
          >
            Trang sau
          </Button>
        </Stack>
      </Stack>
    </>
  );
}
