import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, Text } from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { mutationKeys } from '../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { IncidentEvidencePicker } from '../components/IncidentEvidencePicker';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage } from '../lib/api';
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

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
type ItemDraft = {
  quantity: string;
  condition: InventoryCondition | '';
  notes: string;
  photos: IncidentPhoto[];
  dirty: boolean;
};
function fromItem(item: MoveInInventoryItem): ItemDraft {
  return {
    quantity: item.actualQuantity === null ? '' : String(item.actualQuantity),
    condition: item.condition ?? '',
    notes: item.notes ?? '',
    photos: [],
    dirty: false,
  };
}

export function StaffMoveInInventoryScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { role, preview } = useWorkspace();
  const { session } = useSession();
  if (role !== 'Staff' || preview || !session?.roles.includes('Staff'))
    return <Text>Đăng nhập tài khoản Staff để kiểm kê trước nhận phòng.</Text>;
  return taskId && guidPattern.test(taskId) ? (
    <InventoryDetail key={taskId} taskId={taskId} />
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
          Mở Công việc vận hành, chọn nhiệm vụ “Kiểm kê trước nhận phòng” ở trang tương ứng. Danh
          sách Công việc hiển thị đầy đủ các nhiệm vụ được phân công.
        </Text>
        <Action onPress={() => go('work-orders')}>Mở danh sách công việc</Action>
      </Box>
    </>
  );
}

