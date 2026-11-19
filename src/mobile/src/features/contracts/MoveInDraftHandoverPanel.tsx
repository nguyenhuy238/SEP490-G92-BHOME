import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, Checkbox, Icon, ProgressBar, RadioButton, SegmentedButtons, Text, TouchableRipple } from 'react-native-paper';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  guid,
  mutationKeys,
  type ContractClient,
  type ContractView,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import {
  assetInspectionInput,
  handoverAssetSummary,
  quantityFields,
} from '../../../../../packages/client-core/src/handoverForm';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Pill, Row, ui } from '../../components/WorkspaceKit';
import { Input } from '../../components/WorkflowControls';
import { CameraCapture } from '../../components/CameraCapture';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { conciseMessage } from '../../lib/toast';
import { randomUUID } from '../../lib/randomUUID';
import { canUseLocalMeterDemo, meterDemoJpegBytes } from '../../lib/meterDemoCapture';
import {
  canStaffEditMoveIn,
  canTenantRespondToMoveIn,
  moveInMissingMessage,
  moveInHandover,
  moveInAccessKinds,
  roomHandoverChecks,
  type MoveInDraft,
  type MoveInDraftInput,
  type MoveInRoomCheckCode,
  type MoveInRoomCheckStatus,
  type MoveInAccessItem,
  type MoveInAccessType,
} from '../../services/moveInHandover';
import { ContractInitialMeterTasks } from './ContractInitialMeterTasks';
import { ContractEvidence } from './ContractEvidence';
import { HandoverAssetFields } from './HandoverAssetFields';
import { MeterTaskScreen } from '../../app/meter';
import { StaffMoveInInventoryScreen } from '../../screens/StaffMoveInInventoryScreen';
import { inventoryStatusLabels, type MoveInInventory, type MoveInInventoryItem } from '../../services/moveInInventory';
import { colors } from '../../theme/theme';

const statusLabels = {
  Draft: 'Đang chuẩn bị',
  Ready: 'Sẵn sàng bàn giao',
  ChangesRequested: 'Đang xử lý yêu cầu sửa',
  Confirmed: 'Đã xác nhận bàn giao',
} as const;

const roomStatusLabels: Record<MoveInRoomCheckStatus, string> = {
  Passed: 'Đạt',
  Issue: 'Có vấn đề',
  NotApplicable: 'Không áp dụng',
};

type AccessRow = { type: MoveInAccessType; quantity: string; notes: string };

const staffSteps = [
  { title: 'Ghi chỉ số điện nước', detail: 'Chụp từng công tơ, kiểm tra OCR và xác nhận chỉ số thật.' },
  { title: 'Kiểm tra hiện trạng phòng', detail: 'Chọn kết quả thực tế cho 7 khu vực. Có vấn đề thì ghi chú và chụp ảnh.' },
  { title: 'Kiểm kê tài sản', detail: 'Kiểm kê một lần trong Đối chiếu đầu vào; danh sách bên dưới chỉ hiển thị kết quả đã lưu.' },
  { title: 'Chìa khóa và ảnh bàn giao', detail: 'Đếm chìa khóa, thẻ ra vào và bổ sung ảnh toàn cảnh trước khi lưu.' },
] as const;

const wizardStyles = StyleSheet.create({
  header: { gap: 9 },
  step: { gap: 12 },
  section: { gap: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  progress: { height: 6, borderRadius: 6, backgroundColor: colors.tint },
  divider: { height: 1, backgroundColor: colors.border },
  workList: { gap: 8 },
  workRow: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: '#ffffff',
    borderRadius: 12, padding: 14, minHeight: 66, flexShrink: 0,
  },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontWeight: '700', color: '#14213d' },
  rowDetail: { color: '#5a6a84', lineHeight: 19, flexShrink: 1 },
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(13, 26, 49, 0.62)', padding: 12,
  },
  modalCard: {
    width: '100%', maxWidth: 620, maxHeight: '93%', borderRadius: 16,
    backgroundColor: '#ffffff', overflow: 'hidden',
  },
  modalHeader: {
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8,
  },
  modalBody: { padding: 18, paddingBottom: 30, gap: 14 },
  modalFooter: {
    flexDirection: 'row', gap: 8, padding: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  phoneRoot: { padding: 12, gap: 12, minWidth: 0 },
  phoneWorkRow: { padding: 10, minHeight: 62 },
  compactTitle: { fontWeight: '700', color: '#14213d' },
  compactSummaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
  compactSummaryTitle: { flex: 1, minWidth: 0 },
  compactLocation: { flexShrink: 1, maxWidth: '60%', textAlign: 'right' },
  phoneModalOverlay: { padding: 4, justifyContent: 'flex-end' },
  phoneModalCard: { maxHeight: '100%', borderRadius: 12 },
  phoneModalHeader: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  phoneModalBody: { padding: 12, paddingBottom: 22, gap: 12 },
  phoneModalFooter: { padding: 8, gap: 6 },
  conditionOptions: { gap: 6 },
  conditionOption: { borderWidth: 1, borderRadius: 10, borderColor: colors.border, minHeight: 44 },
  conditionSelected: { backgroundColor: colors.tint, borderColor: colors.blue },
});

function hasCompleteRoomInspection(value: MoveInDraft): boolean {
  return !!value.roomCondition?.trim() && roomHandoverChecks.every(({ code }) => {
    const matches = (value.roomChecks ?? []).filter((check) => check.code === code);
    if (matches.length !== 1) return false;
    const check = matches[0]!;
    return check.status === 'Passed' ||
      (check.status === 'NotApplicable' && !!check.notes?.trim()) ||
      (check.status === 'Issue' && !!check.notes?.trim() && (check.evidenceIds ?? []).length > 0);
  });
}

function hasCompleteAssetInspection(value: MoveInDraft): boolean {
  return value.noAssetsConfirmed || (value.assets.length > 0 && value.assets.every((asset) => asset.checked));
}

function hasSavedInventoryItem(item: MoveInInventoryItem): boolean {
  return item.condition !== null && item.actualQuantity !== null && (item.evidenceIds ?? []).length > 0;
}

function hasCompleteAssetSection(value: MoveInDraft, inventory: MoveInInventory | null): boolean {
  if (!value.moveInTask?.inventoryTaskId) return hasCompleteAssetInspection(value);
  return inventory?.status === 'Completed' && inventory.contractId === value.contractId &&
    inventory.items.length === value.assets.length &&
    value.assets.every((asset) => inventory.items.some((item) => item.id === asset.id && hasSavedInventoryItem(item)));
}

function firstUnfinishedStep(value: MoveInDraft, inventory: MoveInInventory | null = null): number {
  if (!value.electricity || !value.water) return 0;
  if (!hasCompleteRoomInspection(value)) return 1;
  if (!hasCompleteAssetSection(value, inventory)) return 2;
  return 3;
}

// Synthetic test-only artwork; it never depicts a real room or a meter reading.
function handoverDemoJpeg(): Uint8Array<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không tạo được ảnh mẫu trên trình duyệt.');
  context.fillStyle = '#f1f5f9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#991b1b';
  context.font = 'bold 44px sans-serif';
  context.fillText('BHOME - ẢNH GIẢ LẬP DEV', 36, 190);
  context.font = 'bold 29px sans-serif';
  context.fillText('KHÔNG PHẢI HIỆN TRẠNG THỰC TẾ', 36, 264);
  context.font = '23px sans-serif';
  context.fillText('Chỉ dùng thử luồng ảnh bàn giao phòng', 36, 340);
  return meterDemoJpegBytes(canvas.toDataURL('image/jpeg', 0.85));
}

