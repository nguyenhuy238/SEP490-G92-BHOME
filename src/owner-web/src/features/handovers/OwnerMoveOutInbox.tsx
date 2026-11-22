import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ClipboardCheck, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  contractError,
  displayContractDate,
} from '../../../../../packages/client-core/src/contracts';
import { FilterToolbar, StatusChip } from '../../components/common/PortalUI';
import { useContractsApi } from '../contracts/useContractsApi';
import { OwnerMoveOutReviewPanel } from './OwnerMoveOutReviewPanel';

interface MoveOutInboxItem {
  contractId: string;
  roomNumber: string;
  locationId: string;
  locationName: string;
  status: string;
  proposedDate: string;
}

interface MoveOutInboxPage {
  items: MoveOutInboxItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

const moveOutStates = [
  { value: 'Requested', label: 'Chờ duyệt yêu cầu' },
  { value: 'Approved', label: 'Staff đang xử lý' },
  { value: 'Inspected', label: 'Đã có kết quả Staff' },
  { value: 'PendingSettlement', label: 'Đang quyết toán' },
  { value: 'Settled', label: 'Đã quyết toán' },
  { value: 'Completed', label: 'Đã trả phòng' },
];

function labelFor(status: string) {
  return moveOutStates.find((item) => item.value === status)?.label ?? status;
}

export function OwnerMoveOutInbox() {
  const { session } = useAuth();
  const api = useContractsApi();
  const [params, setParams] = useSearchParams();
  const selected = params.get('contractId') ?? '';
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [room, setRoom] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRoom(roomSearch.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [roomSearch]);

  const locations = useQuery({
    queryKey: ['move-out-inbox-locations', session?.userId],
    enabled: !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) => api.locations(signal),
  });
  const inbox = useQuery({
    queryKey: ['move-out-inbox', session?.userId, page, location, status, room],
    enabled: !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) =>
      api.transport<MoveOutInboxPage>(
        `/api/v1/contracts/move-out-inbox?${new URLSearchParams({
          page: String(page),
          pageSize: '20',
          ...(location ? { locationId: location } : {}),
          ...(status ? { status } : {}),
          ...(room ? { room } : {}),
        })}`,
        { signal },
      ),
  });
  const visible = inbox.data?.items ?? [];
  const selectedItem = visible.find((item) => item.contractId === selected);
  const setSelected = (contractId: string) =>
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      updated.set('tab', 'move-out');
      if (contractId) updated.set('contractId', contractId);
      else updated.delete('contractId');
      return updated;
    });

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          Kết quả kiểm tra Staff và các khoản dự kiến thu khi trả phòng
        </Typography>
        <Button
          startIcon={<RefreshCw size={16} />}
          disabled={inbox.isFetching}
          onClick={() => void inbox.refetch()}
        >
          Tải lại
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <FilterToolbar>
            <TextField
              size="small"
              select
              label="Cơ sở"
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setPage(1);
              }}
              sx={{ maxWidth: { sm: 260 } }}
            >
              <MenuItem value="">Tất cả cơ sở</MenuItem>
              {(locations.data ?? []).map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label="Trạng thái trả phòng"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              sx={{ maxWidth: { sm: 230 } }}
            >
              <MenuItem value="">Tất cả trạng thái</MenuItem>
              {moveOutStates.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Tìm phòng"
              placeholder="Ví dụ: P.102"
              value={roomSearch}
              onChange={(event) => setRoomSearch(event.target.value)}
              sx={{ flex: { sm: '1 1 220px' }, maxWidth: { sm: 340 } }}
            />
            {(location || status || roomSearch) && (
              <Button
                onClick={() => {
                  setLocation('');
                  setStatus('');
                  setRoomSearch('');
                  setPage(1);
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
          </FilterToolbar>
          {locations.error && (
            <Alert severity="warning">
              Không tải được danh sách cơ sở.{' '}
              <Button onClick={() => void locations.refetch()}>Thử lại</Button>
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {inbox.data
              ? `${inbox.data.totalCount} yêu cầu trả phòng phù hợp`
              : 'Danh sách trả phòng'}
          </Typography>
          {inbox.isFetching && <LinearProgress aria-label="Đang tải danh sách trả phòng" />}
          {inbox.error ? (
            <Alert
              severity="error"
              action={<Button onClick={() => void inbox.refetch()}>Thử lại</Button>}
            >
              Không tải được danh sách trả phòng: {contractError(inbox.error)}
            </Alert>
          ) : inbox.isPending ? (
            <Stack spacing={1}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height={54} variant="rounded" />
              ))}
            </Stack>
          ) : !visible.length ? (
            <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', py: 5 }}>
              <ClipboardCheck size={32} color="#64748b" strokeWidth={1.5} />
              <Typography sx={{ fontWeight: 700 }}>Chưa có yêu cầu trả phòng phù hợp</Typography>
              <Typography variant="body2" color="text.secondary">
                Thử chọn cơ sở hoặc trạng thái khác.
              </Typography>
            </Stack>
          ) : (
            <>
              <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
                <Table size="small" aria-label="Danh sách trả phòng">
                  <TableHead>
                    <TableRow>
                      <TableCell>Phòng / Cơ sở</TableCell>
                      <TableCell>Ngày dự kiến trả</TableCell>
                      <TableCell>Trạng thái</TableCell>
                      <TableCell align="right">Thao tác</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((item) => (
                      <TableRow key={item.contractId} hover>
                        <TableCell>
                          <Typography sx={{ fontWeight: 700 }}>Phòng {item.roomNumber}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.locationName}
                          </Typography>
                        </TableCell>
                        <TableCell>{displayContractDate(item.proposedDate)}</TableCell>
                        <TableCell>
                          <StatusChip label={labelFor(item.status)} />
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => setSelected(item.contractId)}>
                            Xem kết quả
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack sx={{ display: { xs: 'flex', md: 'none' } }}>
                {visible.map((item) => (
                  <Box key={item.contractId} sx={{ py: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'start', justifyContent: 'space-between' }}
                    >
                      <Box>
                        <Typography sx={{ fontWeight: 700 }}>Phòng {item.roomNumber}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {item.locationName} · {displayContractDate(item.proposedDate)}
                        </Typography>
                      </Box>
                      <StatusChip label={labelFor(item.status)} />
                    </Stack>
                    <Button
                      sx={{ mt: 1, minHeight: 44 }}
                      size="small"
                      onClick={() => setSelected(item.contractId)}
                    >
                      Xem kết quả
                    </Button>
                  </Box>
                ))}
              </Stack>
            </>
          )}
          {!!inbox.data && inbox.data.totalCount > inbox.data.pageSize && (
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption">
                Trang {page} / {Math.ceil(inbox.data.totalCount / inbox.data.pageSize)}
              </Typography>
              <Pagination
                page={page}
                count={Math.ceil(inbox.data.totalCount / inbox.data.pageSize)}
                disabled={inbox.isFetching}
                onChange={(_, p) => setPage(p)}
              />
            </Stack>
          )}
        </Stack>
      </Paper>
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => {
          setSelected('');
          void inbox.refetch();
        }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 'min(900px, 96vw)' },
              maxWidth: '100vw',
              bgcolor: 'background.default',
            },
          },
        }}
      >
        <Stack sx={{ height: '100%', minHeight: 0 }}>
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 750 }}>
                  {selectedItem ? `Trả phòng · ${selectedItem.roomNumber}` : 'Chi tiết trả phòng'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedItem?.locationName ?? 'Hồ sơ hợp đồng'}
                </Typography>
              </Box>
              <IconButton
                aria-label="Đóng chi tiết trả phòng"
                onClick={() => {
                  setSelected('');
                  void inbox.refetch();
                }}
              >
                <X size={20} />
              </IconButton>
            </Stack>
          </Box>
          <Box sx={{ overflowY: 'auto', flex: 1, p: { xs: 1.5, sm: 2.5 } }}>
            {!!selected && (
              <Stack spacing={2}>
                <Button
                  component={Link}
                  to={`/contracts?contractId=${encodeURIComponent(selected)}`}
                  sx={{ alignSelf: 'flex-start' }}
                  size="small"
                >
                  Mở hồ sơ hợp đồng
                </Button>
                <OwnerMoveOutReviewPanel
                  key={selected}
                  api={api}
                  id={selected}
                  onChanged={() => void inbox.refetch()}
                />
              </Stack>
            )}
          </Box>
        </Stack>
      </Drawer>
    </Stack>
  );
}
