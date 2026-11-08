import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Stack, TextField, Typography,
} from '@mui/material';
import { contractError } from '../../../../../../packages/client-core/src/contracts';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { EmptyState, PageHeader, StatusChip } from '../../../components/common/PortalUI';
import { isMockMode } from '../../../services/config';
import { usePropertyApi } from '../../property-api/propertyApi';
import {
  type OperationalTask, type OwnerTaskAction, type TaskWork, useOperationalTasksApi,
} from '../useOperationalTasksApi';

const labels: Record<string, string> = {
  Assigned: 'Cần làm', InProgress: 'Đang xử lý', PendingVerification: 'Chờ Owner kiểm tra',
  Completed: 'Hoàn thành', Cancelled: 'Đã hủy', created: 'Tạo công việc',
  updated: 'Cập nhật yêu cầu', assign: 'Đồng bộ phân công', coordinate: 'Phối hợp',
  verify: 'Xác nhận hoàn thành', rework: 'Yêu cầu làm lại', cancel: 'Hủy công việc',
  progress: 'Cập nhật tiến độ', blockers: 'Báo vướng mắc', submit: 'Gửi kết quả',
  evidence_uploaded: 'Tải bằng chứng', responsibility_changed: 'Cập nhật phân công',
};
const emptyWork = (): TaskWork => ({ title: '', requirements: '', priority: 'Normal', dueAt: '', evidenceRequired: false });
const localDateTime = (value: string | null) => value?.slice(0, 16) ?? '';

export default function TasksPage() {
  return isMockMode ? <ResourcePage kind="tasks" variant="table" /> : <LiveTasks />;
}

function LiveTasks() {
  const api = useOperationalTasksApi();
  const property = usePropertyApi();
  const cache = useQueryClient();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(params.get('taskId') ?? '');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [locationId, setLocationId] = useState('');
  const [editor, setEditor] = useState<OperationalTask | 'new' | null>(null);
  const [action, setAction] = useState<OwnerTaskAction | null>(null);
  const query = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) value.set('status', status);
    if (locationId) value.set('locationId', locationId);
    return value.toString();
  }, [page, status, locationId]);
  const locations = useQuery({ queryKey: ['task-locations'], queryFn: ({ signal }) => property.locations(signal) });
  const list = useQuery({ queryKey: ['owner-operational-tasks', query], queryFn: ({ signal }) => api.list(query, signal) });
  const detail = useQuery({ queryKey: ['owner-operational-task', selected], enabled: !!selected, queryFn: ({ signal }) => api.get(selected, signal) });
  const history = useQuery({ queryKey: ['owner-operational-task-history', selected], enabled: !!selected, queryFn: ({ signal }) => api.history(selected, signal) });
  const evidence = useQuery({ queryKey: ['owner-operational-task-evidence', selected], enabled: !!selected, queryFn: ({ signal }) => api.evidence(selected, signal) });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ['owner-operational-task'] });
    await cache.invalidateQueries({ queryKey: ['owner-operational-tasks'] });
  };
  return <Stack spacing={2}>
    <PageHeader title="Công việc vận hành" subtitle="Tạo, phân công, theo dõi bằng chứng và kiểm tra kết quả theo dữ liệu Backend." actions={<Button variant="contained" onClick={() => setEditor('new')}>Tạo công việc</Button>} />
    <Paper sx={{ p: 2 }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <FormControl size="small" sx={{ minWidth: 220 }}><InputLabel id="task-location-filter">Cơ sở</InputLabel><Select labelId="task-location-filter" label="Cơ sở" value={locationId} onChange={(event) => { setLocationId(event.target.value); setPage(1); }}><MenuItem value="">Tất cả cơ sở</MenuItem>{locations.data?.items.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</Select></FormControl>
      <FormControl size="small" sx={{ minWidth: 220 }}><InputLabel id="task-status-filter">Trạng thái</InputLabel><Select labelId="task-status-filter" label="Trạng thái" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><MenuItem value="">Tất cả trạng thái</MenuItem>{['Assigned', 'InProgress', 'PendingVerification', 'Completed', 'Cancelled'].map((value) => <MenuItem key={value} value={value}>{labels[value]}</MenuItem>)}</Select></FormControl>
      <Button onClick={() => void list.refetch()}>Làm mới</Button>
    </Stack></Paper>
    {(list.isPending || detail.isPending) && <LinearProgress />}
    {(list.error || detail.error) && <Alert severity="error">{contractError(list.error ?? detail.error)}</Alert>}
    {detail.data ? <TaskDetail task={detail.data} history={history.data?.items ?? []} evidence={evidence.data ?? []} onClose={() => setSelected('')} onEdit={() => setEditor(detail.data!)} onAction={setAction} onDownload={async (evidenceId) => {
      const blob = await api.evidenceFile(detail.data!.id, evidenceId);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'task-evidence'; anchor.click(); URL.revokeObjectURL(url);
    }} /> : <>
      {list.data?.items.length === 0 && <EmptyState message="Không có công việc phù hợp." />}
      {list.data?.items.map((task) => <TaskRow key={task.id} task={task} onOpen={() => setSelected(task.id)} />)}
      {list.data && <Stack direction="row" spacing={1}><Button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Trang trước</Button><Button disabled={page * 20 >= list.data.totalCount} onClick={() => setPage((value) => value + 1)}>Trang sau</Button></Stack>}
    </>}
    <TaskEditor key={editor === 'new' ? 'new' : editor?.id ?? 'closed'} open={editor !== null} task={editor === 'new' ? null : editor} locations={locations.data?.items ?? []} onClose={() => setEditor(null)} onSaved={async (task) => { setEditor(null); setSelected(task.id); await refresh(); }} />
    {detail.data && action && <TaskActionDialog task={detail.data} action={action} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await refresh(); }} />}
  </Stack>;
}

