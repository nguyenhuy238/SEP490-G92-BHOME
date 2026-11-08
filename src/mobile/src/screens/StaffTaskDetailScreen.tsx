import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Icon,
  IconButton,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { CameraCapture } from '../components/CameraCapture';
import { KeyboardFormScrollView } from '../components/KeyboardFormScrollView';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useStaffTaskDetail, taskDetailError } from '../features/workspace/useStaffTaskDetail';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { taskActionLabels, type TaskEvidence } from '../services/operationalTasks';
import { colors as c } from '../theme/theme';

type DetailModel = ReturnType<typeof useStaffTaskDetail>;
const statusLabels: Record<string, string> = {
  Assigned: 'Cần làm',
  InProgress: 'Đang thực hiện',
  PendingVerification: 'Chờ Owner kiểm tra',
  Completed: 'Đã hoàn thành',
  Cancelled: 'Đã hủy',
};
const forms = {
  start: {
    title: 'Bắt đầu công việc',
    field: 'Ghi chú (không bắt buộc)',
    submit: 'Bắt đầu công việc',
  },
  progress: { title: 'Cập nhật tiến độ', field: 'Nội dung cập nhật', submit: 'Lưu tiến độ' },
  blockers: { title: 'Báo vướng mắc', field: 'Mô tả khó khăn đang gặp', submit: 'Gửi báo cáo' },
  submit: {
    title: 'Hoàn thành công việc',
    field: 'Kết quả thực hiện',
    submit: 'Gửi Owner kiểm tra',
  },
};

