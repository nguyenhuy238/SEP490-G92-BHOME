import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from '../lib/randomUUID';
import { Button, Checkbox, Dialog, Portal, Text } from 'react-native-paper';
import { OwnerDataState } from '../components/OwnerMobileKit';
import { OwnerPlaceLabel } from '../features/owner/OwnerPlaceLabel';
import { OwnerStaffName } from '../features/owner/OwnerStaffName';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { guid, mutationKeys } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { CameraCapture } from '../components/CameraCapture';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { queryPolicies } from '../lib/queryPolicies';
import { errorMessage, type Named } from '../lib/api';
import { StaffTaskListScreen } from './StaffTaskListScreen';
import { StaffTaskDetailScreen } from './StaffTaskDetailScreen';
import {
  availableTaskActions,
  operationalTasks,
  taskActionLabels,
  taskStatusLabels,
  type OperationalTask,
  type TaskAction,
  type TaskEvidence,
  type TaskHistory,
  type TaskPage,
  type TaskWork,
} from '../services/operationalTasks';

export function OperationalTasksScreen({ approvals = false }: { approvals?: boolean }) {
  const { role } = useWorkspace();
  return role === 'Staff' ? <StaffTaskListScreen /> : <OwnerTaskList approvals={approvals} />;
}

