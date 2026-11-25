import { useState, type MouseEvent } from 'react';
import { Box, Button, ButtonBase, IconButton, Menu, MenuItem, Skeleton, Stack, Typography } from '@mui/material';
import { Bell, ClipboardList, FileText, MoreHorizontal, TriangleAlert, Wallet, Wrench } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { ownerNotificationCategories, type NotificationItem } from '../../../../../packages/client-core/src/notifications';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { hasNotificationTarget } from './useNotificationActions';

const categoryLabels: Record<string, string> = {
  ...ownerNotificationCategories, OperationalTask: 'Vận hành', Maintenance: 'Bảo trì',
  Booking: 'Giữ chỗ', System: 'Hệ thống',
};
const categoryIcons: Record<string, typeof Bell> = {
  Contract: FileText, Booking: FileText, Task: ClipboardList, OperationalTask: ClipboardList,
  Payment: Wallet, Invoice: Wallet, Adjustment: Wallet, Maintenance: Wrench, Incident: TriangleAlert,
};
const businessDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});
function dayNumber(date: Date) {
  if (Number.isNaN(date.getTime())) return NaN;
  const parts = businessDay.formatToParts(date);
  const part = (name: string) => Number(parts.find(({ type }) => type === name)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}
const exactDate = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
});
const relative = new Intl.RelativeTimeFormat('vi', { numeric: 'always' });

function notificationTime(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return relative.format(-minutes, 'minute');
  if (dayNumber(date) === dayNumber(now)) return relative.format(-Math.floor(minutes / 60), 'hour');
  if (dayNumber(now) - dayNumber(date) === 1) return 'Hôm qua';
  return exactDate.format(date);
}

function NotificationRow({ item, now, busy, selected, onOpen, onDetail, onRead }: {
  item: NotificationItem; now: Date; busy: boolean; selected: boolean;
  onOpen: (item: NotificationItem) => void; onDetail: (item: NotificationItem) => void;
  onRead: (item: NotificationItem) => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const Icon = categoryIcons[item.category] ?? Bell;
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => setMenu(event.currentTarget);
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', listStyle: 'none',
      borderBottom: '1px solid', borderColor: 'divider',
      bgcolor: selected || !item.readAt ? (theme) => alpha(theme.palette.primary.main, 0.07) : 'background.paper',
      '&:hover': { bgcolor: 'action.hover' } }}>
      <ButtonBase onClick={() => onOpen(item)} disabled={busy} aria-label={item.title}
        aria-current={selected ? 'true' : undefined} sx={{ flex: 1, minWidth: 0, p: 1.5, gap: 1.25,
          textAlign: 'left', justifyContent: 'flex-start', alignItems: 'flex-start',
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
        <Box sx={{ width: 36, height: 36, display: 'grid', placeItems: 'center', flexShrink: 0,
          borderRadius: 2, bgcolor: 'action.selected', color: 'primary.main' }}><Icon size={18} aria-hidden /></Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="span" variant="caption" color="text.secondary">
            {categoryLabels[item.category] ?? 'Thông báo'} · <time dateTime={item.createdAt} title={formatInstant(item.createdAt)}>{notificationTime(item.createdAt, now)}</time>
          </Typography>
          <Typography sx={{ fontSize: 14, lineHeight: 1.35, fontWeight: item.readAt ? 500 : 700, overflowWrap: 'anywhere' }}>{item.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{item.summary}</Typography>
        </Box>
        {!item.readAt && <Box role="img" aria-label="Chưa đọc" sx={{ mt: 0.75, flexShrink: 0, width: 7, height: 7, borderRadius: '50%', bgcolor: 'primary.main' }} />}
      </ButtonBase>
      <IconButton aria-label={`Tùy chọn: ${item.title}`} size="small" onClick={openMenu} disabled={busy}
        sx={{ mr: 0.5, minWidth: { xs: 40, sm: 32 }, minHeight: { xs: 44, sm: 32 } }}><MoreHorizontal size={17} /></IconButton>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setMenu(null); onDetail(item); }}>Xem chi tiết</MenuItem>
        {!item.readAt && <MenuItem onClick={() => { setMenu(null); onRead(item); }}>Đánh dấu đã đọc</MenuItem>}
      </Menu>
    </Box>
  );
}

export function NotificationRows({ items, busy, selectedId, onOpen, onDetail, onRead }: {
  items: NotificationItem[]; busy: boolean; selectedId?: string;
  onOpen: (item: NotificationItem) => void; onDetail: (item: NotificationItem) => void;
  onRead: (item: NotificationItem) => void;
}) {
  const now = new Date();
  const today = dayNumber(now);
  const groups = new Map<string, NotificationItem[]>();
  for (const item of items) {
    const difference = today - dayNumber(new Date(item.createdAt));
    const name = difference <= 0 ? 'Hôm nay' : difference === 1 ? 'Hôm qua' : difference <= 7 ? '7 ngày qua' : 'Trước đó';
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return [...groups].map(([name, rows]) => (
    <Box component="section" key={name} aria-label={name}>
      <Typography component="h3" variant="caption" sx={{ px: 1.5, py: 0.75, display: 'block', bgcolor: 'background.default', fontWeight: 700 }}>{name}</Typography>
      <Box component="ul" sx={{ m: 0, p: 0 }}>
        {rows.map((item) => <NotificationRow key={item.id} {...{ item, now, busy, onOpen, onDetail, onRead }} selected={selectedId === item.id} />)}
      </Box>
    </Box>
  ));
}

export function NotificationSkeleton() {
  return <Stack spacing={1.5} sx={{ p: 2 }} role="status" aria-label="Đang tải thông báo">
    {[0, 1, 2].map((key) => <Stack key={key} direction="row" spacing={1.5}>
      <Skeleton variant="rounded" width={36} height={36} />
      <Box sx={{ flex: 1 }}><Skeleton width="70%" /><Skeleton width="92%" /></Box>
    </Stack>)}
  </Stack>;
}

export function NotificationDetail({ item, busy, onOpen }: {
  item: NotificationItem; busy: boolean; onOpen: () => void;
}) {
  return <Stack spacing={1.5} sx={{ p: 2 }}>
    <Typography component="h3" variant="h6">{item.title}</Typography>
    <Typography variant="caption" color="text.secondary">{formatInstant(item.createdAt)}</Typography>
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.summary}</Typography>
    {hasNotificationTarget(item) && <Box><Button variant="outlined" disabled={busy} onClick={onOpen}>Mở hồ sơ liên quan</Button></Box>}
  </Stack>;
}
