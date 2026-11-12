import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { contractError } from '../../../../../../packages/client-core/src/contracts';
import { PageHeader, FilterToolbar } from '../../../components/common/PortalUI';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { useMeterApi } from '../useMeterApi';
import { MeterAssignment } from '../MeterAssignment';
import { downloadOwnerFile } from '../../../services/ownerDownloads';
import { OwnerTable } from '../../../components/common/OwnerWorkspace';

export default function MetersPage() {
  return isMockMode ? <ResourcePage kind="meters" variant="table" /> : <LiveMetersPage />;
}

export function LiveMetersPage() {
  const [deepParams] = useSearchParams();
  const api = useMeterApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [selected, setSelected] = useState(deepParams.get('taskId') ?? '');
  const [taskId, setTaskId] = useState('');
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [status, setStatus] = useState(''),
    [dueDate, setDueDate] = useState(''),
    [page, setPage] = useState(1),
    [evidenceError, setEvidenceError] = useState('');
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
  return (
    <>
      <PageHeader
        title="Ghi chỉ số điện nước"
        subtitle="Kết quả Staff xác nhận được lưu trên hệ thống và dùng làm đầu vào lập hóa đơn."
      />
      <Stack spacing={2}>
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
            {['Đã giao', 'Đang thực hiện', 'Đã xác nhận', 'Đã hủy', 'Chờ xác minh'].map(
              (label, i) => (
                <MenuItem key={i} value={String(i)}>
                  {label}
                </MenuItem>
              ),
            )}
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
        {(locations.error || rooms.error || evidenceError) && (
          <Alert severity="error">
            {evidenceError || contractError(locations.error || rooms.error)}
          </Alert>
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
          <Alert severity="info">Chưa có tác vụ ghi chỉ số.</Alert>
        )}
        {!!tasks.data?.length && !tasks.error && (
          <Paper>
            <OwnerTable
              rows={tasks.data}
              id={(t) => t.id}
              select={(t) => setSelected(t.id)}
              label="Tác vụ ghi chỉ số"
              columns={[
                { label: 'Cơ sở / Phòng', render: (t) => `${t.location} · ${t.room}` },
                {
                  label: 'Đồng hồ',
                  render: (t) => `${t.meterCode} · ${t.utilityType === 0 ? 'Điện' : 'Nước'}`,
                },
                {
                  label: 'Kỳ / Ngày ghi',
                  render: (t) =>
                    `${t.billingPeriod?.slice(0, 7) ?? 'Ban đầu / trả phòng'} · ${t.readingDate.split('-').reverse().join('/')}`,
                },
                { label: 'Chỉ số trước', render: (t) => t.previousValue ?? 'Thiếu baseline' },
                {
                  label: 'Trạng thái',
                  render: (t) =>
                    t.status === 2 ? 'Đã xác nhận' : t.status === 3 ? 'Đã hủy' : 'Chờ ghi chỉ số',
                },
                {
                  label: 'Phân công',
                  render: (t) =>
                    t.assignedStaffUserId ? 'Đã phân công (xem chi tiết)' : 'Chưa phân công',
                },
              ]}
            />
          </Paper>
        )}
        <Stack direction="row" spacing={1}>
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
          <Button disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
            Làm mới
          </Button>
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            label="Mã tác vụ cần tra cứu"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            fullWidth
          />
          <Button
            disabled={!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(taskId)}
            onClick={() => setSelected(taskId)}
          >
            Tra cứu
          </Button>
        </Stack>
        {selected && detail.isPending && <LinearProgress />}
        {detail.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void detail.refetch()}>Thử lại</Button>}
          >
            {contractError(detail.error)}
          </Alert>
        )}
        {detail.data && (
          <Paper sx={{ p: 3 }}>
            <Stack spacing={1}>
              <Typography variant="h6">
                {detail.data.location} · Phòng {detail.data.room}
              </Typography>
              <Typography>
                {detail.data.meterCode} ·{' '}
                {detail.data.utilityType === 0 ? 'Điện (kWh)' : 'Nước (m³)'}
              </Typography>
              <Typography>
                Ngày ghi: {detail.data.readingDate.split('-').reverse().join('/')} · Kỳ:{' '}
                {detail.data.billingPeriod?.slice(0, 7) ?? 'Ban đầu / trả phòng'}
              </Typography>
              <Typography>
                Chỉ số trước: {detail.data.previousValue ?? 'Chưa có baseline xác nhận'}
              </Typography>
              <Typography>
                Hạn ghi số: {detail.data.dueAt ? formatInstant(detail.data.dueAt) : 'Chưa cấu hình'}
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
                  <Typography>Chỉ số xác nhận: {reading.data.confirmedValue}</Typography>
                  <Typography>Tiêu thụ: {reading.data.consumption ?? 'Chỉ số ban đầu'}</Typography>
                  <Typography>Xác nhận lúc: {formatInstant(reading.data.confirmedAt)}</Typography>
                  <Typography variant="caption">Mã chỉ số: {reading.data.id}</Typography>
                  <Button
                    onClick={() => {
                      setEvidenceError('');
                      void downloadOwnerFile(
                        api.request,
                        `/api/v1/capture/readings/${reading.data!.id}/evidence`,
                        'chi-so-xac-nhan',
                      ).catch((e) => setEvidenceError(contractError(e)));
                    }}
                  >
                    Tải bằng chứng chỉ số đã xác nhận
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </>
  );
}
