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
  proposalStatus?: 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated' | null;
  proposalSettlementStatus?: 'Payable' | 'RefundEligible' | 'Settled' | 'PendingOwnerReview' | null;
}

interface MoveOutInboxPage {
  items: MoveOutInboxItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

interface MoveOutProposalProgress {
  status: 'None' | 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated';
  latestProposal?: {
    tenantFeedback?: {
      confirmed: boolean;
      settlement?: { status: MoveOutInboxItem['proposalSettlementStatus'] } | null;
    } | null;
  } | null;
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

function progressFor(item: MoveOutInboxItem) {
  // Contract move-out and Tenant's fee decision advance independently. Show
  // the latest verified financial step instead of the earlier Staff handoff.
  if (item.status === 'Completed' || item.status === 'Settled') return labelFor(item.status);
  if (item.status === 'Requested' || item.status === 'Approved') return labelFor(item.status);
  if (item.proposalStatus === 'Accepted') {
    if (item.proposalSettlementStatus === 'Payable')
      return 'Tenant đã đồng ý · Đã tạo khoản phải thu';
    if (item.proposalSettlementStatus === 'RefundEligible')
      return 'Tenant đã đồng ý · Có tiền cọc cần hoàn';
    if (item.proposalSettlementStatus === 'Settled') return 'Đã quyết toán phí trả phòng';
    return 'Tenant đã đồng ý · Đang đối chiếu';
  }
  if (item.proposalStatus === 'Disputed') return 'Tenant yêu cầu điều chỉnh phí';
  if (item.proposalStatus === 'PendingTenant') return 'Chờ Tenant xác nhận phí';
  if (item.proposalStatus === 'Outdated') return 'Cần đối chiếu dữ liệu phí';
  return item.status === 'Inspected' ? 'Chờ Owner gửi phí' : labelFor(item.status);
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
  // A running older API may not yet include the new summary fields. Fetch the
  // existing authenticated proposal endpoint only for those legacy rows, with
  // bounded concurrency. Once the new API is deployed this makes zero calls.
  const legacyIds = visible
    .filter(
      (item) =>
        (item.status === 'Inspected' || item.status === 'PendingSettlement') &&
        item.proposalStatus === undefined,
    )
    .map((item) => item.contractId);
  const legacyProgress = useQuery({
    queryKey: ['move-out-inbox-legacy-proposals', session?.userId, legacyIds.join(',')],
    enabled: legacyIds.length > 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const results: Record<
        string,
        Pick<MoveOutInboxItem, 'proposalStatus' | 'proposalSettlementStatus'>
      > = {};
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, legacyIds.length) }, async () => {
          while (next < legacyIds.length && !signal.aborted) {
            const contractId = legacyIds[next++];
            try {
              const proposal = await api.transport<MoveOutProposalProgress>(
                `/api/v1/contracts/${encodeURIComponent(contractId)}/move-out/receivables/proposal`,
                { signal },
              );
              if (
                !['None', 'PendingTenant', 'Accepted', 'Disputed', 'Outdated'].includes(
                  proposal.status,
                )
              )
                continue;
              results[contractId] = {
                proposalStatus: proposal.status === 'None' ? null : proposal.status,
                proposalSettlementStatus:
                  proposal.latestProposal?.tenantFeedback?.settlement?.status ?? null,
              };
            } catch (cause) {
              if (signal.aborted) throw cause;
              // A failed legacy lookup does not hide the existing move-out row.
            }
          }
        }),
      );
      return results;
    },
  });
  const progressLabel = (item: MoveOutInboxItem) => {
    const fallback = legacyProgress.data?.[item.contractId];
    if (fallback) return progressFor({ ...item, ...fallback });
    if (legacyIds.includes(item.contractId))
      return legacyProgress.isPending ? 'Đang tải tiến độ phí' : 'Chưa xác minh tiến độ phí';
    return progressFor(item);
  };
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
          onClick={() => {
            void inbox.refetch();
            if (legacyIds.length) void legacyProgress.refetch();
          }}
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
                          <StatusChip label={progressLabel(item)} />
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
                      <StatusChip label={progressLabel(item)} />
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
          if (legacyIds.length) void legacyProgress.refetch();
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
                  if (legacyIds.length) void legacyProgress.refetch();
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
                  onChanged={() => {
                    void inbox.refetch();
                    if (legacyIds.length) void legacyProgress.refetch();
                  }}
                />
              </Stack>
            )}
          </Box>
        </Stack>
      </Drawer>
    </Stack>
  );
}
