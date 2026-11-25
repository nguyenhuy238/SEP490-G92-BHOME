import { TextField } from '../../../components/common/ValidatedForm';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { invoiceError } from '../../../../../../packages/client-core/src/invoices';
import {
  ownerNotificationCategories as notificationCategories,
  type NotificationItem,
} from '../../../../../../packages/client-core/src/notifications';
import { useNotifications, useUnreadNotifications } from '../useNotifications';
import { FilterToolbar, PageHeader } from '../../../components/common/PortalUI';
import { isMockMode } from '../../../services/config';
import { NotificationManagement } from '../NotificationManagement';
import { NotificationDetail, NotificationRows, NotificationSkeleton } from '../NotificationRows';
import { hasNotificationTarget, useNotificationActions } from '../useNotificationActions';
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
  const actions = useNotificationActions();
  const navigate = useNavigate();
  const [tab, setTab] = useState('inbox');
  const [composeVisited, setComposeVisited] = useState(false);
  const composing = tab === 'compose' && session?.roles?.includes('Owner');
  const [page, setPage] = useState(1),
    [category, setCategory] = useState(''),
    [unread, setUnread] = useState('');
  const [detail, setDetail] = useState<NotificationItem | null>(null);
  const count = useUnreadNotifications();
  const list = useQuery({
    queryKey: ['notification-list', session?.userId, page, category, unread],
    queryFn: ({ signal }) => api.list(page, category, unread, signal),
    enabled: !composing,
    refetchInterval: composing ? false : 30000,
  });
  const viewDetail = (item: NotificationItem) => void actions.read(item, () => setDetail(item));
  const openItem = (item: NotificationItem) =>
    hasNotificationTarget(item) ? void actions.open(item) : viewDetail(item);
  return (
    <>
      <PageHeader title={composing ? 'Soạn và quản lý thông báo' : 'Trung tâm thông báo'} />
      {import.meta.env.DEV && import.meta.env.VITE_SMS_DEMO_ENABLED === 'true' && (
        <Button onClick={() => navigate('/demo/sms')}>Hộp thư SMS Demo</Button>
      )}
      {session?.roles?.includes('Owner') && (
        <Tabs
          value={tab}
          onChange={(_, v: string) => {
            setTab(v);
            if (v === 'compose') setComposeVisited(true);
          }}
          aria-label="Không gian thông báo"
          sx={{ mb: 2 }}
        >
          <Tab value="inbox" label="Thông báo của tôi" />
          <Tab value="compose" label="Soạn và quản lý" />
        </Tabs>
      )}
      {composeVisited && session?.roles?.includes('Owner') && (
        <Box hidden={!composing}>
          <NotificationManagement />
        </Box>
      )}
      {!composing && (
        <Stack spacing={2}>
          <Stack
            direction="row"
            useFlexGap
            spacing={1}
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Button
              onClick={() => {
                void list.refetch();
                void count.refetch();
              }}
            >
              Làm mới
            </Button>
            <Button
              disabled={actions.busy || !count.data?.unreadCount}
              onClick={() => void actions.readAll()}
            >
              Đánh dấu tất cả đã đọc
            </Button>
            <Typography>
              {count.data ? `${count.data.unreadCount} chưa đọc` : 'Đang tải số chưa đọc'}
            </Typography>
          </Stack>
          <FilterToolbar>
            <TextField
              select
              label="Nhóm thông báo"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setDetail(null);
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
                setDetail(null);
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả</MenuItem>
              <MenuItem value="true">Chưa đọc</MenuItem>
              <MenuItem value="false">Đã đọc</MenuItem>
            </TextField>
          </FilterToolbar>
          {(actions.error || list.error || count.error) && (
            <Alert severity="error" action={list.error ? <Button onClick={() => void list.refetch()}>Thử lại</Button> : undefined}>
              {actions.error || invoiceError(list.error ?? count.error)}
            </Alert>
          )}
          <Paper variant="outlined" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(290px, 38%) minmax(0, 1fr)' }, overflow: 'hidden' }}>
            <Box sx={{ display: { xs: detail ? 'none' : 'block', md: 'block' }, maxHeight: { md: '65dvh' }, overflowY: 'auto', borderRight: { md: '1px solid' }, borderColor: { md: 'divider' } }}>
              {list.isPending && <NotificationSkeleton />}
              {!list.error && list.data?.items.length === 0 && (
                <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                  {unread === 'true' && !category ? 'Bạn đã đọc tất cả thông báo.' : 'Không có thông báo phù hợp.'}
                </Typography>
              )}
              {!list.error && !!list.data?.items.length && (
                <NotificationRows items={list.data.items} busy={actions.busy} selectedId={detail?.id}
                  onOpen={openItem} onDetail={viewDetail} onRead={(item) => void actions.read(item)} />
              )}
            </Box>
            <Box sx={{ display: { xs: detail ? 'block' : 'none', md: 'block' }, minWidth: 0 }}>
              {detail ? (
                <>
                  <Button sx={{ m: 1.5, mb: 0 }} size="small" onClick={() => setDetail(null)}>Về danh sách</Button>
                  <NotificationDetail item={detail} busy={actions.busy} onOpen={() => void actions.open(detail)} />
                </>
              ) : (
                <Typography color="text.secondary" sx={{ px: 3, py: 4 }}>
                  Chọn “Xem chi tiết” trong menu của thông báo để đọc tại đây.
                </Typography>
              )}
            </Box>
          </Paper>
          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}
          >
            <Button disabled={page === 1 || list.isFetching} onClick={() => setPage(page - 1)}>
              Trang trước
            </Button>
            <Typography>Trang {page}</Typography>
            <Button
              disabled={list.isFetching || !list.data || page * 20 >= list.data.totalCount}
              onClick={() => setPage(page + 1)}
            >
              Trang sau
            </Button>
          </Stack>
        </Stack>
      )}
    </>
  );
}
