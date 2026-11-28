import { useDeferredValue, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { visuallyHidden } from '@mui/utils';
import { TextField } from '../../components/common/ValidatedForm';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import { ownerQuery, useOwnerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';
import { businessTimeZone, locale } from '../../../../../packages/client-core/src/localization';
import { IncidentDetailWorkspace } from '../incidents/IncidentDetailWorkspace';
import { WorkOrderDetailWorkspace } from '../incidents/WorkOrderDetailWorkspace';
import { FastRepairPolicyPanel, ProactiveForm } from '../incidents/MaintenanceControls';
import { TaskDetailDrawer } from './components/TaskDetailDrawer';
import { OperationalDetailDialog } from './components/OperationalDetailDialog';
import { TaskEditorDialog } from './components/TaskEditorDialog';
import { RecurringTasks } from './components/RecurringTasks';
import { useTaskDirectory } from './useOperationalTasksApi';
import { vietnamInstant, type OwnerTask } from './taskContracts';

export interface UnifiedWorkItem {
  id: string;
  kind: 'task' | 'incident' | 'workOrder';
  title: string;
  source: string;
  workType: string;
  locationId: string;
  locationName: string | null;
  roomId: string | null;
  roomNumber: string | null;
  commonArea: string | null;
  assetName: string | null;
  priority: string;
  status: string;
  phase: 'needsOwner' | 'active' | 'closed';
  nextAction: string;
  staffName: string | null;
  dueAt: string | null;
  createdAt: string;
  isOverdue: boolean;
  activeWorkOrderId: string | null;
  workOrderCount: number;
  incidentId?: string | null;
  incidentTitle?: string | null;
  incidentStatus?: string | null;
  workOrderStatus?: string | null;
  openWorkOrderCount?: number;
  verifiedWorkOrderCount?: number;
}

export interface UnifiedWorkPageData extends OwnerPage<UnifiedWorkItem> {
  counts: {
    total: number;
    needsOwner: number;
    active: number;
    closed: number;
    overdue: number;
    verification?: number;
  };
}

const root = '/api/v1/operational-work';
const sources: Record<string, string> = {
  Tenant: 'Tenant báo cáo',
  Staff: 'Staff báo cáo',
  Owner: 'Owner tạo thủ công',
  Proactive: 'Bảo trì chủ động',
  Recurring: 'Định kỳ',
  Inventory: 'Kiểm kê tài sản',
  System: 'Hệ thống',
};
const workTypes: Record<string, string> = {
  AdHoc: 'Công việc thông thường',
  LocationAssetHandover: 'Kiểm kê & bàn giao',
  MoveInInventory: 'Kiểm kê nhận phòng',
  MeterReading: 'Ghi chỉ số',
  Incident: 'Xử lý sự cố',
  Proactive: 'Bảo trì chủ động',
};
const priorities: Record<string, string> = {
  Normal: 'Bình thường',
  Emergency: 'Khẩn cấp',
};
const filterKeys = [
  'locationId',
  'roomId',
  'assetId',
  'kind',
  'source',
  'workType',
  'status',
  'priority',
  'search',
  'isOverdue',
  'staffUserId',
  'recordedStaffUserId',
  'hasResponsibility',
  'dueFrom',
  'dueTo',
  'phase',
  'page',
  'schedule',
  'incidentFilter',
  'maintenance',
  'verification',
] as const;
const dateFormatter = new Intl.DateTimeFormat(locale, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: businessTimeZone,
});
function displayDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

const statuses = [
  'Chờ tiếp nhận',
  'Đã tiếp nhận',
  'Đang xử lý',
  'Chờ xử lý',
  'Chờ khảo sát',
  'Chờ duyệt phương án',
  'Đã duyệt phương án',
  'Đang thực hiện',
  'Chờ xác minh',
  'Chờ duyệt tài sản',
  'Chờ duyệt chi phí khẩn cấp',
  'Chờ duyệt kiểm kê',
  'Chờ Owner ký',
  'Chờ Staff ký',
  'Chờ Owner xác nhận tài sản',
  'Chưa có Staff phụ trách',
  'Chờ thực hiện',
  'Chờ Owner duyệt và ký',
  'Chờ duyệt yêu cầu chỉnh sửa',
  'Chờ Tenant ký',
  'Đã hoàn thành',
  'Đã xác minh',
  'Đã giải quyết',
  'Đã hủy',
  'Đã từ chối',
  'Trùng lặp',
  'Đã chuyển giao',
];

export function UnifiedWorkPage() {
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<OwnerTask | null | undefined>();
  const [creation, setCreation] = useState<'choose' | 'proactive' | null>(null);
  const [notice, setNotice] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const { staff, locations } = useTaskDirectory();
  const locationName = (id: string) =>
    locations.data?.find((item) => item.id === id)?.name ?? 'Không tải được tên cơ sở';
  const get = (key: string) => params.get(key) ?? '';
  const taskId = get('taskId'),
    incidentId = get('incidentId'),
    workOrderId = get('workOrderId');
  const fullDetail = !!incidentId || !!workOrderId;
  const location = get('locationId');
  const phase = get('phase');
  const view =
    get('schedule') === 'true' ? 'schedule' : get('view') === 'reports' ? 'reports' : 'work';
  const reports = view === 'reports';
  const tab =
    !reports && get('isOverdue') === 'true'
      ? 'overdue'
      : !reports && get('verification') === 'true'
        ? 'verification'
        : ['needsOwner', 'active', 'closed'].includes(phase)
          ? phase
          : 'all';
  const page = Math.max(1, Math.min(1000000, Math.floor(Number(get('page')) || 1)));
  const search = useDeferredValue(get('search'));
  const priority = get('priority') in priorities ? get('priority') : '';
  const advancedCount = [
    get('workType'),
    get('source'),
    priority,
    get('status'),
    get('staffUserId'),
    get('recordedStaffUserId'),
    get('hasResponsibility'),
    get('dueFrom'),
    get('dueTo'),
  ].filter(Boolean).length;
  const update = (values: Record<string, string>, resetPage = true, replace = true) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (resetPage) next.delete('page');
        for (const [key, value] of Object.entries(values)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );
  };
  const closeDetail = () => update({ taskId: '', incidentId: '', workOrderId: '' }, false, false);
  const select = (item: UnifiedWorkItem) =>
    update(
      {
        taskId: item.kind === 'task' ? item.id : '',
        incidentId: item.kind === 'incident' ? item.id : '',
        workOrderId: item.kind === 'workOrder' ? item.id : '',
      },
      false,
      false,
    );
  const switchView = (value: string) => {
    setAdvanced(false);
    update({
      view: value === 'reports' ? 'reports' : '',
      schedule: value === 'schedule' ? 'true' : '',
      phase: '',
      verification: '',
      kind: '',
      source: '',
      workType: '',
      status: '',
      search: '',
      incidentFilter: '',
      maintenance: '',
      priority: '',
      isOverdue: '',
      staffUserId: '',
      recordedStaffUserId: '',
      hasResponsibility: '',
      dueFrom: '',
      dueTo: '',
    });
  };
  const selectTab = (value: string) =>
    update({
      phase: ['needsOwner', 'active', 'closed'].includes(value) ? value : '',
      verification: value === 'verification' ? 'true' : '',
      isOverdue: value === 'overdue' ? 'true' : '',
      status: '',
    });
  const query = ownerQuery({
    view: reports ? 'reports' : 'work',
    locationId: location,
    roomId: get('roomId'),
    assetId: get('assetId'),
    kind: get('kind'),
    source: get('source'),
    workType: get('workType'),
    status: get('status'),
    phase,
    priority,
    search,
    isOverdue: get('isOverdue'),
    staffUserId: get('staffUserId'),
    recordedStaffUserId: get('recordedStaffUserId'),
    hasResponsibility: get('hasResponsibility'),
    dueFrom: get('dueFrom') ? vietnamInstant(get('dueFrom')) : '',
    dueTo: get('dueTo') ? vietnamInstant(get('dueTo')) : '',
    incidentId: get('incidentFilter'),
    maintenance: get('maintenance'),
    verification: reports ? '' : get('verification'),
    page,
    pageSize: 20,
  });
  const list = useOwnerQuery<UnifiedWorkPageData>(
    ['operational-work', query],
    root + '?' + query,
    view !== 'schedule',
  );
  // The API counts within ordinary filters. For the overdue quick tab, keep
  // the other tab counts based on the same filters without the overdue toggle.
  const countQuery = new URLSearchParams(query);
  countQuery.delete('isOverdue');
  countQuery.delete('page');
  countQuery.set('page', '1');
  const unfilteredOverdueCounts = useOwnerQuery<UnifiedWorkPageData>(
    ['operational-work', countQuery.toString()],
    root + '?' + countQuery.toString(),
    view === 'work' && tab === 'overdue',
  );
  const count =
    tab === 'overdue'
      ? unfilteredOverdueCounts.error
        ? undefined
        : unfilteredOverdueCounts.data?.counts
      : list.error
        ? undefined
        : list.data?.counts;
  const dropdown = (label: string, key: string, options: Record<string, string>) => (
    <TextField
      size="small"
      select
      label={label}
      value={key === 'priority' ? priority : get(key)}
      onChange={(event) => update({ [key]: event.target.value })}
      sx={{ width: { xs: '100%', sm: 168 }, minWidth: 0, flex: '0 0 auto' }}
    >
      <MenuItem value="">Tất cả</MenuItem>
      {key !== 'priority' && get(key) && !(get(key) in options) && (
        <MenuItem value={get(key)}>
          {key === 'staffUserId' || key === 'recordedStaffUserId' ? 'Nhân viên đã chọn' : get(key)}
        </MenuItem>
      )}
      {Object.entries(options).map(([value, name]) => (
        <MenuItem key={value} value={value}>
          {name}
        </MenuItem>
      ))}
    </TextField>
  );
  const staffOptions = Object.fromEntries(
    (staff.data ?? []).map((person) => [person.userId, person.fullName || person.email]),
  );
  const refresh = () => {
    setAdvanced(false);
    update(
      Object.fromEntries(filterKeys.filter((key) => key !== 'schedule').map((key) => [key, ''])),
    );
    // Mark all cached variants stale before the reset so returning to the
    // unfiltered query fetches new data, even if it was loaded previously.
    void cache.invalidateQueries({ queryKey: ['owner-workspace'] });
  };
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1}
        sx={{
          alignItems: { md: 'center' },
          justifyContent: 'space-between',
          minWidth: 0,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography component="h1" sx={visuallyHidden}>
          Công việc vận hành
        </Typography>
        <Tabs
          value={view}
          onChange={(_, value: string) => switchView(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Nội dung công việc vận hành"
          sx={{ minWidth: 0, minHeight: 42, '& .MuiTab-root': { minHeight: 42 } }}
        >
          <Tab value="work" label="Danh sách công việc" />
          <Tab value="reports" label="Báo cáo sự cố" />
          <Tab value="schedule" label="Lịch công việc định kỳ" />
        </Tabs>
        {view === 'work' && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0, pb: 0.5 }}>
            <FastRepairPolicyPanel compact />
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() => setCreation('choose')}
            >
              Tạo công việc
            </Button>
          </Stack>
        )}
      </Stack>
      {view !== 'schedule' && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tab}
            onChange={(_, value: string) => selectTab(value)}
            variant="scrollable"
            allowScrollButtonsMobile
            aria-label={reports ? 'Lọc trạng thái báo cáo' : 'Lọc trạng thái công việc'}
            sx={{ minHeight: 42, '& .MuiTab-root': { minHeight: 42 } }}
          >
            <Tab value="all" label={`Tất cả${count ? ' (' + count.total + ')' : ''}`} />
            <Tab
              value="needsOwner"
              label={`Cần xử lý${count ? ' (' + count.needsOwner + ')' : ''}`}
            />
            <Tab
              value="active"
              label={`${reports ? 'Đang xử lý' : 'Đang thực hiện'}${count ? ' (' + count.active + ')' : ''}`}
            />
            <Tab value="closed" label={`Đã đóng${count ? ' (' + count.closed + ')' : ''}`} />
            {!reports && (
              <Tab
                value="verification"
                label={`Chờ nghiệm thu${count?.verification != null ? ' (' + count.verification + ')' : ''}`}
              />
            )}
            {!reports && (
              <Tab value="overdue" label={`Quá hạn${count ? ' (' + count.overdue + ')' : ''}`} />
            )}
          </Tabs>
        </Box>
      )}
      {view === 'schedule' ? (
        <RecurringTasks
          key={location}
          location={location}
          change={(value) => update({ locationId: value, roomId: '', assetId: '' })}
          locationName={locationName}
          notify={setNotice}
        />
      ) : (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Stack spacing={1} sx={{ p: 1.5 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' }, minWidth: 0 }}
            >
              <TextField
                size="small"
                label={reports ? 'Tìm kiếm báo cáo' : 'Tìm kiếm công việc'}
                value={get('search')}
                onChange={(event) => update({ search: event.target.value.slice(0, 200) })}
                slotProps={{ input: { startAdornment: <Search size={16} aria-hidden="true" /> } }}
                sx={{
                  flex: { xs: '1 1 100%', sm: '1 1 200px' },
                  minWidth: { xs: 0, sm: 180 },
                  maxWidth: { xs: 'none', sm: 360 },
                  '& svg': { mr: 1, color: 'text.secondary' },
                }}
              />
              <Box sx={{ width: { xs: '100%', sm: 220 }, minWidth: 0, '& > *': { minWidth: 0 } }}>
                <OwnerLocationPicker
                  simple
                  value={location}
                  change={(value) => update({ locationId: value, roomId: '', assetId: '' })}
                />
              </Box>
              {location && (
                <Box sx={{ width: { xs: '100%', sm: 200 }, minWidth: 0, '& > *': { minWidth: 0 } }}>
                  <OwnerRoomPicker
                    location={location}
                    value={get('roomId')}
                    change={(value) => update({ roomId: value, assetId: '' })}
                  />
                </Box>
              )}
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  startIcon={<SlidersHorizontal size={16} />}
                  onClick={() => setAdvanced(!advanced)}
                  aria-label="Bộ lọc nâng cao"
                  aria-expanded={advanced}
                  color={advancedCount ? 'primary' : 'inherit'}
                >
                  Bộ lọc nâng cao{advancedCount > 0 ? ` (${advancedCount})` : ''}
                </Button>
                <Button startIcon={<RefreshCw size={16} />} onClick={refresh}>
                  Làm mới
                </Button>
              </Stack>
            </Stack>
            {(get('maintenance') || get('incidentFilter') || get('assetId')) && (
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {get('maintenance') && (
                  <Chip
                    label="Hồ sơ có lệnh sửa chữa / bảo trì"
                    onDelete={() => update({ maintenance: '' })}
                  />
                )}
                {get('incidentFilter') && (
                  <Chip
                    label="Theo sự cố đã chọn"
                    onDelete={() => update({ incidentFilter: '' })}
                  />
                )}
                {get('assetId') && (
                  <Chip label="Theo tài sản đã chọn" onDelete={() => update({ assetId: '' })} />
                )}
              </Stack>
            )}
            <Collapse in={advanced}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                useFlexGap
                sx={{ flexWrap: 'wrap', pt: 1, minWidth: 0 }}
              >
                {!reports && dropdown('Loại công việc', 'workType', workTypes)}
                {dropdown(
                  reports ? 'Nguồn báo cáo' : 'Nguồn phát sinh',
                  'source',
                  reports ? { Tenant: sources.Tenant, Staff: sources.Staff } : sources,
                )}
                {dropdown(reports ? 'Mức độ' : 'Ưu tiên', 'priority', priorities)}
                {dropdown(
                  'Trạng thái chi tiết',
                  'status',
                  Object.fromEntries(
                    (reports
                      ? [
                          'Chờ tiếp nhận',
                          'Đã tiếp nhận',
                          'Đang xử lý',
                          'Đã giải quyết',
                          'Đã từ chối',
                          'Trùng lặp',
                          'Đã hủy',
                        ]
                      : statuses
                    ).map((x) => [x, x]),
                  ),
                )}
                {dropdown('Người phụ trách cơ sở', 'staffUserId', staffOptions)}
                {dropdown('Người được giao trong hồ sơ', 'recordedStaffUserId', staffOptions)}
                {dropdown('Phân công hiện tại', 'hasResponsibility', {
                  false: 'Chưa có người phụ trách',
                  true: 'Có người phụ trách',
                })}
                <TextField
                  size="small"
                  type="datetime-local"
                  label="Hạn từ (giờ Việt Nam)"
                  value={get('dueFrom')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(e) => update({ dueFrom: e.target.value })}
                />
                <TextField
                  size="small"
                  type="datetime-local"
                  label="Hạn đến (giờ Việt Nam)"
                  value={get('dueTo')}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: get('dueFrom') } }}
                  onChange={(e) => update({ dueTo: e.target.value })}
                />
              </Stack>
            </Collapse>
          </Stack>
          <OwnerFeedback busy={list.isFetching} error={staff.error || locations.error} />
          <OwnerTable
            rows={list.data?.items ?? []}
            id={(item) => item.kind + ':' + item.id}
            loading={list.isPending}
            error={list.error}
            retry={() => void list.refetch()}
            select={select}
            label={reports ? 'Danh sách báo cáo sự cố' : 'Danh sách công việc'}
            selectLabel={reports ? 'Xem báo cáo' : 'Xem chi tiết'}
            compactAction
            columns={[
              {
                label: reports ? 'Báo cáo sự cố' : 'Công việc',
                render: (item) => (
                  <Stack spacing={0.25} sx={{ minWidth: 0, maxWidth: 440 }}>
                    <Typography
                      variant="body2"
                      title={item.title}
                      sx={{
                        fontWeight: 650,
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {item.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[
                        item.locationName || 'Không tải được tên cơ sở',
                        item.roomNumber || item.commonArea,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                  </Stack>
                ),
              },
              ...(reports
                ? [
                    {
                      label: 'Nguồn',
                      render: (item: UnifiedWorkItem) =>
                        item.source === 'Tenant' || item.source === 'Staff'
                          ? item.source
                          : (sources[item.source] ?? item.source),
                    },
                  ]
                : []),
              {
                label: 'Trạng thái',
                render: (item) => (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Chip
                      size="small"
                      label={item.status}
                      color={
                        item.phase === 'needsOwner'
                          ? 'warning'
                          : item.phase === 'active'
                            ? 'info'
                            : /hủy|từ chối|trùng|chuyển giao/i.test(item.status)
                              ? 'default'
                              : 'success'
                      }
                      variant="outlined"
                      sx={{
                        height: 'auto',
                        minHeight: 24,
                        fontWeight: 500,
                        '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 },
                      }}
                    />
                    {item.priority === 'Emergency' && (
                      <Chip size="small" label="Khẩn cấp" color="error" variant="outlined" />
                    )}
                  </Stack>
                ),
              },
              ...(!reports
                ? [
                    {
                      label: 'Người phụ trách',
                      render: (item: UnifiedWorkItem) => item.staffName || 'Chưa phân công',
                    },
                  ]
                : []),
              {
                label: reports ? 'Ngày báo cáo' : 'Hạn hoàn thành',
                render: (item) => (
                  <Typography
                    variant="body2"
                    color={!reports && item.isOverdue ? 'error.main' : 'text.primary'}
                    sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {displayDate(reports ? item.createdAt : item.dueAt)}
                    {!reports && item.isOverdue ? ' · Quá hạn' : ''}
                  </Typography>
                ),
              },
            ]}
          />
          {list.data && !list.error && (list.data.totalCount > 20 || page > 1) && (
            <Box sx={{ px: 2, py: 0.5 }}>
              <OwnerPagination
                page={page}
                total={list.data.totalCount}
                busy={list.isFetching}
                change={(value) => update({ page: String(value) }, false)}
              />
            </Box>
          )}
        </Paper>
      )}
      {fullDetail && (
        <OperationalDetailDialog
          title={workOrderId ? 'Chi tiết công việc' : 'Chi tiết báo cáo sự cố'}
          recordKey={workOrderId ? 'work:' + workOrderId : 'report:' + incidentId}
          close={closeDetail}
        >
          {workOrderId ? (
            <WorkOrderDetailWorkspace
              key={workOrderId}
              id={workOrderId}
              inDialog
              showIncident
              onOpenIncident={(id) =>
                update({ incidentId: id, workOrderId: '', taskId: '' }, false, true)
              }
            />
          ) : (
            <IncidentDetailWorkspace
              key={incidentId}
              id={incidentId}
              mode="report"
              inDialog
              onOpenWorkOrder={(id) =>
                update({ workOrderId: id, incidentId: '', taskId: '' }, false, true)
              }
            />
          )}
        </OperationalDetailDialog>
      )}
      {taskId && !fullDetail && (
        <TaskDetailDrawer
          key={taskId}
          id={taskId}
          close={closeDetail}
          edit={setEditor}
          staff={staff.data ?? []}
          locationName={locationName}
          notify={setNotice}
          initialOperation=""
        />
      )}
      {creation === 'choose' && (
        <Dialog open onClose={() => setCreation(null)} fullWidth maxWidth="sm">
          <DialogTitle>Chọn loại công việc</DialogTitle>
          <DialogContent>
            <Stack spacing={1}>
              {[
                {
                  title: 'Công việc thông thường',
                  text: 'Giao việc trực tiếp cho Staff tại cơ sở.',
                  act: () => {
                    setCreation(null);
                    switchView('work');
                    setEditor(null);
                  },
                },
                {
                  title: 'Bảo trì chủ động',
                  text: 'Kiểm tra, đề xuất phương án, sửa chữa và nghiệm thu.',
                  act: () => {
                    switchView('work');
                    setCreation('proactive');
                  },
                },
              ].map((item) => (
                <Button
                  key={item.title}
                  variant="outlined"
                  onClick={item.act}
                  sx={{ justifyContent: 'flex-start', textAlign: 'left', py: 1.5 }}
                >
                  <Stack>
                    <Typography sx={{ fontWeight: 650 }}>{item.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {item.text}
                    </Typography>
                  </Stack>
                </Button>
              ))}
            </Stack>
          </DialogContent>
        </Dialog>
      )}
      {creation === 'proactive' && (
        <ProactiveForm initialLocation={location} close={() => setCreation(null)} />
      )}
      {editor !== undefined && (
        <TaskEditorDialog
          task={editor}
          initialLocation={location}
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
