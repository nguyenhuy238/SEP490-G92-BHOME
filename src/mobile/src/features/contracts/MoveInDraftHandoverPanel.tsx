import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Checkbox, ProgressBar, SegmentedButtons, Text } from 'react-native-paper';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
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
  { title: 'Kiểm kê tài sản', detail: 'Đối chiếu số lượng và tình trạng từng tài sản được giao.' },
  { title: 'Chìa khóa và ảnh bàn giao', detail: 'Đếm chìa khóa, thẻ ra vào và bổ sung ảnh toàn cảnh trước khi lưu.' },
] as const;

const wizardStyles = StyleSheet.create({
  header: { gap: 10, paddingVertical: 4 },
  step: { gap: 14 },
  section: { gap: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  progress: { height: 6, borderRadius: 6, backgroundColor: colors.tint },
  divider: { height: 1, backgroundColor: colors.border },
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

function firstUnfinishedStep(value: MoveInDraft): number {
  if (!value.electricity || !value.water) return 0;
  if (!hasCompleteRoomInspection(value)) return 1;
  if (!hasCompleteAssetInspection(value)) return 2;
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
  const { staffLocationId } = useWorkspace();
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
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
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
  const started = canStaffEditMoveIn(draft);
  const checkedRooms = (draft?.roomChecks ?? []).length;
  const checkedAssets = (draft?.assets ?? []).filter((asset) => asset.checked).length;
  const inspectionIssues = (draft?.roomChecks ?? []).filter((check) => check.status === 'Issue');
  const savedWizardSteps = draft ? [
    !!draft.electricity && !!draft.water,
    hasCompleteRoomInspection(draft),
    hasCompleteAssetInspection(draft),
    !!draft.keysAndAccess?.trim() && (draft.accessItems ?? []).length > 0 && (draft.evidenceIds ?? []).length > 0,
  ] : [false, false, false, false];
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
        if (staff && loadedWizardContract.current !== contract.id) {
          loadedWizardContract.current = contract.id;
          setWizardStep(firstUnfinishedStep(value));
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
          setResponse({ key, record: value, error: '', notFound: false, documents, documentsError });
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

  async function run(command: () => Promise<unknown>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await command();
      setNotice(success);
      setRevision((value) => value + 1);
      onUpdated?.();
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
  }

  async function uploadInspectionPhoto(bytes: Uint8Array<ArrayBuffer>, assetPhoto: boolean) {
    if (!started) throw new Error('Hãy bắt đầu công việc trước khi chụp ảnh kiểm kê.');
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá 5 MB.');
    const file = await client.uploadEvidence(contract.id, bytes, 'image/jpeg');
    setEvidencePool((items) => [...new Set([...items, file.id])]);
    // Asset exceptions need evidence separate from general room photos.
    if (!assetPhoto) setSelectedEvidence((items) => [...new Set([...items, file.id])]);
    setPhotoSafe(false);
  }

  // The returned camera callback only reads the mutation lock after the user
  // confirms a capture; this helper is evaluated during render, not the callback.
  /* eslint-disable react-hooks/refs */
  function photoCapture(kind: 'room' | 'asset' | 'general') {
    const assetPhoto = kind === 'asset';
    return (
      <View style={wizardStyles.section}>
        <Heading
          title={assetPhoto ? 'Ảnh kiểm kê tài sản' : kind === 'room' ? 'Ảnh hiện trạng phòng' : 'Ảnh bàn giao chung'}
          detail={assetPhoto
            ? 'Khi tài sản thiếu hoặc hỏng, hãy tải ảnh rồi gắn riêng vào đúng tài sản ở phía trên.'
            : kind === 'room'
              ? 'Ảnh giúp Owner đối chiếu hiện trạng. Với mục có vấn đề, chọn ảnh ngay tại khu vực đó.'
              : 'Chụp ít nhất một ảnh toàn cảnh, rõ phòng và không có giấy tờ cá nhân.'}
        />
        <Checkbox.Item
          label="Ảnh không có giấy tờ cá nhân hoặc thông tin riêng tư"
          status={photoSafe ? 'checked' : 'unchecked'}
          onPress={() => setPhotoSafe((value) => !value)}
          disabled={busy}
        />
        <CameraCapture
          label={assetPhoto ? 'Chụp ảnh tài sản' : 'Chụp ảnh hiện trạng bàn giao'}
          reviewBeforeSubmit
          reviewActionLabel="Dùng ảnh này làm bằng chứng bàn giao"
          reviewNotice="Kiểm tra đúng phòng, đủ rõ và không chứa giấy tờ cá nhân trước khi tải lên."
          disabled={busy || !photoSafe || availableEvidence.length >= 10}
          onCapture={(bytes) => run(
            () => uploadInspectionPhoto(bytes, assetPhoto),
            assetPhoto ? 'Đã tải ảnh tài sản. Hãy gắn ảnh vào mục tài sản tương ứng.' : 'Đã tải ảnh hiện trạng lên máy chủ.',
          )}
        />
        {canUploadSample && (
          <Action secondary disabled={busy || !photoSafe || availableEvidence.length >= 10}
            onPress={() => void run(async () => {
              if (!canUploadSample) return;
              const bytes = handoverDemoJpeg();
              try {
                await uploadInspectionPhoto(bytes, assetPhoto);
              } finally {
                bytes.fill(0);
              }
            }, 'Đã tải ảnh giả lập DEV lên biên bản test.')}>
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
  /* eslint-enable react-hooks/refs */

  if (!allowed) return <Text>Không thể mở biên bản của cơ sở hoặc tài khoản này.</Text>;
  if (current?.notFound && legacyFallback) return <>{legacyFallback}</>;

  return (
    <Box>
      <Heading
        title={staff ? `Kiểm tra bàn giao · phòng ${draft?.roomNumber ?? contract.roomNumber ?? ''}` : 'Biên bản bàn giao phòng'}
        detail={staff ? 'Một công việc: điện nước, hiện trạng, tài sản và chìa khóa' : 'Tổng hợp từ hợp đồng, công tơ và kiểm kê thực tế'}
      />
      {loading && <Text>Đang tải biên bản bàn giao…</Text>}
      {!loading && !draft && !error && (
        <Text>Chưa tìm thấy biên bản nháp cho hợp đồng này. Hãy yêu cầu Owner kiểm tra.</Text>
      )}
      {staff && draft && (
        <View style={wizardStyles.section}>
          <Row spread>
            <Pill tone={draft.status === 'Confirmed' ? 'green' : draft.status === 'Ready' ? 'blue' : 'amber'}>
              {statusLabels[draft.status] ?? draft.status}
            </Pill>
            <Text style={ui.muted}>{draft.locationName}</Text>
          </Row>
          {draft.status === 'Draft' && draft.moveInTask?.status === 'Assigned' && (
            <>
              <Text variant="titleMedium">Chưa bắt đầu công việc</Text>
              <Text style={ui.muted}>Sau khi bắt đầu, bạn sẽ được hướng dẫn lần lượt qua 4 bước kiểm tra. Staff chỉ ghi nhận hiện trạng; Owner quyết định việc xử lý.</Text>
              <Action disabled={busy || loading} onPress={() => void run(beginWork, 'Đã bắt đầu công việc. Bạn có thể kiểm tra phòng và công tơ.')}>
                Bắt đầu công việc
              </Action>
            </>
          )}
          {draft.status === 'Draft' && !started && draft.moveInTask?.status !== 'Assigned' && (
            <Text style={ui.muted}>Chưa thể ghi nhận. Nhiệm vụ bàn giao cần được phân công và bắt đầu đúng trạng thái.</Text>
          )}
          {!!error && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
          {!!notice && <Text style={ui.green}>{notice}</Text>}
          {started && (
            <View style={wizardStyles.step}>
              <View style={wizardStyles.header}>
                <Row spread>
                  <Text variant="labelMedium" style={ui.blue}>BƯỚC {wizardStep + 1} / {staffSteps.length}</Text>
                  <Text variant="labelSmall" style={ui.muted}>{savedWizardSteps.filter(Boolean).length}/4 bước đã ghi nhận</Text>
                </Row>
                <ProgressBar progress={(wizardStep + 1) / staffSteps.length}
                  color={colors.blue} style={wizardStyles.progress} />
                <Heading title={staffSteps[wizardStep]!.title} detail={staffSteps[wizardStep]!.detail} />
                <Row spread>
                  <Pill tone={savedWizardSteps[wizardStep] ? 'green' : 'amber'}>
                    {savedWizardSteps[wizardStep] ? 'Đã ghi nhận' : 'Cần kiểm tra'}
                  </Pill>
                  <Text variant="labelSmall" style={ui.muted}>
                    {wizardStep === 1 ? `${checkedRooms}/7 khu vực` :
                      wizardStep === 2 ? `${checkedAssets}/${draft.assets.length} nhóm tài sản` :
                        wizardStep === 0 ? `${Number(!!draft.electricity) + Number(!!draft.water)}/2 công tơ` : 'Kiểm tra quyền ra vào'}
                  </Text>
                </Row>
              </View>
              {wizardStep === 0 && (
                <View style={wizardStyles.section}>
                  <ContractInitialMeterTasks contract={contract} integrated />
                  {(!draft.electricity || !draft.water) && (
                    <Text style={ui.muted}>Có thể tiếp tục kiểm kê phòng nếu công tơ chưa xác nhận được. Owner chỉ có thể duyệt khi các điều kiện Backend đã đủ.</Text>
                  )}
                  <Action disabled={busy || loading} onPress={() => goToStep(1)}>Tiếp tục kiểm tra</Action>
                </View>
              )}
              {wizardStep > 0 && !editing && (
                <View style={wizardStyles.section}>
                  <Text style={ui.muted}>Mở bước này để ghi nhận kết quả. Kết quả đã lưu vẫn có thể kiểm tra lại trước khi Owner duyệt.</Text>
                  <Action disabled={busy || loading} onPress={beginEdit}>Tiếp tục kiểm tra</Action>
                </View>
              )}
              {inspectionIssues.length > 0 && wizardStep === 1 && (
                <Text style={ui.red}>{inspectionIssues.length} khu vực đã ghi nhận có vấn đề. Owner sẽ xem ghi chú và ảnh để quyết định xử lý.</Text>
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
      {staff && editing && draft && started && wizardStep > 0 && (
        <>
          {wizardStep === 1 && (
            <View style={wizardStyles.section}>
              <Input label="Hiện trạng phòng" value={values.roomCondition ?? ''} disabled={busy} multiline
                onChange={(value) => setValues((prev) => ({ ...prev, roomCondition: value }))} />
              <Text style={ui.muted}>Chọn kết quả từng khu vực. Chỉ cần ghi chú khi có vấn đề hoặc không áp dụng.</Text>
              {roomHandoverChecks.map(({ code, label }, index) => {
            const status = values[`roomCheck.${code}.status`] ?? '';
            return (
              <View key={code} style={wizardStyles.section}>
                {index > 0 && <View style={wizardStyles.divider} />}
                <Text variant="titleMedium">{index + 1}. {label}</Text>
                <SegmentedButtons
                  value={status}
                  onValueChange={(next) => setRoomCheck(code, 'status', next)}
                  density="small"
                  buttons={[
                    { value: 'Passed', label: 'Đạt', disabled: busy },
                    { value: 'Issue', label: 'Có vấn đề', disabled: busy },
                    { value: 'NotApplicable', label: 'Không áp dụng', disabled: busy },
                  ]}
                />
                {!!status && (
                  <Input label={`Ghi chú · ${label}`}
                    multiline
                    value={values[`roomCheck.${code}.notes`] ?? ''}
                    disabled={busy}
                    onChange={(value) => setRoomCheck(code, 'notes', value)} />
                )}
                {status === 'Issue' && (
                  <>
                    <Text style={ui.muted}>Gắn ít nhất một ảnh đã tải lên trực tiếp cho mục có vấn đề này.</Text>
                    {availableEvidence.map((id, photoIndex) => (
                      <Checkbox.Item
                        key={id}
                        label={`Gắn ảnh ${photoIndex + 1} cho ${label}`}
                        status={values[`roomCheck.${code}.evidence.${id}`] === 'true' ? 'checked' : 'unchecked'}
                        onPress={() => setRoomCheck(code, `evidence.${id}`,
                          values[`roomCheck.${code}.evidence.${id}`] === 'true' ? 'false' : 'true')}
                        disabled={busy}
                      />
                    ))}
                    {!availableEvidence.length && <Text style={ui.red}>Hãy chụp ảnh hiện trạng ở phần ảnh bên dưới trước khi lưu mục này.</Text>}
                  </>
                )}
              </View>
            );
              })}
              {photoCapture('room')}
            </View>
          )}
          {wizardStep === 3 && (
            <View style={wizardStyles.section}>
              <Input label="Chìa khóa / quyền truy cập" value={values.keysAndAccess ?? ''} disabled={busy} multiline
                onChange={(value) => setValues((prev) => ({ ...prev, keysAndAccess: value }))} />
              <Input label="Ghi chú bàn giao" value={values.notes ?? ''} disabled={busy} multiline
                onChange={(value) => setValues((prev) => ({ ...prev, notes: value }))} />
          <Heading title="Bàn giao chìa khóa, thẻ và quyền ra vào"
            detail="Kê số lượng thực tế từng loại. Quyền truy cập số có thể là 0, nhưng phải có ghi chú cách sử dụng." />
          {accessItems.map((item, index) => (
            <View key={index} style={ui.soft}>
              <Text variant="titleMedium">{moveInAccessKinds.find((kind) => kind.type === item.type)?.label ?? item.type}</Text>
              <Input label={`Số lượng bàn giao ${index + 1}`} value={item.quantity} numeric disabled={busy}
                onChange={(value) => updateAccessItem(index, 'quantity', value)} />
              <Input label={`Ghi chú quyền ra vào ${index + 1}`} value={item.notes} multiline disabled={busy}
                onChange={(value) => updateAccessItem(index, 'notes', value)} />
              <Action secondary disabled={busy} onPress={() => {
                setAccessItems((previous) => previous.filter((_, position) => position !== index));
                setAccessItemsTouched(true);
              }}>Xóa dòng bàn giao {index + 1}</Action>
            </View>
          ))}
              <View style={wizardStyles.actions}>
                {moveInAccessKinds.map(({ type, label }) => (
                  <Button key={type} compact mode="outlined"
                    disabled={busy || accessItems.some((item) => item.type === type)}
                    onPress={() => {
                      const quantity = type === 'DigitalAccess' ? '0' : '1';
                      setAccessItems((previous) => [...previous, { type, quantity, notes: '' }]);
                      setAccessItemsTouched(true);
                    }}>Thêm {label.toLocaleLowerCase('vi')}</Button>
                ))}
              </View>
            </View>
          )}
          {wizardStep === 2 && (
            <View style={wizardStyles.section}>
          <Heading title="Kiểm kê tài sản" detail="Đánh dấu từng nhóm đã kiểm tra để lưu theo tiến độ" />
          {!draft.assets.length && (
            <Text style={ui.muted}>{draft.noAssetsConfirmed
              ? 'Owner đã xác nhận phòng không có tài sản để bàn giao.'
              : 'Chưa có danh sách tài sản. Liên hệ Owner để kiểm tra.'}</Text>
          )}
          {draft.assets.map((asset) => (
            <HandoverAssetFields
              key={asset.id}
              asset={asset}
              values={values}
              set={set}
              evidenceIds={availableEvidence}
              disabled={busy}
              quantities={!!draft.inventoryToken}
              showCheckWithoutQuantities
              compact
            />
          ))}
              {photoCapture('asset')}
            </View>
          )}
          {wizardStep === 3 && photoCapture('general')}
          {availableEvidence.length >= 10 && <Text style={ui.muted}>Đã đạt tối đa 10 ảnh hiện trạng trong bản nháp.</Text>}
          <View style={wizardStyles.actions}>
            <Button mode="outlined" disabled={busy || loading} onPress={() => goToStep(wizardStep - 1)}>
              Quay lại
            </Button>
            {wizardStep < 3 && (
              <Button mode="outlined" disabled={busy || loading} onPress={() => goToStep(wizardStep + 1)}>
                Tiếp theo: {staffSteps[wizardStep + 1]!.title}
              </Button>
            )}
          </View>
          <Text variant="bodySmall" style={ui.muted}>
            Đổi bước không tự lưu lên máy chủ. Bấm Lưu tiến độ để giữ kết quả khi rời màn hình.
          </Text>
          <Action disabled={busy || loading} onPress={() => void run(saveDraft, 'Đã cập nhật biên bản nháp trên máy chủ.')}>Lưu tiến độ bàn giao</Action>
          <Action secondary disabled={busy} onPress={() => setEditing(false)}>Đóng biểu mẫu</Action>
        </>
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
      <Action secondary disabled={busy || loading} onPress={() => setRevision((value) => value + 1)}>Tải lại biên bản</Action>
    </Box>
  );
}
