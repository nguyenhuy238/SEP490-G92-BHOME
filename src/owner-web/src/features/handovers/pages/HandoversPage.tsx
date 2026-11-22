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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tabs,
  Typography,
} from '@mui/material';
import { FileText, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  contractError,
  displayContractDate,
} from '../../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { PageHeader, FilterToolbar, StatusChip } from '../../../components/common/PortalUI';
import { isMockMode } from '../../../services/config';
import { useContractsApi } from '../../contracts/useContractsApi';
import { OwnerHandoverDraftPanel } from '../../contracts/OwnerHandoverDraftPanel';
import { OwnerMoveOutInbox } from '../OwnerMoveOutInbox';

interface HandoverInboxItem {
  contractId: string;
  roomNumber: string;
  locationId: string;
  locationName: string;
  status: string;
  startDate: string;
  staffSubmittedAt?: string | null;
  ownerReadyAt?: string | null;
  tenantConfirmedAt?: string | null;
}

interface HandoverInboxPage {
  items: HandoverInboxItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

const handoverStates = [
  { value: 'PendingOwnerReview', label: 'Chờ Owner duyệt' },
  { value: 'ReinspectionRequested', label: 'Chờ Staff kiểm tra lại' },
  { value: 'Ready', label: 'Chờ Tenant ký' },
  { value: 'Confirmed', label: 'Hoàn tất' },
  { value: 'Draft', label: 'Đang lập biên bản' },
  { value: 'ChangesRequested', label: 'Tenant đề nghị chỉnh sửa' },
] as const;

function handoverStatus(status: string) {
  return handoverStates.find((state) => state.value === status)?.label ?? status;
}

function handoverActivity(item: HandoverInboxItem) {
  const date = item.tenantConfirmedAt ?? item.ownerReadyAt ?? item.staffSubmittedAt;
  const label = item.tenantConfirmedAt
    ? 'Tenant xác nhận'
    : item.ownerReadyAt
      ? 'Owner duyệt'
      : item.staffSubmittedAt
        ? 'Staff gửi'
        : '';
  return date ? `${label} · ${formatInstant(date)}` : 'Chưa ghi nhận mốc xác nhận';
}

export default function HandoversPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'move-out' ? 'move-out' : 'handover';
  return (
    <Stack spacing={2}>
      <PageHeader title="Bàn giao & trả phòng" />
      <Paper variant="outlined" sx={{ borderRadius: 2, px: 1 }}>
        <Tabs
          value={tab}
          onChange={(_, next: string) =>
            setParams((previous) => {
              const updated = new URLSearchParams(previous);
              updated.set('tab', next);
              updated.delete('contractId');
              return updated;
            })
          }
          aria-label="Chọn quy trình nhận và trả phòng"
        >
          <Tab value="handover" label="Bàn giao" />
          <Tab value="move-out" label="Trả phòng" />
        </Tabs>
      </Paper>
      {tab === 'move-out' ? (
        <OwnerMoveOutInbox />
      ) : isMockMode ? (
        <ResourcePage kind="handovers" variant="handover" />
      ) : (
        <LiveHandoversPage />
      )}
    </Stack>
  );
}