export function StaffTaskDetailScreen({ id }: { id: string }) {
  const model = useStaffTaskDetail(id);
  const { go } = useWorkspace();
  const { task, detail, busy, allowed, setSheet } = model;
  const [expanded, setExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const refresh = model.reload;
  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') refresh();
      }, 30000);
      return () => clearInterval(timer);
    }, [refresh]),
  );
  const footer = useMemo(() => {
    if (!task || (!allowed.length && !model.pendingAction)) return null;
    return (
      <View style={styles.actionBar}>
        <Button
          mode="contained"
          disabled={!!busy || !model.syncedVersion || model.uploadPending}
          onPress={() =>
            setSheet(
              model.pendingAction?.action ?? (task.status === 'Assigned' ? 'start' : 'choose'),
            )
          }
          contentStyle={{ minHeight: 46 }}
        >
          {model.pendingAction
            ? 'Tiếp tục thao tác chưa xác nhận'
            : task.status === 'Assigned'
              ? 'Bắt đầu công việc'
              : 'Cập nhật công việc'}
        </Button>
      </View>
    );
  }, [
    task,
    allowed.length,
    busy,
    model.syncedVersion,
    model.uploadPending,
    model.pendingAction,
    setSheet,
  ]);
  const inShell = useWorkspaceHeaderRefresh(refresh, !!busy || detail.fetching, {
    title: 'Chi tiết công việc',
    footer,
  });
  if (!task)
    return (
      <>
        {!inShell && <Text variant="titleLarge">Chi tiết công việc</Text>}
        {detail.loading ? (
          <TaskDetailSkeleton />
        ) : (
          <View style={styles.section}>
            <Text variant="titleMedium">Chưa mở được công việc</Text>
            <Text accessibilityRole="alert" style={styles.muted}>
              {taskDetailError(detail.rawError)}
            </Text>
            <Button onPress={refresh}>Thử lại</Button>
            <Button onPress={() => go('work-orders')}>Về danh sách công việc</Button>
          </View>
        )}
      </>
    );
  const pending = task.status === 'PendingVerification';
  const due =
    task.dueAt && Number.isFinite(Date.parse(task.dueAt)) ? formatInstant(task.dueAt) : null;
  const entries = model.history.data?.items ?? [];
  return (
    <>
      {!inShell && <Text variant="titleLarge">Chi tiết công việc</Text>}
      {!!detail.rawError && <ReadFailure error={detail.rawError} retry={refresh} />}
      <View style={styles.section}>
        <Text variant="titleLarge" numberOfLines={3} style={styles.title}>
          {task.title || 'Công việc vận hành'}
        </Text>
        <View style={styles.row}>
          <View style={[styles.badge, pending && { backgroundColor: c.amberSoft }]}>
            <Text variant="labelMedium" style={{ color: pending ? c.amber : c.primary }}>
              {statusLabels[task.status] ?? 'Đang cập nhật trạng thái'}
            </Text>
          </View>
          {task.priority === 'High' && (
            <Text variant="labelMedium" style={{ color: c.amber }}>
              Ưu tiên cao
            </Text>
          )}
        </View>
        {due && (
          <View style={styles.row}>
            <Icon
              source="clock-outline"
              size={16}
              color={task.isOverdue && !pending ? c.red : c.muted}
            />
            <Text
              variant="bodySmall"
              style={task.isOverdue && !pending ? styles.error : styles.muted}
            >
              {task.isOverdue && !pending ? 'Quá hạn · ' : 'Hạn · '}
              {due}
            </Text>
          </View>
        )}
        {!task.responsibilityAvailable && (
          <Text variant="bodySmall" style={styles.muted}>
            Chưa có nhân viên phụ trách có hiệu lực. Liên hệ Owner để cập nhật phân công.
          </Text>
        )}
        {!allowed.length && task.status === 'InProgress' && !detail.rawError && (
          <Text variant="bodySmall" style={styles.muted}>
            Bạn chỉ có quyền xem công việc này.
          </Text>
        )}
      </View>
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.title}>
          Yêu cầu công việc
        </Text>
        <Text
          variant="bodyMedium"
          numberOfLines={
            !expanded &&
            (task.requirements.length > 220 || task.requirements.split('\n').length > 5)
              ? 5
              : undefined
          }
          style={styles.body}
        >
          {task.requirements || 'Chưa có yêu cầu bổ sung.'}
        </Text>
        {(task.requirements.length > 220 || task.requirements.split('\n').length > 5) && (
          <Button compact style={styles.inlineButton} onPress={() => setExpanded(!expanded)}>
            {expanded ? 'Thu gọn' : 'Xem thêm'}
          </Button>
        )}
      </View>
      {!!task.result && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.title}>
            Kết quả đã gửi
          </Text>
          <Text variant="bodyMedium" style={styles.body}>
            {task.result}
          </Text>
          {pending && (
            <Text variant="bodySmall" style={styles.muted}>
              Đã gửi kết quả. Đang chờ Chủ trọ xác nhận.
            </Text>
          )}
          {task.verifiedAt && (
            <Text variant="bodySmall" style={styles.muted}>
              Đã kiểm tra · {formatInstant(task.verifiedAt)}
            </Text>
          )}
        </View>
      )}
      {task.kind === 'MeterReading' && (
        <Button onPress={() => go('meter-reading')}>Mở tác vụ ghi chỉ số</Button>
      )}
      <View style={styles.section}>
        <View style={styles.between}>
          <Text variant="titleMedium" style={styles.title}>
            Hình ảnh minh chứng
          </Text>
          {model.evidence.data && (
            <Text variant="bodySmall" style={styles.muted}>
              {model.evidence.data.length} ảnh
            </Text>
          )}
        </View>
        {task.evidenceRequired && model.canUpload && (
          <Text variant="bodySmall" style={styles.muted}>
            Cần ảnh minh chứng trước khi gửi kết quả.
          </Text>
        )}
        {model.evidence.loading && <ActivityIndicator size="small" />}
        {!!model.evidence.rawError && (
          <ReadFailure error={model.evidence.rawError} retry={model.evidence.reload} />
        )}
        {model.evidence.data?.length === 0 && (
          <Text variant="bodySmall" style={styles.muted}>
            Chưa có ảnh minh chứng.
          </Text>
        )}
        <TaskEvidenceGrid model={model} />
        {model.canUpload && (
          <CameraCapture
            label="Thêm ảnh minh chứng"
            presentation="evidence"
            disabled={busy === 'action' || !!model.pendingAction}
            retryOnly={model.uploadPending}
            uploadError={model.uploadError}
            reviewBeforeSubmit
            onCapture={model.uploadPhoto}
          />
        )}
        {busy === 'upload' && (
          <View style={styles.row}>
            <ActivityIndicator size="small" />
            <Text variant="bodySmall" style={styles.muted}>
              Đang tải ảnh và cập nhật công việc…
            </Text>
          </View>
        )}
        {!!model.uploadError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {model.uploadError}
          </Text>
        )}
        {model.uploadPending && !busy && (
          <Button onPress={() => void model.uploadPhoto()}>Thử lại tải ảnh</Button>
        )}
        {!model.syncedVersion && !model.uploadPending && (
          <Button disabled={!!busy} onPress={() => void model.synchronize()}>
            Tải trạng thái mới trước khi tiếp tục
          </Button>
        )}
      </View>
      <View style={styles.section}>
        <Text variant="titleMedium" style={styles.title}>
          Lịch sử hoạt động
        </Text>
        {model.history.loading && <ActivityIndicator size="small" />}
        {!!model.history.rawError && (
          <ReadFailure error={model.history.rawError} retry={model.history.reload} />
        )}
        {model.history.data?.items.length === 0 && (
          <Text variant="bodySmall" style={styles.muted}>
            Chưa có hoạt động.
          </Text>
        )}
        {(historyExpanded ? entries : entries.slice(0, 3)).map((entry) => (
          <View key={entry.id} style={styles.timelineRow}>
            <View style={styles.timelineDot} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="labelLarge" style={styles.title}>
                {taskActionLabels[entry.action] ?? 'Hoạt động công việc'}
              </Text>
              <Text variant="labelSmall" style={styles.muted}>
                {formatInstant(entry.occurredAt)}
              </Text>
              {!!entry.note && <HistoryNote note={entry.note} />}
            </View>
          </View>
        ))}
        {entries.length > 3 && (
          <Button compact onPress={() => setHistoryExpanded(!historyExpanded)}>
            {historyExpanded ? 'Thu gọn lịch sử' : 'Xem thêm hoạt động'}
          </Button>
        )}
        {model.history.data && model.history.data.totalCount > model.history.data.pageSize && (
          <View style={styles.between}>
            <IconButton
              icon="chevron-left"
              accessibilityLabel="Trang lịch sử trước"
              disabled={model.history.fetching || model.historyPage === 1}
              onPress={() => {
                model.setHistoryPage(model.historyPage - 1);
                setHistoryExpanded(true);
              }}
            />
            <Text variant="bodySmall" style={styles.muted}>
              Trang {model.historyPage}
            </Text>
            <IconButton
              icon="chevron-right"
              accessibilityLabel="Trang lịch sử sau"
              disabled={
                model.history.fetching ||
                model.historyPage * model.history.data.pageSize >= model.history.data.totalCount
              }
              onPress={() => {
                model.setHistoryPage(model.historyPage + 1);
                setHistoryExpanded(true);
              }}
            />
          </View>
        )}
      </View>
      {!inShell && footer}
      <TaskActionSheet model={model} />
    </>
  );
}