function TaskRow({ task, onOpen }: { task: OperationalTask; onOpen: () => void }) {
  return <Paper sx={{ p: 2 }}><Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 2 }}><Box><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography variant="h6">{task.title}</Typography><StatusChip label={labels[task.status] ?? task.status} /></Stack><Typography color="text.secondary">{task.requirements}</Typography><Typography variant="caption" color={task.isOverdue ? 'error' : 'text.secondary'}>{task.dueAt ? `Hạn: ${new Date(task.dueAt).toLocaleString('vi-VN')}` : 'Không có hạn'}</Typography></Box><Button onClick={onOpen}>Xem chi tiết</Button></Stack></Paper>;
}

function TaskDetail({ task, history, evidence, onClose, onEdit, onAction, onDownload }: {
  task: OperationalTask;
  history: { id: string; action: string; note: string; occurredAt: string; taskVersion: number }[];
  evidence: { id: string; contentType: string; length: number; createdAt: string }[];
  onClose: () => void; onEdit: () => void; onAction: (action: OwnerTaskAction) => void;
  onDownload: (id: string) => Promise<void>;
}) {
  const terminal = ['Completed', 'Cancelled'].includes(task.status);
  return <Stack spacing={2}>
    <Paper sx={{ p: 2 }}><Stack spacing={1}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography variant="h6">{task.title}</Typography><StatusChip label={labels[task.status] ?? task.status} /></Stack><Typography>{task.requirements}</Typography><Typography variant="body2">Ưu tiên: {task.priority === 'High' ? 'Cao' : 'Bình thường'} · Phiên bản: {task.version}</Typography><Typography variant="body2">Nhân viên phụ trách: {task.currentResponsibleStaffUserId ?? 'Chưa có phân công hiệu lực'}</Typography>{task.result && <Typography>Kết quả: {task.result}</Typography>}<Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}><Button onClick={onClose}>Về danh sách</Button>{task.kind === 'AdHoc' && ['Assigned', 'InProgress'].includes(task.status) && <Button onClick={onEdit}>Sửa yêu cầu</Button>}{!terminal && <Button onClick={() => onAction('assign')}>Đồng bộ phân công</Button>}{!terminal && <Button onClick={() => onAction('coordinate')}>Ghi hướng dẫn</Button>}{task.status === 'PendingVerification' && <Button color="success" onClick={() => onAction('verify')}>Xác nhận hoàn thành</Button>}{task.status === 'PendingVerification' && <Button color="warning" onClick={() => onAction('rework')}>Yêu cầu làm lại</Button>}{!terminal && <Button color="error" onClick={() => onAction('cancel')}>Hủy công việc</Button>}</Stack></Stack></Paper>
    <Paper sx={{ p: 2 }}><Typography variant="h6" gutterBottom>Bằng chứng</Typography>{evidence.length === 0 ? <Typography color="text.secondary">Chưa có bằng chứng.</Typography> : evidence.map((row) => <Button key={row.id} onClick={() => void onDownload(row.id)}>{row.contentType} · {Math.ceil(row.length / 1024)} KB · {new Date(row.createdAt).toLocaleString('vi-VN')}</Button>)}</Paper>
    <Paper sx={{ p: 2 }}><Typography variant="h6" gutterBottom>Lịch sử</Typography>{history.length === 0 ? <Typography color="text.secondary">Chưa có lịch sử.</Typography> : history.map((row) => <Box key={row.id} sx={{ mb: 1 }}><Typography>{labels[row.action] ?? row.action} · v{row.taskVersion}</Typography><Typography variant="body2" color="text.secondary">{row.note || 'Không có ghi chú'} · {new Date(row.occurredAt).toLocaleString('vi-VN')}</Typography></Box>)}</Paper>
  </Stack>;
}

