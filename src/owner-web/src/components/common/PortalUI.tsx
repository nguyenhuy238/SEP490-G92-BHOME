import type { ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { Inbox, TrendingUp } from 'lucide-react';
export function StatusChip({ label }: { label: string }) {
  const error = /Khẩn|Hỏng|Quá hạn|Trùng/.test(label),
    success = /Hoàn thành|Đã |Đang hiệu lực|Vận hành tốt|Đang thuê/.test(label),
    pending = /Chờ|Nháp|nháp/.test(label);
  return (
    <Chip
      size="small"
      label={label}
      sx={{
        height: 'auto',
        minHeight: 22,
        py: 0.25,
        fontSize: 11,
        fontWeight: 500,
        bgcolor: error ? '#ffdad6' : success ? '#e3f4ea' : pending ? '#fff1d6' : '#eaedff',
        color: error ? '#93000a' : success ? '#006329' : pending ? '#845d00' : '#38485d',
        '& .MuiChip-label': { whiteSpace: 'normal' },
      }}
    />
  );
}
export function PageHeader({
  title,
  subtitle,
  group,
  actions,
}: {
  title: string;
  subtitle?: string;
  group?: string;
  actions?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, gap: 2, mb: 3 }}
    >
      <Box sx={{ maxWidth: 740 }}>
        <Typography
          variant="overline"
          sx={{ fontSize: 11, color: 'primary.main', fontWeight: 850, letterSpacing: 1.15 }}
        >
          {group || 'BHOME OWNER PORTAL'}
        </Typography>
        <Typography
          component="h1"
          variant="h1"
          sx={{ fontSize: { xs: 22, md: 26 }, lineHeight: 1.3, mt: 0.35 }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.75, fontSize: 13, lineHeight: 1.6 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', flexShrink: 0 }}>
        {actions}
      </Stack>
    </Stack>
  );
}
export function ChartCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Paper
      sx={{ p: { xs: 2, md: 2.5 }, height: '100%', border: '1px solid', borderColor: 'divider' }}
    >
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 1 }}
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}
export function KPICard({
  label,
  value,
  hint,
  danger = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Box
          sx={{
            bgcolor: danger ? '#ffeded' : '#e2e7ff',
            color: danger ? 'error.main' : 'primary.main',
            p: 0.75,
            borderRadius: 0.5,
            display: 'flex',
          }}
        >
          <TrendingUp size={18} />
        </Box>
      </Stack>
      <Typography
        sx={{
          fontSize: { xs: 23, lg: 29 },
          letterSpacing: '-0.03em',
          fontWeight: 650,
          my: 1.5,
          color: danger ? 'error.main' : 'text.primary',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Paper>
  );
}
export function KPIGrid({
  items,
}: {
  items: { label: string; value: string | number; hint?: string; danger?: boolean }[];
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', lg: `repeat(${items.length},1fr)` },
        gap: 2,
        mb: 3,
      }}
    >
      {items.map((item) => (
        <KPICard key={item.label} {...item} />
      ))}
    </Box>
  );
}
export function EmptyState({
  message = 'Không có dữ liệu phù hợp với bộ lọc.',
  action,
}: {
  message?: string;
  action?: ReactNode;
}) {
  return (
    <Stack role="status" sx={{ alignItems: 'center', p: 5, gap: 1.5, textAlign: 'center' }}>
      <Inbox size={34} color="#737686" />
      <Typography color="text.secondary">{message}</Typography>
      {action}
    </Stack>
  );
}
export function LoadingState() {
  return (
    <Box role="status" aria-label="Đang tải dữ liệu">
      <LinearProgress sx={{ mb: 3 }} />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={110} sx={{ mb: 2 }} />
      ))}
    </Box>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" onClick={retry}>
          Thử lại
        </Button>
      }
    >
      {error instanceof Error ? error.message : 'Không thể tải dữ liệu.'}
    </Alert>
  );
}
export function ConfirmDialog({
  open,
  title,
  children,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Hủy
        </Button>
        <Button variant="contained" disabled={busy} onClick={onConfirm}>
          Xác nhận
        </Button>
      </DialogActions>
    </Dialog>
  );
}
