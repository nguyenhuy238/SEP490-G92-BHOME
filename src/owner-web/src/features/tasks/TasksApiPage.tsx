import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Plus } from 'lucide-react';
import { OwnerFeedback, OwnerPagination } from '../../components/common/OwnerWorkspace';
import { OwnerLocationPicker } from '../../components/common/OwnerSelectors';
import { ownerQuery, useOwnerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { taskStatus, vietnamInstant, type OwnerTask } from './taskContracts';
import { taskRoot, useTaskDirectory, responsibleName } from './useOperationalTasksApi';
import { TaskDetailDrawer, TaskStatus } from './components/TaskDetailDrawer';
import { TaskEditorDialog } from './components/TaskEditorDialog';
import { RecurringTasks } from './components/RecurringTasks';

export function TasksApiPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('taskId') ?? '';
  const [initialOperation, setInitialOperation] = useState('');
  const [tab, setTab] = useState(0),
    [advanced, setAdvanced] = useState(false),
    [editor, setEditor] = useState<OwnerTask | null | undefined>(),
    [notice, setNotice] = useState('');
  const [filter, setFilter] = useState({
    location: '',
    status: '',
    priority: '',
    staff: '',
    overdue: false,
    from: '',
    to: '',
    page: 1,
  });
  const update = (value: Partial<typeof filter>) =>
    setFilter((current) => ({ ...current, ...value, page: 1 }));
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('taskId', id);
    else next.delete('taskId');
    setParams(next, { replace: true });
  };
  const { staff, locations } = useTaskDirectory();
  const locationName = (id: string) =>
    locations.data?.find((item) => item.id === id)?.name ?? 'Không tải được tên cơ sở';
  const query = ownerQuery({
    locationId: filter.location,
    status: tab === 2 ? '4' : filter.status,
    priority: filter.priority,
    staffUserId: filter.staff,
    isOverdue: filter.overdue || undefined,
    dueFrom: filter.from ? vietnamInstant(filter.from) : '',
    dueTo: filter.to ? vietnamInstant(filter.to) : '',
    page: filter.page,
    pageSize: 20,
  });
  const list = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['tasks', query],
    taskRoot + '?' + query,
    tab !== 1,
  );
  const total = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['task-summary', 'all'],
    taskRoot + '?page=1&pageSize=1',
  );
  const completed = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['task-summary', 'completed'],
    taskRoot + '?status=2&page=1&pageSize=1',
  );
  const cancelled = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['task-summary', 'cancelled'],
    taskRoot + '?status=3&page=1&pageSize=1',
  );
  const overdue = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['task-summary', 'overdue'],
    taskRoot + '?isOverdue=true&page=1&pageSize=1',
  );
  const pending = useOwnerQuery<OwnerPage<OwnerTask>>(
    ['task-summary', 'pending'],
    taskRoot + '?status=4&page=1&pageSize=1',
  );
  const incomplete =
    total.data &&
    completed.data &&
    cancelled.data &&
    !total.error &&
    !completed.error &&
    !cancelled.error
      ? Math.max(0, total.data.totalCount - completed.data.totalCount - cancelled.data.totalCount)
      : undefined;
  const refresh = () => {
    void Promise.all([
      list.refetch(),
      total.refetch(),
      completed.refetch(),
      cancelled.refetch(),
      overdue.refetch(),
      pending.refetch(),
      staff.refetch(),
      locations.refetch(),
    ]);
  };
  return (
    <Stack
      spacing={2.5}
      sx={{
        minWidth: 0,
        '& .MuiPaper-root': { borderRadius: '12px', boxShadow: 'none' },
        '& .MuiButton-root': { borderRadius: '8px', fontSize: 14, minHeight: 40 },
        '& .MuiTableCell-root, & .MuiInputBase-root, & .MuiInputLabel-root': { fontSize: 14 },
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
            Công việc vận hành
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>
            Quản lý, theo dõi và nghiệm thu công việc tại các cơ sở.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setEditor(null)}>
          Tạo công việc
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {[
          ['Tổng công việc', total.error ? '—' : (total.data?.totalCount ?? '…')],
          ['Chưa hoàn thành', incomplete ?? '—'],
          ['Quá hạn', overdue.error ? '—' : (overdue.data?.totalCount ?? '…')],
        ].map(([label, value]) => (
          <Paper key={label} variant="outlined" sx={{ p: 2, flex: 1, minHeight: 86 }}>
            <Typography sx={{ fontSize: 27, fontWeight: 700 }}>{value}</Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{label}</Typography>
          </Paper>
        ))}
      </Stack>
      <OwnerFeedback
        error={
          total.error ||
          completed.error ||
          cancelled.error ||
          overdue.error ||
          pending.error ||
          staff.error ||
          locations.error
        }
      />
      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, value: number) => {
            setTab(value);
            setFilter((current) => ({ ...current, page: 1 }));
          }}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab label="Danh sách công việc" />
          <Tab label="Lịch công việc định kỳ" />
          <Tab
            label={`Chờ nghiệm thu${pending.data && !pending.error ? ' (' + pending.data.totalCount + ')' : ''}`}
          />
        </Tabs>
      </Paper>
      {tab === 1 ? (
        <RecurringTasks
          key={filter.location}
          location={filter.location}
          change={(value) => update({ location: value })}
          locationName={locationName}
          notify={setNotice}
        />
      ) : (
        <>
          {tab === 2 && (
            <Box>
              <Typography sx={{ fontSize: 18, fontWeight: 600 }}>
                Công việc chờ nghiệm thu
              </Typography>
              <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
                Kiểm tra kết quả và bằng chứng do nhân viên gửi.
              </Typography>
            </Box>
          )}
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Stack spacing={1.5} sx={{ p: 2 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { md: 'center' } }}
              >
                <Box sx={{ flex: 2, minWidth: 200 }}>
                  <OwnerLocationPicker
                    simple
                    value={filter.location}
                    change={(value) => update({ location: value })}
                  />
                </Box>
                {tab !== 2 && (
                  <TextField
                    size="small"
                    select
                    label="Trạng thái công việc"
                    value={filter.status}
                    onChange={(e) => update({ status: e.target.value })}
                    sx={{ flex: 1, minWidth: 180 }}
                  >
                    <MenuItem value="">Tất cả</MenuItem>
                    {[
                      'Assigned',
                      'InProgress',
                      'Completed',
                      'Cancelled',
                      'PendingVerification',
                    ].map((value, index) => (
                      <MenuItem key={value} value={String(index)}>
                        {taskStatus[value]}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                <TextField
                  size="small"
                  select
                  label="Ưu tiên"
                  value={filter.priority}
                  onChange={(e) => update({ priority: e.target.value })}
                  sx={{ minWidth: 130 }}
                >
                  <MenuItem value="">Tất cả</MenuItem>
                  <MenuItem value="0">Bình thường</MenuItem>
                  <MenuItem value="1">Cao</MenuItem>
                </TextField>
                <FormControlLabel
                  label="Chỉ quá hạn"
                  control={
                    <Checkbox
                      checked={filter.overdue}
                      onChange={(_, value) => update({ overdue: value })}
                    />
                  }
                />
              </Stack>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
                  Bộ lọc nâng cao
                </Button>
                <Button onClick={refresh}>Làm mới</Button>
                <Button
                  onClick={() =>
                    setFilter({
                      location: '',
                      status: '',
                      priority: '',
                      staff: '',
                      overdue: false,
                      from: '',
                      to: '',
                      page: 1,
                    })
                  }
                >
                  Xóa bộ lọc
                </Button>
              </Stack>
              <Collapse in={advanced}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 1 }}>
                  <TextField
                    size="small"
                    select
                    label="Staff phụ trách"
                    value={filter.staff}
                    onChange={(e) => update({ staff: e.target.value })}
                    sx={{ flex: 1, minWidth: 180 }}
                  >
                    <MenuItem value="">Tất cả Staff</MenuItem>
                    {staff.data?.map((person) => (
                      <MenuItem key={person.userId} value={person.userId}>
                        {person.fullName || person.email}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    type="datetime-local"
                    label="Hạn từ (giờ Việt Nam)"
                    value={filter.from}
                    onChange={(e) => update({ from: e.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    size="small"
                    type="datetime-local"
                    label="Hạn đến (giờ Việt Nam)"
                    value={filter.to}
                    onChange={(e) => update({ to: e.target.value })}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: filter.from } }}
                  />
                </Stack>
              </Collapse>
            </Stack>
            <OwnerFeedback busy={list.isFetching} error={list.error} />
            {tab === 2 ? (
              <Stack spacing={2} sx={{ p: 2 }}>
                {list.data?.items.map((task) => (
                  <Paper key={task.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1}>
                      <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{task.title}</Typography>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                        {locationName(task.locationId)} · {responsibleName(task, staff.data ?? [])}
                      </Typography>
                      <TaskStatus task={task} />
                      <Typography sx={{ fontSize: 13 }}>
                        Hạn: {task.dueAt ? formatInstant(task.dueAt) : 'Chưa đặt'}
                      </Typography>
                      <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
                        {task.result || 'Chưa có kết quả.'}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            setInitialOperation('');
                            select(task.id);
                          }}
                        >
                          Xem chi tiết
                        </Button>
                        <Button
                          variant="contained"
                          onClick={() => {
                            setInitialOperation('verify');
                            select(task.id);
                          }}
                        >
                          Nghiệm thu
                        </Button>
                        <Button
                          onClick={() => {
                            setInitialOperation('rework');
                            select(task.id);
                          }}
                        >
                          Yêu cầu làm lại
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <TableContainer>
                <Table aria-label="Danh sách công việc" sx={{ minWidth: 700 }}>
                  <TableHead sx={{ bgcolor: '#f5f8fc' }}>
                    <TableRow>
                      {['Công việc', 'Trạng thái', 'Deadline', 'Người phụ trách', 'Thao tác'].map(
                        (label) => (
                          <TableCell key={label} sx={{ fontWeight: 600 }}>
                            {label}
                          </TableCell>
                        ),
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {list.data?.items.map((task) => (
                      <TableRow
                        key={task.id}
                        hover
                        tabIndex={0}
                        onClick={() => select(task.id)}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            ['Enter', ' '].includes(event.key)
                          ) {
                            event.preventDefault();
                            select(task.id);
                          }
                        }}
                        sx={{
                          cursor: 'pointer',
                          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                        }}
                      >
                        <TableCell sx={{ maxWidth: 280 }}>
                          <Typography
                            component="div"
                            sx={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}
                          >
                            {task.title}{' '}
                            {task.priority === 'High' && (
                              <Chip size="small" label="Ưu tiên cao" color="warning" />
                            )}
                          </Typography>
                          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                            {locationName(task.locationId)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <TaskStatus task={task} />
                        </TableCell>
                        <TableCell sx={{ color: task.isOverdue ? 'error.main' : undefined }}>
                          {task.dueAt ? formatInstant(task.dueAt) : 'Chưa có hạn'}
                        </TableCell>
                        <TableCell>{responsibleName(task, staff.data ?? [])}</TableCell>
                        <TableCell>
                          <Button
                            onClick={(event) => {
                              event.stopPropagation();
                              select(task.id);
                            }}
                          >
                            Xem chi tiết
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {!list.isPending && !list.error && !list.data?.items.length && (
              <Typography sx={{ p: 3, textAlign: 'center', fontSize: 14 }}>
                Không có công việc phù hợp.
              </Typography>
            )}
            {list.data && (
              <Box sx={{ p: 2 }}>
                {list.data.totalCount > 20 ? (
                  <OwnerPagination
                    page={filter.page}
                    total={list.data.totalCount}
                    busy={list.isFetching}
                    change={(page) => setFilter((current) => ({ ...current, page }))}
                  />
                ) : (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    {list.data.totalCount} công việc
                  </Typography>
                )}
              </Box>
            )}
          </Paper>
        </>
      )}
      {id && (
        <TaskDetailDrawer
          key={id}
          id={id}
          close={() => {
            setInitialOperation('');
            select('');
          }}
          edit={setEditor}
          staff={staff.data ?? []}
          locationName={locationName}
          notify={setNotice}
          initialOperation={initialOperation}
        />
      )}
      {editor !== undefined && (
        <TaskEditorDialog
          task={editor}
          initialLocation={filter.location}
          close={() => setEditor(undefined)}
          notify={setNotice}
        />
      )}
      <Snackbar
        open={!!notice}
        message={notice}
        autoHideDuration={5000}
        onClose={() => setNotice('')}
      />
    </Stack>
  );
}