function InventoryDetail({ taskId }: { taskId: string }) {
  const { api } = useSession();
  const { go } = useWorkspace();
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirmNoAssets, setConfirmNoAssets] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const query = useWorkspaceQuery<MoveInInventory>(
    `/api/v1/operational-tasks/${taskId}/move-in-inventory`,
    { notifyError: false },
  );
  const data = query.data;
  const reload = query.reload;
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
    setNotice('');
  };
  async function saveItem(view: MoveInInventory, item: MoveInInventoryItem, draft: ItemDraft) {
    if (!api) throw new Error('Chưa kết nối máy chủ.');
    const quantity = Number(draft.quantity);
    const input = {
      actualQuantity: quantity,
      condition: draft.condition as InventoryCondition,
      notes: draft.notes.trim(),
    };
    if (!/^\d+$/.test(draft.quantity.trim()))
      throw new Error('Nhập số lượng thực tế nguyên không âm.');
    const failure = validateInventoryItem(input, item.expectedQuantity);
    if (failure) throw new Error(failure);
    if ((item.evidenceIds ?? []).length + draft.photos.length === 0)
      throw new Error('Chọn ít nhất một ảnh minh chứng cho mục kiểm kê trước khi lưu.');
    if ((item.evidenceIds ?? []).length + draft.photos.length > 5)
      throw new Error('Mỗi tài sản chỉ được lưu tối đa 5 ảnh. Hãy bỏ bớt ảnh mới.');
    const client = moveInInventoryClient(api);
    const task = operationalTasks(api);
    const before = await client.get(taskId);
    if (before.version !== view.version)
      throw new Error(
        'Công việc đã được cập nhật từ thiết bị khác. Hãy tải lại và kiểm tra trước khi lưu.',
      );
    const uploaded: { photo: IncidentPhoto; id: string }[] = [];
    for (const photo of draft.photos) {
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
    const latest = draft.photos.length ? await client.get(taskId) : before;
    const currentItem = latest.items.find((entry) => entry.id === item.id);
    if (!currentItem) throw new Error('Tài sản không còn trong danh sách kiểm kê. Hãy tải lại.');
    const body = {
      version: latest.version,
      ...input,
      evidenceIds: [
        ...new Set([...(currentItem.evidenceIds ?? []), ...uploaded.map((part) => part.id)]),
      ],
      incidentId: currentItem.incidentId,
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
  async function runSave(itemId?: string, openReport = false) {
    if (!api || !data || busyRef.current || data.status !== 'InProgress') return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let view = data;
      const targets = itemId
        ? data.items.filter((entry) => entry.id === itemId)
        : data.items.filter((entry) => drafts[entry.id]?.dirty);
      for (const item of targets) {
        const draft = drafts[item.id] ?? fromItem(item);
        if (draft.dirty) view = await saveItem(view, item, draft);
      }
      reload();
      setNotice('Đã lưu kết quả kiểm kê vào máy chủ.');
      showSuccess('Đã lưu kết quả kiểm kê.');
      if (itemId && openReport) {
        const item = view.items.find((entry) => entry.id === itemId);
        if (!item || !item.condition || item.condition === 'Good')
          throw new Error('Hãy chọn Thiếu hoặc Hư hỏng trước khi báo cáo sự cố.');
        if (item.incidentId) {
          go('incident-detail', { incidentId: item.incidentId });
        } else {
          go('report-incident', {
            inventoryTaskId: taskId,
            inventoryItemId: item.id,
            inventoryEvidenceIds: (item.evidenceIds ?? []).slice(0, 5).join(','),
            locationId: view.locationId,
            roomId: view.roomId,
            ...(item.assetId ? { assetId: item.assetId } : {}),
            description:
              `Kiểm kê trước nhận phòng: ${item.name}. Dự kiến ${item.expectedQuantity}, thực tế ${item.actualQuantity ?? 0}. Tình trạng: ${item.condition === 'Damaged' ? (item.actualQuantity !== null && item.actualQuantity < item.expectedQuantity ? 'Thiếu số lượng và có tài sản hư hỏng cần sửa chữa' : 'Hư hỏng cần sửa chữa') : 'Thiếu'}. ${item.notes ?? ''}`.trim(),
          });
        }
      }
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
  async function complete() {
    if (!api || !data || data.status !== 'InProgress' || busyRef.current) return;
    if (data.items.some((item) => drafts[item.id]?.dirty)) {
      setError('Hãy lưu các mục vừa thay đổi trước khi hoàn thành.');
      return;
    }
    if (!readyToComplete(data.items) || (!data.items.length && !confirmNoAssets)) {
      setError(
        'Cần kiểm kê và có ảnh cho từng tài sản; mục thiếu/hỏng phải liên kết báo cáo BF-07. Phòng không có tài sản cần xác nhận riêng.',
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const body = { version: data.version, note: note.trim(), confirmNoAssets };
      const scope = 'inventory-complete';
      await moveInInventoryClient(api).complete(
        taskId,
        data.version,
        body.note,
        keys.get(scope, body),
        confirmNoAssets,
      );
      keys.confirmed(scope, body);
      setNotice('Kiểm kê hoàn thành. Owner đã được thông báo, không cần chờ duyệt kết quả.');
      showSuccess('Đã hoàn thành kiểm kê.');
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
  return (
    <>
      <Heading
        title="Kiểm kê trước nhận phòng"
        detail="Kiểm tra số lượng và tình trạng trước khi Tenant nhận phòng"
      />
      <Button
        disabled={busy || query.loading}
        loading={query.loading}
        icon="refresh"
        onPress={reload}
      >
        Tải lại kiểm kê
      </Button>
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
      {!!notice && (
        <Text accessibilityRole="status" style={ui.green}>
          {notice}
        </Text>
      )}
      {data && (
        <>
          <Box>
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
              Nếu thiếu hoặc hỏng, dùng Báo cáo sự cố BF-07 để Owner tiếp nhận xử lý.
            </Text>
            {completed && (
              <Text style={data.readyForHandover ? ui.green : ui.red}>
                {data.readyForHandover
                  ? 'Phòng đã sẵn sàng về tài sản'
                  : 'Chưa sẵn sàng bàn giao: cần xử lý sự cố hoặc kiểm tra điều kiện còn thiếu'}
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
            const issued = draft.condition === 'Missing' || draft.condition === 'Damaged';
            const defect = issued && !!item.incidentId;
            const expanded = selectedItemId === item.id;
            const status = draft.dirty
              ? 'Chưa lưu'
              : item.condition
                ? inventoryStatusLabels[item.condition]
                : 'Chưa kiểm kê';
            return (
              <Box key={item.id}>
                <Row spread>
                  <Text variant="titleMedium" style={ui.grow}>
                    {item.name}
                  </Text>
                  <Pill
                    tone={
                      draft.dirty
                        ? 'amber'
                        : item.condition === 'Good'
                          ? 'green'
                          : issued
                            ? 'red'
                            : 'neutral'
                    }
                  >
                    {status}
                  </Pill>
                </Row>
                <Row spread>
                  <Text style={ui.muted}>
                    Dự kiến {item.expectedQuantity} · Thực tế{' '}
                    {draft.quantity === '' ? 'chưa ghi' : draft.quantity}
                    {draft.dirty ? ' (chưa lưu)' : ''}
                  </Text>
                  <Button
                    compact
                    disabled={busy}
                    onPress={() => setSelectedItemId(expanded ? null : item.id)}
                    icon={expanded ? 'chevron-up' : 'chevron-down'}
                  >
                    {expanded ? 'Thu gọn' : item.condition ? 'Xem phiếu kiểm tra' : 'Kiểm tra'}
                  </Button>
                </Row>
                {expanded && (
                  <>
                    <Input
                      label={`Số lượng thực tế – ${item.name}`}
                      numeric
                      value={draft.quantity}
                      disabled={busy || !editable}
                      onChange={(quantity) => update(item.id, { quantity })}
                    />
                    <ChoiceField
                      label={`Tình trạng – ${item.name}`}
                      value={draft.condition}
                      disabled={busy || !editable}
                      options={[
                        { id: 'Good', label: 'Đạt' },
                        { id: 'Missing', label: 'Thiếu' },
                        { id: 'Damaged', label: 'Hư hỏng cần sửa chữa' },
                      ]}
                      onChange={(value) =>
                        update(item.id, { condition: value as InventoryCondition })
                      }
                    />
                    {draft.condition === 'Damaged' &&
                      draft.quantity !== '' &&
                      Number(draft.quantity) < item.expectedQuantity && (
                        <Text style={ui.red}>
                          Có cả tài sản thiếu và tài sản hư hỏng. Nội dung này sẽ được chuyển sang
                          báo cáo sự cố.
                        </Text>
                      )}
                    <Input
                      label={`Ghi chú – ${item.name}`}
                      value={draft.notes}
                      disabled={busy || !editable}
                      multiline
                      onChange={(notes) => update(item.id, { notes })}
                    />
                    <Text style={ui.muted}>
                      Ảnh đã lưu: {(item.evidenceIds ?? []).length} · Ảnh mới chọn:{' '}
                      {draft.photos.length}
                    </Text>
                    {editable && (item.evidenceIds ?? []).length < 5 && (
                      <IncidentEvidencePicker
                        value={draft.photos}
                        disabled={busy}
                        onChange={(photos) => update(item.id, { photos })}
                      />
                    )}
                    {draft.dirty && editable && (
                      <Action secondary disabled={busy} onPress={() => void runSave(item.id)}>
                        Lưu mục này
                      </Action>
                    )}
                    {issued && (
                      <>
                        <Pill tone={defect ? 'amber' : 'red'}>
                          {defect ? 'Đã liên kết báo cáo sự cố' : 'Cần báo cáo sự cố BF-07'}
                        </Pill>
                        <Action
                          secondary
                          disabled={busy || !editable}
                          onPress={() => void runSave(item.id, true)}
                        >
                          {defect ? 'Xem báo cáo sự cố' : 'Báo cáo sự cố'}
                        </Action>
                      </>
                    )}
                  </>
                )}
              </Box>
            );
          })}
          {!data.items.length && (
            <Box>
              <Text>
                Phòng chưa có tài sản được cấu hình để kiểm kê. Xác nhận rằng phòng không có tài sản
                trước khi hoàn thành.
              </Text>
              {editable && (
                <Checkbox.Item
                  label="Xác nhận phòng không có tài sản cần kiểm kê"
                  status={confirmNoAssets ? 'checked' : 'unchecked'}
                  onPress={() => setConfirmNoAssets(!confirmNoAssets)}
                  disabled={busy}
                />
              )}
            </Box>
          )}
          {editable && (
            <Box>
              <Input
                label="Thông tin hoàn thành gửi Owner (tùy chọn)"
                value={note}
                multiline
                disabled={busy}
                onChange={setNote}
              />
              <Action
                secondary
                disabled={busy || !data.items.some((item) => drafts[item.id]?.dirty)}
                onPress={() => void runSave()}
              >
                Lưu nháp tất cả
              </Action>
              <Action
                disabled={
                  busy ||
                  !readyToComplete(data.items) ||
                  (!data.items.length && !confirmNoAssets) ||
                  data.items.some((item) => drafts[item.id]?.dirty)
                }
                onPress={() => void complete()}
              >
                Hoàn thành kiểm kê
              </Action>
              <Text style={ui.muted}>
                Staff hoàn thành trực tiếp. Mục thiếu hoặc hỏng cần có báo cáo sự cố BF-07 đã liên
                kết.
              </Text>
            </Box>
          )}
          {completed && (
            <Box>
              <Pill tone="green">Đã hoàn thành, không chờ Owner duyệt</Pill>
              <Text>Kết quả đã được lưu và Owner có thể xem thông tin hoàn thành.</Text>
            </Box>
          )}
        </>
      )}
      <Action secondary disabled={busy} onPress={() => go('work-orders')}>
        Về danh sách công việc
      </Action>
    </>
  );
}
