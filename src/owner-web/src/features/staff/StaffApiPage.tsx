import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Plus, RefreshCw, Search, X, Users, UserCheck } from 'lucide-react';
import { ConfirmDialog } from '../../components/common/PortalUI';
import { OwnerFeedback, OwnerPagination } from '../../components/common/OwnerWorkspace';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import type { Staff } from './staffContracts';
import { StaffTable, StaffDetailDrawer } from './components/StaffPresentation';
import { StaffEditor } from './components/StaffEditor';

export function StaffApiPage() {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState({ search: '', active: '', page: 1 });
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<Staff | null | undefined>();
  const [invite, setInvite] = useState(false);
  const action = useOwnerAction();
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilter((current) =>
          current.search === input ? current : { ...current, search: input, page: 1 },
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [input]);
  const list = useOwnerQuery<OwnerPage<Staff>>(
    ['staff', filter.search, filter.active, filter.page],
    '/api/v1/staff?' +
      ownerQuery({
        search: filter.search,
        isActive: filter.active,
        page: filter.page,
        pageSize: 20,
      }),
  );
  const overview = useOwnerQuery<OwnerPage<Staff>>(
    ['staff-overview'],
    '/api/v1/staff?page=1&pageSize=1',
  );
  const activeOverview = useOwnerQuery<OwnerPage<Staff>>(
    ['staff-overview-active'],
    '/api/v1/staff?isActive=true&page=1&pageSize=1',
  );
  const detail = useOwnerQuery<Staff>(
    ['staff-detail', selected],
    `/api/v1/staff/${selected}`,
    !!selected,
  );
  const refresh = () => {
    void list.refetch();
    void overview.refetch();
    void activeOverview.refetch();
  };
  return (
    <Stack
      spacing={2.5}
      sx={{
        '& .MuiPaper-root': { borderRadius: '12px', boxShadow: 'none' },
        '& .MuiButton-root': { borderRadius: '8px', fontSize: 14, minHeight: 40 },
        '& .MuiInputBase-root, & .MuiInputLabel-root': { fontSize: 14 },
        '& .MuiTableCell-root': { fontSize: 14, py: 1.75 },
        '& .MuiTableHead-root .MuiTableCell-root': { bgcolor: '#f5f8fc', fontSize: 13, height: 44 },
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700 }}>
            Quản lý nhân viên
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5 }}>
            Quản lý tài khoản, hợp đồng và trạng thái làm việc của nhân viên.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setEditor(null)}>
          Thêm nhân viên
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {[
          { label: 'Tổng nhân viên', query: overview, icon: <Users size={22} /> },
          {
            label: 'Tài khoản đang hoạt động',
            query: activeOverview,
            icon: <UserCheck size={22} />,
          },
        ].map(({ label, query, icon }) => (
          <Paper
            key={label}
            variant="outlined"
            sx={{ p: 2, flex: 1, minHeight: 88, display: 'flex', gap: 2, alignItems: 'center' }}
          >
            <Box
              sx={{
                color: 'primary.main',
                bgcolor: '#edf2ff',
                p: 1.25,
                borderRadius: '10px',
                display: 'flex',
              }}
            >
              {icon}
            </Box>
            <Box>
              <Typography sx={{ fontSize: 26, fontWeight: 700 }}>
                {query.isError ? '—' : (query.data?.totalCount ?? '…')}
              </Typography>
              <Typography sx={{ fontSize: 14 }} color="text.secondary">
                {label}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Stack>
      <OwnerFeedback error={overview.error || activeOverview.error} />
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ p: 2, alignItems: { sm: 'center' } }}
        >
          <TextField
            size="small"
            label="Tìm nhân viên"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={18} />
                  </InputAdornment>
                ),
                endAdornment: input ? (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label="Xóa tìm kiếm" onClick={() => setInput('')}>
                      <X size={16} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
          <TextField
            size="small"
            select
            label="Trạng thái tài khoản"
            value={filter.active}
            onChange={(event) =>
              setFilter((current) => ({ ...current, active: event.target.value, page: 1 }))
            }
            sx={{ width: { xs: '100%', sm: 220 } }}
          >
            <MenuItem value="">Tất cả</MenuItem>
            <MenuItem value="true">Đang hoạt động</MenuItem>
            <MenuItem value="false">Đã ngừng hoạt động</MenuItem>
          </TextField>
          <Button startIcon={<RefreshCw size={17} />} disabled={list.isFetching} onClick={refresh}>
            Làm mới
          </Button>
        </Stack>
        <Box sx={{ minHeight: 4 }}>
          <OwnerFeedback busy={list.isFetching} />
        </Box>
        <StaffTable
          rows={list.data?.items ?? []}
          select={(staff) => setSelected(staff.userId)}
          loading={list.isPending}
          error={list.error}
          retry={() => void list.refetch()}
        />
        {list.data && (
          <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
            {list.data.totalCount > 20 ? (
              <OwnerPagination
                page={filter.page}
                total={list.data.totalCount}
                change={(page) => setFilter((current) => ({ ...current, page }))}
                busy={list.isFetching}
              />
            ) : (
              <Typography sx={{ fontSize: 13 }} color="text.secondary">
                {list.data.totalCount} nhân viên
              </Typography>
            )}
          </Box>
        )}
      </Paper>
      <StaffDetailDrawer
        open={!!selected}
        staff={detail.data}
        busy={detail.isFetching}
        error={detail.error || action.error}
        notice={action.notice}
        close={() => setSelected('')}
        edit={setEditor}
        invite={() => setInvite(true)}
        retry={() => void detail.refetch()}
        actionBusy={action.busy}
      />
      <ConfirmDialog
        error={action.error}
        open={invite}
        title="Gửi thông tin tài khoản"
        busy={action.busy}
        onClose={() => setInvite(false)}
        onConfirm={() => {
          void action
            .run(
              () => action.command(`/api/v1/staff/${selected}/invitation`, 'POST'),
              'Đã tiếp nhận yêu cầu lời mời. Email đang chờ xử lý; chưa phải xác nhận đã giao thư.',
            )
            .then((ok) => {
              if (ok) setInvite(false);
            });
        }}
      >
        Gửi liên kết dùng một lần để nhân viên tự đặt mật khẩu đến email hiện tại. Không gửi mật
        khẩu rõ.
      </ConfirmDialog>
      {editor !== undefined && <StaffEditor staff={editor} close={() => setEditor(undefined)} />}
    </Stack>
  );
}
