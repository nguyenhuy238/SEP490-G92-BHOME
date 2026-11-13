import { useId, type ReactNode } from 'react';
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
import { Inbox } from 'lucide-react';
export function FilterToolbar({ children }: { children: ReactNode }) {
  return (
    <Stack
      role="group"
      aria-label="Bộ lọc"
      direction={{ xs: 'column', sm: 'row' }}
      useFlexGap
      spacing={1}
      sx={{
        flexWrap: 'wrap',
        alignItems: { sm: 'flex-start' },
        minWidth: 0,
        '& > *': {
          minWidth: 0,
          width: { xs: '100%', sm: 'auto' },
          flex: { sm: '0 1 220px' },
        },
        '& > .MuiButton-root': {
          flex: '0 0 auto',
          width: 'auto',
          alignSelf: { xs: 'flex-start', sm: 'center' },
        },
      }}
    >
      {children}
    </Stack>
  );
}
export function StatusChip({ label }: { label: string }) {
  // Do not infer success merely from the Vietnamese prefix "Đã". Ended, archived
  // and cancelled records must never appear as successful active operations.
  const status = label.toLocaleLowerCase('vi-VN').trim();
  const tone = /khẩn cấp|hỏng|quá hạn|trùng lặp|từ chối|thất bại|không hợp lệ|lỗi/.test(status)
    ? 'error'
    : /ngừng|đã (hủy|huỷ|kết thúc|lưu trữ|trả phòng|nghỉ việc)|tạm đóng|không khai thác|chưa liên kết|chưa xuất bản/.test(
          status,
        )
      ? 'neutral'
      : /chờ|nháp|cần |sắp |giữ chỗ|chưa xác|chưa duyệt|yêu cầu|hết hạn|tạm ngừng/.test(status)
        ? 'warning'
        : /hoàn thành|đã (xác minh|xác nhận|đối soát|duyệt|giải quyết|công bố|xuất bản|phát hành|ký|thanh toán|liên kết|nghiệm thu|ghi nhận|thu)|đang (hiệu lực|hoạt động|vận hành|làm việc|áp dụng)|vận hành tốt|trống khai thác/.test(
              status,
            )
          ? 'success'
          : /đang (thuê|ở|xử lý|thực hiện)/.test(status)
            ? 'info'
            : 'neutral';
  const colors = {
    error: { bg: '#ffdad6', fg: '#93000a' },
    success: { bg: '#e3f4ea', fg: '#006329' },
    warning: { bg: '#fff1d6', fg: '#845d00' },
    info: { bg: '#ebf2ff', fg: '#194cbb' },
    neutral: { bg: '#eef1f5', fg: '#43536a' },
  }[tone];
  return (
    <Chip
      size="small"
      label={label}
      data-status-tone={tone}
      sx={{
        height: 'auto',
        minHeight: 26,
        py: 0.25,
        fontSize: 12,
        fontWeight: 600,
        bgcolor: colors.bg,
        color: colors.fg,
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
  headingLevel = 'h1',
}: {
  title: string;
  subtitle?: string;
  group?: string | null;
  actions?: ReactNode;
  headingLevel?: 'h1' | 'h2';
}) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{
        justifyContent: 'space-between',
        alignItems: { md: 'center' },
        gap: 1.5,
        mb: 2,
        minWidth: 0,
      }}
    >
      <Box sx={{ maxWidth: 740, minWidth: 0, flex: '1 1 auto' }}>
        <Typography
          component={headingLevel}
          variant={headingLevel}
          sx={{
            fontSize: headingLevel === 'h2' ? 18 : 24,
            lineHeight: 1.3,
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </Typography>
        {group && /mô phỏng|demo|sandbox/i.test(group) && (
          <Typography variant="caption" color="text.secondary" component="div">
            {group}
          </Typography>
        )}
        {subtitle && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: 14, lineHeight: 1.5 }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack
          direction="row"
          sx={{
            gap: 1,
            flexWrap: 'wrap',
            flex: '0 1 auto',
            minWidth: 0,
            justifyContent: { md: 'flex-end' },
          }}
        >
          {actions}
        </Stack>
      )}
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
      sx={{
        p: { xs: 1.5, md: 2 },
        height: '100%',
        minWidth: 0,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack
        direction="row"
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 1.5,
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700 }}>
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
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
      <MetricContent label={label} value={value} hint={hint} danger={danger} />
    </Paper>
  );
}
function MetricContent({
  label,
  value,
  hint,
  danger,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  danger?: boolean;
  tone?: 'primary' | 'success' | 'warning';
}) {
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: { xs: 22, sm: 26 },
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.03em',
          fontWeight: 650,
          my: 0.5,
          color: danger ? 'error.dark' : tone ? `${tone}.dark` : 'text.primary',
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
    </>
  );
}
export function KPIGrid({
  items,
}: {
  items: {
    label: string;
    value: string | number;
    hint?: string;
    danger?: boolean;
    tone?: 'primary' | 'success' | 'warning';
  }[];
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: `repeat(${Math.min(2, Math.max(1, items.length))},minmax(0,1fr))`,
          lg: `repeat(${Math.min(5, Math.max(1, items.length))},minmax(0,1fr))`,
          xl: `repeat(${Math.min(5, Math.max(1, items.length))},minmax(0,1fr))`,
        },
        gap: '1px',
        bgcolor: 'divider',
        overflow: 'hidden',
        mb: 2,
      }}
    >
      {items.map((item) => (
        <Box key={item.label} sx={{ bgcolor: 'background.paper', p: 1.5, minWidth: 0 }}>
          <MetricContent {...item} />
        </Box>
      ))}
    </Paper>
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
    <Stack
      role="status"
      sx={{ alignItems: 'center', p: { xs: 2.5, md: 3 }, gap: 1.5, textAlign: 'center' }}
    >
      <Inbox size={28} color="#53657f" aria-hidden="true" />
      <Typography color="text.secondary">{message}</Typography>
      {action}
    </Stack>
  );
}
export function LoadingState() {
  return (
    <Box role="status" aria-label="Đang tải dữ liệu">
      <LinearProgress sx={{ mb: 1.5 }} />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={44} sx={{ mb: 1 }} />
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
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      aria-labelledby={titleId}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {children}
      </DialogContent>
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
