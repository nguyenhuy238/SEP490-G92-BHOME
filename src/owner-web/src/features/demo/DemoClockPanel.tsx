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
import { QuickContractPanel } from './QuickContractPanel';
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
  const [chosen, setChosen] = useState('');
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

  async function change(date: string | null) {
    if (!applied?.canChange || busy) return;
    setBusy(true);
    setError('');
    try {
      await cache.cancelQueries({ queryKey });
      const updated = await request<DemoClockState>('/api/v1/demo-clock', {
        method: 'PUT',
        body: JSON.stringify({ businessDate: date, expectedVersion: applied.version }),
      });
      setDemoBusinessDate(updated);
      cache.setQueryData(queryKey, updated);
      setChosen('');
      await cache.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'demo-clock' });
    } catch {
      setError('Không đổi được ngày. Kiểm tra kết nối hoặc phiên bản đồng hồ rồi thử lại.');
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
  const dateLabel = applied?.businessDate.split('-').reverse().join('/');
  const status = query.isError
    ? 'Mất kết nối'
    : !synced
      ? 'Đang đồng bộ…'
      : applied.simulated
        ? 'Đang giả lập'
        : 'Ngày thực';
  const value = chosen || applied?.businessDate || '';
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
                width: 340,
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
                    Ngày nghiệp vụ · {status}
                  </Typography>
                  <Typography
                    variant="h5"
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {dateLabel ?? '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {scope}
                  </Typography>
                </Box>
                {!synced ? (
                  <Alert severity={query.isError ? 'error' : 'info'}>
                    {query.isError
                      ? 'Không đọc được đồng hồ demo từ máy chủ.'
                      : 'Đang đồng bộ ngày nghiệp vụ demo…'}
                    {query.isError && (
                      <Button size="small" onClick={() => void query.refetch()}>
                        Thử lại
                      </Button>
                    )}
                  </Alert>
                ) : applied.canChange ? (
                  <>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField
                        size="small"
                        type="date"
                        label="Ngày demo"
                        value={value}
                        fullWidth
                        disabled={busy}
                        onChange={(e) => setChosen(e.target.value)}
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: { min: '2000-01-01', max: '2100-12-31' },
                        }}
                      />
                      <Button
                        variant="contained"
                        disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(value)}
                        onClick={() => void change(value)}
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
                          disabled={busy}
                          onClick={() => void change(addDemoDays(applied.businessDate, days))}
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
                      Ngày thực
                    </Button>
                  </>
                ) : (
                  <Typography variant="caption">
                    Chỉ xem · Owner được chỉ định mới có thể đổi ngày
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  Đổi ngày sẽ áp dụng cho toàn bộ {scope}. Chỉ sử dụng dữ liệu thử nghiệm; trở về
                  ngày thực không tự hoàn tác dữ liệu.
                </Typography>
                {error && <Alert severity="error">{error}</Alert>}
              </Stack>
            </Paper>
          )}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {synced && applied.canChange && (
              <QuickContractPanel businessDate={applied.businessDate} />
            )}
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
              Demo Clock{dateLabel ? ` · ${dateLabel}` : ''}
            </Button>
          </Stack>
        </Box>
      </Portal>
    </>
  );
}
