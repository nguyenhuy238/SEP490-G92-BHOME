import { TextField, ValidatedForm } from '../../../components/common/ValidatedForm';
import { useState, type ReactNode } from 'react';
import { TaskInspectionReview } from '../../property/EquipmentInspectionsPanel';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  MapPinned,
  UserRound,
  X,
} from 'lucide-react';
import { OwnerFeedback, OwnerPagination } from '../../../components/common/OwnerWorkspace';
import { useOwnerQuery, type OwnerPage } from '../../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { Staff } from '../../staff/staffContracts';
import {
  taskStatus,
  type OwnerTask,
  type TaskActor,
  type TaskHistory,
  type TaskEvidence,
} from '../taskContracts';
import {
  actionNames,
  responsibleName,
  taskActions,
  taskRoot,
  useTaskAction,
} from '../useOperationalTasksApi';
import { TaskEvidenceGallery } from './TaskEvidenceGallery';
import { MoveInInventoryReport } from './MoveInInventoryReport';
import { LocationAssetInventoryReport } from './LocationAssetInventoryReport';
import { LocationAssetHandoverPanel } from './LocationAssetHandoverPanel';
import { LocationAssetHandoverOverview } from './LocationAssetHandoverOverview';
import { OperationalTaskOverview } from './OperationalTaskOverview';

export function TaskStatus({ task }: { task: OwnerTask }) {
  const superseded = task.kind === 'LocationAssetHandover' && task.status === 'Cancelled';
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      <Chip
        size="small"
        label={superseded ? 'Đã chuyển giao' : (taskStatus[task.status] ?? task.status)}
        color={
          superseded
            ? 'info'
            : task.status === 'Completed'
              ? 'success'
              : task.status === 'PendingVerification'
                ? 'warning'
                : 'default'
        }
        sx={{ height: 28, fontSize: 12 }}
      />
      {task.isOverdue && (
        <Chip
          size="small"
          variant="outlined"
          color="error"
          label="Quá hạn"
          sx={{ height: 28, fontSize: 12 }}
        />
      )}
    </Stack>
  );
}
const historyNames: Record<string, string> = {
  created: 'Tạo công việc',
  updated: 'Chỉnh sửa công việc',
  start: 'Bắt đầu thực hiện',
  progress: 'Cập nhật tiến độ',
  blockers: 'Báo vướng mắc',
  submit: 'Nộp kết quả',
  verify: 'Nghiệm thu',
  rework: 'Yêu cầu làm lại',
  cancel: 'Hủy công việc',
  coordinate: 'Ghi chú phối hợp',
  assign: 'Đồng bộ người phụ trách',
  responsibility_changed: 'Thay đổi trách nhiệm',
  responsibility_superseded: 'Đã chuyển giao',
  location_asset_inventory_progress_inherited: 'Kế thừa tiến độ kiểm kê',
  'assignment-replaced': 'Thay đổi phân công cơ sở',
  evidence_uploaded: 'Tải bằng chứng',
  location_asset_inventory_created: 'Tạo kiểm kê tài sản toàn cơ sở',
  location_asset_inventory_item_checked: 'Cập nhật xác nhận tài sản',
  location_asset_handover_approved: 'Owner đã duyệt biên bản',
  location_asset_handover_owner_signed: 'Owner đã ký xác nhận',
  location_asset_handover_rework_requested: 'Owner yêu cầu kiểm tra lại',
  location_asset_handover_completed: 'Hai bên hoàn tất ký bàn giao',
  MoveInSubmitted: 'Đã gửi kiểm kê trước bàn giao',
  MoveInReinspection: 'Yêu cầu kiểm tra lại tài sản',
  MoveInCompleted: 'Hoàn tất kiểm kê trước bàn giao',
};
const keyHistoryActions = new Set([
  'created',
  'location_asset_inventory_created',
  'submit',
  'verify',
  'rework',
  'cancel',
  'assign',
  'responsibility_changed',
  'responsibility_superseded',
  'assignment-replaced',
  'location_asset_inventory_progress_inherited',
  'location_asset_handover_approved',
  'location_asset_handover_owner_signed',
  'location_asset_handover_rework_requested',
  'location_asset_handover_completed',
  'MoveInSubmitted',
  'MoveInReinspection',
  'MoveInCompleted',
]);
const ownerHistoryActions = new Set([
  'updated',
  'verify',
  'rework',
  'cancel',
  'assign',
  'coordinate',
  'location_asset_handover_approved',
  'location_asset_handover_owner_signed',
  'location_asset_handover_rework_requested',
]);
const staffHistoryActions = new Set([
  'start',
  'progress',
  'blockers',
  'submit',
  'evidence_uploaded',
  'location_asset_inventory_item_checked',
  'location_asset_handover_completed',
  'MoveInSubmitted',
  'MoveInCompleted',
]);
const isOpaqueId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
  /^[0-9a-f]{32}$/i.test(value);

function TaskSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        p: { xs: 2, sm: 2.5 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {title && (
        <Typography variant="subtitle1" sx={{ fontSize: 16, fontWeight: 700, mb: 1.5 }}>
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}

function TaskFact({
  label,
  children,
  icon,
  highlight = false,
}: {
  label: string;
  children: ReactNode;
  icon: ReactNode;
  highlight?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: highlight ? 'primary.main' : 'text.secondary',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          width: 34,
          height: 34,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          component="div"
          sx={{ color: 'text.secondary', fontSize: 12, fontWeight: 600, mb: 0.25 }}
        >
          {label}
        </Typography>
        <Typography
          variant="body2"
          component="div"
          sx={{
            fontSize: { xs: 13, md: 14 },
            fontWeight: highlight ? 750 : 650,
            color: 'text.primary',
            overflowWrap: 'anywhere',
            lineHeight: 1.45,
          }}
        >
          {children}
        </Typography>
      </Box>
    </Stack>
  );
}

type TaskDetailTab = 'overview' | 'inventory' | 'handover' | 'history';

function initialTaskTab(task: OwnerTask): TaskDetailTab {
  if (task.kind !== 'LocationAssetHandover') return 'overview';
  return task.status === 'Completed' || task.status === 'Cancelled' ? 'handover' : 'inventory';
}

function taskNextStep(task: OwnerTask): string {
  if (task.status === 'PendingVerification')
    return 'Staff đã nộp kết quả. Owner kiểm tra tiến độ, bằng chứng tại Tổng quan rồi nghiệm thu hoặc yêu cầu làm lại.';
  if (task.status === 'Completed')
    return 'Công việc đã nghiệm thu. Bạn có thể xem lại kết quả, bằng chứng và lịch sử xử lý.';
  if (task.status === 'Cancelled')
    return 'Công việc đã hủy. Lịch sử và các bằng chứng trước đó vẫn có thể xem lại.';
  return 'Theo dõi tiến độ và bằng chứng Staff cập nhật. Các thao tác cần xử lý của Owner nằm ở cuối cửa sổ.';
}

function TaskTabPanel({
  tab,
  activeTab,
  children,
}: {
  tab: TaskDetailTab;
  activeTab: TaskDetailTab;
  children: ReactNode;
}) {
  return (
    <Box
      role="tabpanel"
      id={'task-panel-' + tab}
      aria-labelledby={'task-tab-' + tab}
      hidden={activeTab !== tab}
      sx={{ display: activeTab === tab ? 'block' : 'none', minWidth: 0 }}
    >
      <Stack spacing={2} sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
        {children}
      </Stack>
    </Box>
  );
}

export function TaskDetailDrawer({
  id,
  staff,
  locationName,
  close,
  edit,
  notify,
  initialOperation = '',
}: {
  id: string;
  staff: Staff[];
  locationName: (id: string) => string;
  close: () => void;
  edit: (task: OwnerTask) => void;
  notify: (message: string) => void;
  initialOperation?: string;
}) {
  const [page, setPage] = useState(1);
  const [operation, setOperation] = useState(initialOperation);
  const [reworkItemIds, setReworkItemIds] = useState<string[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [tabSelection, setTabSelection] = useState<{ id: string; tab: TaskDetailTab } | null>(null);
  const detail = useOwnerQuery<OwnerTask>(['task', id], `${taskRoot}/${id}`);
  const history = useOwnerQuery<OwnerPage<TaskHistory>>(
    ['task-history', id, page],
    `${taskRoot}/${id}/history?page=${page}&pageSize=20`,
    !!detail.data,
  );
  const summaryHistory = useOwnerQuery<OwnerPage<TaskHistory>>(
    ['task-history-summary', id],
    taskRoot + '/' + id + '/history?page=1&pageSize=100',
    !!detail.data,
  );
  const evidence = useOwnerQuery<TaskEvidence[]>(
    ['task-evidence', id],
    `${taskRoot}/${id}/evidence`,
    !!detail.data,
  );
  const actors = useOwnerQuery<TaskActor[]>(
    ['task-actors', id],
    `${taskRoot}/${id}/actors`,
    !!detail.data,
  );
  const task = detail.data;
  const activeTab =
    tabSelection?.id === id ? tabSelection.tab : task ? initialTaskTab(task) : 'overview';
  const showTab = (tab: TaskDetailTab) => setTabSelection({ id, tab });
  const openTaskAction = async (op: string) => {
    const latest = await detail.refetch();
    if (!latest.data || latest.error || !taskActions(latest.data).includes(op)) return;
    if (op === 'edit') edit(latest.data);
    else setOperation(op);
  };
  const actorName = (actorId: string | null, action?: string) => {
    const name =
      (Array.isArray(actors.data)
        ? actors.data.find((item) => item.userId === actorId)?.displayName
        : undefined) || staff.find((item) => item.userId === actorId)?.fullName;
    if (name?.trim() && !isOpaqueId(name.trim())) return name.trim();
    if (action && ownerHistoryActions.has(action)) return 'Owner';
    if (action && staffHistoryActions.has(action)) return 'Nhân viên';
    return 'Người thực hiện';
  };
  // Scan a bounded larger window so routine checklist/progress events on page 1
  // do not conceal the latest signing, approval or responsibility milestone.
  const condensedSource = summaryHistory.data?.items?.length
    ? summaryHistory.data.items
    : (history.data?.items ?? []);
  const entries = [...(history.data?.items ?? [])].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
  const keyEntries = [...condensedSource]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .filter((item) => keyHistoryActions.has(item.action))
    .filter(
      (item, index, items) =>
        item.action !== 'location_asset_handover_owner_signed' ||
        items.findIndex(
          (other) => other.action === item.action && other.taskVersion === item.taskVersion,
        ) === index,
    )
    .slice(0, 5);
  const visibleEntries = historyExpanded ? entries : keyEntries;
  const refresh = async () => {
    await Promise.all([
      detail.refetch(),
      history.refetch(),
      summaryHistory.refetch(),
      evidence.refetch(),
      actors.refetch(),
    ]);
  };
  const renderHistoryEntry = (item: TaskHistory) => (
    <Box
      key={item.id}
      sx={{
        position: 'relative',
        borderLeft: '2px solid',
        borderColor: 'divider',
        ml: 0.5,
        pl: 2,
        pb: 2,
        minWidth: 0,
        '&:before': {
          content: '""',
          position: 'absolute',
          top: 6,
          left: -5,
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: 'primary.main',
        },
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {historyNames[item.action] ?? item.action}
      </Typography>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.25 }}>
        {formatInstant(item.occurredAt)} · {actorName(item.actorId, item.action)}
      </Typography>
      {item.action === 'blockers' && (
        <Typography variant="caption" sx={{ color: 'warning.dark' }}>
          Vướng mắc cần xử lý
        </Typography>
      )}
      {!!item.note?.trim() && (
        <Typography
          variant="body2"
          sx={{ mt: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {item.note}
        </Typography>
      )}
    </Box>
  );

  return (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      aria-labelledby="task-detail-heading"
      onClose={() => {
        if (!operation) close();
      }}
      slotProps={{
        paper: {
          sx: {
            width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' },
            maxWidth: 1280,
            maxHeight: '92dvh',
            m: { xs: 1, sm: 2 },
            borderRadius: { xs: 2, sm: 3 },
            overflow: 'hidden',
            '& .MuiButton-root': { borderRadius: '8px', minHeight: 36, fontSize: 14 },
          },
        },
      }}
    >
      <DialogTitle id="task-detail-container" sx={{ px: { xs: 2, md: 3 }, pt: 2.25, pb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              id="task-detail-heading"
              component="span"
              sx={{
                display: 'block',
                fontSize: 12,
                fontWeight: 700,
                color: 'text.secondary',
                letterSpacing: 0.5,
              }}
            >
              Chi tiết công việc
            </Typography>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              useFlexGap
              sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap', mt: 0.5 }}
            >
              <Typography
                component="div"
                sx={{ fontSize: { xs: 20, md: 24 }, fontWeight: 750, overflowWrap: 'anywhere' }}
              >
                {task?.title || 'Đang tải công việc…'}
              </Typography>
              {task && <TaskStatus task={task} />}
            </Stack>
          </Box>
          <IconButton aria-label="Đóng chi tiết" onClick={close} sx={{ alignSelf: 'flex-start' }}>
            <X size={20} />
          </IconButton>
        </Stack>
      </DialogTitle>
      {task && (
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            py: { xs: 1.75, md: 2 },
            borderTop: '1px solid',
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
            gap: { xs: 1.5, md: 2.5 },
          }}
        >
          <TaskFact label="Cơ sở" icon={<Building2 size={18} />} highlight>
            {locationName(task.locationId)}
          </TaskFact>
          <TaskFact
            label={task.kind === 'LocationAssetHandover' ? 'Phạm vi kiểm kê' : 'Vị trí'}
            icon={<MapPinned size={18} />}
          >
            {task.target?.label ?? 'Toàn cơ sở'}
          </TaskFact>
          <TaskFact label="Người phụ trách" icon={<UserRound size={18} />}>
            {responsibleName(task, staff)}
          </TaskFact>
          <TaskFact label="Thời hạn" icon={<CalendarDays size={18} />}>
            <Box component="span" sx={{ color: task.isOverdue ? 'error.main' : 'inherit' }}>
              {task.dueAt ? formatInstant(task.dueAt) : 'Chưa có hạn'}
            </Box>
          </TaskFact>
        </Box>
      )}
      <DialogContent dividers sx={{ p: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <OwnerFeedback busy={detail.isFetching} error={detail.error} />
        {!!detail.error && (
          <Button sx={{ m: 2 }} onClick={() => void detail.refetch()}>
            Tải lại công việc
          </Button>
        )}
        {task && (
          <>
            <Box
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
                px: { xs: 1, md: 2 },
              }}
            >
              <Tabs
                value={activeTab}
                onChange={(_, value: TaskDetailTab) => showTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                aria-label="Các phần chi tiết công việc"
                sx={{
                  minHeight: 46,
                  '& .MuiTab-root': { minHeight: 46, textTransform: 'none', fontWeight: 600 },
                }}
              >
                <Tab
                  value="overview"
                  label="Tổng quan"
                  id="task-tab-overview"
                  aria-controls="task-panel-overview"
                />
                {task.kind === 'LocationAssetHandover' && (
                  <Tab
                    value="inventory"
                    label="Kiểm kê tài sản"
                    id="task-tab-inventory"
                    aria-controls="task-panel-inventory"
                  />
                )}
                {task.kind === 'LocationAssetHandover' && (
                  <Tab
                    value="handover"
                    label="Biên bản & ký"
                    id="task-tab-handover"
                    aria-controls="task-panel-handover"
                  />
                )}
                <Tab
                  value="history"
                  label="Lịch sử"
                  id="task-tab-history"
                  aria-controls="task-panel-history"
                />
              </Tabs>
            </Box>
            <TaskTabPanel tab="overview" activeTab={activeTab}>
              {task.kind === 'LocationAssetHandover' ? (
                <>
                  <LocationAssetHandoverOverview task={task} onOpenTab={showTab} />
                  {!task.responsibilityAvailable &&
                    task.status !== 'Completed' &&
                    task.status !== 'Cancelled' && (
                      <Alert severity="warning" variant="outlined">
                        Cơ sở chưa có người phụ trách.{' '}
                        <Button href="/staff-assignments">Mở phân công cơ sở</Button>
                      </Alert>
                    )}
                  {(task.evidenceRequired || (evidence.data?.length ?? 0) > 0) && (
                    <TaskSection title="Bằng chứng công việc">
                      <OwnerFeedback busy={evidence.isFetching} error={evidence.error} />
                      {evidence.error ? (
                        <Button onClick={() => void evidence.refetch()}>Tải lại bằng chứng</Button>
                      ) : (
                        evidence.data &&
                        !operation && <TaskEvidenceGallery taskId={id} evidence={evidence.data} />
                      )}
                    </TaskSection>
                  )}
                </>
              ) : task.kind === 'AdHoc' ? (
                <OperationalTaskOverview
                  task={task}
                  evidence={evidence.data}
                  evidenceFetching={evidence.isFetching}
                  evidenceError={evidence.error}
                  showEvidenceGallery={!operation}
                  onRetryEvidence={() => void evidence.refetch()}
                  onOpenHistory={() => showTab('history')}
                  onVerify={() => void openTaskAction('verify')}
                  verifiedBy={actorName(task.verifiedByUserId, 'verify')}
                />
              ) : (
                <>
                  <TaskSection title="Theo dõi công việc">
                    <Typography variant="body2" color="text.secondary">
                      {taskNextStep(task)}
                    </Typography>
                    {!task.responsibilityAvailable && (
                      <Alert severity="warning" sx={{ mt: 1.5 }}>
                        Cơ sở chưa có người phụ trách.{' '}
                        <Button href="/staff-assignments">Mở phân công cơ sở</Button>
                      </Alert>
                    )}
                  </TaskSection>
                  <TaskSection title="Yêu cầu công việc">
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 }}
                    >
                      {task.requirements || 'Chưa có yêu cầu chi tiết.'}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ flexWrap: 'wrap', mt: 1.5 }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label={'Ưu tiên: ' + (task.priority === 'High' ? 'Cao' : 'Bình thường')}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={
                          'Loại: ' +
                          (task.kind === 'LocationAssetHandover'
                            ? 'Kiểm kê và bàn giao toàn cơ sở'
                            : task.kind === 'MoveInInventory'
                              ? 'Kiểm kê trước bàn giao'
                              : task.kind === 'AdHoc'
                                ? 'Công việc vận hành'
                                : 'Ghi điện nước')
                        }
                      />
                    </Stack>
                    {task.recordedStaffUserId &&
                      task.recordedStaffUserId !== task.currentResponsibleStaffUserId && (
                        <Typography variant="body2" sx={{ mt: 1.25, color: 'text.secondary' }}>
                          Người được ghi nhận khi giao:{' '}
                          {actorName(task.recordedStaffUserId, 'submit')}
                        </Typography>
                      )}
                  </TaskSection>
                  <TaskSection title="Tiến độ và kết quả">
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                      {task.result || 'Nhân viên chưa gửi kết quả hoàn thành.'}
                    </Typography>
                    {task.verifiedAt && (
                      <Typography
                        variant="caption"
                        component="div"
                        sx={{ mt: 1.5, color: 'text.secondary' }}
                      >
                        Nghiệm thu: {formatInstant(task.verifiedAt)} ·{' '}
                        {actorName(task.verifiedByUserId, 'verify')}
                      </Typography>
                    )}
                  </TaskSection>
                  <TaskInspectionReview taskId={task.id} />
                  {task.kind === 'MoveInInventory' && (
                    <TaskSection>
                      <MoveInInventoryReport taskId={task.id} evidence={evidence.data} />
                    </TaskSection>
                  )}
                  <TaskSection title="Bằng chứng công việc">
                    {task.evidenceRequired && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Công việc yêu cầu bằng chứng hoàn thành.
                      </Typography>
                    )}
                    <OwnerFeedback busy={evidence.isFetching} error={evidence.error} />
                    {evidence.error ? (
                      <Button onClick={() => void evidence.refetch()}>Tải lại bằng chứng</Button>
                    ) : (
                      evidence.data &&
                      !operation && <TaskEvidenceGallery taskId={id} evidence={evidence.data} />
                    )}
                  </TaskSection>
                </>
              )}
            </TaskTabPanel>
            {task.kind === 'LocationAssetHandover' && (
              <TaskTabPanel tab="inventory" activeTab={activeTab}>
                <TaskSection>
                  <LocationAssetInventoryReport
                    taskId={task.id}
                    selectable={task.status === 'PendingVerification'}
                    selectedIds={reworkItemIds}
                    onSelectedIdsChange={setReworkItemIds}
                  />
                </TaskSection>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ justifyContent: 'flex-end', alignItems: { sm: 'center' } }}
                >
                  {task.status === 'PendingVerification' && reworkItemIds.length > 0 && (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Đã chọn {reworkItemIds.length} mục cần kiểm tra lại.
                    </Typography>
                  )}
                  <Button variant="outlined" onClick={() => showTab('handover')}>
                    Mở biên bản & ký
                  </Button>
                </Stack>
              </TaskTabPanel>
            )}
            {task.kind === 'LocationAssetHandover' && (
              <TaskTabPanel tab="handover" activeTab={activeTab}>
                {task.status === 'PendingVerification' && (
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Đã chọn {reworkItemIds.length} mục cần kiểm tra lại từ danh sách tài sản.
                    </Typography>
                    <Button size="small" variant="outlined" onClick={() => showTab('inventory')}>
                      Quay lại kiểm kê tài sản
                    </Button>
                  </Stack>
                )}
                <TaskSection>
                  <LocationAssetHandoverPanel
                    task={task}
                    notify={notify}
                    reworkItemIds={reworkItemIds}
                    onReworked={() => {
                      setReworkItemIds([]);
                      void refresh();
                    }}
                  />
                </TaskSection>
              </TaskTabPanel>
            )}
            <TaskTabPanel tab="history" activeTab={activeTab}>
              <TaskSection title="Lịch sử xử lý">
                <Stack spacing={1.5}>
                  <OwnerFeedback
                    busy={history.isFetching || summaryHistory.isFetching}
                    error={history.error && summaryHistory.error ? history.error : undefined}
                  />
                  {history.error && (
                    <Button sx={{ alignSelf: 'flex-start' }} onClick={() => void history.refetch()}>
                      Tải lại lịch sử
                    </Button>
                  )}
                  {summaryHistory.error && (
                    <Typography variant="caption" color="text.secondary">
                      Chưa tải đủ các mốc cũ; đang hiển thị lịch sử gần nhất.
                    </Typography>
                  )}
                  {actors.error && (
                    <Alert
                      severity="info"
                      action={<Button onClick={() => void actors.refetch()}>Tải lại tên</Button>}
                    >
                      Chưa tải được đầy đủ tên người thực hiện.
                    </Alert>
                  )}
                  {!history.error &&
                    !summaryHistory.error &&
                    history.data?.items.length === 0 &&
                    summaryHistory.data?.items.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        Chưa có lịch sử xử lý.
                      </Typography>
                    )}
                  {!historyExpanded && condensedSource.length > 0 && keyEntries.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có mốc xử lý chính trong các cập nhật gần đây.
                    </Typography>
                  )}
                  <Box>{visibleEntries.map(renderHistoryEntry)}</Box>
                  {historyExpanded && (history.data?.totalCount ?? 0) > 20 && (
                    <OwnerPagination
                      page={page}
                      total={history.data!.totalCount}
                      change={setPage}
                      busy={history.isFetching}
                    />
                  )}
                  {(condensedSource.length > keyEntries.length ||
                    (summaryHistory.data?.totalCount ?? history.data?.totalCount ?? 0) >
                      condensedSource.length ||
                    historyExpanded) && (
                    <Button
                      size="small"
                      variant="text"
                      sx={{ alignSelf: 'flex-start' }}
                      startIcon={
                        historyExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                      }
                      onClick={() => {
                        setHistoryExpanded((current) => !current);
                        setPage(1);
                      }}
                    >
                      {historyExpanded ? 'Thu gọn lịch sử' : 'Xem toàn bộ lịch sử'}
                    </Button>
                  )}
                </Stack>
              </TaskSection>
            </TaskTabPanel>
          </>
        )}
      </DialogContent>
      {task && taskActions(task).length > 0 && (
        <DialogActions
          sx={{
            px: { xs: 2, md: 3 },
            py: 1.5,
            justifyContent: 'flex-start',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          {taskActions(task).map((op) => (
            <Button
              key={op}
              disabled={detail.isFetching}
              color={op === 'cancel' ? 'error' : 'primary'}
              variant={op === 'verify' ? 'contained' : 'outlined'}
              onClick={() => void openTaskAction(op)}
            >
              {actionNames[op]}
            </Button>
          ))}
        </DialogActions>
      )}
      {task && operation && (
        <TaskActionDialog
          key={operation}
          task={task}
          operation={operation}
          evidence={evidence.data}
          evidenceError={evidence.error}
          close={() => setOperation('')}
          refresh={refresh}
          notify={notify}
          loading={detail.isFetching || !!detail.error || evidence.isFetching}
        />
      )}
    </Dialog>
  );
}
function TaskActionDialog({
  task,
  operation,
  evidence,
  evidenceError,
  close,
  refresh,
  notify,
  loading,
}: {
  task: OwnerTask;
  operation: string;
  evidence?: TaskEvidence[];
  evidenceError: unknown;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  loading: boolean;
}) {
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const action = useTaskAction();
  const needsNote = !['verify', 'assign'].includes(operation);
  const allowed = taskActions(task).includes(operation);
  const missingRequiredEvidence =
    operation === 'verify' && task.evidenceRequired && !evidence?.some((item) => item.submissionId);
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!action.busy) close();
      }}
    >
      <DialogTitle>{actionNames[operation]}</DialogTitle>
      <DialogContent>
        <Stack
          spacing={2}
          component={ValidatedForm}
          id="task-action"
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              loading ||
              !allowed ||
              action.conflict ||
              (needsNote && !note.trim()) ||
              (operation === 'verify' &&
                (!checked || !evidence || !!evidenceError || missingRequiredEvidence))
            )
              return;
            void action
              .run(() =>
                action.command(`${taskRoot}/${task.id}/${operation}`, 'POST', {
                  version: task.version,
                  note: note.trim() || null,
                }),
              )
              .then((ok) => {
                if (ok) {
                  notify(
                    operation === 'assign'
                      ? 'Đã đồng bộ theo phân công cơ sở.'
                      : 'Đã xử lý công việc.',
                  );
                  close();
                }
              });
          }}
        >
          <OwnerFeedback busy={action.busy} error={action.error} />
          <Typography sx={{ fontWeight: 600 }}>{task.title}</Typography>
          {['verify', 'rework'].includes(operation) && (
            <>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {task.result || 'Chưa có kết quả.'}
              </Typography>
              <OwnerFeedback error={evidenceError} />
              {evidence && (
                <>
                  <Typography sx={{ fontWeight: 600 }}>Bằng chứng của lần gửi hiện tại</Typography>
                  <TaskEvidenceGallery
                    taskId={task.id}
                    evidence={evidence.filter((item) => item.submissionId)}
                  />
                  {evidence.some((item) => !item.submissionId) && (
                    <>
                      <Typography sx={{ fontWeight: 600 }}>
                        Ảnh tiến độ và bằng chứng khác
                      </Typography>
                      <TaskEvidenceGallery
                        taskId={task.id}
                        evidence={evidence.filter((item) => !item.submissionId)}
                      />
                    </>
                  )}
                </>
              )}
              {missingRequiredEvidence && (
                <Alert severity="warning">
                  Chưa có bằng chứng bắt buộc được đính kèm lần gửi hiện tại. Yêu cầu nhân viên bổ
                  sung trước khi nghiệm thu.
                </Alert>
              )}
            </>
          )}
          {operation === 'cancel' && (
            <Typography>Hủy công việc sẽ giữ lại lịch sử và bằng chứng.</Typography>
          )}
          {operation === 'assign' && (
            <Typography>
              Đồng bộ theo người phụ trách hiện tại của cơ sở; không chọn người thực hiện riêng.
            </Typography>
          )}
          <TextField
            multiline
            minRows={2}
            label={operation === 'rework' ? 'Lý do yêu cầu làm lại' : 'Ghi chú / lý do'}
            required={needsNote}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 8000 } }}
          />
          {operation === 'verify' && (
            <FormControlLabel
              label="Đã kiểm tra kết quả và bằng chứng"
              control={<Checkbox checked={checked} onChange={(_, value) => setChecked(value)} />}
            />
          )}
          {action.conflict && (
            <Alert severity="warning">
              Dữ liệu đã thay đổi. Nội dung nhập được giữ nguyên.
              <Button
                onClick={async () => {
                  await refresh();
                  setChecked(false);
                  action.reviewed();
                }}
              >
                Tải dữ liệu mới
              </Button>
            </Alert>
          )}
          {!allowed && (
            <Alert severity="warning">Trạng thái hiện tại không còn cho phép thao tác này.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={action.busy} onClick={close}>
          Hủy
        </Button>
        <Button
          variant="contained"
          color={operation === 'cancel' ? 'error' : 'primary'}
          type="submit"
          form="task-action"
          disabled={
            loading ||
            action.busy ||
            (operation === 'verify' && !checked) ||
            action.conflict ||
            !allowed ||
            (needsNote && !note.trim()) ||
            missingRequiredEvidence ||
            (operation === 'verify' && (!evidence || !!evidenceError))
          }
        >
          Xác nhận
        </Button>
      </DialogActions>
    </Dialog>
  );
}
