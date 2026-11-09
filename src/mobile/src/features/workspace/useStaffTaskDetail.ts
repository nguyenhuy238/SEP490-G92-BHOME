import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MobileApiError } from '../../lib/api';
import { randomUUID } from '../../lib/randomUUID';
import { queryPolicies } from '../../lib/queryPolicies';
import { showSuccess } from '../../lib/toast';
import { useSession } from '../../lib/SessionProvider';
import {
  availableTaskActions,
  operationalTasks,
  type OperationalTask,
  type TaskEvidence,
  type TaskHistory,
  type TaskPage,
} from '../../services/operationalTasks';
import { useCachedWorkspaceQuery } from './useCachedWorkspaceQuery';

export type StaffTaskAction = 'start' | 'progress' | 'blockers' | 'submit';
type Command = {
  action: StaffTaskAction;
  version: number;
  note: string;
  evidenceIds: string[];
  key: string;
};
type Upload = { bytes: Uint8Array<ArrayBuffer>; key: string; file?: TaskEvidence };
export function taskDetailError(error: unknown) {
  if (error instanceof MobileApiError) {
    const messages: Record<string, string> = {
      completion_evidence_required: 'Chọn ít nhất một ảnh minh chứng trước khi gửi kết quả.',
      invalid_task_evidence: 'Ảnh không còn hợp lệ cho lần gửi này. Tải lại danh sách ảnh.',
      task_evidence_limit: 'Đã đạt số ảnh tối đa của công việc.',
      task_evidence_too_large: 'Ảnh vượt giới hạn máy chủ. Hãy chụp lại ảnh nhỏ hơn.',
      invalid_task_image: 'Ảnh không hợp lệ. Hãy chụp lại ảnh JPEG hoặc PNG.',
      corrupted_task_image: 'Không đọc được nội dung ảnh. Hãy chụp lại.',
      task_note_required: 'Nhập nội dung trước khi gửi.',
      stale_version: 'Công việc đã thay đổi. Hãy xem dữ liệu mới trước khi gửi lại.',
      invalid_task_transition: 'Trạng thái công việc đã thay đổi. Hãy kiểm tra lại.',
    };
    if (error.code && messages[error.code]) return messages[error.code];
    return (
      (
        {
          400: 'Nội dung chưa hợp lệ. Kiểm tra ghi chú và ảnh minh chứng trước khi gửi lại.',
          401: 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.',
          403: 'Bạn không có quyền xử lý công việc này.',
          404: 'Không tìm thấy công việc hoặc công việc ngoài phạm vi được phân công.',
          409: 'Công việc đã thay đổi hoặc chưa đủ điều kiện. Hãy xem lại dữ liệu mới.',
          413: 'Ảnh vượt giới hạn máy chủ. Hãy chụp lại ảnh nhỏ hơn.',
        } as Record<number, string>
      )[error.status] ?? 'Chưa xác nhận được kết quả từ máy chủ. Kiểm tra kết nối và thử lại.'
    );
  }
  return 'Chưa kết nối được máy chủ. Nội dung bạn nhập vẫn được giữ lại.';
}
const uncertain = (error: unknown) =>
  !(error instanceof MobileApiError) || error.status === 0 || error.status >= 500;