function OwnerTaskList({ approvals }: { approvals: boolean }) {
  const { role, go } = useWorkspace();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(approvals ? 'PendingVerification' : '');
  const [create, setCreate] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const query = useWorkspaceQuery<TaskPage<OperationalTask>>(
    `/api/v1/operational-tasks?page=${page}&pageSize=20${status ? `&status=${status}` : ''}${overdueOnly ? '&isOverdue=true' : ''}`,
    { cache: queryPolicies.tasks },
  );
  if (create && role === 'Owner')
    return (
      <TaskWorkForm
        onCancel={() => setCreate(false)}
        onSaved={(task) => {
          setCreate(false);
          go('task-detail', { taskId: task.id });
        }}
      />
    );
  return (
    <>
      <Heading
        title={approvals ? 'Phê duyệt công việc' : 'Công việc vận hành'}
        detail={
          role === 'Owner'
            ? 'Theo dõi, phối hợp và kiểm tra kết quả'
            : 'Công việc trong cơ sở đang được phân công'
        }
      />
      {approvals && (
        <Action secondary onPress={() => go('signing')}>
          Kiểm tra & phê duyệt hợp đồng
        </Action>
      )}
      {role === 'Owner' && (
        <Action icon="plus" onPress={() => setCreate(true)}>
          Tạo công việc
        </Action>
      )}
      <ChoiceField
        label="Trạng thái"
        value={status}
        options={[
          { id: '', label: 'Tất cả' },
          ...Object.entries(taskStatusLabels).map(([id, label]) => ({ id, label })),
        ]}
        onChange={(next) => {
          setStatus(next);
          setPage(1);
        }}
      />
      <Checkbox.Item
        label="Chỉ công việc quá hạn"
        status={overdueOnly ? 'checked' : 'unchecked'}
        onPress={() => {
          setOverdueOnly((value) => !value);
          setPage(1);
        }}
      />
      <QueryState {...query} />
      {query.data?.items.map((task) => (
        <Box key={task.id}>
          <Row spread>
            <Pill tone={task.isOverdue ? 'red' : task.status === 'Completed' ? 'green' : 'blue'}>
              {taskStatusLabels[task.status]}
            </Pill>
            <Pill tone={task.priority === 'High' ? 'amber' : 'neutral'}>
              {task.priority === 'High' ? 'Ưu tiên cao' : 'Bình thường'}
            </Pill>
          </Row>
          <Heading
            title={
              task.title || (task.kind === 'MeterReading' ? 'Ghi chỉ số đồng hồ' : 'Công việc')
            }
          />
          <Text>{task.requirements}</Text>
          {task.dueAt && (
            <Text style={task.isOverdue ? ui.red : ui.muted}>
              {task.isOverdue ? 'Quá hạn · ' : 'Hạn: '}
              {formatInstant(task.dueAt)}
            </Text>
          )}
          {!task.responsibilityAvailable && (
            <Text style={ui.red}>Chưa có nhân viên phụ trách có hiệu lực.</Text>
          )}
          <Action
            onPress={() =>
              task.kind === 'MeterReading'
                ? go(role === 'Staff' ? 'meter-reading' : 'operations')
                : go('task-detail', { taskId: task.id })
            }
          >
            {task.kind === 'MeterReading' ? 'Xem tác vụ ghi chỉ số' : 'Xem chi tiết & cập nhật'}
          </Action>
        </Box>
      ))}
      {query.data?.items.length === 0 && (
        <Box>
          <Text>Không có công việc phù hợp.</Text>
        </Box>
      )}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          loading={query.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function OperationalTaskDetail() {
  const { role } = useWorkspace();
  const params = useLocalSearchParams<{ taskId?: string }>();
  let id = '';
  try {
    id = guid(params.taskId ?? '');
  } catch {
    /* Reject untrusted route values before fetching. */
  }
  return id ? (
    role === 'Staff' ? (
      <StaffTaskDetailScreen key={id} id={id} />
    ) : (
      <TaskDetail key={id} id={id} />
    )
  ) : (
    <Box>
      <Text>Mã công việc không hợp lệ. Hãy chọn công việc từ danh sách.</Text>
    </Box>
  );
}

function TaskDetail({ id }: { id: string }) {
  const { api, session } = useSession();
  const { role, go } = useWorkspace();
  const query = useWorkspaceQuery<OperationalTask>(`/api/v1/operational-tasks/${id}`, {
    cache: queryPolicies.tasks,
  });
  const [historyPage, setHistoryPage] = useState(1);
  const history = useWorkspaceQuery<TaskPage<TaskHistory>>(
    `/api/v1/operational-tasks/${id}/history?page=${historyPage}&pageSize=20`,
    { cache: queryPolicies.tasks },
  );
  const evidence = useWorkspaceQuery<TaskEvidence[]>(`/api/v1/operational-tasks/${id}/evidence`, {
    cache: queryPolicies.tasks,
  });
  const [action, setAction] = useState<TaskAction | ''>('');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const [notice, setNotice] = useFeedbackState('success');
  const [confirmDecision, setConfirmDecision] = useState(false);
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const client = useMemo(() => (api ? operationalTasks(api) : null), [api]);
  const task = query.data;
  const actions = task
    ? availableTaskActions(task, role ?? '', session?.userId ?? '').filter((action) =>
        ['verify', 'rework', 'coordinate'].includes(action),
      )
    : [];
  const { reload: reloadTask } = query,
    { reload: reloadHistory } = history,
    { reload: reloadEvidence } = evidence;
  const reload = useCallback(() => {
    reloadTask();
    reloadHistory();
    reloadEvidence();
  }, [reloadTask, reloadHistory, reloadEvidence]);
  useWorkspaceHeaderRefresh(reload, query.fetching || history.fetching || evidence.fetching);
  async function act() {
    if (!client || !task || !action || lock.current || !actions.includes(action)) return;
    if (!['start', 'verify', 'assign'].includes(action) && !note.trim()) {
      setError('Nhập kết quả, nội dung hoặc lý do cho thao tác.');
      return;
    }
    if (action === 'submit' && task.evidenceRequired && !selected.length) {
      setError('Chọn ít nhất một ảnh kết quả trước khi gửi.');
      return;
    }
    const body = {
      version: task.version,
      note: note.trim(),
      evidenceIds: ['submit', 'progress', 'blockers'].includes(action) ? selected : [],
    };
    const scope = `${id}/${action}`;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.act(
        id,
        action,
        body.version,
        body.note,
        body.evidenceIds,
        keys.get(scope, body),
      );
      keys.confirmed(scope, body);
      setNote('');
      setAction('');
      setSelected([]);
      setNotice('Máy chủ đã ghi nhận thao tác.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
      reload();
    }
  }
  return (
    <>
      <Action secondary onPress={() => go(role === 'Owner' ? 'operations' : 'work-orders')}>
        Về danh sách công việc
      </Action>
      <OwnerDataState loading={query.loading} error={query.error} reload={reload} />
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="alert" style={ui.green}>
          {notice}
        </Text>
      )}
      {task && (
        <>
          <Box>
            <Heading title={task.title} />
            <OwnerPlaceLabel item={task} />
            <OwnerStaffName staffId={task.currentResponsibleStaffUserId} />
            <Pill>{taskStatusLabels[task.status]}</Pill>
            <Text>{task.requirements}</Text>
            <Text>Ưu tiên: {task.priority === 'High' ? 'Cao' : 'Bình thường'}</Text>
            {task.dueAt && (
              <Text style={task.isOverdue ? ui.red : ui.muted}>
                Hạn: {formatInstant(task.dueAt)}
              </Text>
            )}
            <Text>
              {task.evidenceRequired ? 'Yêu cầu ảnh kết quả' : 'Ảnh kết quả không bắt buộc'}
            </Text>
            {!task.responsibilityAvailable && (
              <Text style={ui.red}>Cần Owner cập nhật phân công nhân viên.</Text>
            )}
            {task.result && <Text>Kết quả: {task.result}</Text>}
            {task.verifiedAt && <Text>Owner đã kiểm tra: {formatInstant(task.verifiedAt)}</Text>}
          </Box>
          {task.kind === 'MeterReading' && role === 'Staff' && (
            <Action onPress={() => go(role === 'Staff' ? 'meter-reading' : 'operations')}>
              Mở tác vụ đồng hồ
            </Action>
          )}
          <Heading title="Ảnh kết quả" />
          <OwnerDataState {...evidence} />
          {evidence.data?.map((file, index) => (
            <Box key={file.id}>
              <PrivateTaskImage taskId={id} evidence={file} number={index + 1} />
              {role === 'Staff' && actions.includes('submit') && (
                <Checkbox.Item
                  label={`Dùng ảnh ${index + 1} cho lần gửi này`}
                  status={selected.includes(file.id) ? 'checked' : 'unchecked'}
                  disabled={busy}
                  onPress={() =>
                    setSelected((before) =>
                      before.includes(file.id)
                        ? before.filter((value) => value !== file.id)
                        : [...before, file.id],
                    )
                  }
                />
              )}
            </Box>
          ))}
          {evidence.data?.length === 0 && <Text>Chưa có ảnh kết quả.</Text>}
          {role === 'Staff' && actions.includes('submit') && (
            <Box>
              <CameraCapture
                label="Chụp ảnh kết quả công việc"
                disabled={busy || query.loading}
                reviewBeforeSubmit
                onCapture={async (bytes) => {
                  if (!client || lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setError('');
                  setNotice('');
                  try {
                    const file = await client.upload(id, bytes, randomUUID());
                    setSelected((before) => [...new Set([...before, file.id])]);
                    setNotice('Đã tải ảnh lên máy chủ.');
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    lock.current = false;
                    setBusy(false);
                    reload();
                  }
                }}
              />
            </Box>
          )}
          {actions.length > 0 && (
            <Box>
              <Heading title={role === 'Owner' ? 'Kiểm tra & phối hợp' : 'Cập nhật công việc'} />
              <ChoiceField
                label="Thao tác"
                value={action}
                options={actions.map((id) => ({ id, label: taskActionLabels[id]! }))}
                disabled={busy || query.loading}
                onChange={(value) => {
                  setAction(value as TaskAction);
                  setError('');
                  setNotice('');
                }}
              />
              <Input
                label="Kết quả / Nội dung / Lý do"
                value={note}
                onChange={setNote}
                multiline
                disabled={busy}
              />
              {action === 'verify' && (
                <Text>
                  Xác nhận sau khi đã kiểm tra kết quả và ảnh bằng chứng. Công việc sẽ chuyển thành
                  Hoàn thành.
                </Text>
              )}
              {action === 'cancel' && (
                <Text>Hủy công việc và giữ lại lịch sử. Cần ghi rõ lý do.</Text>
              )}
              <Action
                disabled={
                  busy ||
                  query.loading ||
                  evidence.loading ||
                  !actions.includes(action as TaskAction)
                }
                onPress={() => setConfirmDecision(true)}
              >
                Xác nhận thao tác
              </Action>
            </Box>
          )}
        </>
      )}
      <Heading title="Lịch sử công việc" />
      <OwnerDataState {...history} />
      {history.data?.items.map((entry) => (
        <Box key={entry.id}>
          <Pill>{taskActionLabels[entry.action] ?? 'Cập nhật công việc'}</Pill>
          <Text>{entry.note}</Text>
          <Text style={ui.muted}>{formatInstant(entry.occurredAt)}</Text>
        </Box>
      ))}
      {history.data && history.data.totalCount > 20 && (
        <Pagination
          page={historyPage}
          total={history.data.totalCount}
          loading={history.loading}
          onChange={setHistoryPage}
        />
      )}
      <Portal>
        <Dialog visible={confirmDecision} onDismiss={() => !busy && setConfirmDecision(false)}>
          <Dialog.Title>{action ? taskActionLabels[action] : 'Xác nhận thao tác'}</Dialog.Title>
          <Dialog.Content>
            <Text>{task?.title}. Gửi xác nhận sau khi đã xem kết quả và ảnh minh chứng?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button disabled={busy} onPress={() => setConfirmDecision(false)}>
              Quay lại
            </Button>
            <Button
              disabled={busy}
              loading={busy}
              onPress={() => {
                setConfirmDecision(false);
                void act();
              }}
            >
              Xác nhận gửi
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

function PrivateTaskImage({
  taskId,
  evidence,
  number,
}: {
  taskId: string;
  evidence: TaskEvidence;
  number: number;
}) {
  const { api } = useSession();
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const abort = useRef<AbortController | null>(null);
  React.useEffect(() => () => abort.current?.abort(), []);
  return (
    <>
      <Text>
        Ảnh {number} · {formatInstant(evidence.createdAt)}
      </Text>
      {uri && (
        <Image
          source={{ uri }}
          accessibilityLabel={`Ảnh kết quả ${number}`}
          style={{ width: '100%', height: 240 }}
          resizeMode="contain"
        />
      )}
      <Action
        secondary
        disabled={busy}
        onPress={async () => {
          if (!api || busy) return;
          setBusy(true);
          setError('');
          const controller = new AbortController();
          abort.current = controller;
          try {
            const bytes = await api.request<Uint8Array<ArrayBuffer>>(
              `/api/v1/operational-tasks/${guid(taskId)}/evidence/${guid(evidence.id)}`,
              { signal: controller.signal },
              'bytes',
            );
            // Inline data is held only in component memory; no public object URL or disk cache.
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192)
              binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            if (!controller.signal.aborted)
              setUri(`data:${evidence.contentType};base64,${btoa(binary)}`);
          } catch (e) {
            if (!controller.signal.aborted) setError(errorMessage(e));
          } finally {
            if (!controller.signal.aborted) setBusy(false);
          }
        }}
      >
        Xem ảnh {number}
      </Action>
      {!!error && <Text style={ui.red}>{error}</Text>}
    </>
  );
}

export function TaskWorkForm({
  task,
  onCancel,
  onSaved,
}: {
  task?: OperationalTask;
  onCancel: () => void;
  onSaved: (task: OperationalTask) => void;
}) {
  const { api } = useSession();
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations');
  const [location, setLocation] = useState(task?.locationId ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [requirements, setRequirements] = useState(task?.requirements ?? '');
  const [priority, setPriority] = useState<'Normal' | 'High'>(task?.priority ?? 'Normal');
  // Local business date input is explicit UTC+07:00, regardless of device timezone.
  const [date, setDate] = useState(() => {
    if (!task?.dueAt) return '';
    const local = new Date(new Date(task.dueAt).getTime() + 7 * 3600000).toISOString();
    return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`;
  });
  const [required, setRequired] = useState(task?.evidenceRequired ?? true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  async function save() {
    if (!api || lock.current) return;
    const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(date.trim());
    const iso = match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}` : '';
    const dueAt = `${iso}:00+07:00`;
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso) ||
      !Number.isFinite(Date.parse(dueAt)) ||
      new Date(Date.parse(dueAt) + 7 * 3600000).toISOString().slice(0, 16) !== iso
    ) {
      setError('Nhập thời hạn theo dd/MM/yyyy HH:mm (giờ Việt Nam).');
      return;
    }
    if (
      !title.trim() ||
      title.trim().length > 200 ||
      !requirements.trim() ||
      requirements.length > 8000 ||
      !location ||
      (task && !reason.trim())
    ) {
      setError('Nhập cơ sở, tên, yêu cầu công việc và lý do sửa (nếu có).');
      return;
    }
    const work: TaskWork = {
      title: title.trim(),
      requirements: requirements.trim(),
      priority,
      dueAt,
      evidenceRequired: required,
    };
    const body = { location, work, version: task?.version, reason: reason.trim() };
    const scope = task?.id ?? 'create';
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const client = operationalTasks(api);
      const next = task
        ? await client.update(task.id, task.version, work, reason.trim(), keys.get(scope, body))
        : await client.create(location, work, keys.get(scope, body));
      keys.confirmed(scope, body);
      onSaved(next);
      showSuccess('Máy chủ đã lưu thông tin công việc.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title={task ? 'Sửa công việc' : 'Tạo công việc vận hành'}
        detail="Nhân viên được xác định từ phân công cơ sở hiện hành"
      />
      <QueryState {...locations} />
      <Box>
        <ChoiceField
          label="Cơ sở"
          value={location}
          options={locations.data ?? []}
          disabled={!!task || busy}
          onChange={setLocation}
        />
        <Input label="Tên công việc" value={title} onChange={setTitle} disabled={busy} />
        <Input
          label="Yêu cầu & kết quả cần đạt"
          value={requirements}
          onChange={setRequirements}
          multiline
          disabled={busy}
        />
        <ChoiceField
          label="Ưu tiên"
          value={priority}
          options={[
            { id: 'Normal', label: 'Bình thường' },
            { id: 'High', label: 'Cao' },
          ]}
          onChange={(value) => setPriority(value as 'Normal' | 'High')}
          disabled={busy}
        />
        <Input
          label="Thời hạn (dd/MM/yyyy HH:mm, giờ Việt Nam)"
          value={date}
          onChange={setDate}
          disabled={busy}
        />
        <Checkbox.Item
          label="Bắt buộc ảnh kết quả"
          status={required ? 'checked' : 'unchecked'}
          disabled={busy}
          onPress={() => setRequired((v) => !v)}
        />
        {task && <Input label="Lý do sửa" value={reason} onChange={setReason} disabled={busy} />}
        {!!error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        <Action disabled={busy || locations.loading} onPress={() => void save()}>
          Lưu công việc
        </Action>
        <Action secondary disabled={busy} onPress={onCancel}>
          Quay lại
        </Action>
      </Box>
    </>
  );
}
