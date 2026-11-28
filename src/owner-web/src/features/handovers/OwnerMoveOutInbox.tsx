import { useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { useContractsApi } from '../contracts/hooks/useContractsApi';
import { OwnerMoveOutReviewPanel } from './OwnerMoveOutReviewPanel';
import { InboxRoomError, InboxRoomFilter } from './InboxFilters';
import { inboxStages, useInboxRooms } from './useInboxFilters';

interface MoveOutInboxItem {
  contractId: string;
  roomNumber: string;
  locationId: string;
  locationName: string;
  status: string;
  proposedDate: string;
  pendingReason?: string | null;
  proposalStatus?: 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated' | 'Issued' | null;
  proposalSettlementStatus?: 'Payable' | 'RefundEligible' | 'Settled' | 'PendingOwnerReview' | null;
}

interface MoveOutInboxPage {
  items: MoveOutInboxItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

interface MoveOutProposalProgress {
  status: 'None' | 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated' | 'Issued';
  latestProposal?: {
    issuedSettlement?: { status: MoveOutInboxItem['proposalSettlementStatus'] } | null;
    tenantFeedback?: {
      confirmed: boolean;
      settlement?: { status: MoveOutInboxItem['proposalSettlementStatus'] } | null;
    } | null;
  } | null;
}

const moveOutStates = [

  { value: 'Requested', label: 'Chờ duyệt yêu cầu' },
  { value: 'Approved', label: 'Nhân viên đang xử lý' },
  { value: 'Inspected', label: 'Đã có kết quả nhân viên' },
  { value: 'PendingSettlement', label: 'Đang quyết toán' },
  { value: 'Settled', label: 'Đã quyết toán' },
  { value: 'Completed', label: 'Đã trả phòng' },
  { value: 'Rejected', label: 'Đã từ chối' },
];

function labelFor(status: string) {
  return moveOutStates.find((item) => item.value === status)?.label ?? status;
}

function progressFor(item: MoveOutInboxItem) {
  if (item.pendingReason === 'personal_termination_scheduled') return 'Đã duyệt · Chờ ngày chấm dứt';
  if (item.pendingReason === 'personal_termination_completed') return 'Đã chấm dứt hợp đồng cá nhân';
  // Contract move-out and Tenant's fee decision advance independently. Show
  // the latest verified financial step instead of the earlier Staff handoff.
  if (item.status === 'Completed' || item.status === 'Settled') return labelFor(item.status);
  if (
    item.status === 'Requested' ||
    item.status === 'Approved' ||
    item.status === 'Rejected' ||
    item.status === 'AwaitingConsent'
  )
    return labelFor(item.status);
  if (item.proposalStatus === 'Accepted' || item.proposalStatus === 'Issued') {
    if (item.proposalSettlementStatus === 'Payable')
      return 'Đã gửi phí · Đã tạo khoản phải thu';
    if (item.proposalSettlementStatus === 'RefundEligible')
      return 'Đã gửi phí · Có tiền cọc cần hoàn';
    if (item.proposalSettlementStatus === 'Settled') return 'Đã quyết toán phí trả phòng';
    return 'Đã gửi phí · Đang đối chiếu';
  }
  if (item.proposalStatus === 'Disputed') return 'Khách thuê yêu cầu điều chỉnh phí';
  if (item.proposalStatus === 'PendingTenant') return 'Chưa phát hành phí';
  if (item.proposalStatus === 'Outdated') return 'Cần đối chiếu dữ liệu phí';
  return item.status === 'Inspected' ? 'Chờ chủ trọ gửi phí' : labelFor(item.status);
}

export function OwnerMoveOutInbox() {
  const { session } = useAuth();
  const api = useContractsApi();
  const [params, setParams] = useSearchParams();
  const selected = params.get('contractId') ?? '';
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [room, setRoom] = useState('');
  const [page, setPage] = useState(1);

  const locations = useQuery({
    queryKey: ['move-out-inbox-locations', session?.userId],
    enabled: !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) => api.locations(signal),
  });
  const rooms = useInboxRooms(api, session?.userId, location, 'move-out-inbox');
  if (room && rooms.data && !rooms.data.some((option) => option.id === room)) {
    setRoom('');
    setPage(1);
  }
  const inbox = useQuery({
    queryKey: ['move-out-inbox', session?.userId, page, location, status, room],
    enabled: !!session?.roles?.includes('Owner'),
    queryFn: ({ signal }) =>
      api.transport<MoveOutInboxPage>(
        `/api/v1/contracts/move-out-inbox?${new URLSearchParams({
          page: String(page),
          pageSize: '10',
          ...(location ? { locationId: location } : {}),
          ...(status ? { stage: status } : {}),
          ...(room ? { roomId: room } : {}),
        })}`,
        { signal },
      ),
  });
  const visible = inbox.data?.items ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil((inbox.data?.totalCount ?? 0) / (inbox.data?.pageSize || 10)),
  );
  if (inbox.data && page > pageCount) setPage(pageCount);
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
                !['None', 'PendingTenant', 'Accepted', 'Disputed', 'Outdated', 'Issued'].includes(
                  proposal.status,
                )
              )
                continue;
              results[contractId] = {
                proposalStatus: proposal.status === 'None' ? null : proposal.status,
                proposalSettlementStatus:
                  (proposal.latestProposal?.issuedSettlement ?? proposal.latestProposal?.tenantFeedback?.settlement)?.status ?? null,
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
                setRoom('');
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
            <InboxRoomFilter
              location={location}
              room={room}
              rooms={rooms}
              onChange={(value) => {
                setRoom(value);
                setPage(1);
              }}
            />
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
              {inboxStages.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            {(location || status || room) && (
              <Button
                onClick={() => {
                  setLocation('');
                  setStatus('');
                  setRoom('');
                  setPage(1);
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
            <Button
              size="small"
              sx={{ ml: { sm: 'auto' } }}
              startIcon={<RefreshCw size={16} />}
              disabled={inbox.isFetching}
              onClick={() => {
                void inbox.refetch();
                if (location) void rooms.refetch();
                if (legacyIds.length) void legacyProgress.refetch();
              }}
            >
              Tải lại
            </Button>
          </FilterToolbar>
          <InboxRoomError rooms={rooms} />
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
                            {item.status === 'Requested'
                              ? 'Xét duyệt yêu cầu'
                              : item.status === 'Rejected'
                                ? 'Xem yêu cầu'
                                : 'Xem kết quả'}
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
                      {item.status === 'Requested'
                        ? 'Xét duyệt yêu cầu'
                        : item.status === 'Rejected'
                          ? 'Xem yêu cầu'
                          : 'Xem kết quả'}
                    </Button>
                  </Box>
                ))}
              </Stack>
            </>
          )}
          {!!inbox.data && !inbox.error && inbox.data.totalCount > 0 && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography variant="caption" color="text.secondary">
                Trang {page} / {pageCount}
              </Typography>
              <Pagination
                page={page}
                count={pageCount}
                disabled={inbox.isFetching}
                onChange={(_, p) => setPage(p)}
                size="small"
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
                <OwnerMoveOutReviewPanel
                  key={selected}
                  api={api}
                  id={selected}
                  ownerId={session?.userId}
                  onChanged={() => {
                    void inbox.refetch();
                    if (location) void rooms.refetch();
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
