import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
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
  Checkbox,
  Icon,
  IconButton,
  ProgressBar,
  RadioButton,
  SegmentedButtons,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import {
  contractError,
  guid,
  mutationKeys,
  type ContractClient,
  type ContractView,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import { type DrawnSignature } from '../../../../../packages/client-core/src/signing';
import {
  assetInspectionInput,
  quantityFields,
} from '../../../../../packages/client-core/src/handoverForm';
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
  moveInReinspectionLabel,
  moveInHandover,
  roomHandoverChecks,
  type MoveInDraft,
  type MoveInDraftInput,
  type MoveInRoomCheckCode,
  type MoveInRoomCheckStatus,
  type MoveInAccessItem,
} from '../../services/moveInHandover';
import { ContractInitialMeterTasks } from './ContractInitialMeterTasks';
import { ContractEvidence } from './ContractEvidence';
import { TenantMoveInHandoverSummary } from './TenantMoveInHandoverSummary';
import { SignaturePad } from './SignaturePad';
import { HandoverAssetFields } from './HandoverAssetFields';
import { MeterTaskScreen } from '../../app/meter';
import { StaffMoveInInventoryScreen } from '../../screens/StaffMoveInInventoryScreen';
import {
  inventoryStatusLabels,
  type MoveInInventory,
  type MoveInInventoryItem,
} from '../../services/moveInInventory';
import { colors } from '../../theme/theme';

const statusLabels = {
  Draft: 'Đang chuẩn bị',
  PendingOwnerReview: 'Chờ Owner duyệt',
  ReinspectionRequested: 'Owner yêu cầu kiểm tra lại',
  Ready: 'Sẵn sàng bàn giao',
  ChangesRequested: 'Đang xử lý yêu cầu sửa',
  Confirmed: 'Đã xác nhận bàn giao',
} as const;

const roomStatusLabels: Record<MoveInRoomCheckStatus, string> = {
  Passed: 'Đạt',
  Issue: 'Có vấn đề',
  NotApplicable: 'Không áp dụng',
};

const staffSteps = [
  {
    title: 'Ghi chỉ số điện nước',
    detail: 'Chụp từng công tơ, kiểm tra OCR và xác nhận chỉ số thật.',
  },
  {
    title: 'Kiểm tra hiện trạng phòng',
    detail: 'Chọn kết quả thực tế cho 7 khu vực.',
  },
  {
    title: 'Kiểm kê tài sản',
    detail:
      'Kiểm kê một lần trong Đối chiếu đầu vào; danh sách bên dưới chỉ hiển thị kết quả đã lưu.',
  },
  {
    title: 'Chìa khóa bàn giao',
    detail: 'Ghi số lượng chìa khóa thực giao và chụp ảnh chìa khóa.',
  },
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
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    minHeight: 66,
    flexShrink: 0,
  },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontWeight: '700', color: '#14213d' },
  rowDetail: { color: '#5a6a84', lineHeight: 19, flexShrink: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(13, 26, 49, 0.62)',
    padding: 12,
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
    gap: 8,
  },
  modalBody: { padding: 18, paddingBottom: 30, gap: 14 },
  modalFooter: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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

function hasCompleteRoomInspection(value: MoveInDraft): boolean {
  return (
    !!value.roomCondition?.trim() &&
    roomHandoverChecks.every(({ code }) => {
      const matches = (value.roomChecks ?? []).filter((check) => check.code === code);
      if (matches.length !== 1) return false;
      const check = matches[0]!;
      return (
        check.status === 'Passed' || check.status === 'NotApplicable' || check.status === 'Issue'
      );
    })
  );
}

function hasCompleteAssetInspection(value: MoveInDraft): boolean {
  return (
    value.noAssetsConfirmed ||
    (value.assets.length > 0 && value.assets.every((asset) => asset.checked))
  );
}

function hasSavedInventoryItem(item: MoveInInventoryItem): boolean {
  return (
    item.condition !== null &&
    item.actualQuantity !== null &&
    (item.condition === 'Good' || (item.evidenceIds ?? []).length > 0)
  );
}

