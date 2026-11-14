import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { Plus, RefreshCw } from 'lucide-react';
import { OwnerFeedback } from '../../components/common/OwnerWorkspace';
import { KPIGrid, PageHeader } from '../../components/common/PortalUI';
import { todayVietnam } from './staffContracts';
import { assignmentDate, assignmentState, useLocationAssignments } from './useLocationAssignments';
import {
  AssignedStaff,
  AssignmentDetailDrawer,
  AssignmentStatusChip,
} from './components/AssignmentDetailDrawer';
import { AssignmentDialog, type AssignmentIntent } from './components/AssignmentDialog';

export function StaffAssignments() {
  const compact = useMediaQuery('(max-width:599px)');
  const { data, directory, refresh, retryLocation } = useLocationAssignments();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const staffId = params.get('staffUserId') ?? '';
  const [selected, setSelected] = useState('');
  const [intent, setIntent] = useState<AssignmentIntent>();
  const [notice, setNotice] = useState('');
  const today = todayVietnam();
  const staff = directory.data ?? [];
  const rows = data.data ?? [];
  const complete =
    !!data.data && !data.isError && rows.every((row) => !!row.assignments && !row.error);
  const assigned = rows.filter((row) =>
    row.assignments?.some((item) => assignmentState(item, today) === 'current'),
  ).length;
  const visible = rows.filter((row) => {
    const current = row.assignments?.find((item) => assignmentState(item, today) === 'current');
    const person = staff.find((item) => item.userId === current?.staffUserId);
    const text = [row.location.name, person?.fullName, person?.email]
      .join(' ')
      .toLocaleLowerCase('vi');
    return (
      text.includes(search.toLocaleLowerCase('vi')) &&
      (!staffId || row.assignments?.some((item) => item.staffUserId === staffId)) &&
      (!status ||
        (!!row.assignments &&
          !row.error &&
          (status === 'current'
            ? !!current
            : status === 'empty'
              ? !current
              : row.assignments.some((item) => assignmentState(item, today) === 'future'))))
    );
  });
  const clear = () => {
    setSearch('');
    setStatus('');
    const next = new URLSearchParams(params);
    next.delete('staffUserId');
    setParams(next, { replace: true });
  };
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <PageHeader
        title="Phân công nhân viên"
        actions={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            disabled={!complete || !directory.data || !!directory.error}
            onClick={() => setIntent({ mode: 'create' })}
          >
            Tạo phân công
          </Button>
        }
      />
      <KPIGrid
        items={[
          { label: 'Tổng cơ sở', value: data.isPending ? '…' : complete ? rows.length : '—' },
          {
            label: 'Đã có người phụ trách',
            value: data.isPending ? '…' : complete ? assigned : '—',
            tone: 'success',
          },
          {
            label: 'Chưa có người phụ trách',
            value: data.isPending ? '…' : complete ? rows.length - assigned : '—',
          },
        ]}
      />
      <OwnerFeedback
        busy={data.isFetching || directory.isFetching}
        error={data.error || directory.error}
        notice={notice}
      />
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
          <TextField
            size="small"
            label="Tìm tên cơ sở hoặc nhân viên"
            placeholder="Tìm tên cơ sở hoặc nhân viên..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flex: 2 }}
          />
          <TextField
            size="small"
            select
            label="Trạng thái"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
          >
            <MenuItem value="">Tất cả cơ sở</MenuItem>
            <MenuItem value="current">Đang có người phụ trách</MenuItem>
            <MenuItem value="empty">Chưa có người phụ trách</MenuItem>
            <MenuItem value="future">Có phân công sắp hiệu lực</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label="Nhân viên"
            value={staffId}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('staffUserId', event.target.value);
              else next.delete('staffUserId');
              setParams(next, { replace: true });
            }}
            sx={{ flex: 1, minWidth: 180 }}
          >
            <MenuItem value="">Tất cả nhân viên</MenuItem>
            {staffId && !staff.some((item) => item.userId === staffId) && (
              <MenuItem value={staffId}>{staffId}</MenuItem>
            )}
            {staff.map((item) => (
              <MenuItem key={item.userId} value={item.userId}>
                {item.fullName || item.email}
              </MenuItem>
            ))}
          </TextField>
          <Button
            startIcon={<RefreshCw size={17} />}
            onClick={() => void refresh()}
            disabled={data.isFetching}
          >
            Làm mới
          </Button>
        </Stack>
        {(search || status || staffId) && (
          <Button sx={{ ml: 2 }} onClick={clear}>
            Xóa bộ lọc
          </Button>
        )}
        <TableContainer>
          <Table
            size="small"
            aria-label="Phân công theo cơ sở"
            sx={{ minWidth: compact ? 0 : 720, tableLayout: compact ? 'fixed' : 'auto' }}
          >
            <TableHead>
              <TableRow>
                {(compact
                  ? ['Cơ sở', 'Thao tác']
                  : ['Cơ sở', 'Người phụ trách', 'Thời gian hiệu lực', 'Trạng thái', 'Thao tác']
                ).map((label) => (
                  <TableCell
                    key={label}
                    scope="col"
                    align={label === 'Thao tác' ? 'right' : 'left'}
                    sx={{
                      fontWeight: 600,
                      width: compact && label === 'Thao tác' ? 112 : undefined,
                    }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((row) => {
                const current = row.assignments?.find(
                  (item) => assignmentState(item, today) === 'current',
                );
                const future = row.assignments
                  ?.filter((item) => assignmentState(item, today) === 'future')
                  .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
                return (
                  <TableRow
                    key={row.location.id}
                    hover
                    tabIndex={row.error ? undefined : 0}
                    onClick={() => {
                      if (!row.error) setSelected(row.location.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        if (!row.error) setSelected(row.location.id);
                      }
                    }}
                    sx={{
                      cursor: 'pointer',
                      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                    }}
                  >
                    <TableCell sx={{ fontWeight: 600, maxWidth: 240, overflowWrap: 'anywhere' }}>
                      {row.location.name}
                      {compact && (
                        <Stack
                          spacing={0.75}
                          sx={{ mt: 1, alignItems: 'flex-start', fontWeight: 400 }}
                        >
                          {row.error ? (
                            <Typography variant="caption" color="error.main">
                              Chưa tải được phân công
                            </Typography>
                          ) : (
                            <>
                              <AssignmentStatusChip
                                state={current ? 'current' : future ? 'future' : 'empty'}
                              />
                              {current ? (
                                <AssignedStaff staff={staff} id={current.staffUserId} />
                              ) : (
                                <Typography variant="body2">
                                  {future
                                    ? 'Sắp nhận việc: ' +
                                      (staff.find((item) => item.userId === future.staffUserId)
                                        ?.fullName || future.staffUserId)
                                    : 'Chưa có người phụ trách'}
                                </Typography>
                              )}
                              <Typography variant="caption" color="text.secondary">
                                {current
                                  ? assignmentDate(current.startDate) +
                                    ' – ' +
                                    assignmentDate(current.endDate)
                                  : '—'}
                              </Typography>
                            </>
                          )}
                        </Stack>
                      )}
                    </TableCell>
                    {!compact && (
                      <>
                        <TableCell>
                          {row.error ? (
                            'Chưa tải được phân công'
                          ) : current ? (
                            <AssignedStaff staff={staff} id={current.staffUserId} />
                          ) : (
                            <Stack>
                              <Typography sx={{ fontSize: 14 }}>Chưa có người phụ trách</Typography>
                              {future && (
                                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                                  Sắp nhận việc:{' '}
                                  {staff.find((item) => item.userId === future.staffUserId)
                                    ?.fullName || future.staffUserId}
                                </Typography>
                              )}
                            </Stack>
                          )}
                        </TableCell>
                        <TableCell>
                          {current
                            ? assignmentDate(current.startDate) +
                              ' – ' +
                              assignmentDate(current.endDate)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {row.error ? (
                            'Lỗi tải dữ liệu'
                          ) : (
                            <AssignmentStatusChip
                              state={current ? 'current' : future ? 'future' : 'empty'}
                            />
                          )}
                        </TableCell>
                      </>
                    )}
                    <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                      <Button
                        disabled={!row.error && (!!directory.error || !directory.data)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (row.error) void retryLocation(row.location.id);
                          else if (current) setSelected(row.location.id);
                          else setIntent({ mode: 'create', locationId: row.location.id });
                        }}
                      >
                        {row.error ? 'Thử lại' : current ? 'Chi tiết' : 'Phân công'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {!visible.length && (
          <Typography sx={{ p: 3, textAlign: 'center', fontSize: 14 }}>
            {data.isPending
              ? 'Đang tải cơ sở…'
              : data.error
                ? 'Không tải được danh sách cơ sở. Hãy thử làm mới.'
                : 'Không có cơ sở phù hợp.'}
          </Typography>
        )}
        <Typography sx={{ p: 2, fontSize: 13, color: 'text.secondary' }}>
          {visible.length} cơ sở
        </Typography>
      </Paper>
      <AssignmentDetailDrawer
        row={rows.find((row) => row.location.id === selected && !row.error)}
        staff={staff}
        today={today}
        close={() => setSelected('')}
        act={setIntent}
      />
      {intent && (
        <AssignmentDialog
          intent={intent}
          locations={rows.map((row) => row.location)}
          staff={staff}
          close={() => setIntent(undefined)}
          saved={async () => {
            await refresh();
            setNotice('Đã cập nhật phân công.');
          }}
        />
      )}
    </Stack>
  );
}
