import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { AlertTriangle, Bell, ChevronDown, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader, StatusChip } from '../../components/common/PortalUI';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import { TextField } from '../../components/common/ValidatedForm';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { CreateProactiveMaintenance, FastRepairPolicyPanel } from './MaintenanceControls';
import {
  workStatuses,
  statusText,
  type Incident,
  type IncidentNotification,
  type WorkOrder,
} from './incidentContracts';

const root = '/api/v1/incidents';
const workRoot = '/api/v1/work-orders';

export interface IncidentQueueFilters {
  location: string;
  room: string;
  status: string;
  severity: string;
  page: number;
  search: string;
}

const attentionEvents: Record<string, string> = {
  submitted: 'Báo cáo sự cố mới',
  proposal_submitted: 'Có phương án cần xem xét',
  submit: 'Có kết quả cần nghiệm thu',
  emergency_action: 'Có cập nhật ứng phó khẩn cấp',
  asset_proposed: 'Có đề xuất tài sản cần quyết định',
  blocker: 'Staff báo vướng mắc',
};

function nextIncidentAction(incident: Incident): string {
  if (incident.status === 'Submitted') {
    return incident.type && incident.category ? 'Xem để giao xử lý' : 'Phân loại sự cố';
  }
  if (incident.status === 'InProgress') {
    switch (incident.openWorkOrderStatus) {
      case 'PendingApproval':
        return 'Duyệt phương án';
      case 'PendingVerification':
        return 'Nghiệm thu sửa chữa';
      case 'Assigned':
        return 'Chờ Staff kiểm tra';
      case 'InProgress':
        return 'Xem tiến độ sửa chữa';
      default:
        return 'Xem xử lý';
    }
  }
  return 'Xem hồ sơ';
}

function nextWorkAction(work: WorkOrder): string {
  if (work.assetProposalPending) return 'Xét duyệt tài sản';
  if (work.status === 'PendingApproval') return 'Duyệt phương án';
  if (work.status === 'PendingVerification') return 'Xác minh kết quả';
  if (work.status === 'Verified' || work.status === 'Cancelled') return 'Xem hồ sơ';
  return 'Xem tiến độ';
}

