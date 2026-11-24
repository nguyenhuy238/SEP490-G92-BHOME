import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import {
  Button,
  Icon,
  IconButton,
  RadioButton,
  SegmentedButtons,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import {
  businessToday,
  contractClient,
  contractError,
  displayContractDate,
  mutationKeys,
  type ContractView,
  type HandoverAsset,
  type InspectionPreparation,
  type MoveOut,
} from '../../../../packages/client-core/src/contracts';
import {
  handoverQuantity,
  quantityFields,
} from '../../../../packages/client-core/src/handoverForm';
import type { MeterTask } from '../../../../packages/client-core/src/meter';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { CameraCapture } from '../components/CameraCapture';
import { Input } from '../components/WorkflowControls';
import { canUseLocalMeterDemo, meterDemoJpegBytes } from '../lib/meterDemoCapture';
import { ContractInitialMeterTasks } from '../features/contracts/ContractInitialMeterTasks';
import { ContractEvidence } from '../features/contracts/ContractEvidence';
import { MeterTaskScreen } from '../app/meter';
import { roomHandoverChecks, type MoveInRoomCheckStatus } from '../services/moveInHandover';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import type { Named } from '../lib/api';
import { randomUUID } from '../lib/randomUUID';
import { showSuccess } from '../lib/toast';
import { colors } from '../theme/theme';
import { operationalTasks, type OperationalTask } from '../services/operationalTasks';

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const sections = [
  'Ghi chỉ số điện nước',
  'Hiện trạng phòng · 7 mục',
  'Kiểm kê tài sản',
  'Chìa khóa và quyền truy cập',
] as const;
const statuses = [
  { id: 'Passed', label: 'Tốt' },
  { id: 'Issue', label: 'Có vấn đề' },
];

// Local-development artwork only; it must never be presented as real evidence.
function moveOutDemoJpeg(): Uint8Array<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không tạo được ảnh mẫu trên trình duyệt.');
  context.fillStyle = '#f1f5f9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#172b4d';
  context.font = 'bold 45px sans-serif';
  context.fillText('BHOME - ANH MAU DEV', 35, 195);
  context.font = '28px sans-serif';
  context.fillText('KHONG PHAI HIEN TRANG THUC TE', 35, 270);
  context.font = '24px sans-serif';
  context.fillText('Chi dung de thu thao tac tai anh tra phong', 35, 345);
  return meterDemoJpegBytes(canvas.toDataURL('image/jpeg', 0.86));
}
type Assignment = {
  contractId: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  status: string;
  proposedDate?: string;
  scheduledAt: string | null;
};
type InspectionRecord = {
  contract: ContractView;
  moveOut: MoveOut;
  preparation: InspectionPreparation;
};

type DraftRoomCheck = {
  code: string;
  status: MoveInRoomCheckStatus;
  notes: string | null;
  evidenceIds: string[];
};
type DraftAsset = {
  id: string;
  condition: string;
  checked?: boolean;
  notes?: string | null;
  evidenceIds?: string[] | null;
  observedQuantity?: number;
  handedOverQuantity?: number;
  goodQuantity?: number;
  wornQuantity?: number;
  damagedQuantity?: number;
  physicalObservations?: {
    id: string;
    quantity: number;
    condition: string;
    handedOverQuantity?: number;
  }[];
};
type PhysicalItemEvidence = {
  assetId: string;
  physicalAssetId: string;
  notes: string;
  evidenceIds: string[];
};
type InspectionDraft = {
  contractId: string;
  status: 'Draft';
  version: number;
  roomCondition: string | null;
  keysAndAccess: string | null;
  notes: string | null;
  assets: DraftAsset[];
  physicalItemEvidence?: PhysicalItemEvidence[];
  roomChecks: DraftRoomCheck[];
  accessItems: { type: string; quantity: number; notes: string }[];
  evidenceIds: string[];
  keyEvidenceIds: string[];
  electricityReadingId: string | null;
  waterReadingId: string | null;
  inventoryToken: string | null;
  proposedCompensation: string | null;
  updatedAt: string | null;
};
type DraftPatch = {
  version: number;
  roomCondition?: string;
  notes?: string;
  assets?: DraftAsset[];
  physicalItemEvidence?: PhysicalItemEvidence[];
  roomChecks?: DraftRoomCheck[];
  accessItems?: { type: string; quantity: number; notes: string }[];
  evidenceIds?: string[];
  keyEvidenceIds?: string[];
  electricityReadingId?: string;
  waterReadingId?: string;
  inventoryToken?: string;
};
type LocalInspection = {
  values: Record<string, string>;
  photos: Record<string, string[]>;
};

function draftToLocal(draft: InspectionDraft): LocalInspection {
  const values: Record<string, string> = {};
  const photos: Record<string, string[]> = {
    general: draft.evidenceIds ?? [],
    keys: draft.keyEvidenceIds ?? [],
  };
  if (draft.electricityReadingId) values.electricityReadingId = draft.electricityReadingId;
  if (draft.waterReadingId) values.waterReadingId = draft.waterReadingId;
  if (draft.roomCondition) values.roomCondition = draft.roomCondition;
  if (draft.notes) values.notes = draft.notes;
  for (const check of draft.roomChecks ?? []) {
    values[`room.${check.code}.status`] = check.status;
    values[`room.${check.code}.notes`] = check.notes ?? '';
    photos[`room:${check.code}`] = check.evidenceIds ?? [];
  }
  for (const asset of draft.assets ?? []) {
    values[`asset-${asset.id}`] = ['Tốt', 'Good', 'Passed'].includes(asset.condition)
      ? 'Tốt'
      : 'Có vấn đề';
    values[`${asset.id}.checked`] = asset.checked === false ? 'false' : 'true';
    values[`${asset.id}.notes`] = asset.notes ?? '';
    photos[`asset:${asset.id}`] = asset.evidenceIds ?? [];
    for (const [field] of quantityFields)
      if (typeof asset[field] === 'number') values[`${asset.id}.${field}`] = String(asset[field]);
  }
  const keys = (draft.accessItems ?? []).find((item) => item.type === 'RoomKey');
  if (keys) {
    values.keyQuantity = String(keys.quantity);
    values.keyNotes = keys.notes ?? '';
  }
  return { values, photos };
}

