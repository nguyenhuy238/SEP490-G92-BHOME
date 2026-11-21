import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { mutationKeys } from '../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { InventoryPhotoCapture } from '../components/InventoryPhotoCapture';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, MobileApiError } from '../lib/api';
import { randomUUID } from '../lib/randomUUID';
import { showSuccess } from '../lib/toast';
import { operationalTasks } from '../services/operationalTasks';
import {
  inventoryStatusLabels,
  moveInInventoryClient,
  readyToComplete,
  validateInventoryItem,
  type InventoryCondition,
  type MoveInInventory,
  type MoveInInventoryItem,
} from '../services/moveInInventory';
import type { IncidentPhoto } from '../services/incidents';
import { colors } from '../theme/theme';

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const inventoryStyles = {
  embeddedSection: {
    paddingHorizontal: 0,
    paddingVertical: 12,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  itemTitle: { flex: 1, minWidth: 0 },
  selector: { padding: 0, borderWidth: 0, backgroundColor: 'transparent', borderRadius: 0, gap: 8 },
  summaryRow: {
    paddingHorizontal: 0,
    paddingVertical: 10,
    gap: 7,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
};
const conditions: { value: InventoryCondition; label: string }[] = [
  { value: 'Good', label: 'Đạt' },
  { value: 'Missing', label: 'Thiếu' },
  { value: 'Damaged', label: 'Hư hỏng' },
];
type ItemDraft = {
  quantity: string;
  condition: InventoryCondition | '';
  notes: string;
  photos: IncidentPhoto[];
  removedEvidenceIds: string[];
  dirty: boolean;
};
type ItemFieldErrors = Partial<Record<'quantity' | 'condition' | 'notes' | 'photos', string>>;
function validateItemDraft(
  item: MoveInInventoryItem,
  draft: ItemDraft,
  reinspectionSelected = false,
): ItemFieldErrors {
  const errors: ItemFieldErrors = {};
  const quantity = Number(draft.quantity);
  const photoCount =
    (item.evidenceIds ?? []).filter((id) => !draft.removedEvidenceIds.includes(id)).length +
    draft.photos.length;
  if (!/^\d+$/.test(draft.quantity.trim()))
    errors.quantity = 'Nhập số lượng thực tế (số nguyên từ 0).';
  else if (!Number.isSafeInteger(quantity) || quantity > item.expectedQuantity)
    errors.quantity = `Số lượng thực tế không được vượt ${item.expectedQuantity}.`;
  if (!draft.condition) errors.condition = 'Chọn tình trạng của tài sản.';
  else if (!errors.quantity && draft.condition === 'Good' && quantity !== item.expectedQuantity)
    errors.quantity = `Tài sản Đạt phải đủ ${item.expectedQuantity}.`;
  else if (!errors.quantity && draft.condition === 'Missing' && quantity >= item.expectedQuantity)
    errors.quantity = 'Chọn Thiếu khi số lượng thực tế ít hơn số dự kiến.';
  if (draft.condition === 'Missing' || draft.condition === 'Damaged') {
    if (!draft.notes.trim()) errors.notes = 'Mô tả tình trạng thiếu hoặc hư hỏng.';
    else if (draft.notes.length > 2000) errors.notes = 'Ghi chú không quá 2000 ký tự.';
    if (photoCount === 0) errors.photos = 'Chụp ít nhất 1 ảnh minh chứng.';
  }
  if (photoCount > 5) errors.photos = 'Tối đa 5 ảnh minh chứng.';
  if (
    reinspectionSelected &&
    draft.condition === 'Good' &&
    item.condition !== 'Good' &&
    draft.photos.length === 0
  ) {
    errors.photos = 'Kiểm tra lại tài sản đã sửa cần chụp ảnh mới sau yêu cầu của Owner.';
  }
  return errors;
}
function fromItem(item: MoveInInventoryItem): ItemDraft {
  return {
    quantity: item.actualQuantity === null ? '' : String(item.actualQuantity),
    condition: item.condition ?? '',
    notes: item.notes ?? '',
    photos: [],
    removedEvidenceIds: [],
    dirty: false,
  };
}

export function StaffMoveInInventoryScreen({
  embeddedTaskId,
  onPaneChange,
  developmentDemo = false,
}: {
  embeddedTaskId?: string;
  onPaneChange?: () => void;
  developmentDemo?: boolean;
}) {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { role, preview } = useWorkspace();
  const { session } = useSession();
  if (role !== 'Staff' || preview || !session?.roles.includes('Staff'))
    return <Text>Đăng nhập tài khoản Staff để kiểm kê trước nhận phòng.</Text>;
  const selectedTaskId = embeddedTaskId ?? taskId;
  return selectedTaskId && guidPattern.test(selectedTaskId) ? (
    <InventoryDetail
      key={selectedTaskId}
      taskId={selectedTaskId}
      embedded={!!embeddedTaskId}
      onPaneChange={onPaneChange}
      developmentDemo={developmentDemo}
    />
  ) : (
    <InventoryTaskList />
  );
}

function InventoryTaskList() {
  const { go } = useWorkspace();
  return (
    <>
      <Heading title="Kiểm kê trước nhận phòng" detail="Công việc trong các cơ sở bạn phụ trách" />
      <Box>
        <Text>Kiểm kê được tạo tự động khi hợp đồng thuê chính bắt đầu có hiệu lực.</Text>
        <Text style={ui.muted}>
          Mở công việc “Bàn giao vào phòng”, chọn mục “Kiểm kê tài sản” rồi mở phiếu “Đối chiếu kiểm
          kê đầu vào”. Đây là một bước nội bộ của cùng công việc bàn giao.
        </Text>
        <Action onPress={() => go('work-orders')}>Mở danh sách công việc</Action>
      </Box>
    </>
  );
}

function InventoryDetail({
  taskId,
  embedded = false,
  onPaneChange,
  developmentDemo,
}: {
  taskId: string;
  embedded?: boolean;
  onPaneChange?: () => void;
  developmentDemo: boolean;
}) {
  const { api } = useSession();
  const { go, resetScroll } = useWorkspace();
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, ItemFieldErrors>>({});
  const quantityRef = useRef<unknown>(null);
  const notesRef = useRef<unknown>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [completionSyncFailed, setCompletionSyncFailed] = useState(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const query = useWorkspaceQuery<MoveInInventory>(
    `/api/v1/operational-tasks/${taskId}/move-in-inventory`,
    { notifyError: false },
  );
  const data = query.data;
  const reload = query.reload;
  function openItem(itemId: string | null) {
    setSelectedItemId(itemId);
    if (embedded) onPaneChange?.();
    else resetScroll?.();
  }
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  const update = (itemId: string, field: Partial<ItemDraft>) => {
    setDrafts((previous) => {
      const item = data?.items.find((entry) => entry.id === itemId);
      if (!item) return previous;
      return {
        ...previous,
        [itemId]: { ...(previous[itemId] ?? fromItem(item)), ...field, dirty: true },
      };
    });
    setError('');
    setFieldErrors((previous) => {
      const next = { ...(previous[itemId] ?? {}) };
      if (field.quantity !== undefined) delete next.quantity;
      if (field.condition !== undefined) delete next.condition;
      if (field.notes !== undefined) delete next.notes;
      if (field.photos !== undefined || field.removedEvidenceIds !== undefined) delete next.photos;
      return { ...previous, [itemId]: next };
    });
    setNotice('');
  };
  async function saveItem(view: MoveInInventory, item: MoveInInventoryItem, draft: ItemDraft) {
    if (!api) throw new Error('Chưa kết nối máy chủ.');
    const quantity = Number(draft.quantity);
    const hasIssue = draft.condition === 'Missing' || draft.condition === 'Damaged';
    const reinspectionSelected = !!view.reinspectionItemIds?.includes(item.id);
    // On a first inspection, Good requires no photo. An Owner-requested
    // reinspection is different: a newly repaired Good item needs fresh proof.
    const photosToUpload = hasIssue || reinspectionSelected ? draft.photos : [];
    const savedEvidence = (item.evidenceIds ?? []).filter(
      (id) => !draft.removedEvidenceIds.includes(id),
    );
    const input = {
      actualQuantity: quantity,
      condition: draft.condition as InventoryCondition,
      notes: hasIssue ? draft.notes.trim() : '',
    };
    if (!/^\d+$/.test(draft.quantity.trim()))
      throw new Error('Nhập số lượng thực tế nguyên không âm.');
    const failure = validateInventoryItem(input, item.expectedQuantity);
    if (failure) throw new Error(failure);
    if (hasIssue && savedEvidence.length + photosToUpload.length === 0)
      throw new Error('Tài sản thiếu hoặc hư hỏng cần ít nhất một ảnh minh chứng.');
    if (
      reinspectionSelected &&
      draft.condition === 'Good' &&
      item.condition !== 'Good' &&
      photosToUpload.length === 0
    )
      throw new Error('Cần chụp ảnh mới sau khi Owner yêu cầu kiểm tra lại tài sản.');
    if (savedEvidence.length + photosToUpload.length > 5)
      throw new Error('Mỗi tài sản chỉ được lưu tối đa 5 ảnh. Hãy bỏ bớt ảnh mới.');
    const client = moveInInventoryClient(api);
    const task = operationalTasks(api);
    const before = await client.get(taskId);
    if (before.version !== view.version)
      throw new Error(
        'Công việc đã được cập nhật từ thiết bị khác. Hãy tải lại và kiểm tra trước khi lưu.',
      );
    const uploaded: { photo: IncidentPhoto; id: string }[] = [];
    for (const photo of photosToUpload) {
      const scope = `inventory-photo:${item.id}:${photo.id}`;
      const result = await task.upload(
        taskId,
        photo.bytes,
        keys.get(scope, photo.id),
        photo.contentType,
      );
      uploaded.push({ photo, id: result.id });
    }
    // Uploading task evidence can update the task version. Read it again before
    // writing the item's condition and its newly uploaded evidence references.
    const latest = photosToUpload.length ? await client.get(taskId) : before;
    const currentItem = latest.items.find((entry) => entry.id === item.id);
    if (!currentItem) throw new Error('Tài sản không còn trong danh sách kiểm kê. Hãy tải lại.');
    const body = {
      version: latest.version,
      ...input,
      evidenceIds: [
        ...new Set([
          ...(currentItem.evidenceIds ?? []).filter((id) => !draft.removedEvidenceIds.includes(id)),
          ...uploaded.map((part) => part.id),
        ]),
      ],
      incidentId: hasIssue ? currentItem.incidentId : null,
    };
    const scope = `inventory-save:${item.id}`;
    await client.saveItem(taskId, item.id, body, keys.get(scope, body));
    keys.confirmed(scope, body);
    for (const photo of uploaded)
      keys.confirmed(`inventory-photo:${item.id}:${photo.photo.id}`, photo.photo.id);
    const updated = await client.get(taskId);
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[item.id];
      return next;
    });
    return updated;
  }
  async function finalizeInventory(view: MoveInInventory, confirmNoAssets = false) {
    if (!api) throw new Error('Chưa kết nối máy chủ.');
    const body = { version: view.version, note: '', confirmNoAssets };
    const scope = 'inventory-complete';
    const completedView = await moveInInventoryClient(api).complete(
      taskId,
      view.version,
      '',
      keys.get(scope, body),
      confirmNoAssets,
    );
    keys.confirmed(scope, body);
    return completedView;
  }
  async function runSave(itemId: string) {
    if (!api || !data || busyRef.current || data.status !== 'InProgress') return;
    const targets = data.items.filter((entry) => entry.id === itemId);
    for (const item of targets) {
      const draft = drafts[item.id] ?? fromItem(item);
      const problems = validateItemDraft(
        item,
        draft,
        !!data.reinspectionItemIds?.includes(item.id),
      );
      if (Object.keys(problems).length) {
        setFieldErrors((previous) => ({ ...previous, [item.id]: problems }));
        if (selectedItemId !== item.id) openItem(item.id);
        setError('');
        const first = (['quantity', 'condition', 'notes', 'photos'] as const).find(
          (key) => problems[key],
        );
        if (first === 'condition' && selectedItemId === item.id) {
          if (embedded) onPaneChange?.();
          else resetScroll?.();
        }
        if (first === 'quantity' || first === 'notes') {
          const focus = () => {
            const field = (first === 'quantity' ? quantityRef : notesRef).current;
            if (
              field &&
              typeof field === 'object' &&
              'focus' in field &&
              typeof field.focus === 'function'
            )
              field.focus();
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
          else setTimeout(focus, 0);
        }
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let view = data;
      for (const item of targets) {
        const draft = drafts[item.id] ?? fromItem(item);
        if (draft.dirty) view = await saveItem(view, item, draft);
      }
      // The internal inventory task is completed through the existing guarded
      // backend endpoint once every item was saved successfully. Staff has no
      // separate completion form or action to remember.
      const hasUnsavedOtherItem = Object.entries(drafts).some(
        ([id, draft]) => id !== itemId && draft.dirty,
      );
      const shouldComplete =
        !hasUnsavedOtherItem &&
        view.status === 'InProgress' &&
        view.items.length > 0 &&
        readyToComplete(view.items, view.reinspectionItemIds ?? []);
      if (shouldComplete) {
        try {
          view = await finalizeInventory(view);
          setCompletionSyncFailed(false);
        } catch (failure) {
          // Item PUT has succeeded. Report business-rule rejections precisely;
          // retry is appropriate only when confirmation could have been lost.
          const businessRejection =
            failure instanceof MobileApiError &&
            [
              'move_in_inventory_reinspection_not_passed',
              'move_in_inventory_reinspection_new_evidence_required',
              'move_in_inventory_checklist_incomplete',
              'move_in_inventory_evidence_missing',
            ].includes(failure.code ?? '');
          setCompletionSyncFailed(!businessRejection);
          setError(
            businessRejection
              ? errorMessage(failure)
              : `Đã lưu tài sản, nhưng chưa xác nhận được hoàn tất kiểm kê. ${errorMessage(failure)}`,
          );
          reload();
          openItem(null);
          return;
        }
      }
      reload();
      setCompletionSyncFailed(false);
      setNotice(
        shouldComplete
          ? 'Đã lưu đầy đủ kết quả kiểm kê cho Owner.'
          : view.reinspectionItemIds?.length
            ? 'Đã lưu kết quả. Cần kiểm tra các tài sản Owner chọn đến khi đạt và có ảnh mới trước khi hoàn thành kiểm kê lại.'
            : 'Đã lưu kết quả kiểm kê vào máy chủ.',
      );
      showSuccess(shouldComplete ? 'Đã lưu đầy đủ kiểm kê.' : 'Đã lưu kết quả kiểm kê.');
      openItem(null);
    } catch (failure) {
      setError(
        failure instanceof Error &&
          !(failure instanceof TypeError) &&
          failure.message !== 'Yêu cầu không thành công.'
          ? failure.message
          : errorMessage(failure),
      );
      reload();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function retryCompletionSync() {
    if (!api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const fresh = await moveInInventoryClient(api).get(taskId);
      if (
        fresh.status === 'InProgress' &&
        fresh.items.length > 0 &&
        readyToComplete(fresh.items, fresh.reinspectionItemIds ?? [])
      )
        await finalizeInventory(fresh);
      else if (fresh.status !== 'Completed')
        throw new Error(
          fresh.reinspectionItemIds?.length
            ? 'Tài sản cần kiểm tra lại vẫn chưa đạt. Mở mục Owner yêu cầu và ghi nhận kết quả mới.'
            : 'Vẫn còn mục kiểm kê chưa được lưu đầy đủ.',
        );
      setCompletionSyncFailed(false);
      setNotice('Đã đồng bộ kết quả kiểm kê cho Owner.');
      reload();
    } catch (failure) {
      if (failure instanceof MobileApiError && failure.status === 409)
        setCompletionSyncFailed(false);
      setError(
        failure instanceof Error && !(failure instanceof MobileApiError)
          ? failure.message
          : errorMessage(failure),
      );
      reload();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function start() {
    if (!api || !data || data.status !== 'Assigned' || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const scope = 'inventory-start';
      const body = { version: data.version, note: '', evidenceIds: [] as string[] };
      await operationalTasks(api).act(taskId, 'start', data.version, '', [], keys.get(scope, body));
      keys.confirmed(scope, body);
      showSuccess('Đã bắt đầu công việc kiểm kê.');
      reload();
    } catch (failure) {
      setError(errorMessage(failure));
      reload();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function confirmEmptyInventory() {
    if (!api || !data || data.status !== 'InProgress' || data.items.length || busyRef.current)
      return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await finalizeInventory(data, true);
      setNotice('Đã xác nhận phòng không có tài sản cần kiểm kê.');
      showSuccess('Đã xác nhận phòng không có tài sản.');
      reload();
    } catch (failure) {
      setError(errorMessage(failure));
      reload();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const completed = data?.status === 'Completed' || !!data?.completedAt;
  const editable = data?.status === 'InProgress' && !completed;
  // The server retains these IDs for audit after completion. Only an active
  // InProgress task has an outstanding Owner reinspection request.
  const pendingReinspectionItemIds = editable ? (data?.reinspectionItemIds ?? []) : [];
  const reinspectionCompleted =
    data?.status === 'Completed' && !!data.reinspectionItemIds?.length;
  const selectedItem = data?.items.find((item) => item.id === selectedItemId);
  return (
    <>
      {!embedded && (
        <Heading
          title="Kiểm kê trước nhận phòng"
          detail="Kiểm tra số lượng và tình trạng trước khi Tenant nhận phòng"
        />
      )}
      {selectedItem && (
        <Button
          icon="arrow-left"
          mode="text"
          disabled={busy}
          contentStyle={{ justifyContent: 'flex-start', minHeight: 44 }}
          onPress={() => openItem(null)}
        >
          Về danh sách tài sản
        </Button>
      )}
      {query.loading && <Text>Đang tải danh sách tài sản…</Text>}
      {!!query.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {query.error}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {completionSyncFailed && !selectedItem && (
        <Action secondary disabled={busy} onPress={() => void retryCompletionSync()}>
          Thử gửi lại kết quả đã lưu
        </Action>
      )}
      {!!notice && (
        <Text accessibilityRole="status" style={ui.green}>
          {notice}
        </Text>
      )}
      {data && !selectedItem && (
        <>
          <Box style={embedded ? inventoryStyles.embeddedSection : undefined}>
            <Row spread>
              <Text variant="titleMedium">Phòng cần kiểm kê</Text>
              <Pill tone={completed ? 'green' : 'blue'}>
                {completed
                  ? 'Hoàn thành'
                  : data.status === 'Assigned'
                    ? 'Chưa bắt đầu'
                    : 'Đang kiểm kê'}
              </Pill>
            </Row>
            {!!data.dueAt && <Text>Hạn trước nhận phòng: {formatInstant(data.dueAt)}</Text>}
            <Text style={ui.muted}>
              Đã kiểm tra: {data.items.filter((item) => item.condition).length}/{data.items.length}{' '}
              nhóm tài sản
            </Text>
            <Text style={ui.muted}>
              Staff chỉ ghi nhận hiện trạng. Owner xem kết quả bàn giao và quyết định phương án xử
              lý.
            </Text>
            {!!pendingReinspectionItemIds.length && (
              <Text style={ui.red}>
                Owner yêu cầu kiểm tra lại {pendingReinspectionItemIds.length} nhóm tài sản. Các mục
                được chọn cần đạt đủ số lượng và có ảnh mới sau yêu cầu của Owner.
              </Text>
            )}
            {reinspectionCompleted && (
              <Text style={ui.green}>Đã hoàn thành kiểm kê lại theo yêu cầu của Owner.</Text>
            )}
            {completed && (
              <Text style={data.readyForHandover ? ui.green : ui.red}>
                {data.readyForHandover
                  ? 'Phòng đã sẵn sàng về tài sản'
                  : 'Có tài sản cần Owner xem xét và quyết định phương án xử lý'}
              </Text>
            )}
            {data.status === 'Assigned' && (
              <Action disabled={busy} onPress={() => void start()}>
                Bắt đầu kiểm kê
              </Action>
            )}
          </Box>
          {data.items.map((item) => {
            const draft = drafts[item.id] ?? fromItem(item);
            const status = draft.dirty
              ? 'Chưa lưu'
              : item.condition
                ? inventoryStatusLabels[item.condition]
                : 'Chưa kiểm kê';
            return (
              <Box key={item.id} style={embedded ? inventoryStyles.summaryRow : undefined}>
                <Row spread>
                  <Text variant="titleMedium" style={inventoryStyles.itemTitle}>
                    {item.name}
                  </Text>
                  <Pill
                    tone={
                      draft.dirty
                        ? 'amber'
                        : item.condition === 'Good'
                          ? 'green'
                          : item.condition === 'Missing' || item.condition === 'Damaged'
                            ? 'red'
                            : 'neutral'
                    }
                  >
                    {status}
                  </Pill>
                </Row>
                <Text style={ui.muted}>
                  Dự kiến {item.expectedQuantity} · Thực tế{' '}
                  {draft.quantity === '' ? 'chưa ghi' : draft.quantity}
                  {draft.dirty ? ' (chưa lưu)' : ''}
                </Text>
                {pendingReinspectionItemIds.includes(item.id) && (
                  <Text style={ui.red}>
                    Owner yêu cầu kiểm tra lại · Cần đối chiếu thực tế và chụp ảnh mới
                  </Text>
                )}
                <Button
                  compact
                  disabled={busy}
                  mode="text"
                  icon="chevron-right"
                  contentStyle={{ minHeight: 44, justifyContent: 'flex-end' }}
                  onPress={() => openItem(item.id)}
                >
                  {item.condition ? 'Xem kiểm kê' : 'Kiểm tra'}
                </Button>
              </Box>
            );
          })}
          {!data.items.length && (
            <Box style={embedded ? inventoryStyles.embeddedSection : undefined}>
              <Text>
                Phòng chưa có tài sản được cấu hình để kiểm kê. Xác nhận rằng phòng không có tài sản
                trước khi hoàn thành.
              </Text>
              {editable && (
                <Checkbox.Item
                  label="Xác nhận phòng không có tài sản cần kiểm kê"
                  status="unchecked"
                  onPress={() => void confirmEmptyInventory()}
                  disabled={busy}
                />
              )}
            </Box>
          )}
          {completed && (
            <Box style={embedded ? inventoryStyles.embeddedSection : undefined}>
              <Pill tone="green">Đã hoàn thành, không chờ Owner duyệt</Pill>
              <Text>Kết quả đã được lưu và Owner có thể xem thông tin hoàn thành.</Text>
            </Box>
          )}
        </>
      )}
      {data &&
        selectedItem &&
        (() => {
          const item = selectedItem;
          const draft = drafts[item.id] ?? fromItem(item);
          const issued = draft.condition === 'Missing' || draft.condition === 'Damaged';
          const reinspectionSelected = pendingReinspectionItemIds.includes(item.id);
          const errors = fieldErrors[item.id] ?? {};
          const savedIds = (item.evidenceIds ?? []).filter(
            (id) => !draft.removedEvidenceIds.includes(id),
          );
          return (
            <Box style={embedded ? inventoryStyles.embeddedSection : undefined}>
              <Text variant="titleMedium">{item.name}</Text>
              <Text style={ui.muted}>
                Dự kiến {item.expectedQuantity} · Đếm số lượng thực tế và chọn tình trạng.
              </Text>
              {reinspectionSelected && (
                <Text style={ui.red}>
                  Owner yêu cầu kiểm tra lại tài sản này. Sau khi sửa chữa, chỉ chọn Đạt khi thực tế
                  đạt yêu cầu và chụp ảnh minh chứng mới. Ảnh cũ không thay thế lần kiểm tra lại.
                </Text>
              )}
              <TextInput
                ref={(instance: unknown) => {
                  quantityRef.current = instance;
                }}
                mode="outlined"
                label={`Số lượng thực tế – ${item.name}`}
                accessibilityLabel={`Số lượng thực tế – ${item.name}`}
                keyboardType="number-pad"
                value={draft.quantity}
                disabled={busy || !editable}
                error={!!errors.quantity}
                style={{ backgroundColor: colors.white }}
                onChangeText={(quantity) => update(item.id, { quantity })}
              />
              {!!errors.quantity && (
                <Text accessibilityRole="alert" style={ui.red}>
                  {errors.quantity}
                </Text>
              )}
              <Box
                style={[
                  inventoryStyles.selector,
                  errors.condition
                    ? {
                        borderWidth: 1,
                        borderColor: colors.red,
                        borderRadius: 10,
                        padding: 6,
                      }
                    : undefined,
                ]}
              >
                <Text variant="labelMedium">Tình trạng – {item.name}</Text>
                <SegmentedButtons
                  density="small"
                  value={draft.condition}
                  onValueChange={(value) =>
                    update(item.id, { condition: value as InventoryCondition })
                  }
                  buttons={conditions.map(({ value, label }) => ({
                    value,
                    label,
                    disabled: busy || !editable,
                  }))}
                />
              </Box>
              {!!errors.condition && (
                <Text accessibilityRole="alert" style={ui.red}>
                  {errors.condition}
                </Text>
              )}
              {draft.condition === 'Good' && (
                <Text style={ui.muted}>
                  {completed
                    ? 'Đạt: tài sản đã được kiểm kê đủ số lượng và lưu kết quả.'
                    : reinspectionSelected
                      ? 'Đạt: đủ số lượng, không hư hỏng và cần ảnh mới cho lần kiểm tra lại này.'
                      : 'Đạt: đủ số lượng và không hư hỏng. Chỉ cần lưu kết quả.'}
                </Text>
              )}
              {draft.condition === 'Damaged' &&
                draft.quantity !== '' &&
                Number(draft.quantity) < item.expectedQuantity && (
                  <Text style={ui.red}>
                    Có cả tài sản thiếu và hư hỏng. Ghi rõ hiện trạng để Owner xem xét.
                  </Text>
                )}
              {issued && (
                <>
                  <Text style={ui.muted}>
                    {draft.condition === 'Missing'
                      ? 'Thiếu: ghi rõ vật dụng/số lượng thiếu và thêm ảnh minh chứng.'
                      : 'Hư hỏng: mô tả vị trí, tình trạng hư hỏng và thêm ảnh minh chứng.'}
                  </Text>
                  <TextInput
                    ref={(instance: unknown) => {
                      notesRef.current = instance;
                    }}
                    mode="outlined"
                    label={`Lý do / ghi chú – ${item.name}`}
                    accessibilityLabel={`Lý do / ghi chú – ${item.name}`}
                    value={draft.notes}
                    disabled={busy || !editable}
                    multiline
                    error={!!errors.notes}
                    style={{ backgroundColor: colors.white }}
                    onChangeText={(notes) => update(item.id, { notes })}
                  />
                  {!!errors.notes && (
                    <Text accessibilityRole="alert" style={ui.red}>
                      {errors.notes}
                    </Text>
                  )}
                </>
              )}
              {api && (issued || reinspectionSelected) && (
                <InventoryPhotoCapture
                  api={api}
                  taskId={taskId}
                  savedIds={savedIds}
                  developmentDemo={developmentDemo}
                  photos={draft.photos}
                  disabled={busy || !editable}
                  error={errors.photos}
                  onChange={(photos) => update(item.id, { photos })}
                  onRemoveSaved={(id) =>
                    update(item.id, {
                      removedEvidenceIds: [...draft.removedEvidenceIds, id],
                    })
                  }
                />
              )}
              {draft.dirty && editable && (
                <Action secondary disabled={busy} onPress={() => void runSave(item.id)}>
                  Lưu
                </Action>
              )}
              {draft.dirty && (
                <Text style={ui.muted}>
                  Chưa lưu. Có thể quay lại danh sách và mở lại tài sản này để tiếp tục.
                </Text>
              )}
            </Box>
          );
        })()}
      {!embedded && (
        <Action secondary disabled={busy} onPress={() => go('work-orders')}>
          Về danh sách công việc
        </Action>
      )}
    </>
  );
}
