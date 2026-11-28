import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Portal,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Minus } from 'lucide-react';
import { useMeterApi } from '../meters/useMeterApi';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  addDemoDays,
  getDemoClockState,
  subscribeDemoClock,
  setDemoBusinessDate,
  type DemoClockState,
} from '../../../../../packages/client-core/src/demoClock';

export function DemoClockWorkspace({ children }: { children: ReactNode }) {
  const { request } = useMeterApi();
  const { session } = useAuth();
  const queryKey = ['demo-clock', session?.userId];
  const cache = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => request<DemoClockState>('/api/v1/demo-clock', { signal }),
    refetchInterval: (q) =>
      q.state.error instanceof ApiError && q.state.error.status === 404 ? 30000 : 3000,
    retry: false,
  });
  const disabled = query.error instanceof ApiError && query.error.status === 404;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const applied = useSyncExternalStore(subscribeDemoClock, getDemoClockState, getDemoClockState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (disabled) {
      if (setDemoBusinessDate(null))
        void cache.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'demo-clock' });
      return;
    }
    if (!query.data?.enabled) return;
    if (setDemoBusinessDate(query.data)) {
      void cache.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'demo-clock' });
    }
  }, [query.data, cache, disabled]);
  useEffect(
    () => () => {
      setDemoBusinessDate(null);
    },
    [],
  );

  async function change(dateTime: string | null) {
    if (!applied?.canChange || busy) return;
    setBusy(true);
    setError('');
    try {
      await cache.cancelQueries({ queryKey });
      const updated = await request<DemoClockState>('/api/v1/demo-clock', {
        method: 'PUT',
        body: JSON.stringify({
          businessDate: null,
          businessDateTime: dateTime ? dateTime + '+07:00' : null,
          expectedVersion: applied.version,
        }),
      });
      setDemoBusinessDate(updated);
      cache.setQueryData(queryKey, updated);
      setChosen(null);
      await cache.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'demo-clock' });
    } catch {
      setError('Không đổi được thời gian. Kiểm tra kết nối hoặc phiên bản đồng hồ rồi thử lại.');
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (disabled && !applied) return <>{children}</>;
  const synced =
    !!applied &&
    !!query.data?.enabled &&
    !query.isError &&
    applied.version === query.data.version &&
    applied.businessDate === query.data.businessDate;
  const environment = import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT;
  const scope =
    environment === 'Staging' || environment === 'Production'
      ? environment
      : 'Backend Development đang kết nối';
  const live = (value: string | null | undefined) => {
    const instant = value ? Date.parse(value) : NaN;
    return Number.isFinite(instant)
      ? new Date(instant + Math.max(0, tick - query.dataUpdatedAt) + 7 * 3600_000)
          .toISOString()
          .slice(0, 19)
      : '';
  };
  const businessTime = live(query.data?.businessTime);
  const realTime = live(query.data?.realTime);
  const dateLabel = (businessTime.slice(0, 10) || applied?.businessDate)
    ?.split('-')
    .reverse()
    .join('/');
  const timeLabel = businessTime.slice(11);
  const realLabel = realTime
    ? realTime.slice(0, 10).split('-').reverse().join('/') + ' ' + realTime.slice(11)
    : '—';
  const status = query.isError
    ? 'Mất kết nối'
    : !synced
      ? 'Đang đồng bộ…'
      : applied.simulated
        ? 'Đang giả lập'
        : 'Giờ thực';
  const value =
    chosen ?? (businessTime || (applied?.businessDate ? applied.businessDate + 'T00:00:00' : ''));
  const validTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
  const addDays = (days: number) => addDemoDays(value.slice(0, 10), days) + value.slice(10);
  return (
    <>
      {synced && <Box key={`${applied.version}:${applied.businessDate}`}>{children}</Box>}
      <Portal>
        <Box
          sx={{
            position: 'fixed',
            right: { xs: 12, sm: 20 },
            bottom: { xs: 'max(12px, env(safe-area-inset-bottom))', sm: 20 },
            zIndex: (theme) => theme.zIndex.drawer + 1,
            maxWidth: 'calc(100vw - 24px)',
          }}
        >
          {expanded && (
            <Paper
              id={panelId}
              role="region"
              aria-label="Điều khiển Demo Clock"
              elevation={8}
              sx={{
                width: 390,
                maxWidth: 'calc(100vw - 24px)',
                maxHeight: 'calc(100dvh - 92px)',
                overflowY: 'auto',
                mb: 1,
                p: 2,
                borderRadius: 2,
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setExpanded(false);
                  document.getElementById(`${panelId}-toggle`)?.focus();
                }
              }}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Demo Clock
                  </Typography>
                  <IconButton
                    aria-label="Thu nhỏ Demo Clock"
                    size="small"
                    onClick={() => {
                      setExpanded(false);
                      document.getElementById(`${panelId}-toggle`)?.focus();
                    }}
                    sx={{ minWidth: 36, minHeight: 36 }}
                  >
                    <Minus size={20} />
                  </IconButton>
                </Stack>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Thời gian nghiệp vụ · {status} · UTC+7
                  </Typography>
                  <Typography
                    variant="h5"
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {dateLabel ?? '—'}
                    {timeLabel ? ' ' + timeLabel : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Giờ máy chủ: {realLabel}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {scope}
                  </Typography>
                </Box>
                {!synced ? (
                  <Alert severity={query.isError ? 'error' : 'info'}>
                    {query.isError
                      ? 'Không đọc được đồng hồ demo từ máy chủ.'
                      : 'Đang đồng bộ thời gian nghiệp vụ demo…'}
                    {query.isError && (
                      <Button size="small" onClick={() => void query.refetch()}>
                        Thử lại
                      </Button>
                    )}
                  </Alert>
                ) : applied.canChange ? (
                  <>
                    <Stack spacing={1}>
                      <TextField
                        size="small"
                        type="datetime-local"
                        label="Ngày giờ demo"
                        value={value}
                        fullWidth
                        disabled={busy}
                        onFocus={() => setChosen((previous) => previous ?? value)}
                        onChange={(e) => setChosen(e.target.value.split('.')[0] ?? '')}
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: {
                            min: '2000-01-01T00:00',
                            max: '2100-12-31T23:59:59',
                            step: 1,
                          },
                        }}
                      />
                      <Button
                        variant="contained"
                        disabled={busy || !validTime}
                        onClick={() => void change(value.length === 16 ? value + ':00' : value)}
                        sx={{ flexShrink: 0 }}
                      >
                        Áp dụng
                      </Button>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      {[1, 7, 30].map((days) => (
                        <Button
                          key={days}
                          variant="outlined"
                          fullWidth
                          disabled={busy || !validTime}
                          onClick={() =>
                            void change(
                              addDays(days).length === 16 ? addDays(days) + ':00' : addDays(days),
                            )
                          }
                        >
                          +{days} ngày
                        </Button>
                      ))}
                    </Stack>
                    <Button
                      fullWidth
                      disabled={busy || !applied.simulated}
                      onClick={() => void change(null)}
                    >
                      Giờ thực
                    </Button>
                  </>
                ) : (
                  <Typography variant="caption">
                    Chỉ xem · Owner được chỉ định mới có thể đổi thời gian
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  Đổi thời gian sẽ áp dụng cho toàn bộ {scope}. Chỉ sử dụng dữ liệu thử nghiệm; trở
                  về giờ thực không tự hoàn tác dữ liệu.
                </Typography>
                {error && <Alert severity="error">{error}</Alert>}
              </Stack>
            </Paper>
          )}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button
              id={`${panelId}-toggle`}
              variant="contained"
              color={applied?.simulated ? 'warning' : 'primary'}
              startIcon={<Clock size={18} />}
              aria-label={expanded ? 'Thu gọn bảng Demo Clock' : 'Mở Demo Clock'}
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              onClick={() => setExpanded((previous) => !previous)}
              sx={{
                display: 'flex',
                ml: 'auto',
                minHeight: 44,
                px: 1.5,
                borderRadius: 2,
                fontVariantNumeric: 'tabular-nums',
                boxShadow: 3,
              }}
            >
              Demo Clock{dateLabel ? ' · ' + dateLabel + (timeLabel ? ' ' + timeLabel : '') : ''}
            </Button>
          </Stack>
        </Box>
      </Portal>
    </>
  );
}