const wizardStyles = StyleSheet.create({
  root: { gap: 12 },
  phoneRoot: { padding: 12, minWidth: 0, gap: 12 },
  header: { gap: 9 },
  section: { gap: 12 },
  workList: { gap: 8 },
  workRow: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    minHeight: 66,
  },
  phoneWorkRow: { padding: 10, minHeight: 62 },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontWeight: '700', color: '#14213d' },
  rowDetail: { color: '#5a6a84', lineHeight: 19, flexShrink: 1 },
  comparisonPair: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  comparisonCell: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    borderColor: colors.border,
    backgroundColor: colors.tint,
    gap: 5,
    padding: 10,
  },
  physicalItem: {
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progress: { height: 6, borderRadius: 6, backgroundColor: colors.tint },
  compactTitle: { fontWeight: '700', color: '#14213d' },
  compactSummary: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' },
  compactSummaryTitle: { flex: 1, minWidth: 0 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(13, 26, 49, 0.62)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '93%',
    borderRadius: 16,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  modalHeader: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalBody: { padding: 18, paddingBottom: 30, gap: 14 },
  modalFooter: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  phoneModalOverlay: { padding: 4, justifyContent: 'flex-end' },
  phoneModalCard: { maxHeight: '100%', borderRadius: 12 },
  phoneModalHeader: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  phoneModalBody: { padding: 12, paddingBottom: 22, gap: 12 },
  phoneModalFooter: { padding: 8, gap: 6 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: {
    width: '47%',
    minWidth: 116,
    maxWidth: 210,
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#ffffff',
    padding: 4,
    overflow: 'hidden',
  },
  removePhoto: {
    position: 'absolute',
    top: 2,
    right: 2,
    margin: 0,
    width: 36,
    height: 36,
    backgroundColor: '#ffffff',
    borderRadius: 18,
  },
});

export function StaffMoveOutInspectionScreen() {
  const { contractId, taskId } = useLocalSearchParams<{ contractId?: string; taskId?: string }>();
  const { api, session } = useSession();
  const { role, preview, staffLocationId, go } = useWorkspace();
  const allowed = role === 'Staff' && !preview && !!session?.roles.includes('Staff');
  const selectedId =
    typeof contractId === 'string' && guidPattern.test(contractId) ? contractId : '';
  const selectedTaskId = typeof taskId === 'string' && guidPattern.test(taskId) ? taskId : '';
  const task = useWorkspaceQuery<OperationalTask>(
    allowed && selectedId && selectedTaskId
      ? `/api/v1/operational-tasks/${encodeURIComponent(selectedTaskId)}`
      : null,
    { notifyError: false },
  );
  const assignments = useWorkspaceQuery<Assignment[]>(
    allowed && staffLocationId ? '/api/v1/contracts/move-out-assignments' : null,
    { notifyError: false },
  );
  const rooms = useWorkspaceQuery<Named[]>(
    allowed && staffLocationId
      ? `/api/v1/capture/locations/${encodeURIComponent(staffLocationId)}/rooms`
      : null,
    { notifyError: false },
  );
  const client = useMemo(
    () => (api ? contractClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const taskClient = useMemo(() => (api ? operationalTasks(api) : null), [api]);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState('');
  const startLock = useRef(false);
  const [startKeys] = useState(() => mutationKeys(randomUUID));
  const beginWork = async () => {
    if (startLock.current || !validTask || workOrder?.status !== 'Assigned' || !taskClient) return;
    const body = { version: workOrder.version, note: '', evidenceIds: [] as string[] };
    const scope = 'staff-move-out-start';
    startLock.current = true;
    setStartBusy(true);
    setStartError('');
    try {
      const started = await taskClient.act(
        workOrder.id,
        'start',
        body.version,
        body.note,
        body.evidenceIds,
        startKeys.get(scope, body),
      );
      if (started.status !== 'InProgress')
        throw new Error('Máy chủ chưa xác nhận đã bắt đầu nhiệm vụ.');
      startKeys.confirmed(scope, body);
      api?.queryCache.invalidate(['tasks', 'contracts']);
      task.reload();
      showSuccess('Đã bắt đầu kiểm tra trả phòng.');
    } catch (cause) {
      setStartError(contractError(cause));
      task.reload();
    } finally {
      startLock.current = false;
      setStartBusy(false);
    }
  };
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{
    key: string;
    record: InspectionRecord | null;
    error: string;
  } | null>(null);
  const key = `${selectedId}:${staffLocationId}:${revision}`;
  const authorizedRoomIds = new Set((rooms.data ?? []).map((room) => room.id));
  const locationAssignments = (assignments.data ?? []).filter((item) =>
    authorizedRoomIds.has(item.roomId),
  );
  const assigned = locationAssignments.find((item) => item.contractId === selectedId);
  const workOrder = task.data;
  const validTask =
    !!workOrder &&
    workOrder.id === selectedTaskId &&
    workOrder.locationId === staffLocationId &&
    workOrder.title.startsWith('Kiểm tra trả phòng') &&
    workOrder.target?.contractId === selectedId &&
    workOrder.target?.roomId === assigned?.roomId;
  const isAssignedWorker =
    workOrder?.status !== 'InProgress' ||
    (!!session?.userId && workOrder.currentResponsibleStaffUserId === session.userId);
  const assignmentReady =
    !!assigned &&
    allowed &&
    !!staffLocationId &&
    !!rooms.data &&
    validTask &&
    isAssignedWorker &&
    workOrder.status === 'InProgress';
  const reloadAssignments = assignments.reload;
  const reloadRooms = rooms.reload;
  const reloadTask = task.reload;
  const reloadQueue = useCallback(() => {
    reloadAssignments();
    reloadRooms();
  }, [reloadAssignments, reloadRooms]);
  useFocusEffect(
    useCallback(() => {
      setRevision((value) => value + 1);
      // The loaded checklist stays mounted when Staff returns from a Final
      // meter capture. A transient assignment refresh would discard every
      // locally entered room, asset and key observation.
      if (!selectedId) reloadQueue();
      if (selectedTaskId) reloadTask();
    }, [reloadQueue, reloadTask, selectedId, selectedTaskId, setRevision]),
  );
  useEffect(() => {
    if (!assignmentReady || !selectedId || !client) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [contract, moveOut, preparation] = await Promise.all([
          client.get(selectedId, controller.signal),
          client.moveOut(selectedId, controller.signal),
          client.inspectionPreparation(selectedId, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (
          contract.id !== selectedId ||
          contract.locationId !== staffLocationId ||
          contract.roomId !== assigned.roomId
        )
          throw new Error('Nhiệm vụ không thuộc cơ sở đang chọn.');
        setResponse({ key, record: { contract, moveOut, preparation }, error: '' });
      } catch (cause) {
        if (!controller.signal.aborted)
          setResponse({ key, record: null, error: contractError(cause) });
      }
    })();
    return () => controller.abort();
  }, [assigned?.roomId, assignmentReady, client, key, selectedId, staffLocationId]);
  if (!allowed) return <Text>Chỉ Staff có quyền tại cơ sở mới được kiểm tra trả phòng.</Text>;
  if (!staffLocationId) return <Text>Chọn cơ sở được phân công để xem kiểm tra trả phòng.</Text>;
  if (contractId && !selectedId) return <Text>Mã hợp đồng trả phòng không hợp lệ.</Text>;
  if (taskId && !selectedTaskId) return <Text>Mã nhiệm vụ kiểm tra trả phòng không hợp lệ.</Text>;
  if (assignments.error || rooms.error)
    return (
      <Box>
        <Text style={ui.red}>{assignments.error || rooms.error}</Text>
        <Action secondary onPress={reloadQueue}>
          Tải lại công việc
        </Action>
      </Box>
    );
  if (assignments.loading || rooms.loading || !rooms.data)
    return <Text>Đang tải công việc trả phòng tại cơ sở…</Text>;
  if (!selectedId)
    return (
      <Box>
        <Heading
          title="Kiểm tra trả phòng"
          detail="Mở nhiệm vụ kiểm tra trả phòng trong mục Công việc để bắt đầu"
        />
        <Action onPress={() => go('work-orders')}>Xem công việc tại cơ sở</Action>
      </Box>
    );
  if (!assigned)
    return (
      <Box>
        <Text style={ui.red}>
          Hợp đồng này hiện không nằm trong danh sách nhiệm vụ của cơ sở đang chọn.
        </Text>
        <Action secondary onPress={() => go('move-out')}>
          Về công việc tại cơ sở
        </Action>
      </Box>
    );
  if (!selectedTaskId)
    return (
      <Box>
        <Text>Hãy mở nhiệm vụ kiểm tra trả phòng từ mục Công việc để xác nhận bắt đầu.</Text>
        <Action onPress={() => go('work-orders')}>Đến danh sách công việc</Action>
      </Box>
    );
  if (task.error)
    return (
      <Box>
        <Text accessibilityRole="alert" style={ui.red}>
          {task.error}
        </Text>
        <Action secondary onPress={task.reload}>
          Tải lại nhiệm vụ
        </Action>
      </Box>
    );
  if (task.loading || !workOrder) return <Text>Đang kiểm tra trạng thái nhiệm vụ trả phòng…</Text>;
  if (!validTask)
    return <Text accessibilityRole="alert">Nhiệm vụ không thuộc hợp đồng hoặc cơ sở này.</Text>;
  if (!isAssignedWorker)
    return (
      <Box>
        <Text accessibilityRole="alert">
          Nhân viên khác đang xử lý nhiệm vụ này. Chỉ người đã bắt đầu mới có thể cập nhật kết quả
          kiểm tra.
        </Text>
        <Action secondary onPress={() => go('work-orders')}>
          Về danh sách công việc
        </Action>
      </Box>
    );
  if (workOrder.status !== 'InProgress')
    return (
      <Box>
        <Heading
          title="Kiểm tra trả phòng"
          detail={`Phòng ${assigned.roomNumber} · ${assigned.locationName}`}
        />
        <Pill tone={workOrder.status === 'Assigned' ? 'amber' : 'neutral'}>
          {workOrder.status === 'Assigned'
            ? 'Cần làm'
            : workOrder.status === 'PendingVerification'
              ? 'Chờ duyệt'
              : 'Đã kết thúc'}
        </Pill>
        <Text>
          {workOrder.status === 'Assigned'
            ? 'Hãy bấm Bắt đầu công việc trong nhiệm vụ để mở 4 phần kiểm tra.'
            : workOrder.status === 'PendingVerification'
              ? 'Đã gửi kết quả kiểm tra cho Owner xem xét. Bạn sẽ được thông báo nếu cần bổ sung.'
              : 'Nhiệm vụ đã kết thúc. Không thể cập nhật kết quả kiểm tra.'}
        </Text>
        {!!startError && (
          <Text accessibilityRole="alert" style={ui.red}>
            {startError}
          </Text>
        )}
        {workOrder.status === 'Assigned' ? (
          <Action disabled={startBusy} onPress={() => void beginWork()}>
            Bắt đầu công việc
          </Action>
        ) : (
          <Action secondary onPress={() => go('task-detail', { taskId: selectedTaskId })}>
            Xem chi tiết nhiệm vụ
          </Action>
        )}
      </Box>
    );
  const current = response?.key.startsWith(`${selectedId}:${staffLocationId}:`) ? response : null;
  if (!current) return <Text>Đang tải hiện trạng và chỉ số chốt trả phòng…</Text>;
  if (current.error || !current.record)
    return (
      <Box>
        <Text style={ui.red}>{current.error || 'Không tải được dữ liệu kiểm tra trả phòng.'}</Text>
        <Action secondary onPress={() => setRevision((v) => v + 1)}>
          Tải lại kết quả kiểm tra
        </Action>
      </Box>
    );
  return (
    <InspectionForm
      key={`${selectedId}:${current.record.moveOut.id}`}
      data={current.record}
      client={client!}
      taskId={selectedTaskId}
      refresh={() => {
        setRevision((v) => v + 1);
        assignments.reload();
        task.reload();
        api?.queryCache.invalidate(['tasks', 'contracts']);
      }}
    />
  );
}

function InspectionForm({
  data,
  client,
  taskId,
  refresh,
}: {
  data: InspectionRecord;
  client: NonNullable<ReturnType<typeof contractClient>>;
  taskId: string;
  refresh: () => void;
}) {
  const { contract, moveOut, preparation } = data;
  const { width } = useWindowDimensions();
  const compactPhone = width < 540;
  const [step, setStep] = useState<number | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [meterTask, setMeterTask] = useState<{
    id: string;
    label: string;
    utilityType: 0 | 1;
  } | null>(null);
  const [meterRevision, setMeterRevision] = useState(0);
  const [meterReady, setMeterReady] = useState(false);
  const [meterProvisionError, setMeterProvisionError] = useState('');
  const [latestFinalReadings, setLatestFinalReadings] = useState<
    InspectionPreparation['finalReadings'] | null
  >(null);
  const finalReadings = latestFinalReadings ?? preparation.finalReadings;
  const [values, setValues] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState('');
  const [draftReload, setDraftReload] = useState(0);
  const canLoadDraft = moveOut.status === 'Approved' && businessToday() >= moveOut.proposedDate;
  const draftPath = `/api/v1/contracts/${encodeURIComponent(contract.id)}/move-out/inspection-draft`;
  useEffect(() => {
    if (!canLoadDraft) return;
    const controller = new AbortController();
    void client.transport<InspectionDraft>(draftPath, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (
          result.contractId !== contract.id ||
          result.status !== 'Draft' ||
          !Number.isInteger(result.version)
        ) {
          setDraftError('Phiếu nháp không hợp lệ. Hãy thử tải lại.');
          setDraftLoading(false);
          return;
        }
        const restored = draftToLocal(result);
        setDraft(result);
        setValues(restored.values);
        setPhotos(restored.photos);
        setDraftError('');
        setDraftLoading(false);
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setDraftError(contractError(cause));
        setDraftLoading(false);
      },
    );
    return () => controller.abort();
  }, [canLoadDraft, client, contract.id, draftPath, draftReload]);
  const [photoPreviews, setPhotoPreviews] = useState<
    Record<string, { uri: string; dispose: () => void }>
  >({});
  const previewCleanup = useRef(photoPreviews);
  useEffect(() => {
    const previous = previewCleanup.current;
    for (const [id, preview] of Object.entries(previous)) {
      if (!photoPreviews[id]) preview.dispose();
    }
    previewCleanup.current = photoPreviews;
  }, [photoPreviews]);
  useEffect(() => {
    const heldPreviews = previewCleanup;
    return () => {
      for (const preview of Object.values(heldPreviews.current)) preview.dispose();
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const meterReturnLock = useRef(false);
  const meterEnsureLock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const groups = preparation.inspectionGroups ?? preparation.baseline?.snapshot.assets ?? [];
  const baseline = preparation.baseline?.snapshot;
  const openingAsset = (assetId: string) =>
    baseline?.assets.find((asset) => asset.id === assetId) ?? null;
  const noAssetsConfirmed =
    preparation.inventory?.noAssetsConfirmed ?? baseline?.noAssetsConfirmed ?? false;
  const editable = moveOut.status === 'Approved' && businessToday() >= moveOut.proposedDate;
  // Inspection is a physical Move-Out observation, not an extension of Move-In.
  // A missing historical handover only removes comparison data; it does not
  // prevent Staff from photographing, checking and saving what exists today.
  const ensureFinalMeterTasks = useCallback(async () => {
    if (!editable || meterEnsureLock.current) return;
    meterEnsureLock.current = true;
    setMeterReady(false);
    setMeterProvisionError('');
    const scope = 'staff-move-out-ensure-final-meter-tasks';
    const identity = { taskId, date: businessToday() };
    try {
      const ids = await client.transport<string[]>(
        `/api/v1/operational-tasks/${encodeURIComponent(taskId)}/final-meter-tasks/ensure`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': keys.get(scope, identity) },
        },
      );
      if (!Array.isArray(ids) || ids.some((id) => !guidPattern.test(id)))
        throw new Error('Máy chủ chưa trả về nhiệm vụ Final hợp lệ.');
      keys.confirmed(scope, identity);
      if (ids.length === 0)
        throw new Error(
          'Phòng chưa có công tơ điện/nước đang hoạt động. Owner cần cấu hình công tơ trước khi chốt chỉ số.',
        );
      setMeterRevision((value) => value + 1);
      setMeterReady(true);
    } catch (cause) {
      setMeterProvisionError(
        cause instanceof Error && !('status' in cause) ? cause.message : contractError(cause),
      );
    } finally {
      meterEnsureLock.current = false;
    }
  }, [client, editable, keys, taskId]);
  useEffect(() => {
    if (step !== 0 || meterReady || meterProvisionError) return;
    // Provision asynchronously: state changes belong to the network response,
    // not to the synchronous effect phase during the initial step render.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void ensureFinalMeterTasks();
    });
    return () => {
      cancelled = true;
    };
  }, [step, meterReady, meterProvisionError, ensureFinalMeterTasks]);
  const confirmed = draft ? draftToLocal(draft) : { values: {}, photos: {} };
  const confirmedValues = confirmed.values;
  const confirmedPhotos = (bucket: string) => confirmed.photos[bucket] ?? [];
  const getPhotos = (bucket: string) => photos[bucket] ?? [];
  function assetResult(asset: HandoverAsset) {
    const condition = values[`asset-${asset.id}`]?.trim() ?? '';
    if (condition !== 'Tốt' && condition !== 'Có vấn đề')
      throw new Error(`Chọn Tốt hoặc Có vấn đề cho ${asset.name}.`);
    const current = values[`${asset.id}.observedQuantity`] ?? '';
    const openingQuantity = openingAsset(asset.id)?.handedOverQuantity;
    const hasCount =
      openingQuantity != null ||
      asset.configuredQuantity != null ||
      asset.handedOverQuantity != null ||
      !!asset.physicalAssets?.length;
    const result = hasCount
      ? (() => {
          const count = handoverQuantity(current, `${asset.name} · Số lượng hiện tại`);
          return {
            id: asset.id,
            condition,
            observedQuantity: count,
            ...(openingQuantity == null
              ? {}
              : { missingQuantity: Math.max(0, openingQuantity - count) }),
          };
        })()
      : { id: asset.id, condition };
    return result;
  }
  const set = (name: string, value: string) => {
    setValues((prior) => ({ ...prior, [name]: value }));
    setError('');
  };
  const readingId = (type: 0 | 1) =>
    values[type === 0 ? 'electricityReadingId' : 'waterReadingId'] ?? '';
  const roomCompleted = roomHandoverChecks.every(({ code }) => {
    const status = confirmedValues[`room.${code}.status`];
    return (
      status === 'Passed' || (status === 'Issue' && !!confirmedValues[`room.${code}.notes`]?.trim())
    );
  });
  const assetIssue = (asset: HandoverAsset, condition: string, actual: number | undefined) => {
    const expected = openingAsset(asset.id)?.handedOverQuantity;
    return (
      condition === 'Có vấn đề' || (actual !== undefined && expected != null && actual !== expected)
    );
  };
  const assetCompleted = groups.length
    ? groups.every((item) => {
        if (confirmedValues[`${item.id}.checked`] !== 'true') return false;
        try {
          const observed = draft?.assets.find((asset) => asset.id === item.id);
          if (!observed || observed.checked === false || !observed.condition) return false;
          const hasIssue = assetIssue(item, observed.condition, observed.observedQuantity);
          if (hasIssue && !observed.notes?.trim()) return false;
          return !hasIssue || !!confirmedValues[`${item.id}.notes`]?.trim();
        } catch {
          return false;
        }
      })
    : noAssetsConfirmed;
  const keyCount = values.keyQuantity ?? '';
  const confirmedKeyCount = confirmedValues.keyQuantity ?? '';
  const openingKeyQuantity = baseline?.accessItems?.find(
    (item) => item.type === 'RoomKey',
  )?.quantity;
  const keyCountChanged =
    openingKeyQuantity != null &&
    /^\d+$/.test(confirmedKeyCount) &&
    Number(confirmedKeyCount) !== openingKeyQuantity;
  const assetIssues = groups.some((asset) => {
    const saved = draft?.assets.find((item) => item.id === asset.id);
    return (
      !!saved &&
      saved.checked !== false &&
      assetIssue(asset, saved.condition, saved.observedQuantity)
    );
  });
  const keysCompleted =
    /^\d+$/.test(confirmedKeyCount) &&
    Number(confirmedKeyCount) <= 100 &&
    confirmedPhotos('keys').length > 0;
  const completedSteps = [
    !!confirmedValues.electricityReadingId && !!confirmedValues.waterReadingId,
    roomCompleted,
    assetCompleted,
    keysCompleted,
  ];
  const inspectedRooms = roomHandoverChecks.filter(
    ({ code }) => confirmedValues[`room.${code}.status`],
  ).length;
  const inspectedAssets = groups.filter(
    (item) => confirmedValues[`${item.id}.checked`] === 'true',
  ).length;
  const roomIssues = roomHandoverChecks.filter(
    ({ code }) => confirmedValues[`room.${code}.status`] === 'Issue',
  ).length;
  const sectionHasIssue = [false, roomIssues > 0, assetIssues, keyCountChanged];
  const selectedRoomCode = activeItem?.startsWith('room:') ? activeItem.slice(5) : '';
  const selectedRoomCheck = roomHandoverChecks.find(({ code }) => code === selectedRoomCode);
  const openingRoomCheck = baseline?.roomChecks?.find((item) => item.code === selectedRoomCode);
  const selectedAssetId = activeItem?.startsWith('asset:') ? activeItem.slice(6) : '';
  const selectedAsset = groups.find((item) => item.id === selectedAssetId);
  const modalTitle =
    activeItem === 'meter'
      ? `Ghi chỉ số ${meterTask?.label.toLocaleLowerCase('vi') ?? 'chốt trả phòng'}`
      : activeItem === 'keys'
        ? 'Chìa khóa thu lại'
        : (selectedRoomCheck?.label ?? selectedAsset?.name ?? '');
  const isSubmitted = moveOut.status !== 'Approved';
  async function upload(bytes: Uint8Array<ArrayBuffer>, bucket: string) {
    if (busy || !editable || isSubmitted) throw new Error('Nhiệm vụ hiện không cho phép tải ảnh.');
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá 5 MB.');
    if (getPhotos(bucket).length >= 5) throw new Error('Đã đạt giới hạn ảnh cho hạng mục này.');
    setBusy(true);
    setError('');
    try {
      const file = await client.upload(contract.id, bytes, 'image/jpeg');
      try {
        let preview: { uri: string; dispose: () => void };
        if (Platform.OS === 'web') {
          const uri = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          preview = { uri, dispose: () => URL.revokeObjectURL(uri) };
        } else {
          const folder = new Directory(Paths.cache, 'bhome-move-out-unsaved-photos');
          folder.create({ idempotent: true, intermediates: true });
          const cached = new File(folder, `${randomUUID()}.jpg`);
          cached.create();
          await cached.write(bytes);
          preview = {
            uri: cached.uri,
            dispose: () => {
              if (cached.exists) cached.delete();
            },
          };
        }
        setPhotoPreviews((current) => ({ ...current, [file.id]: preview }));
      } catch {
        // The private evidence was uploaded successfully; a device preview
        // failure must not discard its identifier or force another upload.
      }
      setPhotos((previous) => ({
        ...previous,
        [bucket]: [...(previous[bucket] ?? []), file.id],
      }));
      setNotice('');
    } catch (cause) {
      const message = contractError(cause);
      setError(message);
      throw new Error(message, { cause });
    } finally {
      setBusy(false);
    }
  }
  function photoSection(bucket: string, label: string) {
    const count = getPhotos(bucket).length;
    const canUseSample = canUseLocalMeterDemo(
      typeof __DEV__ !== 'undefined' && __DEV__,
      Platform.OS,
      globalThis.location?.hostname,
      globalThis.location?.port,
    );
    return (
      <View style={wizardStyles.section}>
        <Text variant="labelMedium">
          {label}
          {count > 0 ? ` · ${count} ảnh` : ''}
        </Text>
        <CameraCapture
          label="Chụp ảnh"
          presentation="evidence"
          reviewBeforeSubmit
          reviewActionLabel="Dùng ảnh này"
          disabled={busy || !editable || count >= 5}
          onCapture={(bytes) => upload(bytes, bucket)}
        />
        {canUseSample && (
          <Button
            mode="outlined"
            icon="flask-outline"
            disabled={busy || !editable || count >= 5}
            onPress={() => {
              try {
                const bytes = moveOutDemoJpeg();
                void upload(bytes, bucket)
                  .catch(() => undefined)
                  .finally(() => bytes.fill(0));
              } catch {
                setError('Không tạo được ảnh mẫu DEV. Hãy thử lại trên web local.');
              }
            }}
          >
            Chọn ảnh mẫu (test)
          </Button>
        )}
        {count > 0 && (
          <View style={wizardStyles.photoGrid}>
            {getPhotos(bucket).map((id, index) => (
              <View key={id} style={wizardStyles.photoTile}>
                {photoPreviews[id] ? (
                  <Image
                    source={{ uri: photoPreviews[id].uri }}
                    accessibilityLabel={`Ảnh minh chứng ${index + 1}`}
                    style={{ width: '100%', height: 108, borderRadius: 8 }}
                    resizeMode="cover"
                  />
                ) : (
                  <ContractEvidence
                    api={client}
                    contractId={contract.id}
                    evidenceId={id}
                    thumbnail
                    thumbnailHeight={108}
                    label={`Ảnh minh chứng ${index + 1}`}
                  />
                )}
                <IconButton
                  icon="close"
                  size={20}
                  accessibilityLabel={`Xóa ảnh minh chứng ${index + 1}`}
                  disabled={busy || !editable}
                  style={wizardStyles.removePhoto}
                  onPress={() => {
                    setPhotos((current) => ({
                      ...current,
                      [bucket]: (current[bucket] ?? []).filter((item) => item !== id),
                    }));
                    setPhotoPreviews((current) => {
                      const next = { ...current };
                      delete next[id];
                      return next;
                    });
                    setNotice('');
                  }}
                />
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }
  function buildBody() {
    if (!editable) throw new Error('Chưa đủ điều kiện kiểm tra trả phòng.');
    const electricity = finalReadings.find(
      (item) => item.id === readingId(0) && item.utilityType === 0,
    );
    const water = finalReadings.find((item) => item.id === readingId(1) && item.utilityType === 1);
    if (!electricity || !water)
      throw new Error('Cần chọn đủ chỉ số điện và nước chốt đã được Staff xác nhận.');
    const roomChecks = roomHandoverChecks.map(({ code, label }) => {
      const status = values[`room.${code}.status`] as MoveInRoomCheckStatus | undefined;
      const notes = values[`room.${code}.notes`]?.trim() ?? '';
      const evidenceIds = getPhotos(`room:${code}`);
      if (status !== 'Passed' && status !== 'Issue') throw new Error(`Chưa kiểm tra: ${label}.`);
      if (status === 'Issue' && !notes) throw new Error(`Cần ghi lý do: ${label}.`);
      return { code, status, notes, evidenceIds };
    });
    const roomCondition = roomHandoverChecks
      .map(
        ({ code, label }) =>
          `${label}: ${values[`room.${code}.status`] === 'Passed' ? 'Tốt' : 'Có vấn đề'}`,
      )
      .join('; ');
    const quantity = Number(keyCount);
    if (!keysCompleted) throw new Error('Nhập số chìa khóa thực nhận và chụp ảnh chìa khóa.');
    const evidenceIds = getPhotos('general');
    const assets = groups.map((item: HandoverAsset) => {
      const result = assetResult(item);
      const issue = assetIssue(
        item,
        result.condition,
        'observedQuantity' in result ? result.observedQuantity : undefined,
      );
      if (issue && !values[`${item.id}.notes`]?.trim())
        throw new Error(`Cần ghi nguyên nhân khi tài sản có vấn đề: ${item.name}.`);
      return {
        ...result,
        checked: true,
        notes: values[`${item.id}.notes`]?.trim() ?? '',
        evidenceIds: getPhotos(`asset:${item.id}`),
      };
    });
    const notes =
      values.notes?.trim() ||
      'Đã hoàn thành kiểm tra thực tế điện nước, hiện trạng phòng, tài sản và chìa khóa.';
    const allIds = [
      ...evidenceIds,
      ...roomChecks.flatMap((item) => item.evidenceIds),
      ...assets.flatMap((item) => ('evidenceIds' in item ? item.evidenceIds : []) ?? []),
      ...getPhotos('keys'),
    ];
    if (new Set(allIds).size !== allIds.length)
      throw new Error('Một ảnh bằng chứng chỉ được gắn vào một hạng mục.');
    const accessItems = [{ type: 'RoomKey', quantity, notes: '' }];
    return {
      electricityReadingId: electricity.id,
      waterReadingId: water.id,
      roomCondition,
      notes,
      keysAndAccess: `Đã nhận lại ${quantity} chìa khóa phòng.`,
      roomChecks,
      assets,
      accessItems,
      keyEvidenceIds: getPhotos('keys'),
      evidenceIds,
      inventoryToken: preparation.inventory?.stateToken ?? null,
      expectedVersion: moveOut.version,
    };
  }
  function rollbackItem() {
    if (draft) {
      const restored = draftToLocal(draft);
      setValues(restored.values);
      setPhotos(restored.photos);
      const keptIds = new Set(Object.values(restored.photos).flat());
      setPhotoPreviews((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => keptIds.has(id))),
      );
    }
    setError('');
    setActiveItem(null);
    setMeterTask(null);
  }
  function patchForItem(item: string, version: number): DraftPatch {
    if (!editable) throw new Error('Chưa đủ điều kiện kiểm tra trả phòng.');
    if (item.startsWith('room:')) {
      const code = item.slice(5);
      const check = roomHandoverChecks.find((entry) => entry.code === code);
      if (!check) throw new Error('Hạng mục hiện trạng phòng không hợp lệ.');
      const status = values[`room.${code}.status`] as MoveInRoomCheckStatus | undefined;
      const notes = values[`room.${code}.notes`]?.trim() ?? '';
      const evidenceIds = getPhotos(item);
      if (status !== 'Passed' && status !== 'Issue')
        throw new Error(`Chọn Tốt hoặc Có vấn đề: ${check.label}.`);
      if (status === 'Issue' && !notes) throw new Error(`Nhập lý do: ${check.label}.`);
      return {
        version,
        roomChecks: [{ code, status, notes: status === 'Passed' ? null : notes, evidenceIds }],
      };
    }
    if (item.startsWith('asset:')) {
      const asset = groups.find((entry) => entry.id === item.slice(6));
      if (!asset) throw new Error('Hạng mục kiểm kê tài sản không hợp lệ.');
      const evidenceIds = getPhotos(item);
      const result = assetResult(asset);
      const issue = assetIssue(
        asset,
        result.condition,
        'observedQuantity' in result ? result.observedQuantity : undefined,
      );
      const notes = values[`${asset.id}.notes`]?.trim() ?? '';
      if (issue && !notes) throw new Error(`Cần ghi chú tài sản có vấn đề: ${asset.name}.`);
      return {
        version,
        assets: [{ ...result, checked: true, notes, evidenceIds }],
        ...(preparation.inventory?.stateToken
          ? { inventoryToken: preparation.inventory.stateToken }
          : {}),
      };
    }
    if (item === 'keys') {
      const quantity = Number(keyCount);
      if (!/^\d+$/.test(keyCount) || quantity > 100 || !getPhotos('keys').length)
        throw new Error('Nhập số chìa khóa đã nhận và chụp ít nhất một ảnh.');
      return {
        version,
        accessItems: [{ type: 'RoomKey', quantity, notes: '' }],
        keyEvidenceIds: getPhotos('keys'),
      };
    }
    throw new Error('Hạng mục kiểm tra không hợp lệ.');
  }
  async function writeDraftPatch(patch: DraftPatch): Promise<boolean> {
    if (!draft || draftLoading || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const scope = 'staff-move-out-draft';
      const result = await client.transport<InspectionDraft>(draftPath, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': keys.get(scope, patch) },
        body: JSON.stringify(patch),
      });
      if (
        result.contractId !== contract.id ||
        result.status !== 'Draft' ||
        !Number.isInteger(result.version) ||
        result.version < draft.version
      )
        throw new Error('Máy chủ chưa xác nhận lưu phiếu.');
      if (
        patch.physicalItemEvidence?.some((item) => {
          const confirmed = result.physicalItemEvidence?.find(
            (part) =>
              part.assetId === item.assetId && part.physicalAssetId === item.physicalAssetId,
          );
          return (
            !confirmed ||
            confirmed.notes !== item.notes ||
            confirmed.evidenceIds.length !== item.evidenceIds.length ||
            item.evidenceIds.some((id) => !confirmed.evidenceIds.includes(id))
          );
        })
      )
        throw new Error('Máy chủ chưa xác nhận ảnh riêng của từng tài sản. Hãy kiểm tra lại.');
      keys.confirmed(scope, patch);
      const confirmed = draftToLocal(result);
      setDraft(result);
      setValues(confirmed.values);
      setPhotos(confirmed.photos);
      setActiveItem(null);
      setMeterTask(null);
      setNotice('');
      return true;
    } catch (cause) {
      setError(contractError(cause));
      if ((cause as { status?: number })?.status === 409) {
        try {
          const latest = await client.transport<InspectionDraft>(draftPath);
          if (latest.contractId === contract.id && latest.status === 'Draft') {
            setDraft(latest);
            setError(
              activeItem === 'meter'
                ? 'Dữ liệu đã thay đổi. Đóng mục này và mở lại để thử lưu chỉ số.'
                : 'Phiếu đã thay đổi trên máy chủ. Kiểm tra lại mục đang nhập và bấm Xong để lưu với phiên bản mới.',
            );
          }
        } catch {
          setError('Phiếu đã thay đổi. Tải lại màn kiểm tra trước khi lưu tiếp.');
        }
      }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveItem() {
    if (!draft || draftLoading || !activeItem || lock.current || busy) return;
    try {
      await writeDraftPatch(patchForItem(activeItem, draft.version));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cần hoàn thiện mục trước khi lưu.');
    }
  }
  async function finishMeterTask(selected: { id: string; utilityType: 0 | 1 }) {
    if (meterReturnLock.current || lock.current || !draft || !editable) return;
    meterReturnLock.current = true;
    setBusy(true);
    setError('');
    try {
      // Only the current contract's Final capture is eligible, never a
      // periodic/initial reading or a Final reading from an earlier day.
      const task = await client.transport<MeterTask>(
        `/api/v1/capture/meter-tasks/${encodeURIComponent(selected.id)}`,
      );
      if (
        task.id !== selected.id ||
        task.contractId !== contract.id ||
        task.roomId !== contract.roomId ||
        task.locationId !== contract.locationId ||
        task.purpose !== 2 ||
        task.utilityType !== selected.utilityType ||
        task.readingDate !== businessToday()
      ) {
        throw new Error('Nhiệm vụ Final không thuộc hợp đồng, cơ sở hoặc ngày trả phòng hôm nay.');
      }
      setMeterRevision((value) => value + 1);
      if (task.status !== 2 || !task.confirmedReadingId) {
        setActiveItem(null);
        setMeterTask(null);
        setNotice('Chỉ số chưa được xác nhận, nên chưa lưu vào phiếu trả phòng.');
        return;
      }
      const field = selected.utilityType === 0 ? 'electricityReadingId' : 'waterReadingId';
      if (draft[field] === task.confirmedReadingId) {
        setActiveItem(null);
        setMeterTask(null);
        setNotice('');
        return;
      }
      // The preparation endpoint is the authoritative eligibility projection.
      // Do not trust just a task status or reading ID from local capture state.
      const fresh = await client.inspectionPreparation(contract.id);
      const matching = fresh.finalReadings.find(
        (reading) =>
          reading.id === task.confirmedReadingId && reading.utilityType === selected.utilityType,
      );
      if (!matching)
        throw new Error('Chỉ số Final chưa đủ điều kiện ghi nhận. Hãy tải lại công việc.');
      const patch: DraftPatch =
        selected.utilityType === 0
          ? { version: draft.version, electricityReadingId: matching.id }
          : { version: draft.version, waterReadingId: matching.id };
      const saved = await writeDraftPatch(patch);
      if (saved) {
        setLatestFinalReadings(fresh.finalReadings);
        refresh();
      }
    } catch (cause) {
      setError(
        cause instanceof Error && !('status' in cause) ? cause.message : contractError(cause),
      );
    } finally {
      meterReturnLock.current = false;
      setBusy(false);
    }
  }
  function closeInspectionItem() {
    if (activeItem === 'meter' && meterTask) {
      void finishMeterTask(meterTask);
    } else {
      rollbackItem();
    }
  }
  async function submit() {
    if (
      lock.current ||
      busy ||
      isSubmitted ||
      draftLoading ||
      !draft ||
      !completedSteps.every(Boolean)
    )
      return;
    let body: ReturnType<typeof buildBody>;
    try {
      body = buildBody();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dữ liệu kiểm tra chưa đầy đủ.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const scope = 'staff-move-out-inspection';
      const result = await client.mutate<MoveOut>(
        contract.id,
        'move-out/inspection',
        body,
        keys.get(scope, body),
      );
      if (result.status !== 'Inspected')
        throw new Error('Máy chủ chưa xác nhận đã lưu kết quả kiểm tra trả phòng.');
      keys.confirmed(scope, body);
      setNotice('');
      showSuccess('Đã hoàn tất kiểm tra trả phòng.');
      refresh();
    } catch (cause) {
      if ((cause as { code?: string } | null)?.code === 'request_timeout') {
        // A disconnected response does not prove the server rolled back.
        // Read the authoritative Move-Out state before allowing another submit.
        try {
          const latest = await client.moveOut(contract.id);
          if (latest.status === 'Inspected') {
            keys.confirmed('staff-move-out-inspection', body);
            showSuccess('Đã lưu kết quả kiểm tra.');
            refresh();
            return;
          }
        } catch {
          // Leave the original idempotency key intact for a deliberate retry.
        }
        setError('Chưa xác nhận được kết quả gửi. Tải lại trang để kiểm tra trước khi gửi lại.');
      } else {
        setError(contractError(cause));
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function workEntry(
    id: string,
    title: string,
    detail: string,
    status: string,
    onPress: () => void,
    done = false,
    issue = false,
  ) {
    return (
      <TouchableRipple
        key={id}
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={busy || isSubmitted}
        onPress={onPress}
        style={[wizardStyles.workRow, compactPhone && wizardStyles.phoneWorkRow]}
      >
        <View style={wizardStyles.rowContent}>
          <Icon
            source={
              issue
                ? 'alert-circle-outline'
                : done
                  ? 'check-circle-outline'
                  : 'clipboard-text-outline'
            }
            size={23}
            color={issue ? colors.amber : done ? colors.green : colors.blue}
          />
          <View style={wizardStyles.rowText}>
            <Text variant="titleSmall" style={wizardStyles.rowTitle}>
              {title}
            </Text>
            {!!detail && (
              <Text variant="bodySmall" style={wizardStyles.rowDetail}>
                {detail}
              </Text>
            )}
            <Text
              variant="labelSmall"
              style={issue ? { color: colors.amber } : done ? ui.green : ui.muted}
            >
              {status}
            </Text>
          </View>
          <Icon source="chevron-right" size={22} color={colors.blue} />
        </View>
      </TouchableRipple>
    );
  }
  if (!canLoadDraft)
    return (
      <Box>
        <Heading title={`Kiểm tra trả phòng · phòng ${contract.roomNumber}`} />
        <Text accessibilityRole="status">
          Nhiệm vụ đã bắt đầu. Bạn có thể kiểm tra từ ngày trả phòng đã duyệt:{' '}
          {displayContractDate(moveOut.proposedDate)}.
        </Text>
      </Box>
    );
  if (draftLoading) return <Text>Đang tải các mục kiểm tra đã lưu…</Text>;
  if (draftError || !draft)
    return (
      <Box>
        <Text accessibilityRole="alert" style={ui.red}>
          {draftError || 'Chưa tải được phiếu nháp kiểm tra trả phòng.'}
        </Text>
        <Action
          secondary
          onPress={() => {
            setDraftLoading(true);
            setDraftError('');
            setDraftReload((current) => current + 1);
          }}
        >
          Tải lại các mục đã lưu
        </Action>
      </Box>
    );
  return (
    <Box style={compactPhone ? wizardStyles.phoneRoot : undefined}>
      <View style={wizardStyles.section}>
        {compactPhone ? (
          <Text variant="titleMedium" style={wizardStyles.compactTitle}>
            Kiểm tra trả phòng · phòng {contract.roomNumber}
          </Text>
        ) : (
          <Heading title={`Kiểm tra trả phòng · phòng ${contract.roomNumber}`} />
        )}
        <View style={wizardStyles.compactSummary}>
          <Pill tone={isSubmitted ? 'green' : 'blue'}>
            {moveOut.status === 'Inspected' ? 'Đã gửi Owner duyệt' : 'Đang kiểm tra'}
          </Pill>
          <Text variant="bodySmall" style={ui.muted}>
            {contract.locationName}
          </Text>
        </View>
        <Text variant="bodySmall" style={ui.muted}>
          Ngày trả dự kiến: {displayContractDate(moveOut.proposedDate)}
          {moveOut.inspectionScheduledAt
            ? ` · Lịch kiểm tra: ${formatInstant(moveOut.inspectionScheduledAt)}`
            : ''}
        </Text>
        {!editable && !isSubmitted && (
          <Text accessibilityRole="alert" style={ui.red}>
            Chỉ được kiểm tra từ ngày trả phòng đã được duyệt.
          </Text>
        )}
        {preparation.otherTenantsRemain && <Text style={ui.muted}>Phòng vẫn còn người thuê.</Text>}
        {!!error && !activeItem && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        {!!notice && !activeItem && (
          <Text accessibilityRole="status" style={ui.green}>
            {notice}
          </Text>
        )}
      </View>
      {!isSubmitted && (
        <View style={wizardStyles.section}>
          {step !== null && (
            <Button
              icon="arrow-left"
              mode="text"
              disabled={busy}
              style={{ alignSelf: 'flex-start' }}
              onPress={() => {
                setActiveItem(null);
                setStep(null);
              }}
            >
              Về 4 mục trả phòng
            </Button>
          )}
          <View style={wizardStyles.header}>
            <View style={wizardStyles.compactSummary}>
              <Text variant="titleMedium" style={wizardStyles.compactSummaryTitle}>
                {step === null ? '4 phần kiểm tra trả phòng' : sections[step]}
              </Text>
              <Pill
                tone={
                  completedSteps.every(Boolean)
                    ? sectionHasIssue.some(Boolean)
                      ? 'amber'
                      : 'green'
                    : 'blue'
                }
              >
                {completedSteps.filter(Boolean).length}/4 đã lưu
              </Pill>
            </View>
          </View>
          {step === null ? (
            <View style={wizardStyles.workList}>
              {sections.map((label, index) =>
                workEntry(
                  `section-${index}`,
                  `${index + 1}. ${label}`,
                  index === 0
                    ? `${Number(!!confirmedValues.electricityReadingId) + Number(!!confirmedValues.waterReadingId)}/2 công tơ đã lưu`
                    : index === 1
                      ? `${inspectedRooms}/7 đã kiểm tra`
                      : index === 2
                        ? groups.length
                          ? `${inspectedAssets}/${groups.length} đã kiểm tra`
                          : noAssetsConfirmed
                            ? 'Không có tài sản'
                            : 'Chưa có tài sản'
                        : openingKeyQuantity != null
                          ? `${confirmedKeyCount || '—'}/${openingKeyQuantity} chìa khóa`
                          : `${confirmedKeyCount || 'Chưa ghi'} chìa khóa`,
                  completedSteps[index]
                    ? sectionHasIssue[index]
                      ? 'Có vấn đề'
                      : 'Đã lưu'
                    : 'Chưa hoàn tất',
                  () => setStep(index),
                  completedSteps[index],
                  sectionHasIssue[index],
                ),
              )}
            </View>
          ) : (
            <View style={wizardStyles.workList}>
              {step === 0 && (
                <>
                  {!meterReady && !meterProvisionError && (
                    <Text variant="bodySmall" style={ui.muted}>
                      Đang chuẩn bị nhiệm vụ chốt công tơ điện và nước…
                    </Text>
                  )}
                  {!!meterProvisionError && (
                    <Text accessibilityRole="alert" style={ui.red}>
                      Không chuẩn bị được nhiệm vụ chốt công tơ: {meterProvisionError}
                    </Text>
                  )}
                  {meterReady && (
                    <ContractInitialMeterTasks
                      contract={contract}
                      integrated
                      purpose={2}
                      refreshRevision={meterRevision}
                      onOpenTask={(id, label, utilityType) => {
                        if (draftLoading || !draft || busy) return;
                        setError('');
                        setMeterTask({ id, label, utilityType });
                        setActiveItem('meter');
                      }}
                    />
                  )}
                  {!!meterProvisionError && (
                    <Button
                      mode="text"
                      disabled={busy}
                      onPress={() => void ensureFinalMeterTasks()}
                    >
                      Thử lại
                    </Button>
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  {roomHandoverChecks.map(({ code, label }) => {
                    const status = confirmedValues[`room.${code}.status`];
                    const notes = confirmedValues[`room.${code}.notes`];
                    const done = !!status && (status === 'Passed' || !!notes?.trim());
                    return workEntry(
                      code,
                      label,
                      '',
                      done
                        ? status === 'Issue'
                          ? 'Có vấn đề · đã lưu'
                          : 'Đã lưu'
                        : 'Chưa kiểm tra',
                      () => setActiveItem(`room:${code}`),
                      done,
                      status === 'Issue',
                    );
                  })}
                </>
              )}
              {step === 2 && (
                <>
                  {!groups.length && (
                    <Text style={ui.muted}>
                      {noAssetsConfirmed
                        ? 'Không có tài sản cần kiểm kê.'
                        : 'Không có danh sách tài sản để đối chiếu, không có nghĩa là phòng không có tài sản. Cần Owner xác nhận trước khi hoàn tất.'}
                    </Text>
                  )}
                  {groups.map((asset) => {
                    const checked = confirmedValues[`${asset.id}.checked`] === 'true';
                    const current = draft?.assets.find((item) => item.id === asset.id);
                    return workEntry(
                      asset.id,
                      asset.name,
                      '',
                      checked
                        ? assetIssue(asset, current?.condition ?? '', current?.observedQuantity)
                          ? 'Có vấn đề'
                          : 'Đã lưu kiểm kê'
                        : 'Chưa kiểm kê',
                      () => setActiveItem(`asset:${asset.id}`),
                      checked,
                      checked &&
                        !!current &&
                        assetIssue(asset, current.condition, current.observedQuantity),
                    );
                  })}
                </>
              )}
              {step === 3 &&
                workEntry(
                  'keys',
                  'Chìa khóa thu lại',
                  '',
                  keysCompleted ? (keyCountChanged ? 'Có vấn đề' : 'Đã lưu') : 'Chưa hoàn tất',
                  () => setActiveItem('keys'),
                  keysCompleted,
                  keyCountChanged,
                )}
            </View>
          )}
        </View>
      )}
      {!isSubmitted && step === null && (
        <View style={wizardStyles.section}>
          <Action
            disabled={busy || !!activeItem || !editable || !completedSteps.every(Boolean)}
            onPress={() => void submit()}
          >
            Xác nhận hoàn thành
          </Action>
        </View>
      )}
      {isSubmitted && <Text style={ui.green}>Đã gửi kết quả kiểm tra.</Text>}
      <Modal
        visible={!!activeItem && !isSubmitted}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) closeInspectionItem();
        }}
      >
        <KeyboardAvoidingView
          style={[wizardStyles.modalOverlay, compactPhone && wizardStyles.phoneModalOverlay]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[wizardStyles.modalCard, compactPhone && wizardStyles.phoneModalCard]}>
            <View style={[wizardStyles.modalHeader, compactPhone && wizardStyles.phoneModalHeader]}>
              <Row spread>
                <Text variant="titleMedium" style={wizardStyles.rowTitle}>
                  {modalTitle}
                </Text>
                <Button mode="text" disabled={busy} onPress={closeInspectionItem}>
                  Đóng
                </Button>
              </Row>
            </View>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={[
                wizardStyles.modalBody,
                compactPhone && wizardStyles.phoneModalBody,
              ]}
              keyboardShouldPersistTaps="handled"
            >
              {activeItem === 'meter' && meterTask && (
                <MeterTaskScreen
                  embedded
                  key={meterTask.id}
                  taskId={meterTask.id}
                  onReturn={() => void finishMeterTask(meterTask)}
                />
              )}
              {selectedRoomCheck && (
                <>
                  <Text variant="bodySmall" style={ui.muted}>
                    Khi bàn giao:{' '}
                    {openingRoomCheck?.status
                      ? openingRoomCheck.status === 'NotApplicable'
                        ? 'Không áp dụng'
                        : (statuses.find((status) => status.id === openingRoomCheck.status)
                            ?.label ?? openingRoomCheck.status)
                      : 'Chưa có ghi nhận'}
                    {openingRoomCheck?.notes ? ` · ${openingRoomCheck.notes}` : ''}
                  </Text>
                  <Text variant="labelMedium">Tình trạng · {selectedRoomCheck.label}</Text>
                  {compactPhone ? (
                    <View style={wizardStyles.section}>
                      {statuses.map((status) => (
                        <RadioButton.Item
                          key={status.id}
                          label={status.label}
                          value={status.id}
                          status={
                            values[`room.${selectedRoomCode}.status`] === status.id
                              ? 'checked'
                              : 'unchecked'
                          }
                          onPress={() => set(`room.${selectedRoomCode}.status`, status.id)}
                          disabled={busy || !editable}
                          mode="android"
                          color={colors.blue}
                        />
                      ))}
                    </View>
                  ) : (
                    <SegmentedButtons
                      value={values[`room.${selectedRoomCode}.status`] ?? ''}
                      onValueChange={(status) => set(`room.${selectedRoomCode}.status`, status)}
                      density="small"
                      buttons={statuses.map((status) => ({
                        value: status.id,
                        label: status.label,
                        disabled: busy || !editable,
                      }))}
                    />
                  )}
                  {values[`room.${selectedRoomCode}.status`] === 'Issue' && (
                    <Input
                      label="Lý do có vấn đề"
                      value={values[`room.${selectedRoomCode}.notes`] ?? ''}
                      onChange={(value) => set(`room.${selectedRoomCode}.notes`, value)}
                      disabled={busy || !editable}
                      multiline
                    />
                  )}
                  {photoSection(`room:${selectedRoomCode}`, 'Ảnh kiểm tra khu vực (tùy chọn)')}
                </>
              )}
              {selectedAsset && (
                <>
                  {(openingAsset(selectedAsset.id)?.handedOverQuantity != null ||
                    selectedAsset.configuredQuantity != null ||
                    selectedAsset.handedOverQuantity != null ||
                    !!selectedAsset.physicalAssets?.length) && (
                    <>
                      <Text style={ui.muted}>
                        Số lượng lúc nhận:{' '}
                        {openingAsset(selectedAsset.id)?.handedOverQuantity ?? 'Chưa có dữ liệu'}
                      </Text>
                      <Input
                        label="Số lượng lúc trả"
                        value={values[`${selectedAsset.id}.observedQuantity`] ?? ''}
                        onChange={(value) => set(`${selectedAsset.id}.observedQuantity`, value)}
                        numeric
                        disabled={busy || !editable}
                      />
                    </>
                  )}
                  <Text variant="labelMedium">Tình trạng hiện tại</Text>
                  <SegmentedButtons
                    density="small"
                    value={values[`asset-${selectedAsset.id}`] ?? ''}
                    onValueChange={(value) => set(`asset-${selectedAsset.id}`, value)}
                    buttons={[
                      { value: 'Tốt', label: 'Tốt', disabled: busy || !editable },
                      { value: 'Có vấn đề', label: 'Có vấn đề', disabled: busy || !editable },
                    ]}
                  />
                  {(values[`asset-${selectedAsset.id}`] === 'Có vấn đề' ||
                    (openingAsset(selectedAsset.id)?.handedOverQuantity != null &&
                      /^\d+$/.test(values[`${selectedAsset.id}.observedQuantity`] ?? '') &&
                      Number(values[`${selectedAsset.id}.observedQuantity`]) !==
                        openingAsset(selectedAsset.id)?.handedOverQuantity)) && (
                    <Input
                      label="Nội dung vấn đề"
                      value={values[`${selectedAsset.id}.notes`] ?? ''}
                      onChange={(value) => set(`${selectedAsset.id}.notes`, value)}
                      multiline
                      disabled={busy || !editable}
                    />
                  )}
                  {photoSection(`asset:${selectedAsset.id}`, 'Ảnh tài sản')}
                </>
              )}
              {activeItem === 'keys' && (
                <>
                  <Text style={ui.muted}>
                    Số chìa khóa lúc nhận: {openingKeyQuantity ?? 'Chưa có dữ liệu'}
                  </Text>
                  <Input
                    label="Số chìa khóa lúc trả"
                    value={keyCount}
                    onChange={(value) => set('keyQuantity', value)}
                    numeric
                    disabled={busy || !editable}
                  />
                  {photoSection('keys', 'Ảnh chìa khóa thu lại')}
                </>
              )}
              {!!error && (
                <Text accessibilityRole="alert" style={ui.red}>
                  {error}
                </Text>
              )}
              {!!notice && (
                <Text accessibilityRole="status" style={ui.green}>
                  {notice}
                </Text>
              )}
            </ScrollView>
            {activeItem !== 'meter' && (
              <View
                style={[wizardStyles.modalFooter, compactPhone && wizardStyles.phoneModalFooter]}
              >
                <View style={{ flex: 1 }}>
                  <Button mode="outlined" disabled={busy} onPress={rollbackItem}>
                    Để sau
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    mode="contained"
                    loading={busy}
                    disabled={busy}
                    onPress={() => void saveItem()}
                  >
                    Xong
                  </Button>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Box>
  );
}