function TaskEditor({ open, task, locations, onClose, onSaved }: {
  open: boolean; task: OperationalTask | null; locations: { id: string; name: string }[];
  onClose: () => void; onSaved: (task: OperationalTask) => Promise<void>;
}) {
  const api = useOperationalTasksApi();
  const [locationId, setLocationId] = useState(task?.locationId ?? '');
  const [work, setWork] = useState<TaskWork>(() => task ? { title: task.title, requirements: task.requirements, priority: task.priority, dueAt: localDateTime(task.dueAt), evidenceRequired: task.evidenceRequired } : emptyWork());
  const [reason, setReason] = useState('');
  const key = useRef(crypto.randomUUID());
  const mutation = useMutation({ mutationFn: () => {
    const payload = { ...work, dueAt: new Date(work.dueAt).toISOString() };
    return task ? api.update(task.id, task.version, payload, reason.trim(), key.current) : api.create(locationId, payload, key.current);
  }, onSuccess: async (saved) => { key.current = crypto.randomUUID(); await onSaved(saved); } });
  const valid = !!locationId && !!work.title.trim() && !!work.requirements.trim() && !!work.dueAt && (!task || !!reason.trim());
  return <Dialog open={open} onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm"><DialogTitle>{task ? 'Cập nhật công việc' : 'Tạo công việc'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{mutation.error && <Alert severity="error">{contractError(mutation.error)}</Alert>}<FormControl size="small" disabled={!!task}><InputLabel id="task-editor-location">Cơ sở</InputLabel><Select labelId="task-editor-location" label="Cơ sở" value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</Select></FormControl><TextField label="Tiêu đề" value={work.title} onChange={(event) => setWork({ ...work, title: event.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} required /><TextField label="Yêu cầu thực hiện" value={work.requirements} onChange={(event) => setWork({ ...work, requirements: event.target.value })} multiline minRows={3} slotProps={{ htmlInput: { maxLength: 8000 } }} required /><FormControl size="small"><InputLabel id="task-priority">Ưu tiên</InputLabel><Select labelId="task-priority" label="Ưu tiên" value={work.priority} onChange={(event) => setWork({ ...work, priority: event.target.value as TaskWork['priority'] })}><MenuItem value="Normal">Bình thường</MenuItem><MenuItem value="High">Cao</MenuItem></Select></FormControl><TextField label="Hạn hoàn thành" type="datetime-local" value={work.dueAt} onChange={(event) => setWork({ ...work, dueAt: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} required /><FormControlLabel control={<Checkbox checked={work.evidenceRequired} onChange={(event) => setWork({ ...work, evidenceRequired: event.target.checked })} />} label="Bắt buộc có ảnh bằng chứng" />{task && <TextField label="Lý do cập nhật" value={reason} onChange={(event) => setReason(event.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} required />}</Stack></DialogContent><DialogActions><Button disabled={mutation.isPending} onClick={onClose}>Hủy</Button><Button variant="contained" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Đang lưu…' : 'Lưu'}</Button></DialogActions></Dialog>;
}

function TaskActionDialog({ task, action, onClose, onSaved }: { task: OperationalTask; action: OwnerTaskAction; onClose: () => void; onSaved: () => Promise<void> }) {
  const api = useOperationalTasksApi(); const [note, setNote] = useState(''); const key = useRef(crypto.randomUUID());
  const mutation = useMutation({ mutationFn: () => api.act(task.id, action, task.version, note.trim(), key.current), onSuccess: async () => { key.current = crypto.randomUUID(); await onSaved(); } });
  const noteRequired = ['coordinate', 'rework', 'cancel'].includes(action);
  return <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth maxWidth="sm"><DialogTitle>{labels[action]}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{mutation.error && <Alert severity="error">{contractError(mutation.error)}</Alert>}<Typography color="text.secondary">Backend sẽ kiểm tra lại quyền, trạng thái, phiên bản và phân công hiện hành.</Typography><TextField autoFocus label={noteRequired ? 'Nội dung / lý do' : 'Ghi chú (không bắt buộc)'} value={note} onChange={(event) => setNote(event.target.value)} multiline minRows={3} slotProps={{ htmlInput: { maxLength: 8000 } }} required={noteRequired} /></Stack></DialogContent><DialogActions><Button disabled={mutation.isPending} onClick={onClose}>Đóng</Button><Button variant="contained" color={action === 'cancel' ? 'error' : 'primary'} disabled={mutation.isPending || (noteRequired && !note.trim())} onClick={() => mutation.mutate()}>Xác nhận</Button></DialogActions></Dialog>;
}
