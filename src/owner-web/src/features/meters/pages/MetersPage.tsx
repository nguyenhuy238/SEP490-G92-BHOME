import { useState } from 'react';
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
import { PageHeader } from '../../../components/common/PortalUI';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { isMockMode } from '../../../services/config';
import { useMeterApi } from '../useMeterApi';

export default function MetersPage() {
  return isMockMode ? <ResourcePage kind="meters" variant="table" /> : <LiveMetersPage />;
}

export function LiveMetersPage() {
  const api = useMeterApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const [selected, setSelected] = useState('');
  const [taskId, setTaskId] = useState('');
  const tasks = useQuery({
    queryKey: ['meter-tasks', actor],
    queryFn: ({ signal }) => api.tasks(signal),
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
        {!!tasks.data?.length && (
          <TextField
            select
            label="100 tác vụ gần nhất"
            value={tasks.data.some((t) => t.id === selected) ? selected : ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            <MenuItem value="">Chọn tác vụ</MenuItem>
            {tasks.data.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.location} · {t.room} · {t.meterCode} · {t.readingDate} ·{' '}
                {t.status === 2 ? 'Đã xác nhận' : t.status === 3 ? 'Đã hủy' : 'Chờ ghi chỉ số'}
              </MenuItem>
            ))}
          </TextField>
        )}
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
                </>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </>
  );
}