export function useStaffTaskDetail(id: string) {
  const { api, session } = useSession();
  const client = useMemo(() => (api ? operationalTasks(api) : null), [api]);
  const detail = useCachedWorkspaceQuery<OperationalTask>(
    `/api/v1/operational-tasks/${id}`,
    queryPolicies.tasks,
  );
  const evidence = useCachedWorkspaceQuery<TaskEvidence[]>(
    `/api/v1/operational-tasks/${id}/evidence`,
    queryPolicies.tasks,
  );
  const [historyPage, setHistoryPage] = useState(1);
  const history = useCachedWorkspaceQuery<TaskPage<TaskHistory>>(
    `/api/v1/operational-tasks/${id}/history?page=${historyPage}&pageSize=20`,
    queryPolicies.tasks,
  );
  const [sheet, setSheet] = useState<StaffTaskAction | 'choose' | null>(null);
  const [notes, setNotes] = useState<Record<StaffTaskAction, string>>({
    start: '',
    progress: '',
    blockers: '',
    submit: '',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<'action' | 'upload' | null>(null);
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [pendingAction, setPendingAction] = useState<Command | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const upload = useRef<Upload | null>(null);
  const actionLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      upload.current?.bytes.fill(0);
      upload.current = null;
    };
  }, []);
  const task = detail.data;
  const allowed =
    task && session?.roles.includes('Staff') && task.responsibilityAvailable && !detail.rawError
      ? availableTaskActions(task, 'Staff', session.userId).filter(
          (action): action is StaffTaskAction =>
            ['start', 'progress', 'blockers', 'submit'].includes(action),
        )
      : [];
  const canUpload = allowed.includes('submit');
  const reloadDetail = detail.reload,
    reloadEvidence = evidence.reload,
    reloadHistory = history.reload;
  const reload = useCallback(() => {
    reloadDetail();
    reloadEvidence();
    reloadHistory();
  }, [reloadDetail, reloadEvidence, reloadHistory]);
  const apply = detail.setData;
  const [syncedVersion, setSyncedVersion] = useState(true);
  const refreshTask = detail.refresh;
  const refreshEvidence = evidence.refresh;
  async function send() {
    if (!client || !task || !sheet || sheet === 'choose' || actionLock.current || !syncedVersion)
      return;
    if (!pendingAction && (!allowed.includes(sheet) || (conflict && !reviewed))) return;
    const note = notes[sheet].trim();
    if (!pendingAction && sheet !== 'start' && !note) {
      setError('Nhập nội dung trước khi gửi.');
      return;
    }
    const ids = selected.filter((fileId) => evidence.data?.some((file) => file.id === fileId));
    if (!pendingAction && sheet === 'submit' && task.evidenceRequired && !ids.length) {
      setError('Chọn ít nhất một ảnh minh chứng trước khi gửi kết quả.');
      return;
    }
    const command: Command = pendingAction ?? {
      action: sheet,
      version: task.version,
      note,
      evidenceIds: sheet === 'start' ? [] : ids,
      key: randomUUID(),
    };
    actionLock.current = true;
    setBusy('action');
    setError('');
    try {
      const result = await client.act(
        id,
        command.action,
        command.version,
        command.note,
        command.evidenceIds,
        command.key,
      );
      if (!alive.current) return;
      apply(result);
      setPendingAction(null);
      setConflict(false);
      setReviewed(false);
      setNotes((previous) => ({ ...previous, [command.action]: '' }));
      setSelected([]);
      setSheet(null);
      setHistoryPage(1);
      history.reload();
      evidence.reload();
      showSuccess(
        {
          start: 'Đã bắt đầu công việc.',
          progress: 'Đã lưu tiến độ.',
          blockers: 'Đã gửi báo cáo vướng mắc.',
          submit: 'Đã gửi kết quả. Chờ Owner kiểm tra.',
        }[command.action],
      );
    } catch (failure) {
      if (!alive.current) return;
      setError(taskDetailError(failure));
      if (failure instanceof MobileApiError && failure.status === 409) {
        setPendingAction(null);
        setConflict(true);
        setReviewed(false);
        try {
          await refreshTask();
          await refreshEvidence();
        } catch {
          setSyncedVersion(false);
        }
      } else if (uncertain(failure)) {
        // Freeze the exact payload/key: even if the server already committed it, retry is safe.
        setPendingAction(command);
      } else {
        setPendingAction(null);
        if (failure instanceof MobileApiError && [401, 403, 404].includes(failure.status))
          detail.reload();
      }
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(null);
    }
  }
  async function uploadPhoto(bytes?: Uint8Array<ArrayBuffer>) {
    if (!client || actionLock.current || (!upload.current && !canUpload)) return false;
    if (!upload.current) {
      if (!bytes) return false;
      upload.current = { bytes: bytes.slice(), key: randomUUID() };
    }
    const pending = upload.current;
    actionLock.current = true;
    setBusy('upload');
    setUploadError('');
    setSyncedVersion(false);
    setUploadPending(true);
    try {
      if (!pending.file) pending.file = await client.upload(id, pending.bytes, pending.key);
      if (!alive.current) return false;
      // Upload returns metadata, not a TaskView; the following GET must succeed before any action.
      await refreshTask();
      await refreshEvidence();
      if (!alive.current) return false;
      const fileId = pending.file.id;
      setSelected((previous) => [...new Set([...previous, fileId])]);
      pending.bytes.fill(0);
      upload.current = null;
      setUploadPending(false);
      setSyncedVersion(true);
      history.reload();
      showSuccess('Đã tải ảnh minh chứng.');
      return true;
    } catch (failure) {
      if (!alive.current) return false;
      setUploadError(taskDetailError(failure));
      // A failed read after an acknowledged upload retries the read, never uploads again.
      if (!pending.file && !uncertain(failure)) {
        pending.bytes.fill(0);
        upload.current = null;
        setUploadPending(false);
        try {
          await refreshTask();
          setSyncedVersion(true);
        } catch {
          /* Actions remain blocked. */
        }
      }
      return false;
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(null);
    }
  }
  async function synchronize() {
    if (actionLock.current) return;
    setBusy('action');
    actionLock.current = true;
    try {
      await refreshTask();
      await refreshEvidence();
      if (alive.current) setSyncedVersion(true);
    } catch (failure) {
      if (alive.current) setError(taskDetailError(failure));
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(null);
    }
  }
  return {
    client,
    detail,
    evidence,
    history,
    historyPage,
    setHistoryPage,
    task,
    allowed,
    canUpload,
    sheet,
    setSheet,
    notes,
    setNote: (action: StaffTaskAction, note: string) => {
      if (!pendingAction) setNotes((previous) => ({ ...previous, [action]: note }));
    },
    selected,
    toggleEvidence: (fileId: string) => {
      if (!busy && !pendingAction)
        setSelected((previous) =>
          previous.includes(fileId)
            ? previous.filter((value) => value !== fileId)
            : [...previous, fileId],
        );
    },
    busy,
    error,
    uploadError,
    conflict,
    reviewed,
    setReviewed,
    pendingAction,
    uploadPending,
    syncedVersion,
    reload,
    send,
    uploadPhoto,
    synchronize,
    clearError: () => setError(''),
  };
}
