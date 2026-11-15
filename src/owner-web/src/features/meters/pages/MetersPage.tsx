import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { ClipboardList, Clock3, CheckCircle2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { contractError } from '../../../../../../packages/client-core/src/contracts';
import { PageHeader, FilterToolbar, StatusChip } from '../../../components/common/PortalUI';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { useMeterApi } from '../useMeterApi';
import { MeterAssignment } from '../MeterAssignment';
import { OwnerTable } from '../../../components/common/OwnerWorkspace';
import { PrivateEvidenceViewer } from '../../../components/common/PrivateEvidenceViewer';

const taskStatusLabels = ['Đã giao', 'Đang thực hiện', 'Đã xác nhận', 'Đã hủy', 'Chờ xác minh'];
const taskStatusLabel = (status: number) => taskStatusLabels[status] ?? 'Trạng thái chưa xác định';

export default function MetersPage() {
  return isMockMode ? <ResourcePage kind="meters" variant="table" /> : <LiveMetersPage />;
}

export function LiveMetersPage() {
  const [deepParams] = useSearchParams();
  const api = useMeterApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [selected, setSelected] = useState(deepParams.get('taskId') ?? '');
  const [workView, setWorkView] = useState<'all' | 'attention' | 'active' | 'done'>('all');
  const [location, setLocation] = useState(deepParams.get('locationId') ?? ''),
    [room, setRoom] = useState(''),
    [status, setStatus] = useState(''),
    [dueDate, setDueDate] = useState(''),
    [page, setPage] = useState(1);
  const locations = useQuery({
    queryKey: ['meter-location-options', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['meter-room-options', actor, location],
    enabled: !!location,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  const tasks = useQuery({
    queryKey: ['meter-tasks', actor, location, room, status, dueDate, page],
    queryFn: ({ signal }) =>
      api.tasks(signal, { locationId: location, roomId: room, status, dueDate, page }),
  });
  const detail = useQuery({
    queryKey: ['meter-task', actor, selected],
    enabled: !!selected,
    queryFn: ({ signal }) => api.task(selected, signal),
  });
  const readingId = detail.data?.confirmedReadingId;
  const reading = useQuery({
    queryKey: ['meter-reading', actor, readingId],
    enabled: !!readingId,
    queryFn: ({ signal }) => api.reading(readingId!, signal),
  });
  // Task endpoint is paginated. These counts and quick views are deliberately scoped
  // to the loaded page; never present them as totals across the whole location.
  const pageTasks = tasks.data ?? [];
  const attentionCount = pageTasks.filter(
    (task) => task.status === 4 || (task.status === 0 && !task.assignedStaffUserId),
  ).length;
  const activeCount = pageTasks.filter(
    (task) => task.status === 1 || (task.status === 0 && !!task.assignedStaffUserId),
  ).length;
  const completedCount = pageTasks.filter((task) => task.status === 2).length;
  const visibleTasks = pageTasks.filter(
    (task) =>
      workView === 'all' ||
      (workView === 'attention' &&
        (task.status === 4 || (task.status === 0 && !task.assignedStaffUserId))) ||
      (workView === 'active' &&
        (task.status === 1 || (task.status === 0 && !!task.assignedStaffUserId))) ||
      (workView === 'done' && task.status === 2),
  );
  return (
    <>
      <PageHeader
        title="Ghi chỉ số điện nước"
        subtitle="Theo dõi nhiệm vụ ghi số và kiểm tra chỉ số Staff đã xác nhận trước khi lập hóa đơn."
      />
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ gap: 1.5 }}
          aria-label="Tổng quan nhiệm vụ trên trang hiện tại"
        >
          {[
            {
              label: 'Cần xử lý',
              value: attentionCount,
              icon: <ClipboardList size={19} />,
              color: 'warning.main',
            },
            {
              label: 'Đang thực hiện / đã giao',
              value: activeCount,
              icon: <Clock3 size={19} />,
              color: 'primary.main',
            },
            {
              label: 'Đã xác nhận',
              value: completedCount,
              icon: <CheckCircle2 size={19} />,
              color: 'success.main',
            },
          ].map((summary) => (
            <Paper
              key={summary.label}
              variant="outlined"
              sx={{ flex: 1, minWidth: 0, borderRadius: 2, p: 1.75 }}
            >
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
              >
                <Typography variant="body2" color="text.secondary">
                  {summary.label}
                </Typography>
                <Box sx={{ color: summary.color, display: 'flex' }}>{summary.icon}</Box>
              </Stack>
              <Typography
                variant="h5"
                sx={{ fontWeight: 750, mt: 0.75, fontVariantNumeric: 'tabular-nums' }}
              >
                {tasks.isPending ? '—' : summary.value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Trong trang dữ liệu đang tải
              </Typography>
            </Paper>
          ))}
        </Stack>
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ justifyContent: 'space-between', gap: 1, mb: 1 }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Tìm và lọc nhiệm vụ
            </Typography>
            {(location || room || status || dueDate) && (
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setLocation('');
                  setRoom('');
                  setStatus('');
                  setDueDate('');
                  setPage(1);
                  setWorkView('all');
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
          </Stack>
          <FilterToolbar>
            <TextField
              select
              label="Cơ sở ghi số"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setRoom('');
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả cơ sở</MenuItem>
              {locations.data?.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Phòng ghi số"
              value={room}
              disabled={!location}
              onChange={(e) => {
                setRoom(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả phòng</MenuItem>
              {rooms.data?.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Trạng thái tác vụ"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <MenuItem value="">Tất cả trạng thái</MenuItem>
              {[4, 1, 0, 2, 3].map((value) => (
                <MenuItem key={value} value={String(value)}>
                  {taskStatusLabels[value]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Ngày đến hạn"
              type="date"
              value={dueDate}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(e) => {
                setDueDate(e.target.value);
                setPage(1);
              }}
            />
          </FilterToolbar>
        </Paper>
        {(locations.error || rooms.error) && (
          <Alert severity="error">{contractError(locations.error || rooms.error)}</Alert>
        )}
        {tasks.isPending && <LinearProgress aria-label="Đang tải tác vụ" />}
        {tasks.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void tasks.refetch()}>Thử lại</Button>}
          >
            {contractError(tasks.error)}
          </Alert>
        )}
        {tasks.data && !tasks.data.length && (
          <Alert severity="info">
            Chưa có nhiệm vụ phù hợp. Thử bỏ bộ lọc, hoặc chọn cơ sở và phòng để giao nhiệm vụ ghi
            số ban đầu.
          </Alert>
        )}
        {!!tasks.data?.length && !tasks.error && (
          <Paper variant="outlined" sx={{ minWidth: 0, overflow: 'hidden', borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{
                gap: 1,
                px: 1.5,
                py: 1.25,
                justifyContent: 'space-between',
                alignItems: { md: 'center' },
              }}
            >
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                  Danh sách nhiệm vụ
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Bộ lọc nhanh và số lượng chỉ áp dụng cho trang {page} · {pageTasks.length} nhiệm
                  vụ đang tải
                </Typography>
              </Box>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={workView}
                  onChange={(_, value: typeof workView | null) => {
                    if (value) setWorkView(value);
                  }}
                  aria-label="Lọc nhanh theo công việc trên trang"
                  sx={{
                    flexWrap: 'wrap',
                    '& .MuiToggleButton-root': { textTransform: 'none', px: 1.5 },
                  }}
                >
                  <ToggleButton value="all">Tất cả</ToggleButton>
                  <ToggleButton value="attention">Cần xử lý</ToggleButton>
                  <ToggleButton value="active">Đang thực hiện</ToggleButton>
                  <ToggleButton value="done">Hoàn thành</ToggleButton>
                </ToggleButtonGroup>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={tasks.isFetching}
                  onClick={() => void tasks.refetch()}
                >
                  Làm mới
                </Button>
              </Stack>
            </Stack>
            {!visibleTasks.length && (
              <Alert severity="info" sx={{ mx: 1.5, mb: 1.5 }}>
                Không có nhiệm vụ thuộc nhóm này trong trang {page}. Chọn “Tất cả” hoặc chuyển trang
                để xem các nhiệm vụ khác.
              </Alert>
            )}
            {!!visibleTasks.length && (
              <OwnerTable
                rows={visibleTasks}
                id={(t) => t.id}
                select={(t) => setSelected(t.id)}
                label="Tác vụ ghi chỉ số"
                columns={[
                  {
                    label: 'Phòng / Cơ sở',
                    render: (t) => (
                      <Stack spacing={0.25}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {t.room}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t.location}
                        </Typography>
                      </Stack>
                    ),
                  },
                  {
                    label: 'Đồng hồ',
                    render: (t) => (
                      <Stack spacing={0.25}>
                        <Typography variant="body2">
                          {t.utilityType === 0 ? 'Điện' : 'Nước'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t.meterCode}
                        </Typography>
                      </Stack>
                    ),
                  },
                  {
                    label: 'Kỳ / Ngày ghi',
                    render: (t) =>
                      `${t.purpose === 0 ? 'Ban đầu' : t.purpose === 1 ? 'Định kỳ' : 'Trả phòng'} · ${t.billingPeriod?.slice(0, 7) ?? 'Không theo kỳ'} · ${t.readingDate.split('-').reverse().join('/')}`,
                  },
                  {
                    label: 'Chỉ số trước',
                    render: (t) =>
                      t.previousValue == null
                        ? 'Chưa có chỉ số trước'
                        : formatBillingDecimal(t.previousValue),
                  },
                  {
                    label: 'Hạn hoàn thành',
                    render: (t) => (t.dueAt ? formatInstant(t.dueAt) : 'Chưa có hạn'),
                  },
                  {
                    label: 'Trạng thái',
                    render: (t) => <StatusChip label={taskStatusLabel(t.status)} />,
                  },
                  {
                    label: 'Phân công',
                    render: (t) =>
                      t.assignedStaffUserId ? 'Đã phân công (xem chi tiết)' : 'Chưa phân công',
                  },
                ]}
                selectLabel="Xem chi tiết"
              />
            )}
          </Paper>
        )}
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Button disabled={page === 1 || tasks.isFetching} onClick={() => setPage(page - 1)}>
            Trang trước
          </Button>
          <Typography>Trang {page}</Typography>
          <Button
            disabled={tasks.isFetching || tasks.data?.length !== 100}
            onClick={() => setPage(page + 1)}
          >
            Trang sau
          </Button>
        </Stack>
        <Drawer
          anchor="right"
          open={!!selected}
          onClose={() => setSelected('')}
          slotProps={{
            paper: {
              'aria-labelledby': 'meter-task-detail-title',
              sx: {
                width: { xs: '100%', sm: 560 },
                maxWidth: '100%',
                height: '100dvh',
                display: 'flex',
                flexDirection: 'column',
              },
            },
          }}
        >
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              p: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography id="meter-task-detail-title" variant="subtitle1" sx={{ fontWeight: 750 }}>
                Chi tiết nhiệm vụ ghi số
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Đóng để quay lại danh sách và bộ lọc đang chọn.
              </Typography>
            </Box>
            <IconButton aria-label="Đóng chi tiết nhiệm vụ" onClick={() => setSelected('')}>
              <X size={20} />
            </IconButton>
          </Stack>
          <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1, p: { xs: 1.5, sm: 2 } }}>
            {selected && detail.isPending && (
              <LinearProgress aria-label="Đang tải chi tiết nhiệm vụ" />
            )}
            {detail.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void detail.refetch()}>Thử lại</Button>}
              >
                {contractError(detail.error)}
              </Alert>
            )}
            {detail.data && !detail.error && (
              <Paper
                variant="outlined"
                sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0, overflowWrap: 'anywhere' }}
              >
                <Stack spacing={1}>
                  <Typography variant="h6">
                    {detail.data.location} · Phòng {detail.data.room}
                  </Typography>
                  <Box sx={{ alignSelf: 'flex-start' }}>
                    <StatusChip label={taskStatusLabel(detail.data.status)} />
                  </Box>
                  <Typography>
                    {detail.data.meterCode} ·{' '}
                    {detail.data.utilityType === 0 ? 'Điện (kWh)' : 'Nước (m³)'}
                  </Typography>
                  <Typography>
                    Ngày ghi: {detail.data.readingDate.split('-').reverse().join('/')} · Kỳ:{' '}
                    {detail.data.billingPeriod?.slice(0, 7) ?? 'Ban đầu / trả phòng'}
                  </Typography>
                  <Typography>
                    Chỉ số trước:{' '}
                    {detail.data.previousValue == null
                      ? 'Chưa có chỉ số đã xác nhận'
                      : formatBillingDecimal(detail.data.previousValue)}
                  </Typography>
                  <Typography>
                    Hạn ghi số:{' '}
                    {detail.data.dueAt ? formatInstant(detail.data.dueAt) : 'Chưa cấu hình'}
                  </Typography>
                  <MeterAssignment
                    key={detail.data.id + ':' + detail.data.version}
                    task={detail.data}
                    saved={() => {
                      void detail.refetch();
                      void tasks.refetch();
                    }}
                  />
                  {!readingId && (
                    <Alert severity="info">
                      {detail.data.status === 3
                        ? 'Tác vụ đã hủy.'
                        : 'Chưa có chỉ số được Staff xác nhận.'}
                    </Alert>
                  )}
                  {readingId && reading.isPending && <LinearProgress />}
                  {reading.error && (
                    <Alert
                      severity="error"
                      action={<Button onClick={() => void reading.refetch()}>Thử lại</Button>}
                    >
                      {contractError(reading.error)}
                    </Alert>
                  )}
                  {reading.data && (
                    <>
                      <Typography>
                        Chỉ số xác nhận: {formatBillingDecimal(reading.data.confirmedValue)}
                      </Typography>
                      <Typography>
                        Tiêu thụ:{' '}
                        {reading.data.consumption == null
                          ? 'Chỉ số ban đầu'
                          : formatBillingDecimal(reading.data.consumption)}
                      </Typography>
                      <Typography>
                        Xác nhận lúc: {formatInstant(reading.data.confirmedAt)}
                      </Typography>
                      <Typography variant="caption">Mã chỉ số: {reading.data.id}</Typography>
                      <PrivateEvidenceViewer
                        key={reading.data.id}
                        label="Bằng chứng chỉ số đã xác nhận"
                        filename="chi-so-xac-nhan"
                        fetchBlob={(signal) =>
                          api.request<Blob>(
                            `/api/v1/capture/readings/${reading.data!.id}/evidence`,
                            { signal },
                            'blob',
                          )
                        }
                        errorMessage={contractError}
                      />
                    </>
                  )}
                </Stack>
              </Paper>
            )}
          </Box>
        </Drawer>
      </Stack>
    </>
  );
}