export function MoveInDraftHandoverPanel({
  api,
  contract,
  role,
  onUpdated,
  legacyFallback,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
  onUpdated?: () => void;
  legacyFallback?: React.ReactNode;
}) {
  const { staffLocationId, resetScroll } = useWorkspace();
  const { width } = useWindowDimensions();
  const compactPhone = width <= 380;
  const client = useMemo(() => moveInHandover(api), [api]);
  const staff = role === 'Staff' && contract.locationId === staffLocationId;
  const tenant = role === 'Tenant';
  const allowed = (staff || tenant) && contract.kind === 'Main';
  const [response, setResponse] = useState<{
    key: string;
    record: MoveInDraft | null;
    error: string;
    notFound: boolean;
    documents: PreviewDocument[];
    documentsError: string;
    inventory: MoveInInventory | null;
    inventoryError: string;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [meterTask, setMeterTask] = useState<{ id: string; label: string } | null>(null);
  const modalScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const loadedWizardContract = useRef('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [evidencePool, setEvidencePool] = useState<string[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [roomChecksTouched, setRoomChecksTouched] = useState<string[]>([]);
  const [accessItems, setAccessItems] = useState<AccessRow[]>([]);
  const [accessItemsTouched, setAccessItemsTouched] = useState(false);
  const [photoSafe, setPhotoSafe] = useState(false);
  const [feedback, setFeedback] = useState({ version: -1, note: '', acknowledged: false });
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));

  useFocusEffect(useCallback(() => {
    setRevision((value) => value + 1);
  }, []));

  const key = `${contract.id}:${contract.locationId}:${role}:${revision}`;
  const current = response?.key === key ? response : null;
  const loading = allowed && !current;
  const error = actionError || current?.error || '';
  const draft = allowed ? (current?.record ?? null) : null;
  const inventory = current?.inventory ?? null;
  const started = canStaffEditMoveIn(draft);
  const checkedRooms = (draft?.roomChecks ?? []).length;
  const checkedAssets = draft?.moveInTask?.inventoryTaskId
    ? draft.assets.filter((asset) => inventory?.items.some((item) => item.id === asset.id && hasSavedInventoryItem(item))).length
    : (draft?.assets ?? []).filter((asset) => asset.checked).length;
  const inspectionIssues = (draft?.roomChecks ?? []).filter((check) => check.status === 'Issue');
  const savedWizardSteps = draft ? [
    !!draft.electricity && !!draft.water,
    hasCompleteRoomInspection(draft),
    hasCompleteAssetSection(draft, inventory),
    !!draft.keysAndAccess?.trim() && (draft.accessItems ?? []).length > 0 && (draft.evidenceIds ?? []).length > 0,
  ] : [false, false, false, false];
  const recommendedStep = draft ? firstUnfinishedStep(draft, inventory) : 0;
  const availableEvidence = [
    ...new Set([
      ...selectedEvidence,
      ...evidencePool,
      ...(draft?.assets.flatMap((asset) => asset.evidenceIds ?? []) ?? []),
      ...(draft?.roomChecks ?? []).flatMap((check) => check.evidenceIds ?? []),
    ]),
  ];
  const assetEvidence = new Set([
    ...(draft?.assets.flatMap((asset) => asset.evidenceIds ?? []) ?? []),
    ...availableEvidence.filter((id) =>
      draft?.assets.some((asset) => values[`${asset.id}.evidence.${id}`] === 'true')),
  ]);
  const attachedEvidence = new Set([
    ...(draft?.evidenceIds ?? []),
    ...(draft?.assets.flatMap((asset) => asset.evidenceIds ?? []) ?? []),
    ...(draft?.roomChecks ?? []).flatMap((check) => check.evidenceIds ?? []),
  ]);
  const canUploadSample = staff && contract.isDevelopmentDemo === true &&
    canUseLocalMeterDemo(
      typeof __DEV__ !== 'undefined' && __DEV__,
      Platform.OS,
      globalThis.location?.hostname,
      globalThis.location?.port,
    );
  const set = (name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    if (value === 'true' && name.includes('.evidence.')) {
      const evidenceId = name.split('.evidence.')[1];
      if (evidenceId) setSelectedEvidence((previous) => previous.filter((id) => id !== evidenceId));
    }
  };
  const setRoomCheck = (code: MoveInRoomCheckCode, field: string, value: string) => {
    setValues((previous) => ({ ...previous, [`roomCheck.${code}.${field}`]: value }));
    setRoomChecksTouched((previous) => previous.includes(code) ? previous : [...previous, code]);
  };
  const updateAccessItem = (index: number, field: keyof AccessRow, value: string) => {
    setAccessItems((previous) => previous.map((item, position) =>
      position === index ? { ...item, [field]: value } : item));
    setAccessItemsTouched(true);
  };

  useEffect(() => {
    if (!allowed || !revision) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const value = await client.get(contract.id, controller.signal);
        let inventory: MoveInInventory | null = null;
        let inventoryError = '';
        if (staff && value.moveInTask?.inventoryTaskId) {
          try {
            const taskId = guid(value.moveInTask.inventoryTaskId);
            const result = await api.transport<MoveInInventory>(
              `/api/v1/operational-tasks/${taskId}/move-in-inventory`, { signal: controller.signal });
            if (result.taskId !== taskId || result.contractId !== contract.id)
              throw new Error('Kết quả kiểm kê không thuộc hợp đồng này.');
            inventory = result;
          } catch (cause) {
            if (controller.signal.aborted) return;
            inventoryError = cause instanceof Error && !('status' in cause)
              ? cause.message : conciseMessage(contractError(cause));
          }
        }
        if (staff && loadedWizardContract.current !== contract.id) {
          loadedWizardContract.current = contract.id;
          setWizardStep(firstUnfinishedStep(value, inventory));
        }
        let documents: PreviewDocument[] = [];
        let documentsError = '';
        if (value.status === 'Confirmed') {
          try {
            // The endpoint also returns move-out and asset-change documents, possibly from
            // prior contracts in the lineage. Only this Main's immutable MoveIn PDF applies.
            const files = await api.handoverDocuments(contract.id, controller.signal);
            documents = files
              .filter((file) => file.kind === 'MoveInReport' && file.contractId === contract.id)
              .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
              .slice(0, 1);
          } catch (cause) {
            documentsError = conciseMessage(contractError(cause));
          }
        }
        if (!controller.signal.aborted) {
          setResponse({ key, record: value, error: '', notFound: false, documents, documentsError, inventory, inventoryError });
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          const notFound = typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 404;
          setResponse({
            key,
            record: null,
            error: notFound ? '' : conciseMessage(contractError(cause)),
            notFound,
            documents: [],
            documentsError: '',
            inventory: null,
            inventoryError: '',
          });
        }
      }
    })();
    return () => controller.abort();
  }, [allowed, api, client, contract.id, key, revision, staff]);

  const note = feedback.version === draft?.version ? feedback.note : '';
  const acknowledged = feedback.version === draft?.version && feedback.acknowledged;
  const setNote = (next: string) =>
    setFeedback((value) => ({
      version: draft?.version ?? -1,
      note: next,
      acknowledged: value.version === draft?.version && value.acknowledged,
    }));
  const setAcknowledged = (next: boolean) =>
    setFeedback((value) => ({
      version: draft?.version ?? -1,
      note: value.version === draft?.version ? value.note : '',
      acknowledged: next,
    }));

  async function run(command: () => Promise<unknown>, success: string, refresh = true) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await command();
      setNotice(success);
      // Evidence uploads do not mutate the draft. Reloading at this point
      // would unmount the active modal and interrupt the Staff's inspection.
      if (refresh) {
        setRevision((value) => value + 1);
        onUpdated?.();
      }
    } catch (cause) {
      setActionError(cause instanceof Error && !('status' in cause) ? cause.message : conciseMessage(contractError(cause)));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function beginEdit() {
    if (!draft || !canStaffEditMoveIn(draft)) return;
    setValues({
      roomCondition: draft.roomCondition || '',
      keysAndAccess: draft.keysAndAccess || '',
      notes: draft.notes || '',
      ...Object.fromEntries((draft.roomChecks ?? []).flatMap((check) => [
        [`roomCheck.${check.code}.status`, check.status],
        [`roomCheck.${check.code}.notes`, check.notes || ''],
        ...(check.evidenceIds ?? []).map((id) => [`roomCheck.${check.code}.evidence.${id}`, 'true']),
      ])),
      ...Object.fromEntries(draft.assets.flatMap((asset) => [
        [`asset-${asset.id}`, asset.observedCondition || ''],
        ...quantityFields.map(([name]) => [
          `${asset.id}.${name}`,
          asset[name] == null ? '' : String(asset[name]),
        ]),
        [`${asset.id}.checked`, asset.checked ? 'true' : 'false'],
        [`${asset.id}.notes`, asset.notes || ''],
        ...(asset.evidenceIds ?? []).map((id) => [`${asset.id}.evidence.${id}`, 'true']),
        ...(asset.physicalObservations ?? []).flatMap((item) => [
          [`${item.id}.physicalQuantity`, String(item.quantity)],
          [`${item.id}.physicalCondition`, item.condition],
          [`${item.id}.physicalHandedOverQuantity`, item.handedOverQuantity == null ? '' : String(item.handedOverQuantity)],
        ]),
      ])),
    });
    setSelectedEvidence(draft.evidenceIds ?? []);
    setEvidencePool([
      ...new Set([
        ...(draft.evidenceIds ?? []),
        ...draft.assets.flatMap((asset) => asset.evidenceIds ?? []),
        ...(draft.roomChecks ?? []).flatMap((check) => check.evidenceIds ?? []),
      ]),
    ]);
    setRoomChecksTouched([]);
    setAccessItems((draft.accessItems ?? []).map((item) => ({
      type: item.type,
      quantity: String(item.quantity),
      notes: item.notes || '',
    })));
    setAccessItemsTouched(false);
    setPhotoSafe(false);
    setEditing(true);
  }

  async function saveDraft() {
    if (!draft || !canStaffEditMoveIn(draft)) return;
    const touchedChecks = roomHandoverChecks.filter((check) => roomChecksTouched.includes(check.code));
    const roomChecks: NonNullable<MoveInDraftInput['roomChecks']> = touchedChecks.map(({ code, label }) => {
      const status = values[`roomCheck.${code}.status`] as MoveInRoomCheckStatus | undefined;
      const notes = (values[`roomCheck.${code}.notes`] ?? '').trim();
      const evidenceIds = availableEvidence.filter((id) =>
        values[`roomCheck.${code}.evidence.${id}`] === 'true');
      if (!status) throw new Error(`Hãy chọn kết quả kiểm tra: ${label}.`);
      if (status !== 'Passed' && !notes) {
        throw new Error(`Hãy ghi lý do cho mục "${label}".`);
      }
      if (status === 'Issue' && !evidenceIds.length) {
        throw new Error(`Mục "${label}" có vấn đề cần gắn ít nhất một ảnh bằng chứng riêng.`);
      }
      if (evidenceIds.length > 5) {
        throw new Error(`Mục "${label}" chỉ được gắn tối đa 5 ảnh.`);
      }
      return { code, status, notes, evidenceIds };
    });
    let validatedAccessItems: MoveInAccessItem[] | undefined;
    if (accessItemsTouched) {
      validatedAccessItems = accessItems.map((item, index) => {
        const type = item.type;
        const notes = item.notes.trim();
        const quantity = Number(item.quantity);
        if (!moveInAccessKinds.some((kind) => kind.type === type) || !item.quantity.trim() ||
          !Number.isInteger(quantity) || quantity < 0 || quantity > 100 ||
          (quantity === 0 && (type !== 'DigitalAccess' || !notes)) ||
          (type === 'Other' && !notes)) {
          throw new Error(`Dòng bàn giao quyền ra vào ${index + 1}: số lượng phải từ 1–100; quyền truy cập số có thể bằng 0 nếu có ghi chú, và loại khác cần mô tả.`);
        }
        return { type, quantity, notes };
      });
      if (new Set(validatedAccessItems.map((item) => item.type)).size !== validatedAccessItems.length) {
        throw new Error('Mỗi loại chìa khóa, thẻ hoặc quyền ra vào chỉ được kê một dòng.');
      }
    }
    // Unchecked groups remain untouched. Each checked group can be saved separately.
    const checkedAssets = draft.assets.filter((asset) => values[`${asset.id}.checked`] === 'true');
    const input: MoveInDraftInput = {
      version: draft.version,
      roomCondition: values.roomCondition?.trim(),
      keysAndAccess: values.keysAndAccess?.trim(),
      notes: values.notes?.trim(),
      ...(touchedChecks.length ? { roomChecks } : {}),
      ...(validatedAccessItems ? { accessItems: validatedAccessItems } : {}),
      ...(checkedAssets.length ? {
        assets: checkedAssets.map((asset) => ({
          ...assetInspectionInput(asset, values, availableEvidence, !!draft.inventoryToken),
          checked: true,
          notes: values[`${asset.id}.notes`] ?? '',
          evidenceIds: availableEvidence.filter((id) => values[`${asset.id}.evidence.${id}`] === 'true'),
        })),
        inventoryToken: draft.inventoryToken,
      } : {}),
      evidenceIds: selectedEvidence,
    };
    const key = keys.get('draft', input);
    await client.save(contract.id, input, key);
    keys.confirmed('draft', input);
    setEditing(false);
    setActiveItem(null);
    // Keep Staff inside the current section after saving an individual check.
    // The modal closes, while the refreshed server version is rehydrated when
    // they open the next check. Returning to the four-section menu is explicit.
  }

  async function tenantDecision(correction: boolean) {
    if (!draft) return;
    const operation = correction ? 'correction' : 'confirmation';
    const input = { version: draft.version, note: note.trim() };
    const key = keys.get(operation, input);
    if (correction) await client.requestCorrection(contract.id, draft.version, input.note, key);
    else await client.confirm(contract.id, draft.version, input.note, key);
    keys.confirmed(operation, input);
    setFeedback({ version: -1, note: '', acknowledged: false });
  }

  async function beginWork() {
    if (!staff || draft?.status !== 'Draft' || draft.moveInTask?.status !== 'Assigned') return;
    const input = { taskId: draft.moveInTask.id, version: draft.moveInTask.version };
    const key = keys.get('start-move-in', input);
    await client.beginWork(draft.moveInTask, key);
    keys.confirmed('start-move-in', input);
  }

  function goToStep(next: number) {
    if (!started || busy || next < 0 || next >= staffSteps.length) return;
    if (next !== 0 && !editing) beginEdit();
    setWizardStep(next);
    setSectionOpen(true);
    setActiveItem(null);
    if (compactPhone) resetScroll?.();
  }
  function closeItem() {
    if (busy) return;
    const legacyInventory = activeItem === 'legacy-inventory';
    setActiveItem(null);
    if (legacyInventory) setRevision((value) => value + 1);
  }

  async function uploadInspectionPhoto(bytes: Uint8Array<ArrayBuffer>, assetPhoto: boolean, targetId?: string) {
    if (!started) throw new Error('Hãy bắt đầu công việc trước khi chụp ảnh kiểm kê.');
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá 5 MB.');
    const file = await client.uploadEvidence(contract.id, bytes, 'image/jpeg');
    setEvidencePool((items) => [...new Set([...items, file.id])]);
    // A photo taken for a specific room/asset check stays attached to that
    // check, not also counted as an unrelated general handover photo.
    if (!assetPhoto && !targetId)
      setSelectedEvidence((items) => [...new Set([...items, file.id])]);
    // When a specific inspection form opened the camera, link the uploaded
    // evidence to that same form immediately. Staff must not hunt through a
    // shared image pool or accidentally attach it to another asset.
    if (assetPhoto && targetId) set(`${targetId}.evidence.${file.id}`, 'true');
    if (!assetPhoto && targetId)
      setRoomCheck(targetId as MoveInRoomCheckCode, 'evidence.' + file.id, 'true');
    setPhotoSafe(false);
  }

  // The returned camera callback only reads the mutation lock after the user
  // confirms a capture; this helper is evaluated during render, not the callback.
  function photoCapture(kind: 'room' | 'asset' | 'general' | 'access', targetId?: string) {
    const assetPhoto = kind === 'asset';
    return (
      <View style={wizardStyles.section}>
        <Heading
          title={assetPhoto ? 'Ảnh kiểm kê tài sản' : kind === 'room' ? 'Ảnh hiện trạng phòng' : kind === 'access' ? 'Ảnh chìa khóa / quyền ra vào' : 'Ảnh bàn giao chung'}
          detail={assetPhoto
            ? 'Ảnh tải lên tại phiếu này sẽ được gắn ngay vào đúng tài sản.'
            : kind === 'room'
              ? 'Ảnh chụp trong phiếu khu vực được tự động gắn vào khu vực đang kiểm tra.'
              : kind === 'access'
                ? 'Ảnh này được lưu trong bằng chứng bàn giao chung, không gắn riêng từng loại quyền truy cập.'
                : 'Chụp ít nhất một ảnh toàn cảnh, rõ phòng và không có giấy tờ cá nhân.'}
        />
        <Checkbox.Item
          label="Ảnh không có giấy tờ cá nhân hoặc thông tin riêng tư"
          status={photoSafe ? 'checked' : 'unchecked'}
          onPress={() => setPhotoSafe((value) => !value)}
          disabled={busy}
        />
        <CameraCapture
          label={assetPhoto ? 'Chụp ảnh tài sản' : kind === 'access' ? 'Chụp ảnh chìa khóa / thẻ' : 'Chụp ảnh hiện trạng bàn giao'}
          reviewBeforeSubmit
          reviewActionLabel="Dùng ảnh này làm bằng chứng bàn giao"
          reviewNotice="Kiểm tra đúng phòng, đủ rõ và không chứa giấy tờ cá nhân trước khi tải lên."
          disabled={busy || !photoSafe || availableEvidence.length >= 10}
          onCapture={(bytes) => run(
            () => uploadInspectionPhoto(bytes, assetPhoto, targetId),
            assetPhoto ? 'Đã tải và gắn ảnh vào phiếu tài sản.' : 'Đã tải ảnh hiện trạng lên máy chủ.',
            false,
          )}
        />
        {canUploadSample && (
          <Action secondary disabled={busy || !photoSafe || availableEvidence.length >= 10}
            onPress={() => void run(async () => {
              if (!canUploadSample) return;
              const bytes = handoverDemoJpeg();
              try {
                await uploadInspectionPhoto(bytes, assetPhoto, targetId);
              } finally {
                bytes.fill(0);
              }
            }, 'Đã tải ảnh giả lập DEV lên biên bản test.', false)}>
            Ảnh giả lập DEV – không dùng làm bằng chứng thực tế
          </Action>
        )}
        {kind === 'general' && availableEvidence.length > 0 && (
          <View style={wizardStyles.section}>
            <Text variant="titleSmall">Ảnh đã tải lên</Text>
            {availableEvidence.map((id, index) => (
              <View key={id} style={wizardStyles.section}>
                {attachedEvidence.has(id) ? (
                  <ContractEvidence api={api} contractId={contract.id} evidenceId={id}
                    draftHandoverEvidence label={`Xem ảnh hiện trạng ${index + 1}`} />
                ) : (
                  <Text style={ui.muted}>Ảnh {index + 1} đã tải lên. Lưu tiến độ để gắn vào biên bản.</Text>
                )}
                <Checkbox.Item
                  label={assetEvidence.has(id)
                    ? `Ảnh ${index + 1} đã gắn riêng cho tài sản`
                    : `Dùng ảnh ${index + 1} làm ảnh bàn giao chung`}
                  status={selectedEvidence.includes(id) ? 'checked' : 'unchecked'}
                  disabled={busy || assetEvidence.has(id)}
                  onPress={() => setSelectedEvidence((items) =>
                    items.includes(id) ? items.filter((item) => item !== id) : [...items, id])}
                />
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  function workEntry(
    id: string, title: string, detail: string, status: string,
    onPress: () => void, done = false,
  ) {
    return (
      <TouchableRipple key={id} accessibilityRole="button"
        accessibilityLabel={title} disabled={busy} onPress={onPress}
        style={[wizardStyles.workRow, compactPhone && wizardStyles.phoneWorkRow]}>
        <View style={wizardStyles.rowContent}>
          <Icon source={done ? 'check-circle-outline' : 'clipboard-text-outline'}
            size={23} color={done ? colors.green : colors.blue} />
          <View style={wizardStyles.rowText}>
            <Text variant="titleSmall" style={wizardStyles.rowTitle}>{title}</Text>
            <Text variant="bodySmall" style={wizardStyles.rowDetail}>{detail}</Text>
            <Text variant="labelSmall" style={done ? ui.green : ui.muted}>{status}</Text>
          </View>
          <Icon source="chevron-right" size={22} color={colors.blue} />
        </View>
      </TouchableRipple>
    );
  }

  const selectedRoomCode = activeItem?.startsWith('room:')
    ? activeItem.slice(5) as MoveInRoomCheckCode : null;
  const selectedRoomCheck = roomHandoverChecks.find((check) => check.code === selectedRoomCode);
  const selectedAsset = activeItem?.startsWith('asset:')
    ? draft?.assets.find((asset) => asset.id === activeItem.slice(6)) : undefined;
  const selectedAccessType = activeItem?.startsWith('access:') ? activeItem.slice(7) : null;
  const selectedAccessIndex = selectedAccessType
    ? accessItems.findIndex((item) => item.type === selectedAccessType) : -1;
  const selectedAccess = selectedAccessIndex >= 0 ? accessItems[selectedAccessIndex] : null;
  const modalTitle = activeItem === 'meter' ? `Ghi chỉ số ${meterTask?.label.toLocaleLowerCase('vi') ?? 'công tơ'}` :
    activeItem === 'legacy-inventory' ? 'Kiểm kê đầu vào của hợp đồng' :
    activeItem === 'room-summary' ? 'Hiện trạng tổng quan' :
      selectedRoomCheck?.label ?? selectedAsset?.name ??
      (activeItem === 'access-summary' ? 'Thông tin bàn giao' :
        activeItem === 'add-access' ? 'Chọn loại quyền ra vào' :
          selectedAccessType ? moveInAccessKinds.find((kind) => kind.type === selectedAccessType)?.label ?? 'Quyền ra vào' :
            activeItem === 'room-photo' ? 'Ảnh hiện trạng phòng' :
              activeItem === 'general-photo' ? 'Ảnh bàn giao chung' : '');

  if (!allowed) return <Text>Không thể mở biên bản của cơ sở hoặc tài khoản này.</Text>;
  if (current?.notFound && legacyFallback) return <>{legacyFallback}</>;

  return (
    <Box style={compactPhone && staff ? wizardStyles.phoneRoot : undefined}>
      {compactPhone && staff ? (
        <View style={wizardStyles.section}>
          <Text variant="titleMedium" style={wizardStyles.compactTitle}>
            Kiểm tra bàn giao · phòng {draft?.roomNumber ?? contract.roomNumber ?? ''}
          </Text>
          <Text variant="bodySmall" style={ui.muted}>Điện nước, hiện trạng, tài sản và chìa khóa</Text>
        </View>
      ) : <Heading
        title={staff ? `Kiểm tra bàn giao · phòng ${draft?.roomNumber ?? contract.roomNumber ?? ''}` : 'Biên bản bàn giao phòng'}
        detail={staff ? 'Một công việc: điện nước, hiện trạng, tài sản và chìa khóa' : 'Tổng hợp từ hợp đồng, công tơ và kiểm kê thực tế'}
      />}
      {loading && <Text>Đang tải biên bản bàn giao…</Text>}
      {!loading && !draft && !error && (
        <Text>Chưa tìm thấy biên bản nháp cho hợp đồng này. Hãy yêu cầu Owner kiểm tra.</Text>
      )}
      {staff && draft && (
        <View style={wizardStyles.section}>
          <View style={wizardStyles.compactSummaryRow}>
            <Pill tone={draft.status === 'Confirmed' ? 'green' : draft.status === 'Ready' ? 'blue' : 'amber'}>
              {statusLabels[draft.status] ?? draft.status}
            </Pill>
            <Text style={[ui.muted, wizardStyles.compactLocation]}>{draft.locationName}</Text>
          </View>
          {draft.status === 'Draft' && draft.moveInTask?.status === 'Assigned' && (
            <>
              <Text variant="titleMedium">Chưa bắt đầu công việc</Text>
              <Text style={ui.muted}>Bắt đầu một lần để mở 4 mục kiểm tra. Bạn được chọn mục cần làm, ghi nhận thực tế và lưu riêng từng lần. Owner chịu trách nhiệm quyết định xử lý.</Text>
              <Action disabled={busy || loading} onPress={() => void run(beginWork, 'Đã bắt đầu công việc. Bạn có thể kiểm tra phòng và công tơ.')}>
                Bắt đầu công việc
              </Action>
            </>
          )}
          {draft.status === 'Draft' && !started && draft.moveInTask?.status !== 'Assigned' && (
            <Text style={ui.muted}>Chưa thể ghi nhận. Nhiệm vụ bàn giao cần được phân công và bắt đầu đúng trạng thái.</Text>
          )}
          {!!error && !activeItem && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
          {!!notice && !activeItem && <Text style={ui.green}>{notice}</Text>}
          {started && (
            <View style={wizardStyles.step}>
              {sectionOpen && (
                <Button icon="arrow-left" mode="text" disabled={busy}
                  style={{ alignSelf: 'flex-start' }}
                  onPress={() => {
                    setSectionOpen(false);
                    if (compactPhone) resetScroll?.();
                  }}>
                  Về 4 mục bàn giao
                </Button>
              )}
              <View style={wizardStyles.header}>
                <View style={wizardStyles.compactSummaryRow}>
                  <Text variant="titleMedium" style={wizardStyles.compactSummaryTitle}>
                    {sectionOpen ? staffSteps[wizardStep]!.title : '4 mục bàn giao phòng'}
                  </Text>
                  <Pill tone={savedWizardSteps.every(Boolean) ? 'green' : 'blue'}>
                    {savedWizardSteps.filter(Boolean).length}/4 đã ghi nhận
                  </Pill>
                </View>
                {!sectionOpen && (
                  <>
                    <ProgressBar progress={savedWizardSteps.filter(Boolean).length / staffSteps.length}
                      color={colors.blue} style={wizardStyles.progress} />
                    <Text variant="bodySmall" style={[ui.muted, { lineHeight: 20 }]}>
                      {savedWizardSteps.every(Boolean)
                        ? 'Đã lưu đủ 4 mục kiểm tra. Owner sẽ tiếp tục xem xét các điều kiện bàn giao.'
                        : `Chọn một mục để làm việc. Gợi ý tiếp theo: ${staffSteps[recommendedStep]!.title}.`}
                    </Text>
                  </>
                )}
              </View>
              {!sectionOpen ? (
                <View style={wizardStyles.workList}>
                  {staffSteps.map((step, index) => workEntry(
                    `section-${index}`,
                    `${index + 1}. ${step.title}`,
                    index === 0 ? `${Number(!!draft.electricity) + Number(!!draft.water)}/2 công tơ đã xác nhận` :
                      index === 1 ? `${checkedRooms}/7 khu vực đã kiểm tra` :
                        index === 2 ? `${checkedAssets}/${draft.assets.length} nhóm tài sản đã kiểm tra` :
                          `${(draft.accessItems ?? []).length} loại quyền ra vào · ${draft.evidenceIds.length} ảnh chung`,
                    savedWizardSteps[index] ? 'Đã lưu đủ' : index === recommendedStep ? 'Nên làm tiếp' : 'Chưa hoàn tất',
                    () => goToStep(index),
                    savedWizardSteps[index],
                  ))}
                </View>
              ) : (
                <View style={wizardStyles.section}>
                  {wizardStep === 0 && (
                    <>
                      <ContractInitialMeterTasks contract={contract} integrated refreshRevision={revision}
                        onOpenTask={(id, label) => {
                        setMeterTask({ id, label });
                        setActiveItem('meter');
                      }} />
                      <Text variant="bodySmall" style={ui.muted}>
                        Mở từng công tơ để chụp OCR, đối chiếu và xác nhận. Bạn có thể làm các mục khác trước; Owner chỉ duyệt khi điện nước đủ.
                      </Text>
                    </>
                  )}
                  {wizardStep === 1 && (
                    <View style={wizardStyles.workList}>
                      {workEntry('room-condition', 'Hiện trạng tổng quan',
                        draft.roomCondition || 'Ghi mô tả chung về phòng', 'Mở phiếu ghi nhận',
                        () => setActiveItem('room-summary'), !!draft.roomCondition)}
                      {roomHandoverChecks.map(({ code, label }) => {
                        const check = (draft.roomChecks ?? []).find((item) => item.code === code);
                        return workEntry(code, label, check?.notes || 'Kiểm tra thực tế và chụp ảnh nếu có vấn đề',
                          check ? roomStatusLabels[check.status] : 'Chưa kiểm tra',
                          () => setActiveItem(`room:${code}`), !!check);
                      })}
                      {workEntry('room-photo', 'Ảnh hiện trạng phòng',
                        'Chụp và gắn bằng chứng cho mục có vấn đề', 'Mở máy ảnh',
                        () => setActiveItem('room-photo'))}
                      {inspectionIssues.length > 0 && (
                        <Text style={ui.red}>{inspectionIssues.length} khu vực có vấn đề. Owner xem ghi chú và ảnh để quyết định xử lý.</Text>
                      )}
                    </View>
                  )}
                  {wizardStep === 2 && (
                    <View style={wizardStyles.workList}>
                      {draft.moveInTask?.inventoryTaskId && workEntry('legacy-inventory',
                        'Đối chiếu kiểm kê đầu vào',
                        'Chọn từng tài sản để kiểm tra và lưu kết quả.',
                        draft.moveInTask.inventoryStatus === 'Completed'
                          ? 'Đã hoàn tất' : 'Cần hoàn thành',
                        () => setActiveItem('legacy-inventory'),
                        draft.moveInTask.inventoryStatus === 'Completed')}
                      {draft.moveInTask?.inventoryTaskId && (
                        <Text variant="bodySmall" style={[ui.muted, { lineHeight: 20, flexShrink: 0 }]}>
                          Bên dưới chỉ theo dõi kết quả đã lưu trên máy chủ.
                        </Text>
                      )}
                      {draft.moveInTask?.inventoryTaskId && !!current?.inventoryError && (
                        <View style={wizardStyles.section}>
                          <Text accessibilityRole="alert" style={ui.red}>
                            Không tải được trạng thái kiểm kê: {current.inventoryError}
                          </Text>
                        </View>
                      )}
                      {draft.assets.length === 0 && (
                        <Text style={ui.muted}>{draft.noAssetsConfirmed
                          ? 'Owner đã xác nhận phòng không có tài sản.'
                          : 'Chưa có danh sách tài sản; cần Owner kiểm tra cấu hình.'}</Text>
                      )}
                      {draft.moveInTask?.inventoryTaskId ? (
                        draft.assets.map((asset) => {
                          const item = inventory?.items.find((entry) => entry.id === asset.id);
                          const saved = !!item && hasSavedInventoryItem(item);
                          return (
                            <View key={asset.id} style={[wizardStyles.workRow, compactPhone && wizardStyles.phoneWorkRow]}>
                              <View style={wizardStyles.rowContent}>
                                <Icon source={saved ? 'check-circle-outline' : 'checkbox-blank-circle-outline'}
                                  size={23} color={saved ? colors.green : colors.blue} />
                                <View style={wizardStyles.rowText}>
                                  <Text variant="titleSmall" style={wizardStyles.rowTitle}>{asset.name}</Text>
                                  <Text variant="bodySmall" style={wizardStyles.rowDetail}>
                                    {item
                                      ? `Dự kiến ${item.expectedQuantity} · Thực tế ${item.actualQuantity ?? 'chưa ghi'}`
                                      : `Dự kiến ${asset.configuredQuantity ?? 'chưa rõ'} ${asset.unit ?? 'đơn vị'}`}
                                  </Text>
                                  <Text variant="labelSmall" style={saved ? ui.green : ui.muted}>
                                    {saved
                                      ? `Đã kiểm kê · ${inventoryStatusLabels[item!.condition!]}`
                                      : 'Chưa kiểm kê'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          );
                        })
                      ) : draft.assets.map((asset) => workEntry(asset.id, asset.name,
                        asset.configuredQuantity == null ? 'Đối chiếu tình trạng thực tế' :
                          `Cần đối chiếu ${asset.configuredQuantity} ${asset.unit ?? 'đơn vị'}`,
                        asset.checked ? 'Đã kiểm tra' : 'Chưa kiểm tra',
                        () => setActiveItem(`asset:${asset.id}`), asset.checked))}
                    </View>
                  )}
                  {wizardStep === 3 && (
                    <View style={wizardStyles.workList}>
                      {workEntry('access-summary', 'Ghi chú bàn giao',
                        draft.keysAndAccess || 'Tình trạng chìa khóa, quyền ra vào', 'Mở phiếu ghi nhận',
                        () => setActiveItem('access-summary'), !!draft.keysAndAccess)}
                      {accessItems.map((item) => workEntry(item.type,
                        moveInAccessKinds.find((kind) => kind.type === item.type)?.label ?? item.type,
                        `Số lượng ${item.quantity || 'chưa nhập'} · ${item.notes || 'Chưa có ghi chú'}`,
                        'Mở để chỉnh sửa', () => setActiveItem(`access:${item.type}`)))}
                      {workEntry('add-access', 'Thêm chìa khóa / thẻ / quyền truy cập',
                        'Chọn loại và ghi nhận số lượng bàn giao', 'Thêm loại',
                        () => setActiveItem('add-access'))}
                      {workEntry('general-photo', 'Ảnh bàn giao chung',
                        `${draft.evidenceIds.length} ảnh đã lưu trên biên bản`,
                        'Mở phiếu ảnh', () => setActiveItem('general-photo'),
                        draft.evidenceIds.length > 0)}
                    </View>
                  )}
                  <Text variant="bodySmall" style={ui.muted}>
                    Thông tin chỉ được lưu trên máy chủ sau khi bấm Lưu trong phiếu. Chuyển mục không tự phát hành biên bản.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
      {draft && !editing && tenant && (
        <>
          <Row spread>
            <Pill tone={draft.status === 'Confirmed' ? 'green' : draft.status === 'Ready' ? 'blue' : 'amber'}>
              {statusLabels[draft.status] ?? draft.status}
            </Pill>
            <Text>Phiên bản {draft.version}</Text>
          </Row>
          <Text>Phòng {draft.roomNumber} · {draft.locationName}</Text>
          {!!draft.locationAddress && <Text>{draft.locationAddress}</Text>}
          <Text>Hợp đồng: {displayContractDate(draft.startDate)} – {displayContractDate(draft.endDate)}</Text>
          {tenant && (
            <Text>Giá thuê: {formatContractMoney(String(draft.monthlyRent))} / tháng · Cọc: {formatContractMoney(String(draft.requiredDeposit))}</Text>
          )}
          {tenant && !!draft.terms && <Text>Điều khoản: {draft.terms}</Text>}
          <Text>Hiện trạng phòng: {draft.roomCondition || 'Chưa kiểm tra'}</Text>
          <Text>Chìa khóa / quyền ra vào: {draft.keysAndAccess || 'Chưa kiểm tra'}</Text>
          {!!draft.notes && <Text>Ghi chú: {draft.notes}</Text>}
          <Heading title="Kiểm tra hiện trạng (7 mục)" detail="Ghi nhận kết quả, ghi chú và ảnh của từng khu vực" />
          {roomHandoverChecks.map(({ code, label }) => {
            const check = (draft.roomChecks ?? []).find((item) => item.code === code);
            return (
              <Box key={code} style={ui.soft}>
                <Row spread>
                  <Text>{label}</Text>
                  <Pill tone={check?.status === 'Passed' ? 'green' : check?.status === 'Issue' ? 'red' : 'neutral'}>
                    {check ? roomStatusLabels[check.status] : 'Chưa kiểm tra'}
                  </Pill>
                </Row>
                {!!check?.notes && <Text>{check.notes}</Text>}
                {(check?.evidenceIds ?? []).map((id, index) => (
                  <ContractEvidence key={id} api={api} contractId={contract.id}
                    evidenceId={id} draftHandoverEvidence label={`Xem ảnh ${label} · ${index + 1}`} />
                ))}
              </Box>
            );
          })}
          <Heading title="Vật dụng và quyền ra vào" />
          {(draft.accessItems ?? []).length ? (draft.accessItems ?? []).map((item, index) => (
            <Text key={index}>{moveInAccessKinds.find((kind) => kind.type === item.type)?.label ?? item.type}: {item.quantity} · {item.notes || 'Không có ghi chú'}</Text>
          )) : <Text>Chưa kê khai chìa khóa, thẻ hay quyền truy cập.</Text>}
          {(draft.outstandingIssues ?? []).length > 0 && <Heading title="Ghi nhận liên quan" />}
          {(draft.outstandingIssues ?? []).length ? (draft.outstandingIssues ?? []).map((issue, index) => (
            <Text key={`${issue.code}-${index}`}>
              {roomHandoverChecks.find((check) => check.code === issue.code)?.label ?? issue.code}:
              {' '}{issue.description}
            </Text>
          )) : null}
          <Text>Điện khởi tạo: {draft.electricity ? `${draft.electricity.value} kWh` : 'Chưa xác nhận'}</Text>
          <Text>Nước khởi tạo: {draft.water ? `${draft.water.value} m³` : 'Chưa xác nhận'}</Text>
          {draft.electricity && <ContractEvidence api={api} contractId={contract.id} readingId={draft.electricity.id} label="Mở hoặc lưu ảnh công tơ điện" />}
          {draft.water && <ContractEvidence api={api} contractId={contract.id} readingId={draft.water.id} label="Mở hoặc lưu ảnh công tơ nước" />}
          <Heading title={`Tài sản bàn giao (${draft.assets.length})`} />
          {draft.assets.map((asset) => <Text key={asset.id}>{handoverAssetSummary(asset)}</Text>)}
          {draft.assets.flatMap((asset) => (asset.evidenceIds ?? []).map((id, index) => (
            <ContractEvidence key={`${asset.id}-${id}`} api={api} contractId={contract.id} evidenceId={id} draftHandoverEvidence label={`Mở ảnh ${asset.name} · ${index + 1}`} />
          )))}
          {draft.evidenceIds.map((id, index) => (
            <ContractEvidence key={id} api={api} contractId={contract.id} evidenceId={id} draftHandoverEvidence label={`Mở ảnh hiện trạng ${index + 1}`} />
          ))}
          {!draft.assets.length && <Text>{draft.noAssetsConfirmed ? 'Owner xác nhận phòng không có tài sản.' : 'Chưa kiểm kê tài sản.'}</Text>}
          {draft.missing.length > 0 && (
            <>
              <Heading title="Còn thiếu để bàn giao" />
              {draft.missing.map((item, index) => (
                <Text key={`${item}-${index}`} style={ui.muted}>
                  • {moveInMissingMessage(item)}
                </Text>
              ))}
            </>
          )}
          {draft.ownerReadyAt && <Text>Owner xác nhận sẵn sàng: {formatInstant(draft.ownerReadyAt)}</Text>}
          {draft.tenantConfirmedAt && <Text>Tenant xác nhận: {formatInstant(draft.tenantConfirmedAt)}</Text>}
          {draft.status !== 'Confirmed' && (
            <ContractEvidence api={api} contractId={contract.id} draftHandoverPdf label="Xem PDF biên bản nháp" />
          )}
          {current?.documents.map((document) => (
            <ContractEvidence
              key={document.id}
              api={api}
              contractId={contract.id}
              handoverDocumentId={document.id}
              label="Mở hoặc lưu biên bản cuối cùng"
            />
          ))}
          {draft.status === 'Confirmed' && current?.documentsError && (
            <Text accessibilityRole="alert" style={ui.red}>
              Không tải được PDF bàn giao cuối cùng: {current.documentsError}
            </Text>
          )}
          {draft.status === 'Confirmed' && !current?.documentsError && !current?.documents.length && (
            <Text style={ui.muted}>
              Biên bản đã xác nhận nhưng PDF cuối cùng chưa có. Hãy tải lại hoặc liên hệ Owner để kiểm tra tài liệu.
            </Text>
          )}
          {draft.requests.length > 0 && (
            <>
              <Heading title="Yêu cầu sửa biên bản" />
              {draft.requests.map((request) => (
                <Box key={request.id}>
                  <Text>Phiên bản {request.version} · {request.status === 'Pending' ? 'Chờ Owner xử lý' : request.status === 'Approved' ? 'Owner đã chấp nhận' : 'Owner từ chối'}</Text>
                  <Text>{request.reason}</Text>
                  {!!request.decisionReason && <Text>Phản hồi Owner: {request.decisionReason}</Text>}
                </Box>
              ))}
            </>
          )}
        </>
      )}

      {staff && draft?.status === 'Ready' && (
        <Text>Owner đã đánh dấu sẵn sàng. Tenant có thể xem và xác nhận biên bản.</Text>
      )}
      {staff && draft?.status === 'ChangesRequested' && (
        <Text>Đã có yêu cầu sửa từ Tenant. Chờ Owner quyết định trước khi Staff cập nhật biên bản.</Text>
      )}
      {staff && draft && started && (
        <Modal visible={!!activeItem} transparent animationType="slide"
          onRequestClose={closeItem}>
          <KeyboardAvoidingView style={[wizardStyles.modalOverlay, compactPhone && wizardStyles.phoneModalOverlay]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[wizardStyles.modalCard, compactPhone && wizardStyles.phoneModalCard]}>
              <View style={[wizardStyles.modalHeader, compactPhone && wizardStyles.phoneModalHeader]}>
                <Row spread>
                  <View style={wizardStyles.rowText}>
                    <Text variant="titleMedium" style={wizardStyles.rowTitle}>
                      {modalTitle}
                    </Text>
                    {activeItem !== 'legacy-inventory' && <Text variant="bodySmall" style={ui.muted}>
                      {activeItem === 'meter'
                        ? 'Chụp ảnh, kiểm tra kết quả OCR và tự xác nhận chỉ số.'
                        : 'Chỉ ghi nhận thực tế. Owner quyết định xử lý các vấn đề.'}
                    </Text>}
                  </View>
                  <Button mode="text" disabled={busy} onPress={closeItem}>Đóng</Button>
                </Row>
              </View>
              <ScrollView ref={modalScroll} style={{ flexShrink: 1 }} contentContainerStyle={[wizardStyles.modalBody, compactPhone && wizardStyles.phoneModalBody]}
                keyboardShouldPersistTaps="handled">
                {activeItem === 'meter' && meterTask && (
                  <MeterTaskScreen embedded taskId={meterTask.id} onReturn={() => {
                    setActiveItem(null);
                    setMeterTask(null);
                    setRevision((value) => value + 1);
                  }} />
                )}
                {activeItem === 'legacy-inventory' && draft.moveInTask?.inventoryTaskId && (
                  <StaffMoveInInventoryScreen embeddedTaskId={draft.moveInTask.inventoryTaskId}
                    onPaneChange={() => modalScroll.current?.scrollTo({ y: 0, animated: false })} />
                )}
                {activeItem === 'room-summary' && (
                  <Input label="Hiện trạng phòng" value={values.roomCondition ?? ''}
                    disabled={busy} multiline
                    onChange={(value) => set('roomCondition', value)} />
                )}
                {selectedRoomCode && selectedRoomCheck && (
                  <View style={wizardStyles.section}>
                    <Text variant="bodySmall" style={ui.muted}>
                      Chọn kết quả kiểm tra tại phòng, ghi chú khi có vấn đề hoặc không áp dụng.
                    </Text>
                    {compactPhone ? (
                      <View style={wizardStyles.conditionOptions}>
                        {([
                          ['Passed', 'Đạt'], ['Issue', 'Có vấn đề'], ['NotApplicable', 'Không áp dụng'],
                        ] as const).map(([value, label]) => (
                          <RadioButton.Item key={value} label={label} value={value}
                            status={values['roomCheck.' + selectedRoomCode + '.status'] === value ? 'checked' : 'unchecked'}
                            onPress={() => setRoomCheck(selectedRoomCode, 'status', value)}
                            disabled={busy} mode="android" color={colors.blue}
                            style={[wizardStyles.conditionOption,
                              values['roomCheck.' + selectedRoomCode + '.status'] === value && wizardStyles.conditionSelected]} />
                        ))}
                      </View>
                    ) : <SegmentedButtons
                      value={values['roomCheck.' + selectedRoomCode + '.status'] ?? ''}
                      onValueChange={(value) => setRoomCheck(selectedRoomCode, 'status', value)}
                      density="small"
                      buttons={[
                        { value: 'Passed', label: 'Đạt', disabled: busy },
                        { value: 'Issue', label: 'Có vấn đề', disabled: busy },
                        { value: 'NotApplicable', label: 'Không áp dụng', disabled: busy },
                      ]}
                    />}
                    {values['roomCheck.' + selectedRoomCode + '.status'] !== 'Passed' && (
                      <Input label={'Ghi chú · ' + selectedRoomCheck.label}
                        value={values['roomCheck.' + selectedRoomCode + '.notes'] ?? ''}
                        disabled={busy} multiline
                        onChange={(value) => setRoomCheck(selectedRoomCode, 'notes', value)} />
                    )}
                    {values['roomCheck.' + selectedRoomCode + '.status'] === 'Issue' && (
                      <>
                        <Text variant="bodySmall" style={ui.muted}>
                          Gắn riêng ít nhất một ảnh minh chứng cho khu vực này.
                        </Text>
                        {availableEvidence.map((id, index) => (
                          <Checkbox.Item key={id} label={'Gắn ảnh ' + (index + 1)}
                            status={values['roomCheck.' + selectedRoomCode + '.evidence.' + id] === 'true' ? 'checked' : 'unchecked'}
                            disabled={busy}
                            onPress={() => setRoomCheck(selectedRoomCode, 'evidence.' + id,
                              values['roomCheck.' + selectedRoomCode + '.evidence.' + id] === 'true' ? 'false' : 'true')} />
                        ))}
                        {photoCapture('room', selectedRoomCode)}
                      </>
                    )}
                  </View>
                )}
                {selectedAsset && (
                  <View style={wizardStyles.section}>
                    <HandoverAssetFields asset={selectedAsset} values={values} set={set}
                      evidenceIds={availableEvidence} disabled={busy}
                      quantities={!!draft.inventoryToken} showCheckWithoutQuantities compact embedded />
                    {photoCapture('asset', selectedAsset.id)}
                  </View>
                )}
                {activeItem === 'access-summary' && (
                  <>
                    <Input label="Chìa khóa / quyền truy cập"
                      value={values.keysAndAccess ?? ''} disabled={busy} multiline
                      onChange={(value) => set('keysAndAccess', value)} />
                    <Input label="Ghi chú bàn giao"
                      value={values.notes ?? ''} disabled={busy} multiline
                      onChange={(value) => set('notes', value)} />
                  </>
                )}
                {activeItem === 'add-access' && (
                  <View style={wizardStyles.section}>
                    <Text variant="bodySmall" style={ui.muted}>
                      Chọn loại chưa kê khai. Mỗi loại chỉ có một dòng bàn giao.
                    </Text>
                    {moveInAccessKinds.map(({ type, label }) => (
                      <Button key={type} mode="outlined"
                        disabled={busy || accessItems.some((item) => item.type === type)}
                        onPress={() => {
                          setAccessItems((previous) => [...previous, {
                            type, quantity: type === 'DigitalAccess' ? '0' : '1', notes: '',
                          }]);
                          setAccessItemsTouched(true);
                          setActiveItem('access:' + type);
                        }}>
                        {label}
                      </Button>
                    ))}
                  </View>
                )}
                {selectedAccess && selectedAccessIndex >= 0 && (
                  <View style={wizardStyles.section}>
                    <Input label="Số lượng bàn giao" numeric
                      value={selectedAccess.quantity} disabled={busy}
                      onChange={(value) => updateAccessItem(selectedAccessIndex, 'quantity', value)} />
                    <Input label="Ghi chú / cách sử dụng" multiline
                      value={selectedAccess.notes} disabled={busy}
                      onChange={(value) => updateAccessItem(selectedAccessIndex, 'notes', value)} />
                    {photoCapture('access')}
                    <Button mode="text" disabled={busy} onPress={() => {
                      setAccessItems((previous) => previous.filter((_, position) => position !== selectedAccessIndex));
                      setAccessItemsTouched(true);
                      setActiveItem(null);
                    }}>Bỏ loại quyền ra vào này</Button>
                  </View>
                )}
                {activeItem === 'room-photo' && photoCapture('room')}
                {activeItem === 'general-photo' && photoCapture('general')}
                {!!error && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
                {!!notice && <Text style={ui.green}>{notice}</Text>}
              </ScrollView>
              {activeItem !== 'meter' && activeItem !== 'add-access' && activeItem !== 'legacy-inventory' && (
                <View style={[wizardStyles.modalFooter, compactPhone && wizardStyles.phoneModalFooter]}>
                  <View style={{ flex: 1 }}>
                    <Button mode="outlined" disabled={busy} onPress={closeItem}>
                      Để sau
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button mode="contained" loading={busy} disabled={busy || loading}
                      onPress={() => void run(saveDraft, 'Đã lưu kết quả kiểm tra trên máy chủ.')}>
                      Lưu tiến độ
                    </Button>
                  </View>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {tenant && draft && draft.status !== 'Confirmed' && (
        <>
          {canTenantRespondToMoveIn(draft) ? (
            <>
              <Input label="Ghi chú / nội dung cần sửa" multiline value={note} disabled={busy} onChange={setNote} />
              <Checkbox.Item
                label={`Tôi đã kiểm tra nội dung biên bản phiên bản ${draft.version}`}
                status={acknowledged ? 'checked' : 'unchecked'}
                disabled={busy}
                onPress={() => setAcknowledged(!acknowledged)}
              />
              {contract.status !== 'Active' && <Text style={ui.muted}>Chờ hợp đồng được kích hoạt để xác nhận nhận phòng.</Text>}
              <Action disabled={busy || !acknowledged || contract.status !== 'Active'} onPress={() => void run(() => tenantDecision(false), 'Đã xác nhận bàn giao; vui lòng kiểm tra PDF cuối cùng đã lưu.')}>Xác nhận biên bản bàn giao</Action>
              <Action secondary disabled={busy || !acknowledged || !note.trim()} onPress={() => void run(() => tenantDecision(true), 'Đã gửi yêu cầu sửa biên bản cho Owner.')}>Gửi yêu cầu chỉnh sửa</Action>
              <Text style={ui.muted}>Chưa cần ký biên bản ở bước này.</Text>
            </>
          ) : (
            <Text>Biên bản đang được Staff và Owner chuẩn bị hoặc xử lý yêu cầu sửa. Bạn sẽ xác nhận khi Owner đánh dấu sẵn sàng.</Text>
          )}
        </>
      )}
      {(!staff || !draft) && !!error && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
      {(!staff || !draft) && !!notice && <Text style={ui.green}>{notice}</Text>}
    </Box>
  );
}