function hasCompleteAssetSection(value: MoveInDraft, inventory: MoveInInventory | null): boolean {
  if (!value.moveInTask?.inventoryTaskId) return hasCompleteAssetInspection(value);
  return (
    inventory?.status === 'Completed' &&
    inventory.contractId === value.contractId &&
    inventory.items.length === value.assets.length &&
    value.assets.every((asset) =>
      inventory.items.some((item) => item.id === asset.id && hasSavedInventoryItem(item)),
    )
  );
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
  if (!context) throw new UserFeedbackError('Không tạo được ảnh mẫu trên trình duyệt.');
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
    documentsLoading: boolean;
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
  const [selectedKeyEvidence, setSelectedKeyEvidence] = useState<string[]>([]);
  const [photoPreviewUris, setPhotoPreviewUris] = useState<Record<string, string>>({});
  const previewFiles = useRef(new Map<string, { uri: string; dispose: () => void }>());
  const [keyQuantity, setKeyQuantity] = useState('');
  const [keyNotes, setKeyNotes] = useState('');
  const [feedback, setFeedback] = useState({ version: -1, acknowledged: false });
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [tenantDrawing, setTenantDrawing] = useState<DrawnSignature | null>(null);
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));

  useEffect(
    () => () => {
      for (const preview of previewFiles.current.values()) preview.dispose();
      previewFiles.current.clear();
    },
    [contract.id],
  );

  useFocusEffect(
    useCallback(() => {
      setRevision((value) => value + 1);
    }, []),
  );

  const key = `${contract.id}:${contract.locationId}:${role}:${revision}`;
  const current = response?.key === key ? response : null;
  const loading = allowed && !current;
  const error = actionError || current?.error || '';
  const draft = allowed ? (current?.record ?? null) : null;
  const inventory = current?.inventory ?? null;
  const started = canStaffEditMoveIn(draft);
  const checkedRooms = (draft?.roomChecks ?? []).length;
  const checkedAssets = draft?.moveInTask?.inventoryTaskId
    ? draft.assets.filter((asset) =>
        inventory?.items.some((item) => item.id === asset.id && hasSavedInventoryItem(item)),
      ).length
    : (draft?.assets ?? []).filter((asset) => asset.checked).length;
  const inspectionIssues = (draft?.roomChecks ?? []).filter((check) => check.status === 'Issue');
  const savedWizardSteps = draft
    ? [
        !!draft.electricity && !!draft.water,
        hasCompleteRoomInspection(draft),
        hasCompleteAssetSection(draft, inventory),
        // Saving the key quantity completes this step; key photos are optional.
        (draft.accessItems ?? []).length === 1 && draft.accessItems[0]?.type === 'RoomKey',
      ]
    : [false, false, false, false];
  // A reinspection is complete only when the server has verified the newly
  // saved observation AND, for canonical inventory assets, fresh photo proof.
  // Rechecking timestamps/conditions on the client would allow old photos to
  // appear sufficient. The server updates reinspectionItems[].rechecked.
  const isReinspectionItemComplete = (item: { rechecked?: boolean }): boolean =>
    item.rechecked === true;
  const reinspectionReady =
    draft?.status !== 'ReinspectionRequested' ||
    ((draft.reinspectionItems?.length ?? 0) > 0 &&
      (draft.reinspectionItems ?? []).every(isReinspectionItemComplete));
  // Staff completes an inspection by recording its four sections. Conditions
  // that only the Owner can resolve before signing are not Staff blockers.
  const inspectionReady = savedWizardSteps.every(Boolean) && reinspectionReady;
  const recommendedStep = draft ? firstUnfinishedStep(draft, inventory) : 0;
  const availableEvidence = [
    ...new Set([
      ...selectedEvidence,
      ...selectedKeyEvidence,
      ...evidencePool,
      ...(draft?.assets.flatMap((asset) => asset.evidenceIds ?? []) ?? []),
      ...(draft?.roomChecks ?? []).flatMap((check) => check.evidenceIds ?? []),
    ]),
  ];
  const canUploadSample =
    staff &&
    contract.isDevelopmentDemo === true &&
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
    setValues((previous) => ({
      ...previous,
      [`roomCheck.${code}.${field}`]: value,
    }));
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
              `/api/v1/operational-tasks/${taskId}/move-in-inventory`,
              { signal: controller.signal },
            );
            if (result.taskId !== taskId || result.contractId !== contract.id)
              throw new UserFeedbackError('Kết quả kiểm kê không thuộc hợp đồng này.');
            inventory = result;
          } catch (cause) {
            if (controller.signal.aborted) return;
            inventoryError = conciseMessage(contractError(cause));
          }
        }
        if (staff && loadedWizardContract.current !== contract.id) {
          loadedWizardContract.current = contract.id;
          setWizardStep(firstUnfinishedStep(value, inventory));
        }
        if (!controller.signal.aborted) {
          setResponse({
            key,
            record: value,
            error: '',
            notFound: false,
            documents: [],
            documentsError: '',
            documentsLoading: value.status === 'Confirmed',
            inventory,
            inventoryError,
          });
        }
        if (value.status === 'Confirmed' && !controller.signal.aborted) {
          try {
            // Render the confirmed state before fetching the separate document list.
            // Only the immutable MoveIn PDF from this contract is exposed.
            const files = await api.handoverDocuments(contract.id, controller.signal);
            const documents = files
              .filter((file) => file.kind === 'MoveInReport' && file.contractId === contract.id)
              .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
              .slice(0, 1);
            if (!controller.signal.aborted)
              setResponse((previous) =>
                previous?.key === key
                  ? { ...previous, documents, documentsLoading: false }
                  : previous,
              );
          } catch (cause) {
            if (!controller.signal.aborted)
              setResponse((previous) =>
                previous?.key === key
                  ? {
                      ...previous,
                      documentsError: conciseMessage(contractError(cause)),
                      documentsLoading: false,
                    }
                  : previous,
              );
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          const notFound =
            typeof cause === 'object' &&
            cause !== null &&
            'status' in cause &&
            cause.status === 404;
          setResponse({
            key,
            record: null,
            error: notFound ? '' : conciseMessage(contractError(cause)),
            notFound,
            documents: [],
            documentsError: '',
            documentsLoading: false,
            inventory: null,
            inventoryError: '',
          });
        }
      }
    })();
    return () => controller.abort();
  }, [allowed, api, client, contract.id, key, revision, staff]);

  const acknowledged = feedback.version === draft?.version && feedback.acknowledged;
  const setAcknowledged = (next: boolean) =>
    setFeedback(() => ({
      version: draft?.version ?? -1,
      acknowledged: next,
    }));

  function closeCorrection() {
    if (busy) return;
    setCorrectionOpen(false);
    setCorrectionReason('');
    setActionError('');
  }

  async function run(command: () => Promise<unknown>, success: string, refresh = true) {
    if (lock.current) return false;
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
      return true;
    } catch (cause) {
      setActionError(conciseMessage(contractError(cause)));
      // CameraCapture must retain its preview for retry after a failed private upload.
      return false;
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
      ...Object.fromEntries(
        (draft.roomChecks ?? []).flatMap((check) => [
          [`roomCheck.${check.code}.status`, check.status],
          [`roomCheck.${check.code}.notes`, check.notes || ''],
          ...(check.evidenceIds ?? []).map((id) => [
            `roomCheck.${check.code}.evidence.${id}`,
            'true',
          ]),
        ]),
      ),
      ...Object.fromEntries(
        draft.assets.flatMap((asset) => [
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
            [
              `${item.id}.physicalHandedOverQuantity`,
              item.handedOverQuantity == null ? '' : String(item.handedOverQuantity),
            ],
          ]),
        ]),
      ),
    });
    setSelectedEvidence(draft.evidenceIds ?? []);
    setSelectedKeyEvidence(draft.keyEvidenceIds ?? []);
    setEvidencePool([
      ...new Set([
        ...(draft.evidenceIds ?? []),
        ...(draft.keyEvidenceIds ?? []),
        ...draft.assets.flatMap((asset) => asset.evidenceIds ?? []),
        ...(draft.roomChecks ?? []).flatMap((check) => check.evidenceIds ?? []),
      ]),
    ]);
    const recordedKeys = (draft.accessItems ?? []).find((item) => item.type === 'RoomKey');
    setKeyQuantity(recordedKeys ? String(recordedKeys.quantity) : '');
    setKeyNotes(recordedKeys?.notes ?? '');
    setEditing(true);
  }

  async function saveDraft() {
    if (!draft || !canStaffEditMoveIn(draft)) return;
    const touchedChecks = roomHandoverChecks.filter((check) => activeItem === `room:${check.code}`);
    const roomChecks: NonNullable<MoveInDraftInput['roomChecks']> = touchedChecks.map(
      ({ code, label }) => {
        const status = values[`roomCheck.${code}.status`] as MoveInRoomCheckStatus | undefined;
        const notes = (values[`roomCheck.${code}.notes`] ?? '').trim();
        const evidenceIds = availableEvidence.filter(
          (id) => values[`roomCheck.${code}.evidence.${id}`] === 'true',
        );
        if (!status) throw new UserFeedbackError(`Hãy chọn kết quả kiểm tra: ${label}.`);
        if (evidenceIds.length > 5) {
          throw new UserFeedbackError(`Mục "${label}" chỉ được gắn tối đa 5 ảnh.`);
        }
        return { code, status, notes: notes || null, evidenceIds };
      },
    );
    let validatedAccessItems: MoveInAccessItem[] | undefined;
    if (activeItem === 'keys') {
      const quantity = Number(keyQuantity);
      if (!keyQuantity.trim() || !Number.isInteger(quantity) || quantity < 0 || quantity > 100)
        throw new UserFeedbackError('Số lượng chìa khóa bàn giao phải là số nguyên từ 0 đến 100.');
      if (quantity === 0 && !keyNotes.trim())
        throw new UserFeedbackError('Nếu không bàn giao chìa khóa, hãy ghi rõ lý do.');
      validatedAccessItems = [{ type: 'RoomKey', quantity, notes: keyNotes.trim() }];
    }
    // Unchecked groups remain untouched. Each checked group can be saved separately.
    const checkedAssets = draft.assets.filter((asset) => activeItem === `asset:${asset.id}`);
    if (checkedAssets.some((asset) => values[`${asset.id}.checked`] !== 'true')) {
      throw new UserFeedbackError('Hãy xác nhận đã kiểm tra tài sản.');
    }
    const input: MoveInDraftInput = {
      version: draft.version,
      ...(activeItem === 'room-summary' ? { roomCondition: values.roomCondition?.trim() } : {}),
      ...(touchedChecks.length ? { roomChecks } : {}),
      ...(validatedAccessItems ? { accessItems: validatedAccessItems } : {}),
      ...(checkedAssets.length
        ? {
            assets: checkedAssets.map((asset) => ({
              ...assetInspectionInput(asset, values, availableEvidence, !!draft.inventoryToken),
              checked: true,
              notes: values[`${asset.id}.notes`] ?? '',
              evidenceIds: availableEvidence.filter(
                (id) => values[`${asset.id}.evidence.${id}`] === 'true',
              ),
            })),
            inventoryToken: draft.inventoryToken,
          }
        : {}),
      evidenceIds: selectedEvidence,
      ...(activeItem === 'keys' ? { keyEvidenceIds: selectedKeyEvidence } : {}),
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

  async function requestTenantCorrection() {
    if (!draft) return;
    const input = { version: draft.version, reason: correctionReason.trim() };
    const key = keys.get('correction', input);
    await client.requestCorrection(contract.id, draft.version, input.reason, key);
    keys.confirmed('correction', input);
    setFeedback({ version: -1, acknowledged: false });
  }

  async function signTenantInSession() {
    if (
      !tenant ||
      !draft ||
      !canTenantRespondToMoveIn(draft) ||
      !acknowledged ||
      !tenantDrawing ||
      contract.status !== 'Active'
    )
      return;
    const input = { version: draft.version, ink: tenantDrawing, note: '' };
    const key = keys.get('tenant-handover-session-sign', input);
    try {
      await client.signTenantInSession(contract.id, input.version, input.ink, input.note, key);
    } catch (cause) {
      // The client may lose the response after the signed PDF was committed.
      // Verify server state via GET; never automatically repeat the signature POST.
      const uncertain = cause as { code?: string; status?: number } | null;
      if (uncertain?.code !== 'request_timeout' && uncertain?.code !== 'network_unavailable')
        throw cause;
      let completed = false;
      try {
        const latest = await client.get(contract.id);
        completed = latest.status === 'Confirmed' && !!latest.tenantSignedAt;
      } catch {
        // Keep the original ambiguous result: do not misreport a signed PDF.
      }
      if (!completed) throw cause;
    }
    keys.confirmed('tenant-handover-session-sign', input);
    setTenantDrawing(null);
    setFeedback({ version: -1, acknowledged: false });
  }

  async function beginWork() {
    if (!staff || draft?.status !== 'Draft' || draft.moveInTask?.status !== 'Assigned') return;
    const input = { taskId: draft.moveInTask.id, version: draft.moveInTask.version };
    const key = keys.get('start-move-in', input);
    await client.beginWork(draft.moveInTask, key);
    keys.confirmed('start-move-in', input);
  }

  async function submitInspection() {
    if (!staff || !draft || !started || !inspectionReady) return;
    const resubmit = draft.status === 'ReinspectionRequested';
    const input = { version: draft.version };
    const action = resubmit ? 'resubmit-move-in' : 'submit-move-in';
    const key = keys.get(action, input);
    if (resubmit) await client.resubmit(contract.id, draft.version, key);
    else await client.submit(contract.id, draft.version, key);
    keys.confirmed(action, input);
    setSectionOpen(false);
  }

  function openReinspectionItem(kind: string, code?: string | null, assetId?: string | null) {
    if (!started) return;
    if (kind === 'Meter') goToStep(0);
    else if (kind === 'RoomCheck' || kind === 'Room') goToStep(1);
    else if (kind === 'Asset') goToStep(2);
    else if (kind === 'Access') goToStep(3);
    if (kind === 'RoomCheck' && code && roomHandoverChecks.some((check) => check.code === code))
      setActiveItem(`room:${code}`);
    else if (kind === 'Room') setActiveItem('room-summary');
    else if (kind === 'Access') setActiveItem('keys');
    else if (kind === 'Asset' && assetId && draft?.assets.some((asset) => asset.id === assetId))
      // A canonical inventory task, once reopened by Owner, is the only
      // authoritative place to record a fresh asset condition and photo.
      setActiveItem(draft.moveInTask?.inventoryTaskId ? 'legacy-inventory' : `asset:${assetId}`);
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

  async function uploadInspectionPhoto(
    bytes: Uint8Array<ArrayBuffer>,
    kind: 'room' | 'asset' | 'keys',
    targetId?: string,
  ) {
    if (!started) throw new UserFeedbackError('Hãy bắt đầu công việc trước khi chụp ảnh kiểm kê.');
    if (bytes.byteLength > 5 * 1024 * 1024) throw new UserFeedbackError('Ảnh vượt quá 5 MB.');
    const file = await client.uploadEvidence(contract.id, bytes, 'image/jpeg');
    // Newly uploaded private files cannot be GET-previewed until Save links them
    // into the draft. Retain a short-lived local preview instead of weakening
    // the server's evidence authorization or auto-saving an unfinished form.
    let preview: { uri: string; dispose: () => void };
    if (Platform.OS === 'web') {
      const uri = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      preview = { uri, dispose: () => URL.revokeObjectURL(uri) };
    } else {
      const directory = new Directory(Paths.cache, 'bhome-handover-unsaved-photos');
      directory.create({ idempotent: true, intermediates: true });
      const cached = new File(directory, `${randomUUID()}.jpg`);
      cached.create();
      await cached.write(bytes);
      preview = {
        uri: cached.uri,
        dispose: () => {
          if (cached.exists) cached.delete();
        },
      };
    }
    previewFiles.current.get(file.id)?.dispose();
    previewFiles.current.set(file.id, preview);
    setPhotoPreviewUris((items) => ({ ...items, [file.id]: preview.uri }));
    setEvidencePool((items) => [...new Set([...items, file.id])]);
    // A photo taken for a specific room/asset check stays attached to that
    // check, not also counted as an unrelated general handover photo.
    if (kind === 'keys') setSelectedKeyEvidence((items) => [...new Set([...items, file.id])]);
    // When a specific inspection form opened the camera, link the uploaded
    // evidence to that same form immediately. Staff must not hunt through a
    // shared image pool or accidentally attach it to another asset.
    if (kind === 'asset' && targetId) set(`${targetId}.evidence.${file.id}`, 'true');
    if (kind === 'room' && targetId)
      setRoomCheck(targetId as MoveInRoomCheckCode, 'evidence.' + file.id, 'true');
  }

  function photoIdsFor(kind: 'room' | 'asset' | 'keys', targetId?: string) {
    const belongsToThisItem = (id: string) =>
      kind === 'asset' && targetId
        ? values[`${targetId}.evidence.${id}`] === 'true'
        : kind === 'room' && targetId
          ? values[`roomCheck.${targetId}.evidence.${id}`] === 'true'
          : kind === 'keys' && selectedKeyEvidence.includes(id);
    return availableEvidence.filter(belongsToThisItem);
  }

  function photoGallery(kind: 'room' | 'asset' | 'keys', targetId?: string) {
    // Every thumbnail belongs to this inspection; no cross-room image choices.
    const photos = photoIdsFor(kind, targetId);
    if (!photos.length) return null;
    const remove = (id: string) => {
      if (kind === 'asset' && targetId) set(`${targetId}.evidence.${id}`, 'false');
      if (kind === 'room' && targetId)
        setRoomCheck(targetId as MoveInRoomCheckCode, `evidence.${id}`, 'false');
      if (kind === 'keys') setSelectedKeyEvidence((ids) => ids.filter((value) => value !== id));
      // No server-side file DELETE exists: remove this inspection's attachment
      // on the next Save, preserving any other area's existing references.
      const linkedElsewhere =
        selectedEvidence.includes(id) ||
        (kind !== 'keys' && selectedKeyEvidence.includes(id)) ||
        Object.entries(values).some(
          ([field, value]) =>
            value === 'true' &&
            field.endsWith(`.evidence.${id}`) &&
            field !==
              (kind === 'room' && targetId
                ? `roomCheck.${targetId}.evidence.${id}`
                : `${targetId}.evidence.${id}`),
        );
      if (linkedElsewhere) return;
      setEvidencePool((ids) => ids.filter((value) => value !== id));
      const localPreview = previewFiles.current.get(id);
      if (localPreview) {
        localPreview.dispose();
        previewFiles.current.delete(id);
        setPhotoPreviewUris((items) => {
          const updated = { ...items };
          delete updated[id];
          return updated;
        });
      }
    };
    return (
      <View style={wizardStyles.photoGrid}>
        {photos.map((id, index) => (
          <View key={id} style={wizardStyles.photoTile}>
            <ContractEvidence
              api={api}
              contractId={contract.id}
              evidenceId={id}
              draftHandoverEvidence
              thumbnail
              localThumbnailUri={photoPreviewUris[id]}
              label={`${kind === 'keys' ? 'Ảnh chìa khóa' : 'Ảnh hiện trạng'} ${index + 1}`}
            />
            <IconButton
              icon="close"
              size={20}
              disabled={busy}
              accessibilityLabel={`Xóa ${kind === 'keys' ? 'ảnh chìa khóa' : 'ảnh hiện trạng'} ${index + 1}`}
              style={wizardStyles.removePhoto}
              onPress={() => remove(id)}
            />
          </View>
        ))}
      </View>
    );
  }

  // The returned camera callback only reads the mutation lock after the user
  // confirms a capture; this helper is evaluated during render, not the callback.
  function photoCapture(kind: 'room' | 'asset' | 'keys', targetId?: string) {
    const assetPhoto = kind === 'asset';
    const itemPhoto = kind === 'keys' || !!targetId;
    const photoLimit = 5;
    const photoCount = photoIdsFor(kind, targetId).length;
    return (
      <View style={wizardStyles.section}>
        {itemPhoto ? (
          <Text variant="labelMedium" style={{ color: colors.navy }}>
            {kind === 'keys' ? 'Ảnh chìa khóa bàn giao (không bắt buộc):' : 'Ảnh minh chứng:'}
          </Text>
        ) : null}
        <CameraCapture
          label="Chụp ảnh"
          presentation="evidence"
          reviewBeforeSubmit
          reviewActionLabel="Dùng ảnh này"
          disabled={busy || photoCount >= photoLimit}
          onCapture={(bytes) =>
            run(
              () => uploadInspectionPhoto(bytes, kind, targetId),
              kind === 'keys'
                ? 'Đã tải ảnh chìa khóa; bấm Lưu để gắn vào biên bản.'
                : assetPhoto
                  ? 'Đã tải và gắn ảnh vào phiếu tài sản.'
                  : 'Đã tải ảnh hiện trạng lên máy chủ.',
              false,
            )
          }
        />
        {canUploadSample && (
          <Button
            mode="outlined"
            icon="flask-outline"
            disabled={busy || photoCount >= photoLimit}
            onPress={() =>
              void run(
                async () => {
                  if (!canUploadSample) return;
                  const bytes = handoverDemoJpeg();
                  try {
                    await uploadInspectionPhoto(bytes, kind, targetId);
                  } finally {
                    bytes.fill(0);
                  }
                },
                'Đã tải ảnh giả lập DEV lên biên bản test.',
                false,
              )
            }
          >
            Thêm ảnh mẫu DEV
          </Button>
        )}
        {photoGallery(kind, targetId)}
      </View>
    );
  }

  function workEntry(
    id: string,
    title: string,
    detail: string,
    status: string,
    onPress: () => void,
    done = false,
    indicator: 'passed' | 'issue' | 'not-applicable' | 'unreviewed' = done
      ? 'passed'
      : 'unreviewed',
  ) {
    const source =
      indicator === 'passed'
        ? 'check-circle-outline'
        : indicator === 'issue'
          ? 'alert-circle-outline'
          : indicator === 'not-applicable'
            ? 'minus-circle-outline'
            : 'clipboard-text-outline';
    const color =
      indicator === 'passed'
        ? colors.green
        : indicator === 'issue'
          ? colors.amber
          : indicator === 'not-applicable'
            ? colors.muted
            : colors.blue;
    return (
      <TouchableRipple
        key={id}
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={busy}
        onPress={onPress}
        style={[wizardStyles.workRow, compactPhone && wizardStyles.phoneWorkRow]}
      >
        <View style={wizardStyles.rowContent}>
          <Icon source={source} size={23} color={color} />
          <View style={wizardStyles.rowText}>
            <Text variant="titleSmall" style={wizardStyles.rowTitle}>
              {title}
            </Text>
            <Text variant="bodySmall" style={wizardStyles.rowDetail}>
              {detail}
            </Text>
            <Text
              variant="labelSmall"
              style={
                indicator === 'passed'
                  ? ui.green
                  : indicator === 'issue'
                    ? { color: colors.amber }
                    : ui.muted
              }
            >
              {status}
            </Text>
          </View>
          <Icon source="chevron-right" size={22} color={colors.blue} />
        </View>
      </TouchableRipple>
    );
  }

  const selectedRoomCode = activeItem?.startsWith('room:')
    ? (activeItem.slice(5) as MoveInRoomCheckCode)
    : null;
  const selectedRoomCheck = roomHandoverChecks.find((check) => check.code === selectedRoomCode);
  const selectedAsset = activeItem?.startsWith('asset:')
    ? draft?.assets.find((asset) => asset.id === activeItem.slice(6))
    : undefined;
  const modalTitle =
    activeItem === 'meter'
      ? `Ghi chỉ số ${meterTask?.label.toLocaleLowerCase('vi') ?? 'công tơ'}`
      : activeItem === 'legacy-inventory'
        ? 'Kiểm kê đầu vào của hợp đồng'
        : activeItem === 'room-summary'
          ? 'Hiện trạng tổng quan'
          : (selectedRoomCheck?.label ??
            selectedAsset?.name ??
            (activeItem === 'keys' ? 'Chìa khóa bàn giao' : ''));

  if (!allowed) return <Text>Không thể mở biên bản của cơ sở hoặc tài khoản này.</Text>;
  if (current?.notFound && legacyFallback) return <>{legacyFallback}</>;

  return (
    <Box style={compactPhone && staff ? wizardStyles.phoneRoot : undefined}>
      {compactPhone && staff ? (
        <View style={wizardStyles.section}>
          <Text variant="titleMedium" style={wizardStyles.compactTitle}>
            Kiểm tra bàn giao · phòng {draft?.roomNumber ?? contract.roomNumber ?? ''}
          </Text>
          <Text variant="bodySmall" style={ui.muted}>
            Điện nước, hiện trạng, tài sản và chìa khóa
          </Text>
        </View>
      ) : (
        <Heading
          title={
            staff
              ? `Kiểm tra bàn giao · phòng ${draft?.roomNumber ?? contract.roomNumber ?? ''}`
              : 'Biên bản bàn giao phòng'
          }
          detail={
            staff
              ? 'Một công việc: điện nước, hiện trạng, tài sản và chìa khóa'
              : 'Tổng hợp từ hợp đồng, công tơ và kiểm kê thực tế'
          }
        />
      )}
      {loading && <Text>Đang tải biên bản bàn giao…</Text>}
      {!loading && !draft && !error && (
        <Text>Chưa tìm thấy biên bản nháp cho hợp đồng này. Hãy yêu cầu Owner kiểm tra.</Text>
      )}
      {staff && draft && (
        <View style={wizardStyles.section}>
          <View style={wizardStyles.compactSummaryRow}>
            <Pill
              tone={
                draft.status === 'Confirmed' ? 'green' : draft.status === 'Ready' ? 'blue' : 'amber'
              }
            >
              {statusLabels[draft.status] ?? draft.status}
            </Pill>
            <Text style={[ui.muted, wizardStyles.compactLocation]}>{draft.locationName}</Text>
          </View>
          {draft.status === 'Draft' && draft.moveInTask?.status === 'Assigned' && (
            <>
              <Text variant="titleMedium">Chưa bắt đầu công việc</Text>
              <Text style={ui.muted}>
                Bắt đầu một lần để mở 4 mục kiểm tra. Bạn được chọn mục cần làm, ghi nhận thực tế và
                lưu riêng từng lần. Owner chịu trách nhiệm quyết định xử lý.
              </Text>
              <Action
                disabled={busy || loading}
                onPress={() =>
                  void run(beginWork, 'Đã bắt đầu công việc. Bạn có thể kiểm tra phòng và công tơ.')
                }
              >
                Bắt đầu công việc
              </Action>
            </>
          )}
          {(draft.status === 'Draft' || draft.status === 'ReinspectionRequested') &&
            !started &&
            draft.moveInTask?.status !== 'Assigned' && (
              <Text style={ui.muted}>
                Chưa thể ghi nhận. Nhiệm vụ bàn giao cần được phân công và bắt đầu đúng trạng thái.
              </Text>
            )}
          {draft.status === 'PendingOwnerReview' && (
            <Text style={ui.muted}>
              Đã gửi kết quả kiểm tra cho Owner. Bạn sẽ nhận được yêu cầu cụ thể nếu cần kiểm tra
              lại.
            </Text>
          )}
          {draft.status === 'ReinspectionRequested' && (
            <View style={wizardStyles.section}>
              <Text variant="titleMedium">Các mục Owner yêu cầu kiểm tra lại</Text>
              {!!draft.reinspectionHistory?.length && (
                <Text>
                  {draft.reinspectionHistory[draft.reinspectionHistory.length - 1]?.reason}
                </Text>
              )}
              {(draft.reinspectionItems ?? []).map((item, index) => (
                <View key={`${item.kind}:${item.code ?? item.assetId ?? index}`}>
                  <Button
                    mode="outlined"
                    disabled={busy || !started}
                    onPress={() => openReinspectionItem(item.kind, item.code, item.assetId)}
                  >
                    {moveInReinspectionLabel(item, draft)} · Mở kiểm tra
                  </Button>
                  <Text
                    variant="bodySmall"
                    style={isReinspectionItemComplete(item) ? ui.green : ui.muted}
                  >
                    {isReinspectionItemComplete(item)
                      ? 'Staff đã lưu kết quả kiểm tra lại'
                      : 'Cần ghi nhận kiểm tra lại'}
                  </Text>
                  {item.kind === 'Asset' && !!draft.moveInTask?.inventoryTaskId && (
                    <Text variant="bodySmall" style={ui.muted}>
                      Mở phiếu kiểm kê gốc, ghi nhận tình trạng Đạt và chụp ảnh minh chứng mới sau
                      khi Owner yêu cầu kiểm tra lại. Ảnh cũ không thay thế kết quả mới.
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
          {!!error && !activeItem && (
            <Text accessibilityRole="alert" style={ui.red}>
              {error}
            </Text>
          )}
          {!!notice && !activeItem && <Text style={ui.green}>{notice}</Text>}
          {started && (
            <View style={wizardStyles.step}>
              {sectionOpen && (
                <Button
                  icon="arrow-left"
                  mode="text"
                  disabled={busy}
                  style={{ alignSelf: 'flex-start' }}
                  onPress={() => {
                    setSectionOpen(false);
                    if (compactPhone) resetScroll?.();
                  }}
                >
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
                    <ProgressBar
                      progress={savedWizardSteps.filter(Boolean).length / staffSteps.length}
                      color={colors.blue}
                      style={wizardStyles.progress}
                    />
                    <Text variant="bodySmall" style={[ui.muted, { lineHeight: 20 }]}>
                      {savedWizardSteps.every(Boolean)
                        ? 'Đã lưu đủ 4 mục. Xác nhận hoàn thành để Owner xem xét biên bản.'
                        : `Chọn một mục để làm việc. Gợi ý tiếp theo: ${staffSteps[recommendedStep]!.title}.`}
                    </Text>
                  </>
                )}
              </View>
              {!sectionOpen ? (
                <View style={wizardStyles.workList}>
                  {staffSteps.map((step, index) =>
                    workEntry(
                      `section-${index}`,
                      `${index + 1}. ${step.title}`,
                      index === 0
                        ? `${Number(!!draft.electricity) + Number(!!draft.water)}/2 công tơ đã xác nhận`
                        : index === 1
                          ? `${checkedRooms}/7 khu vực đã kiểm tra`
                          : index === 2
                            ? `${checkedAssets}/${draft.assets.length} nhóm tài sản đã kiểm tra`
                            : `${draft.accessItems?.find((item) => item.type === 'RoomKey')?.quantity ?? 'Chưa ghi'} chìa khóa · ${(draft.keyEvidenceIds ?? []).length} ảnh chìa khóa`,
                      savedWizardSteps[index]
                        ? index === 1 && inspectionIssues.length
                          ? `Đã ghi nhận · ${inspectionIssues.length} khu vực có vấn đề`
                          : 'Đã lưu đủ'
                        : index === recommendedStep
                          ? 'Nên làm tiếp'
                          : 'Chưa hoàn tất',
                      () => goToStep(index),
                      savedWizardSteps[index],
                      index === 1 && inspectionIssues.length ? 'issue' : undefined,
                    ),
                  )}
                </View>
              ) : (
                <View style={wizardStyles.section}>
                  {wizardStep === 0 && (
                    <>
                      <Text>Điện: {draft.electricity?.value ?? 'Chưa ghi'} kWh</Text>
                      <Text>Nước: {draft.water?.value ?? 'Chưa ghi'} m³</Text>
                      <ContractInitialMeterTasks
                        contract={contract}
                        integrated
                        moveInTaskId={draft.moveInTask?.id}
                        moveInStarted={started}
                        refreshRevision={revision}
                        onOpenTask={(id, label) => {
                          setMeterTask({ id, label });
                          setActiveItem('meter');
                        }}
                      />
                      <Text variant="bodySmall" style={ui.muted}>
                        Mở từng công tơ để chụp OCR, đối chiếu và xác nhận. Bạn có thể làm các mục
                        khác trước; Owner chỉ duyệt khi điện nước đủ.
                      </Text>
                    </>
                  )}
                  {wizardStep === 1 && (
                    <View style={wizardStyles.workList}>
                      {workEntry(
                        'room-condition',
                        'Hiện trạng tổng quan',
                        draft.roomCondition || 'Ghi mô tả chung về phòng',
                        'Mở phiếu ghi nhận',
                        () => setActiveItem('room-summary'),
                        !!draft.roomCondition,
                      )}
                      {roomHandoverChecks.map(({ code, label }) => {
                        const check = (draft.roomChecks ?? []).find((item) => item.code === code);
                        return workEntry(
                          code,
                          label,
                          check?.notes || 'Kiểm tra thực tế',
                          check ? roomStatusLabels[check.status] : 'Chưa kiểm tra',
                          () => setActiveItem(`room:${code}`),
                          !!check,
                          check?.status === 'Issue'
                            ? 'issue'
                            : check?.status === 'NotApplicable'
                              ? 'not-applicable'
                              : undefined,
                        );
                      })}
                      {inspectionIssues.length > 0 && (
                        <Text style={ui.red}>
                          {inspectionIssues.length} khu vực có vấn đề. Owner xem ghi chú và ảnh để
                          quyết định xử lý.
                        </Text>
                      )}
                    </View>
                  )}
                  {wizardStep === 2 && (
                    <View style={wizardStyles.workList}>
                      {draft.moveInTask?.inventoryTaskId &&
                        workEntry(
                          'legacy-inventory',
                          'Đối chiếu kiểm kê đầu vào',
                          'Chọn từng tài sản để kiểm tra và lưu kết quả.',
                          draft.moveInTask.inventoryStatus === 'Completed'
                            ? 'Đã hoàn tất'
                            : 'Cần hoàn thành',
                          () => setActiveItem('legacy-inventory'),
                          draft.moveInTask.inventoryStatus === 'Completed',
                        )}
                      {draft.moveInTask?.inventoryTaskId && (
                        <Text
                          variant="bodySmall"
                          style={[ui.muted, { lineHeight: 20, flexShrink: 0 }]}
                        >
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
                        <Text style={ui.muted}>
                          {draft.noAssetsConfirmed
                            ? 'Owner đã xác nhận phòng không có tài sản.'
                            : 'Chưa có danh sách tài sản; cần Owner kiểm tra cấu hình.'}
                        </Text>
                      )}
                      {draft.moveInTask?.inventoryTaskId
                        ? draft.assets.map((asset) => {
                            const item = inventory?.items.find((entry) => entry.id === asset.id);
                            const saved = !!item && hasSavedInventoryItem(item);
                            const passed = saved && item?.condition === 'Good';
                            const problem =
                              saved &&
                              (item?.condition === 'Missing' || item?.condition === 'Damaged');
                            return (
                              <View
                                key={asset.id}
                                style={[
                                  wizardStyles.workRow,
                                  compactPhone && wizardStyles.phoneWorkRow,
                                ]}
                              >
                                <View style={wizardStyles.rowContent}>
                                  <Icon
                                    source={
                                      passed
                                        ? 'check-circle-outline'
                                        : problem
                                          ? 'alert-circle-outline'
                                          : 'checkbox-blank-circle-outline'
                                    }
                                    size={23}
                                    color={
                                      passed ? colors.green : problem ? colors.amber : colors.blue
                                    }
                                  />
                                  <View style={wizardStyles.rowText}>
                                    <Text variant="titleSmall" style={wizardStyles.rowTitle}>
                                      {asset.name}
                                    </Text>
                                    <Text variant="bodySmall" style={wizardStyles.rowDetail}>
                                      {item
                                        ? `Dự kiến ${item.expectedQuantity} · Thực tế ${item.actualQuantity ?? 'chưa ghi'}`
                                        : `Dự kiến ${asset.configuredQuantity ?? 'chưa rõ'} ${asset.unit ?? 'đơn vị'}`}
                                    </Text>
                                    <Text
                                      variant="labelSmall"
                                      style={
                                        passed
                                          ? ui.green
                                          : problem
                                            ? { color: colors.amber }
                                            : ui.muted
                                      }
                                    >
                                      {saved
                                        ? `Đã kiểm kê · ${inventoryStatusLabels[item!.condition!]}`
                                        : 'Chưa kiểm kê'}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            );
                          })
                        : draft.assets.map((asset) =>
                            workEntry(
                              asset.id,
                              asset.name,
                              asset.configuredQuantity == null
                                ? 'Đối chiếu tình trạng thực tế'
                                : `Cần đối chiếu ${asset.configuredQuantity} ${asset.unit ?? 'đơn vị'}`,
                              asset.checked ? 'Đã kiểm tra' : 'Chưa kiểm tra',
                              () => setActiveItem(`asset:${asset.id}`),
                              asset.checked,
                            ),
                          )}
                    </View>
                  )}
                  {wizardStep === 3 && (
                    <View style={wizardStyles.workList}>
                      {workEntry(
                        'keys',
                        'Chìa khóa bàn giao',
                        `${draft.accessItems?.find((item) => item.type === 'RoomKey')?.quantity ?? 'Chưa ghi'} chiếc · ${(draft.keyEvidenceIds ?? []).length} ảnh chìa khóa (tùy chọn)`,
                        (draft.accessItems ?? []).length === 1 &&
                          draft.accessItems?.[0]?.type === 'RoomKey'
                          ? 'Đã ghi nhận'
                          : 'Chưa hoàn tất',
                        () => setActiveItem('keys'),
                        (draft.accessItems ?? []).length === 1 &&
                          draft.accessItems?.[0]?.type === 'RoomKey',
                      )}
                    </View>
                  )}
                  <Text variant="bodySmall" style={ui.muted}>
                    Thông tin chỉ được lưu trên máy chủ sau khi bấm Lưu trong phiếu. Chuyển mục
                    không tự phát hành biên bản.
                  </Text>
                </View>
              )}
            </View>
          )}
          {started && (
            <View style={wizardStyles.section}>
              <Text variant="titleMedium">
                {draft.status === 'ReinspectionRequested'
                  ? 'Hoàn thành kiểm tra lại'
                  : 'Hoàn thành nhiệm vụ kiểm tra'}
              </Text>
              <Text style={ui.muted}>
                {inspectionReady
                  ? 'Đã ghi nhận đủ 4 mục, kể cả hạng mục thiếu hoặc hỏng. Xác nhận hoàn thành để Owner duyệt và quyết định xử lý.'
                  : draft.status === 'ReinspectionRequested' && !reinspectionReady
                    ? 'Bạn cần mở và lưu lại từng hạng mục Owner yêu cầu kiểm tra trước khi gửi duyệt.'
                    : `Cần lưu đủ 4 mục trước khi xác nhận. Hiện đã hoàn thành ${savedWizardSteps.filter(Boolean).length}/4 mục.`}
              </Text>
              <Action
                disabled={busy || !inspectionReady || !!activeItem}
                onPress={() =>
                  void run(
                    submitInspection,
                    draft.status === 'ReinspectionRequested'
                      ? 'Đã nộp kết quả kiểm tra lại cho Owner.'
                      : 'Đã xác nhận hoàn thành kiểm tra. Biên bản đang chờ Owner duyệt.',
                  )
                }
              >
                {draft.status === 'ReinspectionRequested'
                  ? 'Xác nhận hoàn thành kiểm tra lại'
                  : 'Xác nhận hoàn thành'}
              </Action>
            </View>
          )}
        </View>
      )}
      {draft && !editing && tenant && (
        <TenantMoveInHandoverSummary
          api={api}
          contractId={contract.id}
          draft={draft}
          documents={current?.documents ?? []}
          documentsError={current?.documentsError}
          documentsLoading={current?.documentsLoading}
        />
      )}

      {staff && draft?.status === 'Ready' && (
        <Text>Owner đã đánh dấu sẵn sàng. Tenant có thể xem và xác nhận biên bản.</Text>
      )}
      {staff && draft?.status === 'ChangesRequested' && (
        <Text>
          Đã có yêu cầu sửa từ Tenant. Chờ Owner quyết định trước khi Staff cập nhật biên bản.
        </Text>
      )}
      {staff && draft && started && (
        <Modal visible={!!activeItem} transparent animationType="slide" onRequestClose={closeItem}>
          <KeyboardAvoidingView
            style={[wizardStyles.modalOverlay, compactPhone && wizardStyles.phoneModalOverlay]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[wizardStyles.modalCard, compactPhone && wizardStyles.phoneModalCard]}>
              <View
                style={[wizardStyles.modalHeader, compactPhone && wizardStyles.phoneModalHeader]}
              >
                <Row spread>
                  <View style={wizardStyles.rowText}>
                    <Text variant="titleMedium" style={wizardStyles.rowTitle}>
                      {modalTitle}
                    </Text>
                  </View>
                  <Button mode="text" disabled={busy} onPress={closeItem}>
                    Đóng
                  </Button>
                </Row>
              </View>
              <ScrollView
                ref={modalScroll}
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
                    taskId={meterTask.id}
                    onReturn={() => {
                      setActiveItem(null);
                      setMeterTask(null);
                      setRevision((value) => value + 1);
                    }}
                  />
                )}
                {activeItem === 'legacy-inventory' && draft.moveInTask?.inventoryTaskId && (
                  <StaffMoveInInventoryScreen
                    embeddedTaskId={draft.moveInTask.inventoryTaskId}
                    developmentDemo={contract.isDevelopmentDemo === true}
                    onPaneChange={() => modalScroll.current?.scrollTo({ y: 0, animated: false })}
                  />
                )}
                {activeItem === 'room-summary' && (
                  <Input
                    label="Hiện trạng phòng"
                    value={values.roomCondition ?? ''}
                    disabled={busy}
                    multiline
                    onChange={(value) => set('roomCondition', value)}
                  />
                )}
                {selectedRoomCode && selectedRoomCheck && (
                  <View style={wizardStyles.section}>
                    <Text variant="bodySmall" style={ui.muted}>
                      Chọn Không áp dụng nếu hạng mục không có tại phòng.
                    </Text>
                    {compactPhone ? (
                      <View style={wizardStyles.conditionOptions}>
                        {(
                          [
                            ['Passed', 'Đạt'],
                            ['Issue', 'Có vấn đề'],
                            ['NotApplicable', 'Không áp dụng'],
                          ] as const
                        ).map(([value, label]) => (
                          <RadioButton.Item
                            key={value}
                            label={label}
                            value={value}
                            status={
                              values['roomCheck.' + selectedRoomCode + '.status'] === value
                                ? 'checked'
                                : 'unchecked'
                            }
                            onPress={() => setRoomCheck(selectedRoomCode, 'status', value)}
                            disabled={busy}
                            mode="android"
                            color={colors.blue}
                            style={[
                              wizardStyles.conditionOption,
                              values['roomCheck.' + selectedRoomCode + '.status'] === value &&
                                wizardStyles.conditionSelected,
                            ]}
                          />
                        ))}
                      </View>
                    ) : (
                      <SegmentedButtons
                        value={values['roomCheck.' + selectedRoomCode + '.status'] ?? ''}
                        onValueChange={(value) => setRoomCheck(selectedRoomCode, 'status', value)}
                        density="small"
                        buttons={[
                          { value: 'Passed', label: 'Đạt', disabled: busy },
                          { value: 'Issue', label: 'Có vấn đề', disabled: busy },
                          { value: 'NotApplicable', label: 'Không áp dụng', disabled: busy },
                        ]}
                      />
                    )}
                    {!!values['roomCheck.' + selectedRoomCode + '.status'] && (
                      <Input
                        label={'Ghi chú · ' + selectedRoomCheck.label}
                        value={values['roomCheck.' + selectedRoomCode + '.notes'] ?? ''}
                        disabled={busy}
                        multiline
                        onChange={(value) => setRoomCheck(selectedRoomCode, 'notes', value)}
                      />
                    )}
                    {!!values['roomCheck.' + selectedRoomCode + '.status'] && (
                      <>
                        <Text variant="bodySmall" style={ui.muted}>
                          Ảnh minh chứng (không bắt buộc).
                        </Text>
                        {photoCapture('room', selectedRoomCode)}
                      </>
                    )}
                  </View>
                )}
                {selectedAsset && (
                  <View style={wizardStyles.section}>
                    <HandoverAssetFields
                      asset={selectedAsset}
                      values={values}
                      set={set}
                      evidenceIds={availableEvidence}
                      disabled={busy}
                      quantities={!!draft.inventoryToken}
                      showCheckWithoutQuantities
                      compact
                      embedded
                      hideEvidenceChoices
                    />
                    {photoCapture('asset', selectedAsset.id)}
                  </View>
                )}
                {activeItem === 'keys' && (
                  <View style={wizardStyles.section}>
                    <Input
                      label="Số lượng chìa khóa bàn giao"
                      numeric
                      value={keyQuantity}
                      disabled={busy}
                      onChange={(value) => {
                        setKeyQuantity(value);
                      }}
                    />
                    <Input
                      label="Ghi chú chìa khóa (nếu có)"
                      multiline
                      value={keyNotes}
                      disabled={busy}
                      onChange={(value) => {
                        setKeyNotes(value);
                      }}
                    />
                    {photoCapture('keys')}
                  </View>
                )}
                {!!error && (
                  <Text accessibilityRole="alert" style={ui.red}>
                    {error}
                  </Text>
                )}
                {!!notice && <Text style={ui.green}>{notice}</Text>}
              </ScrollView>
              {activeItem !== 'meter' && activeItem !== 'legacy-inventory' && (
                <View
                  style={[wizardStyles.modalFooter, compactPhone && wizardStyles.phoneModalFooter]}
                >
                  <View style={{ flex: 1 }}>
                    <Button mode="outlined" disabled={busy} onPress={closeItem}>
                      Để sau
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      mode="contained"
                      loading={busy}
                      disabled={busy || loading}
                      onPress={() => void run(saveDraft, 'Đã lưu kết quả kiểm tra trên máy chủ.')}
                    >
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
              <Heading
                title="Ký biên bản bàn giao"
                detail="Đọc PDF Owner đã ký và ký trực tiếp bằng tài khoản Tenant đang đăng nhập"
              />
              {contract.status !== 'Active' && (
                <Text style={ui.muted}>Chờ hợp đồng được kích hoạt để ký nhận bàn giao.</Text>
              )}
              {contract.status === 'Active' && (
                <>
                  <Text variant="titleSmall">Chữ ký của Tenant</Text>
                  <SignaturePad disabled={busy} onChange={setTenantDrawing} />
                  <Checkbox.Item
                    label="Tôi đã xem biên bản và đồng ý nhận phòng theo hiện trạng ghi nhận, kể cả các mục có vấn đề"
                    status={acknowledged ? 'checked' : 'unchecked'}
                    disabled={busy}
                    onPress={() => setAcknowledged(!acknowledged)}
                  />
                  <Action
                    disabled={busy || !acknowledged || !tenantDrawing}
                    onPress={() =>
                      void run(
                        signTenantInSession,
                        'Đã ký và hoàn thành bàn giao. PDF có đủ chữ ký đã được lưu.',
                      )
                    }
                  >
                    Ký và hoàn tất bàn giao
                  </Action>
                </>
              )}
              <Action
                secondary
                disabled={busy}
                onPress={() => {
                  setActionError('');
                  setCorrectionReason('');
                  setCorrectionOpen(true);
                }}
              >
                Gửi yêu cầu chỉnh sửa
              </Action>
            </>
          ) : (
            <Text>
              Biên bản đang được Staff kiểm tra hoặc Owner xem xét. Bạn sẽ nhận được bản PDF đã ký
              của Owner trước khi ký nhận bàn giao.
            </Text>
          )}
        </>
      )}
      {tenant && draft && correctionOpen && (
        <Modal visible transparent animationType="slide" onRequestClose={closeCorrection}>
          <KeyboardAvoidingView
            style={[wizardStyles.modalOverlay, compactPhone && wizardStyles.phoneModalOverlay]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View
              style={[
                wizardStyles.modalCard,
                { maxWidth: 460 },
                compactPhone && wizardStyles.phoneModalCard,
              ]}
            >
              <View
                style={[wizardStyles.modalHeader, compactPhone && wizardStyles.phoneModalHeader]}
              >
                <Row spread>
                  <Text variant="titleMedium" style={wizardStyles.rowTitle}>
                    Yêu cầu chỉnh sửa biên bản
                  </Text>
                  <Button mode="text" disabled={busy} onPress={closeCorrection}>
                    Đóng
                  </Button>
                </Row>
              </View>
              <ScrollView
                style={{ flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  wizardStyles.modalBody,
                  compactPhone && wizardStyles.phoneModalBody,
                ]}
              >
                <Text style={ui.muted}>Mô tả nội dung cần Owner kiểm tra và chỉnh sửa.</Text>
                <Input
                  label="Lý do yêu cầu chỉnh sửa"
                  multiline
                  value={correctionReason}
                  disabled={busy}
                  onChange={(value) => setCorrectionReason(value.slice(0, 2000))}
                />
                {!!actionError && (
                  <Text accessibilityRole="alert" style={ui.red}>
                    {actionError}
                  </Text>
                )}
              </ScrollView>
              <View
                style={[wizardStyles.modalFooter, compactPhone && wizardStyles.phoneModalFooter]}
              >
                <View style={{ flex: 1 }}>
                  <Button mode="outlined" disabled={busy} onPress={closeCorrection}>
                    Hủy
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    mode="contained"
                    loading={busy}
                    disabled={busy || !correctionReason.trim()}
                    onPress={() => {
                      void (async () => {
                        const succeeded = await run(
                          requestTenantCorrection,
                          'Đã gửi yêu cầu sửa biên bản cho Owner.',
                        );
                        if (succeeded) {
                          setCorrectionOpen(false);
                          setCorrectionReason('');
                        }
                      })();
                    }}
                  >
                    Gửi yêu cầu
                  </Button>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
      {(!staff || !draft) && !!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {(!staff || !draft) && !!notice && <Text style={ui.green}>{notice}</Text>}
    </Box>
  );
}