function ReadFailure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="alert" variant="bodySmall" style={styles.error}>
        {taskDetailError(error)}
      </Text>
      <Button compact onPress={retry} style={styles.inlineButton}>
        Thử lại
      </Button>
    </View>
  );
}
function HistoryNote({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = note.length > 140 || note.split('\n').length > 2;
  return (
    <>
      <Text
        variant="bodySmall"
        style={styles.body}
        numberOfLines={long && !expanded ? 2 : undefined}
      >
        {note}
      </Text>
      {long && (
        <Button compact style={styles.inlineButton} onPress={() => setExpanded(!expanded)}>
          {expanded ? 'Thu gọn ghi chú' : 'Xem ghi chú'}
        </Button>
      )}
    </>
  );
}
function TaskDetailSkeleton() {
  return (
    <View
      accessibilityLabel="Đang tải chi tiết công việc"
      accessibilityRole="progressbar"
      style={styles.section}
    >
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonLine} />
      <ActivityIndicator size="small" />
    </View>
  );
}

function TaskActionSheet({ model }: { model: DetailModel }) {
  const { sheet, setSheet, task, busy, notes, pendingAction } = model;
  const close = () => {
    if (!busy) setSheet(null);
  };
  const action = sheet && sheet !== 'choose' ? sheet : null;
  const form = action ? forms[action] : null;
  const canSend = action && (pendingAction || model.allowed.includes(action));
  const selected = model.selected.filter((id) =>
    model.evidence.data?.some((file) => file.id === id),
  );
  return (
    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.scrim} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.between}>
            <Text variant="titleLarge" style={styles.sheetHeading}>
              {form?.title ?? 'Cập nhật công việc'}
            </Text>
            <IconButton
              icon="close"
              accessibilityLabel="Đóng cập nhật công việc"
              disabled={!!busy}
              onPress={close}
            />
          </View>
          <KeyboardFormScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.sheetContent}
          >
            {sheet === 'choose' &&
              model.allowed
                .filter((value) => value !== 'start')
                .map((value) => (
                  <Button
                    key={value}
                    mode={value === 'submit' ? 'contained' : 'outlined'}
                    onPress={() => {
                      model.clearError();
                      setSheet(value);
                    }}
                    contentStyle={{ minHeight: 46 }}
                  >
                    {value === 'submit' ? 'Gửi kết quả' : forms[value].title}
                  </Button>
                ))}
            {action && form && (
              <>
                <TextInput
                  mode="outlined"
                  label={form.field}
                  accessibilityLabel={form.field}
                  multiline
                  maxLength={8000}
                  value={notes[action]}
                  onChangeText={(note) => model.setNote(action, note)}
                  disabled={!!busy || !!pendingAction}
                  style={styles.input}
                />
                {action !== 'start' && !!model.evidence.data?.length && (
                  <>
                    <Text variant="labelLarge">
                      {action === 'submit' ? 'Ảnh kèm kết quả' : 'Ảnh đính kèm'}
                    </Text>
                    <TaskEvidenceGrid model={model} selectable />
                  </>
                )}
                {action === 'submit' && task?.evidenceRequired && !selected.length && (
                  <Text variant="bodySmall" style={styles.muted}>
                    Cần ảnh minh chứng trước khi gửi kết quả.
                  </Text>
                )}
                {!!model.error && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {model.error}
                  </Text>
                )}
                {pendingAction && (
                  <Text variant="bodySmall" style={styles.muted}>
                    Kết quả lần gửi trước chưa được xác nhận. Thử lại sẽ dùng đúng nội dung và mã
                    thao tác cũ.
                  </Text>
                )}
                {model.conflict && (
                  <>
                    <Text variant="bodySmall" style={styles.muted}>
                      Đã tải lại dữ liệu. Nội dung bạn nhập vẫn được giữ. Kiểm tra trạng thái trước
                      khi gửi lại.
                    </Text>
                    <Checkbox.Item
                      label="Tôi đã kiểm tra dữ liệu mới"
                      status={model.reviewed ? 'checked' : 'unchecked'}
                      disabled={!!busy}
                      onPress={() => model.setReviewed(!model.reviewed)}
                    />
                  </>
                )}
                {!canSend && (
                  <Text variant="bodySmall" style={styles.muted}>
                    Trạng thái hoặc phân công hiện tại không cho phép thao tác này.
                  </Text>
                )}
                <Button
                  mode="contained"
                  loading={busy === 'action'}
                  disabled={
                    !!busy ||
                    !model.syncedVersion ||
                    model.uploadPending ||
                    !canSend ||
                    (!pendingAction &&
                      ((action !== 'start' && !notes[action].trim()) ||
                        (action === 'submit' && !!task?.evidenceRequired && !selected.length) ||
                        (model.conflict && !model.reviewed)))
                  }
                  onPress={() => void model.send()}
                  contentStyle={{ minHeight: 46 }}
                >
                  {pendingAction
                    ? 'Thử lại thao tác'
                    : model.conflict
                      ? 'Xác nhận gửi lại'
                      : form.submit}
                </Button>
              </>
            )}
            <Button disabled={!!busy} onPress={close}>
              Đóng
            </Button>
          </KeyboardFormScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TaskEvidenceGrid({
  model,
  selectable = false,
}: {
  model: DetailModel;
  selectable?: boolean;
}) {
  return (
    <View style={styles.grid}>
      {model.evidence.data?.map((file, index) => (
        <View key={file.id} style={styles.gridCell}>
          <TaskEvidenceImage
            client={model.client}
            taskId={model.task!.id}
            file={file}
            number={index + 1}
          />
          {selectable && (
            <Checkbox.Item
              label={`Dùng ảnh ${index + 1}`}
              status={model.selected.includes(file.id) ? 'checked' : 'unchecked'}
              disabled={!!model.busy || !!model.pendingAction}
              onPress={() => model.toggleEvidence(file.id)}
            />
          )}
        </View>
      ))}
    </View>
  );
}
function TaskEvidenceImage({
  client,
  taskId,
  file,
  number,
}: {
  client: DetailModel['client'];
  taskId: string;
  file: TaskEvidence;
  number: number;
}) {
  const [uri, setUri] = useState('');
  const [failure, setFailure] = useState(false);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void client
      .imageBytes(taskId, file.id, controller.signal)
      .then((bytes) => {
        try {
          if (controller.signal.aborted) return;
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          setUri(`data:${file.contentType};base64,${btoa(binary)}`);
        } finally {
          bytes.fill(0);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailure(true);
      });
    return () => controller.abort();
  }, [client, taskId, file.id, file.contentType, revision]);
  return (
    <>
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel={failure ? `Tải lại ảnh ${number}` : `Xem ảnh minh chứng ${number}`}
        disabled={!failure && !uri}
        onPress={() => {
          if (failure) {
            setFailure(false);
            setRevision(revision + 1);
          } else setPreview(true);
        }}
        style={styles.thumbnail}
      >
        {uri ? (
          <Image
            source={{ uri }}
            accessibilityLabel={`Ảnh minh chứng ${number}`}
            style={{ width: '100%', height: 96 }}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            {failure ? (
              <Text variant="labelSmall" style={styles.muted}>
                Tải lại ảnh
              </Text>
            ) : (
              <ActivityIndicator size="small" />
            )}
          </View>
        )}
      </TouchableRipple>
      <Modal visible={preview} animationType="fade" onRequestClose={() => setPreview(false)}>
        <View style={styles.imagePreview}>
          <IconButton
            icon="close"
            accessibilityLabel="Đóng ảnh minh chứng"
            onPress={() => setPreview(false)}
          />
          <Image
            source={{ uri }}
            style={{ flex: 1, width: '100%' }}
            resizeMode="contain"
            accessibilityLabel={`Xem lớn ảnh ${number}`}
          />
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  section: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  title: { color: c.primary },
  body: { color: c.ink, lineHeight: 21 },
  muted: { color: c.muted },
  error: { color: c.red },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { backgroundColor: c.soft, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 5 },
  inlineButton: { alignSelf: 'flex-start', marginLeft: -8 },
  actionBar: {
    backgroundColor: c.white,
    borderTopWidth: 1,
    borderColor: c.border,
    padding: 12,
    gap: 6,
  },
  timelineRow: { flexDirection: 'row', gap: 8, paddingVertical: 3 },
  timelineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.muted, marginTop: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridCell: { width: '47%', minWidth: 100, gap: 4 },
  thumbnail: { borderRadius: 8, overflow: 'hidden', backgroundColor: c.soft },
  imagePlaceholder: { height: 96, justifyContent: 'center', alignItems: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: c.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sheetHeading: { color: c.primary, flex: 1 },
  sheetContent: { gap: 14, paddingBottom: 16 },
  input: { backgroundColor: c.white, minHeight: 96 },
  imagePreview: { flex: 1, backgroundColor: c.white, paddingTop: 32, paddingBottom: 24 },
  skeletonTitle: { height: 24, width: '75%', backgroundColor: c.soft, borderRadius: 4 },
  skeletonLine: { height: 16, backgroundColor: c.soft, borderRadius: 4 },
});
