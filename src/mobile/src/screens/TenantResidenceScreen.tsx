import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  IconButton,
  Text,
  TextInput,
} from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import {
  residenceAction,
  residenceClient,
  residenceKey,
  residencePayload,
  residenceStatus,
  type ResidenceClient,
  type ResidenceTask,
} from '../../../../packages/client-core/src/residence';
import { useResidenceRecord } from '../../../../packages/client-core/src/useResidenceRecord';
import { useResidenceList } from '../../../../packages/client-core/src/useResidenceList';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { useSession } from '../lib/SessionProvider';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { ChoiceField } from '../components/WorkflowControls';
import { ContractDateField } from '../components/ContractDateField';
import { ResidenceEvidence } from '../features/residence/ResidenceEvidence';
import { colors as c } from '../theme/theme';

export function TenantResidenceScreen() {
  const { api, session } = useSession();
  const client = useMemo(
    () => (api ? residenceClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  if (!client || !session?.roles.includes('Tenant'))
    return <Text>Bạn cần tài khoản Khách thuê để xem hồ sơ tạm trú.</Text>;
  return <ResidenceList key={session.userId} api={client} />;
}
function ResidenceList({ api }: { api: ResidenceClient }) {
  const list = useResidenceList(api);
  const [selected, setSelected] = useState('');
  const reload = list.reload;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  const inShell = useWorkspaceHeaderRefresh(reload, list.loading, { title: 'Đăng ký tạm trú' });
  const items = list.data?.items ?? [];
  const current = items.find((task) => residenceKey(task) === selected) ?? items[0];
  return (
    <>
      {!inShell && (
        <View style={s.row}>
          <Text variant="titleMedium" style={s.grow}>
            Đăng ký tạm trú
          </Text>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại hồ sơ tạm trú"
            disabled={list.loading}
            onPress={reload}
          />
        </View>
      )}
      {list.loading && <ActivityIndicator size="small" />}
      {!!list.error && (
        <View style={s.card}>
          <Text accessibilityRole="alert" style={s.error}>
            {list.error}
          </Text>
          <Button compact onPress={reload}>
            Thử lại
          </Button>
        </View>
      )}
      {!list.loading && !list.error && !items.length && (
        <Text>Chưa có hồ sơ theo dõi tạm trú.</Text>
      )}
      {items.length > 1 && (
        <ChoiceField
          label="Phòng / người ở"
          value={current ? residenceKey(current) : ''}
          options={items.map((task) => ({
            id: residenceKey(task),
            label: `Phòng ${task.roomNumber} · ${task.residentLabel}`,
          }))}
          onChange={setSelected}
        />
      )}
      {current && !list.error && (
        <ResidenceRecord
          key={residenceKey(current)}
          api={api}
          contractId={current.contractId}
          residentId={current.residentId}
          listRecord={current}
        />
      )}
      {list.data && list.data.totalCount > list.data.pageSize && (
        <View style={s.row}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Trang hồ sơ trước"
            disabled={list.loading || list.page === 1}
            onPress={() => list.setPage(list.page - 1)}
          />
          <Text>Trang {list.page}</Text>
          <IconButton
            icon="chevron-right"
            accessibilityLabel="Trang hồ sơ sau"
            disabled={list.loading || list.page * list.data.pageSize >= list.data.totalCount}
            onPress={() => list.setPage(list.page + 1)}
          />
        </View>
      )}
    </>
  );
}
function ResidenceRecord({
  api,
  contractId,
  residentId,
  listRecord,
}: {
  api: ResidenceClient;
  contractId: string;
  residentId: string;
  listRecord: ResidenceTask;
}) {
  const record = useResidenceRecord(api, contractId, residentId);
  const reload = record.reload;
  React.useEffect(() => {
    void reload();
  }, [listRecord, reload]);
  return (
    <>
      {record.loading && <ActivityIndicator size="small" />}
      {!!record.error && (
        <Text accessibilityRole="alert" style={s.error}>
          {record.error}
        </Text>
      )}
      {!!record.notice && (
        <Text accessibilityRole="alert" style={{ color: c.primary }}>
          {record.notice}
        </Text>
      )}
      {!record.task && !record.loading && (
        <Button compact onPress={() => void record.reload()}>
          Thử lại hồ sơ
        </Button>
      )}
      {record.review && (
        <View style={s.card}>
          <Text>
            Hãy tải lại và đối chiếu hồ sơ trước khi tiếp tục. Nội dung đang nhập vẫn được giữ.
          </Text>
          <Button
            compact
            disabled={record.loading || record.busy}
            onPress={() => void record.reload()}
          >
            Kiểm tra dữ liệu mới
          </Button>
          {!record.error && !record.loading && (
            <Checkbox.Item
              label="Tôi đã đối chiếu dữ liệu mới"
              status="unchecked"
              onPress={record.acknowledge}
            />
          )}
        </View>
      )}
      {record.task && <ResidenceContent api={api} record={record} task={record.task} />}
    </>
  );
}
function ResidenceContent({
  api,
  record,
  task,
}: {
  api: ResidenceClient;
  record: ReturnType<typeof useResidenceRecord>;
  task: ResidenceTask;
}) {
  const [actual, setActual] = useState(() =>
    displayContractDate(task.actualResidenceFrom ?? task.residenceFrom),
  );
  const [resultDate, setResultDate] = useState(''),
    [resultTime, setResultTime] = useState('');
  const [note, setNote] = useState(''),
    [error, setError] = useState('');
  const [editing, setEditing] = useState(false),
    [resetConfirmed, setResetConfirmed] = useState(false);
  const [guide, setGuide] = useState(false),
    [history, setHistory] = useState(false);
  const completed = task.status === 'Completed';
  const known = ['Pending', 'InProgress', 'Completed'].includes(task.status);
  const disabled = record.busy || record.loading || record.review;
  async function save() {
    if (disabled || !known || (task.ownerConfirmed && !resetConfirmed)) return;
    setError('');
    try {
      const body = residencePayload(
        task,
        actual,
        resultDate,
        resultTime,
        note,
        task.status !== 'Pending',
      );
      if (
        await record.mutate(
          () => api.update(task, body),
          task.status === 'Pending'
            ? 'Đã bắt đầu theo dõi trong BHOME.'
            : 'Đã ghi nhận kết quả trong BHOME.',
        )
      ) {
        setNote('');
        setEditing(false);
        setResetConfirmed(false);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Kiểm tra thông tin đã nhập.');
    }
  }
  const entries = [...task.history].reverse();
  return (
    <>
      <View style={s.card}>
        <Text variant="titleMedium" style={s.title}>
          Phòng {task.roomNumber}
        </Text>
        <Text variant="bodyLarge">{task.residentLabel}</Text>
        <Text variant="bodySmall" style={s.muted}>
          {task.residentRole === 'Representative' ? 'Người đại diện' : 'Người ở cùng'}
        </Text>
        <Text style={s.status}>{residenceStatus[task.status] ?? 'Chưa xác định trạng thái'}</Text>
        <Text variant="bodySmall">Bắt đầu cư trú: {displayContractDate(task.residenceFrom)}</Text>
        {task.actualResidenceFrom && (
          <Text variant="bodySmall">
            Cư trú thực tế: {displayContractDate(task.actualResidenceFrom)}
          </Text>
        )}
        {(completed || task.ownerConfirmed) && (
          <Text style={s.title}>
            {task.ownerConfirmed ? 'Owner đã xác nhận' : 'Chờ Owner xác nhận'}
          </Text>
        )}
        {task.ownerConfirmedAt && (
          <Text variant="bodySmall">Xác nhận lúc: {formatInstant(task.ownerConfirmedAt)}</Text>
        )}
        {completed && (
          <Text variant="bodySmall" style={s.muted}>
            Xác nhận nội bộ BHOME; không phải xác minh của cơ quan nhà nước.
          </Text>
        )}
        <Button
          compact
          style={s.smallButton}
          disabled={record.busy || record.loading}
          onPress={() => void record.reload()}
        >
          Làm mới trạng thái
        </Button>
      </View>
      <View style={s.card}>
        <Text variant="titleSmall" style={s.title}>
          Thực hiện trên VNeID
        </Text>
        <Text>Đăng ký tạm trú trên VNeID. Sau khi có kết quả, quay lại BHOME để cập nhật.</Text>
        <Button compact style={s.smallButton} onPress={() => setGuide(!guide)}>
          Xem hướng dẫn
        </Button>
        {guide && (
          <Text variant="bodySmall">
            Mở ứng dụng VNeID chính thức trên thiết bị để thực hiện đăng ký. BHOME chỉ theo dõi kết
            quả; không nộp hồ sơ thay bạn. Liên hệ Chủ cơ sở khi cần xác nhận chỗ ở trên VNeID.
          </Text>
        )}
      </View>
      <View style={s.card}>
        <Text variant="titleMedium" style={s.title}>
          Cập nhật kết quả
        </Text>
        {task.resultAt && <Text>Thời điểm có kết quả: {formatInstant(task.resultAt)}</Text>}
        {task.status !== 'Pending' && (
          <ResidenceEvidence
            api={api}
            task={task}
            revision={record.revision}
            disabled={disabled || !known}
            reviewRequired={record.review}
            upload={(bytes) =>
              record.mutate(() => api.upload(task, bytes), 'Đã lưu ảnh minh chứng.')
            }
          />
        )}
        {completed && !editing && (
          <Button
            compact
            disabled={disabled}
            onPress={() => {
              setEditing(true);
              if (task.resultAt) {
                const local = new Date(Date.parse(task.resultAt) + 7 * 3600000).toISOString();
                setResultDate(displayContractDate(local.slice(0, 10)));
                setResultTime(local.slice(11, 16));
              }
            }}
          >
            Chỉnh sửa kết quả
          </Button>
        )}
        {known && (!completed || editing) && (
          <>
            {task.ownerConfirmed && (
              <>
                <Text style={s.error}>Lưu thay đổi sẽ hủy xác nhận Owner hiện tại.</Text>
                <Checkbox.Item
                  label="Tôi đồng ý cập nhật và chờ Owner xác nhận lại"
                  status={resetConfirmed ? 'checked' : 'unchecked'}
                  disabled={disabled}
                  onPress={() => setResetConfirmed(!resetConfirmed)}
                />
              </>
            )}
            <ContractDateField
              label="Ngày cư trú thực tế (dd/MM/yyyy)"
              value={actual}
              onChange={setActual}
              disabled={disabled}
            />
            {task.status !== 'Pending' && (
              <>
                <ContractDateField
                  label="Ngày có kết quả (dd/MM/yyyy)"
                  value={resultDate}
                  onChange={setResultDate}
                  disabled={disabled}
                />
                <TextInput
                  mode="outlined"
                  label="Giờ có kết quả (HH:mm, giờ Việt Nam)"
                  value={resultTime}
                  onChangeText={setResultTime}
                  disabled={disabled}
                  keyboardType="numbers-and-punctuation"
                  placeholder="HH:mm"
                />
              </>
            )}
            <TextInput
              mode="outlined"
              label="Ghi chú (không bắt buộc)"
              value={note}
              onChangeText={setNote}
              disabled={disabled}
              multiline
              maxLength={1000}
            />
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            <Button
              mode="contained"
              loading={record.busy}
              disabled={disabled || (task.ownerConfirmed && !resetConfirmed)}
              onPress={() => void save()}
              contentStyle={{ minHeight: 46 }}
            >
              {task.status === 'Pending'
                ? 'Bắt đầu đăng ký'
                : completed
                  ? 'Lưu kết quả cập nhật'
                  : 'Xác nhận đã có kết quả'}
            </Button>
            {completed && (
              <Button disabled={record.busy} onPress={() => setEditing(false)}>
                Hủy chỉnh sửa
              </Button>
            )}
          </>
        )}
      </View>
      {!!entries.length && (
        <View style={s.card}>
          <Text variant="titleSmall" style={s.title}>
            Lịch sử cập nhật
          </Text>
          {(history ? entries : entries.slice(0, 3)).map((entry, index) => (
            <View key={index} style={{ gap: 3 }}>
              <Text>{residenceAction[entry.action] ?? 'Cập nhật hồ sơ'}</Text>
              <Text variant="bodySmall" style={s.muted}>
                {formatInstant(entry.occurredAt)}
              </Text>
              {!!entry.note && <HistoryNote note={entry.note} />}
            </View>
          ))}
          {entries.length > 3 && (
            <Button compact onPress={() => setHistory(!history)}>
              {history ? 'Thu gọn lịch sử' : 'Xem thêm lịch sử'}
            </Button>
          )}
        </View>
      )}
    </>
  );
}
function HistoryNote({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = note.length > 120 || note.split('\n').length > 2;
  return (
    <>
      <Text variant="bodySmall" numberOfLines={long && !expanded ? 2 : undefined}>
        {note}
      </Text>
      {long && (
        <Button compact onPress={() => setExpanded(!expanded)}>
          {expanded ? 'Thu gọn ghi chú' : 'Xem ghi chú'}
        </Button>
      )}
    </>
  );
}
const s = StyleSheet.create({
  card: {
    padding: 14,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  title: { color: c.primary },
  muted: { color: c.muted },
  error: { color: c.red },
  status: { color: c.primary, fontWeight: '600' },
  smallButton: { alignSelf: 'flex-start', marginLeft: -8 },
});