function LiveHandoversPage() {
  const [params, setParams] = useSearchParams();
  const { session } = useAuth();
  const api = useContractsApi();
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [page, setPage] = useState(1);
  const selected = params.get('contractId') ?? '';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRoomFilter(roomSearch.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [roomSearch]);

  const locations = useQuery({
    queryKey: ['handover-inbox-locations', session?.userId],
    enabled: !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) => api.locations(signal),
  });

  const inbox = useQuery({
    queryKey: ['handover-inbox', session?.userId, page, location, status, roomFilter],
    enabled: !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) =>
      api.transport<HandoverInboxPage>(
        `/api/v1/contracts/handovers?${new URLSearchParams({
          page: String(page),
          pageSize: '20',
          ...(location ? { locationId: location } : {}),
          ...(status ? { status } : {}),
          ...(roomFilter ? { room: roomFilter } : {}),
        })}`,
        { signal },
      ),
  });

  const visible = inbox.data?.items ?? [];
  const selectedItem = inbox.data?.items.find((item) => item.contractId === selected);

  function selectHandover(contractId: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (contractId) next.set('contractId', contractId);
      else next.delete('contractId');
      return next;
    });
  }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          startIcon={<RefreshCw size={16} />}
          disabled={inbox.isFetching}
          onClick={() => void inbox.refetch()}
        >
          Tải lại
        </Button>
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }}>
        <Stack spacing={1.5}>
          <FilterToolbar>
            <TextField
              select
              size="small"
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
              select
              size="small"
              label="Trạng thái biên bản"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              sx={{ maxWidth: { sm: 240 } }}
            >
              <MenuItem value="">Tất cả trạng thái</MenuItem>
              {handoverStates.map((option) => (
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
              sx={{ flex: { sm: '1 1 240px' }, maxWidth: { sm: 340 } }}
            />
            {(location || status || roomSearch) && (
              <Button
                variant="text"
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
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.5}
            sx={{ justifyContent: 'space-between' }}
          >
            <Typography variant="body2" color="text.secondary">
              {inbox.data
                ? `${inbox.data.totalCount} biên bản phù hợp`
                : 'Danh sách biên bản bàn giao'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Danh sách từ hệ thống · {inbox.data?.items.length ?? 0} biên bản trên trang này
            </Typography>
          </Stack>
          {inbox.isFetching && <LinearProgress aria-label="Đang tải danh sách biên bản" />}
          {inbox.error ? (
            <Alert
              severity="error"
              action={<Button onClick={() => void inbox.refetch()}>Thử lại</Button>}
            >
              Không tải được danh sách biên bản: {contractError(inbox.error)}
            </Alert>
          ) : inbox.isPending ? (
            <Stack spacing={1} role="status" aria-label="Đang tải biên bản">
              {[1, 2, 3].map((index) => (
                <Skeleton key={index} variant="rounded" height={54} />
              ))}
            </Stack>
          ) : visible.length === 0 ? (
            <Stack spacing={1} sx={{ py: 5, textAlign: 'center', alignItems: 'center' }}>
              <FileText size={32} color="#64748b" strokeWidth={1.5} />
              <Typography sx={{ fontWeight: 700 }}>
                {roomFilter ? 'Không tìm thấy biên bản của phòng' : 'Chưa có biên bản phù hợp'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {roomFilter
                  ? 'Thử tên hoặc số phòng khác, hoặc xóa từ khóa.'
                  : 'Đổi bộ lọc để xem những biên bản khác.'}
              </Typography>
            </Stack>
          ) : (
            <>
              <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
                <Table size="small" aria-label="Danh sách biên bản bàn giao">
                  <TableHead>
                    <TableRow>
                      <TableCell>Phòng / Cơ sở</TableCell>
                      <TableCell>Trạng thái bàn giao</TableCell>
                      <TableCell>Mốc xác nhận gần nhất</TableCell>
                      <TableCell align="right">Thao tác</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((item) => (
                      <TableRow key={item.contractId} hover sx={{ '& td': { py: 1.25 } }}>
                        <TableCell>
                          <Typography sx={{ fontWeight: 700 }}>Phòng {item.roomNumber}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.locationName} · Kỳ thuê từ {displayContractDate(item.startDate)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <StatusChip label={handoverStatus(item.status)} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {handoverActivity(item)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => selectHandover(item.contractId)}>
                            Xem chi tiết
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack spacing={0} sx={{ display: { xs: 'flex', md: 'none' } }}>
                {visible.map((item) => (
                  <Box
                    key={item.contractId}
                    sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700 }}>Phòng {item.roomNumber}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {item.locationName} · Kỳ thuê từ {displayContractDate(item.startDate)}
                        </Typography>
                      </Box>
                      <StatusChip label={handoverStatus(item.status)} />
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 1 }}
                    >
                      {handoverActivity(item)}
                    </Typography>
                    <Button
                      size="small"
                      sx={{ mt: 1, px: 0, minHeight: 44 }}
                      onClick={() => selectHandover(item.contractId)}
                    >
                      Xem chi tiết
                    </Button>
                  </Box>
                ))}
              </Stack>
            </>
          )}
          {inbox.data && inbox.data.totalCount > inbox.data.pageSize && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography variant="caption" color="text.secondary">
                Trang {page} / {Math.ceil(inbox.data.totalCount / inbox.data.pageSize)}
              </Typography>
              <Pagination
                page={page}
                disabled={inbox.isFetching}
                count={Math.ceil(inbox.data.totalCount / inbox.data.pageSize)}
                onChange={(_, nextPage) => setPage(nextPage)}
                shape="rounded"
                color="primary"
              />
            </Stack>
          )}
        </Stack>
      </Paper>

      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => {
          selectHandover('');
          void inbox.refetch();
        }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 'min(880px, 94vw)' },
              maxWidth: '100vw',
              bgcolor: 'background.default',
            },
          },
        }}
      >
        <Stack sx={{ height: '100%', minHeight: 0 }}>
          <Box
            sx={{
              px: { xs: 2, sm: 3 },
              py: 1.5,
              bgcolor: 'background.paper',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 750 }}>
                  {selectedItem
                    ? `Biên bản phòng ${selectedItem.roomNumber}`
                    : 'Chi tiết biên bản bàn giao'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedItem?.locationName ?? 'Dữ liệu bàn giao theo hợp đồng'}
                </Typography>
              </Box>
              <IconButton
                aria-label="Đóng chi tiết"
                onClick={() => {
                  selectHandover('');
                  void inbox.refetch();
                }}
              >
                <X size={20} />
              </IconButton>
            </Stack>
          </Box>
          <Box sx={{ px: { xs: 1.5, sm: 3 }, py: 2, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {selected && (
              <Stack spacing={2}>
                <Button
                  component={Link}
                  to={`/contracts?contractId=${encodeURIComponent(selected)}`}
                  sx={{ alignSelf: 'flex-start' }}
                  size="small"
                >
                  Mở hồ sơ hợp đồng
                </Button>
                <OwnerHandoverDraftPanel
                  key={selected}
                  api={api}
                  id={selected}
                  compact
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