export function NotificationSummary() {
  const query = useOwnerQuery<OwnerPage<IncidentNotification>>(
    ['incident-notifications'],
    `${root}/notifications?page=1&pageSize=10`,
  );
  const action = useOwnerAction();
  const unread = (query.data?.items ?? []).filter((item) => !item.readAt);

  if (!unread.length && !query.isFetching && !query.error) return null;
  return (
    <Accordion
      disableGutters
      variant="outlined"
      sx={{
        '&:before': { display: 'none' },
        borderRadius: '12px !important',
        overflow: 'hidden',
      }}
    >
      <AccordionSummary
        expandIcon={<ChevronDown size={18} />}
        aria-label="Mở các cập nhật sự cố chưa đọc"
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Bell size={18} />
          <Typography sx={{ fontWeight: 700 }}>Cập nhật chưa đọc</Typography>
          {unread.length > 0 && (
            <Chip
              size="small"
              variant="outlined"
              label={
                unread.length === query.data?.items.length
                  ? `${unread.length} mục`
                  : `${unread.length} mục trong 10 thông báo gần nhất`
              }
            />
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          <OwnerFeedback
            busy={query.isFetching || action.busy}
            error={query.error || action.error}
          />
          {unread.map((item) => {
            const target = item.workOrderId
              ? `/maintenance?workOrderId=${encodeURIComponent(item.workOrderId)}`
              : item.incidentId
                ? `/incidents?incidentId=${encodeURIComponent(item.incidentId)}`
                : '/incidents';
            const eventKey = item.event.toLocaleLowerCase('en-US');
            return (
              <Stack
                key={item.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  alignItems: { sm: 'center' },
                  justifyContent: 'space-between',
                  borderBottom: 1,
                  borderColor: 'divider',
                  py: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {item.highPriority ? 'Ưu tiên cao · ' : ''}
                    {attentionEvents[eventKey] ?? 'Có cập nhật trong hồ sơ sự cố'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatInstant(item.createdAt)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  component={Link}
                  to={target}
                  onClick={() =>
                    void action.run(() =>
                      action.request(`${root}/notifications/${item.id}/read`, { method: 'POST' }),
                    )
                  }
                >
                  Xem cập nhật
                </Button>
              </Stack>
            );
          })}
          {query.data && !unread.length && (
            <Typography variant="body2">Không có cập nhật chưa đọc.</Typography>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function IncidentQueueWorkspace({
  maintenance = false,
  incidentFilter = '',
  initialLocation = '',
  initialFilters,
  onFiltersChange,
  onSelect,
  onClearIncidentFilter,
}: {
  maintenance?: boolean;
  incidentFilter?: string;
  initialLocation?: string;
  initialFilters?: IncidentQueueFilters;
  onFiltersChange?: (filters: IncidentQueueFilters) => void;
  onSelect: (id: string) => void;
  onClearIncidentFilter?: () => void;
}) {
  const [location, setLocation] = useState(initialFilters?.location ?? initialLocation);
  const [room, setRoom] = useState(initialFilters?.room ?? '');
  const [status, setStatus] = useState(initialFilters?.status ?? '');
  const [severity, setSeverity] = useState(initialFilters?.severity ?? '');
  const [page, setPage] = useState(initialFilters?.page ?? 1);
  const [search, setSearch] = useState(initialFilters?.search ?? '');
  useEffect(() => {
    onFiltersChange?.({ location, room, status, severity, page, search });
  }, [location, room, status, severity, page, search, onFiltersChange]);
  const path =
    (maintenance ? workRoot : root) +
    '?' +
    ownerQuery({
      locationId: location,
      roomId: room,
      severity: maintenance ? '' : severity,
      incidentId: maintenance ? incidentFilter : '',
      ...(maintenance ? { workOrderStatus: status } : { status }),
      page,
      pageSize: 20,
    });
  const incidents = useOwnerQuery<OwnerPage<Incident>>(['incidents', path], path, !maintenance);
  const workOrders = useOwnerQuery<OwnerPage<WorkOrder>>(['work-orders', path], path, maintenance);
  const query = maintenance ? workOrders : incidents;
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi-VN');
    if (!term) return maintenance ? (workOrders.data?.items ?? []) : (incidents.data?.items ?? []);
    const haystack = (item: Incident | WorkOrder) =>
      [
        item.locationName,
        item.roomNumber,
        item.assetName,
        'description' in item ? item.description : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('vi-VN');
    return (maintenance ? (workOrders.data?.items ?? []) : (incidents.data?.items ?? [])).filter(
      (item) => haystack(item).includes(term),
    );
  }, [incidents.data?.items, maintenance, search, workOrders.data?.items]);
  const chooseStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  return (
    <Stack spacing={2}>
      <PageHeader
        title={maintenance ? 'Công việc sửa chữa & bảo trì' : 'Hàng đợi sự cố'}
        subtitle={
          maintenance
            ? 'Theo dõi phương án, nhân viên, tiến độ và các quyết định nghiệm thu.'
            : 'Tìm sự cố cần xử lý và mở hồ sơ để đưa ra quyết định tiếp theo.'
        }
        actions={
          <Button
            variant="outlined"
            disabled={query.isFetching}
            startIcon={<RefreshCw size={16} />}
            onClick={() => void query.refetch()}
          >
            Làm mới
          </Button>
        }
      />
      {maintenance ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap' }}
        >
          <CreateProactiveMaintenance />
          <FastRepairPolicyPanel />
        </Stack>
      ) : (
        <NotificationSummary />
      )}
      {maintenance && incidentFilter && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip variant="outlined" label="Đang xem lệnh sửa chữa của sự cố đã chọn" />
          <Button onClick={onClearIncidentFilter}>Xem tất cả lệnh sửa chữa</Button>
        </Stack>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
        <Stack spacing={1.75}>
          {!maintenance ? (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
              role="group"
              aria-label="Lọc trạng thái sự cố"
            >
              {[
                { key: '', label: 'Tất cả' },
                { key: 'Submitted', label: 'Mới báo cáo' },
                { key: 'InProgress', label: 'Đang xử lý' },
                { key: 'Resolved', label: 'Đã giải quyết' },
              ].map(({ key, label }) => (
                <Button
                  key={key}
                  size="small"
                  variant={status === key ? 'contained' : 'outlined'}
                  color={status === key ? 'primary' : 'inherit'}
                  onClick={() => chooseStatus(key)}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          ) : (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
              role="group"
              aria-label="Lọc trạng thái lệnh sửa chữa"
            >
              {[['', 'Tất cả'], ...Object.entries(workStatuses)].map(([value, label]) => (
                <Button
                  key={value}
                  size="small"
                  variant={status === value ? 'contained' : 'outlined'}
                  color={status === value ? 'primary' : 'inherit'}
                  onClick={() => chooseStatus(value)}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          )}
          <Divider />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' } }}
          >
            <OwnerLocationPicker
              value={location}
              change={(id) => {
                setLocation(id);
                setRoom('');
                setPage(1);
              }}
            />
            <OwnerRoomPicker
              key={location}
              location={location}
              value={room}
              change={(id) => {
                setRoom(id);
                setPage(1);
              }}
            />
            {!maintenance && (
              <Button
                color="error"
                variant={severity === 'Emergency' ? 'contained' : 'outlined'}
                startIcon={<AlertTriangle size={16} />}
                onClick={() => {
                  setSeverity((previous) => (previous === 'Emergency' ? '' : 'Emergency'));
                  setPage(1);
                }}
              >
                Ưu tiên khẩn cấp
              </Button>
            )}
            <TextField
              label="Tìm trong trang hiện tại"
              size="small"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nội dung, phòng, tài sản"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={17} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: { sm: 240 }, flex: 1, maxWidth: { sm: 350 } }}
            />
          </Stack>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
          >
            <Typography variant="body2" color="text.secondary">
              {query.data ? `${query.data.totalCount} hồ sơ theo bộ lọc` : 'Đang tải danh sách'}
              {search.trim() && ` · ${rows.length} kết quả trên trang ${page}`}
            </Typography>
            {status || severity || location || room || search ? (
              <Button
                size="small"
                onClick={() => {
                  setStatus('');
                  setSeverity('');
                  setLocation('');
                  setRoom('');
                  setSearch('');
                  setPage(1);
                }}
              >
                Xóa bộ lọc
              </Button>
            ) : null}
          </Stack>
          {maintenance ? (
            <OwnerTable
              loading={query.isFetching}
              error={query.error}
              retry={() => void query.refetch()}
              label="Danh sách lệnh sửa chữa"
              rows={rows as WorkOrder[]}
              id={(item) => item.id}
              select={(item) => onSelect(item.id)}
              selectLabel="Mở lệnh"
              columns={[
                {
                  label: 'Công việc',
                  render: (item) => (
                    <Stack spacing={0.25}>
                      <Typography sx={{ fontWeight: 700 }}>
                        {item.description || item.expectedOutcome}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.locationName || 'Cơ sở liên quan'} ·{' '}
                        {item.roomNumber
                          ? `Phòng ${item.roomNumber}`
                          : item.commonArea || 'Khu vực chung'}
                        {item.assetName ? ` · ${item.assetName}` : ''}
                      </Typography>
                    </Stack>
                  ),
                },
                {
                  label: 'Trạng thái',
                  render: (item) => <StatusChip label={statusText(item.status)} />,
                },
                {
                  label: 'Nhân viên',
                  render: (item) => item.assignedStaffName || 'Chưa có thông tin',
                },
                {
                  label: 'Hạn hoàn thành',
                  render: (item) => (
                    <Typography
                      variant="body2"
                      color={item.isOverdue ? 'error.main' : 'text.primary'}
                    >
                      {formatInstant(item.targetCompletionAt)}
                      {item.isOverdue ? ' · Quá hạn' : ''}
                    </Typography>
                  ),
                },
                {
                  label: 'Cần xử lý',
                  render: (item) => (
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {nextWorkAction(item)}
                    </Typography>
                  ),
                },
              ]}
            />
          ) : (
            <OwnerTable
              loading={query.isFetching}
              error={query.error}
              retry={() => void query.refetch()}
              label="Danh sách sự cố"
              rows={rows as Incident[]}
              id={(item) => item.id}
              select={(item) => onSelect(item.id)}
              selectLabel="Xem & xử lý"
              columns={[
                {
                  label: 'Sự cố',
                  render: (item) => (
                    <Stack spacing={0.4}>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        useFlexGap
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography sx={{ fontWeight: 700 }}>{item.description}</Typography>
                        {item.severity === 'Emergency' && <StatusChip label="Khẩn cấp" />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {item.locationName || 'Cơ sở liên quan'} ·{' '}
                        {item.roomNumber
                          ? `Phòng ${item.roomNumber}`
                          : item.commonArea || 'Khu vực chung'}
                        {item.assetName ? ` · ${item.assetName}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.createdAt ? formatInstant(item.createdAt) : 'Chưa có ngày báo cáo'}
                      </Typography>
                    </Stack>
                  ),
                },
                {
                  label: 'Trạng thái',
                  render: (item) => <StatusChip label={statusText(item.status)} />,
                },
                { label: 'Người xử lý', render: (item) => item.assignedStaffName || 'Chưa giao' },
                {
                  label: 'Tiếp theo',
                  render: (item) => (
                    <Typography sx={{ fontWeight: 650 }} variant="body2">
                      {nextIncidentAction(item)}
                    </Typography>
                  ),
                },
              ]}
            />
          )}
          {search.trim() && query.data && rows.length === 0 && query.data.items.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              Không thấy kết quả trong trang hiện tại. Xóa từ khóa hoặc chuyển trang để tìm tiếp.
            </Typography>
          )}
          <OwnerPagination
            page={page}
            total={query.data?.totalCount ?? 0}
            busy={query.isFetching}
            change={setPage}
          />
        </Stack>
      </Paper>
    </Stack>
  );
}
