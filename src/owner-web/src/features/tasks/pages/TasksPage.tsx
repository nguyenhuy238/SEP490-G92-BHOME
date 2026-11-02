import { ResourcePage } from '../../../components/common/ResourcePage';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { contractError } from '../../../../../../packages/client-core/src/contracts';
import { useMeterApi } from '../../meters/useMeterApi';
import { isMockMode } from '../../../services/config';
type Task = {
  id: string;
  title: string;
  requirements: string;
  status: string;
  result: string | null;
  dueAt: string | null;
};
export default function TasksPage() {
  return isMockMode ? <ResourcePage kind="tasks" variant="table" /> : <LiveTasks />;
}
function LiveTasks() {
  const api = useMeterApi();
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(params.get('taskId') ?? ''),
    [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['owner-operational-tasks', session?.userId, page],
    queryFn: ({ signal }) =>
      api.request<{ items: Task[]; totalCount: number }>(
        `/api/v1/operational-tasks?page=${page}&pageSize=20`,
        { signal },
      ),
  });
  const detail = useQuery({
    queryKey: ['owner-operational-task', session?.userId, selected],
    enabled: !!selected,
    queryFn: ({ signal }) =>
      api.request<Task>(`/api/v1/operational-tasks/${encodeURIComponent(selected)}`, { signal }),
  });
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Công việc vận hành</Typography>
      <Button
        onClick={() => {
          void list.refetch();
          if (selected) void detail.refetch();
        }}
      >
        Làm mới
      </Button>
      {(list.isPending || (selected && detail.isPending)) && <LinearProgress />}
      {(list.error || detail.error) && (
        <Alert severity="error">{contractError(list.error ?? detail.error)}</Alert>
      )}
      {detail.data && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">
            {detail.data.title} · {detail.data.status}
          </Typography>
          <Typography>{detail.data.requirements}</Typography>
          <Typography>{detail.data.result}</Typography>
          <Button onClick={() => setSelected('')}>Đóng chi tiết</Button>
        </Paper>
      )}
      {list.data?.items.length === 0 && <Alert severity="info">Chưa có công việc.</Alert>}
      {list.data?.items.map((t) => (
        <Button key={t.id} onClick={() => setSelected(t.id)}>
          {t.title} · {t.status}
        </Button>
      ))}
      <Stack direction="row">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Trang trước
        </Button>
        <Button
          disabled={!list.data || page * 20 >= list.data.totalCount}
          onClick={() => setPage(page + 1)}
        >
          Trang sau
        </Button>
      </Stack>
    </Stack>
  );
}
