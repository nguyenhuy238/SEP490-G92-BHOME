import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { Pill, Row, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { errorMessage } from '../lib/api';
import { queryPolicies } from '../lib/queryPolicies';
import { randomUUID } from '../lib/randomUUID';
import { useSession } from '../lib/SessionProvider';
import { showSuccess } from '../lib/toast';
import {
  inventoryGroups,
  inventoryReady,
  locationAssetInventoryClient,
  type LocationAssetInventory,
  type LocationAssetInventoryItem,
} from '../services/locationAssetInventory';
import { colors as c } from '../theme/theme';

const conditionOptions = [
  { id: 'Unassessed', label: 'Chưa ghi nhận hiện trạng' },
  { id: 'Intact', label: 'Đủ và nguyên vẹn' },
  { id: 'Missing', label: 'Thiếu tài sản' },
  { id: 'Damaged', label: 'Tài sản hư hỏng' },
  { id: 'NotAccessible', label: 'Không thể kiểm tra' },
];
const conditionLabels = Object.fromEntries(
  conditionOptions.map((option) => [option.id, option.label]),
);
type InventoryFilter = 'all' | 'pending' | 'checked';

export function LocationAssetInventoryChecklist({
  taskId,
  locationName,
  onTaskRefresh,
  onReadinessChange,
}: {
  taskId: string;
  locationName?: string;
  onTaskRefresh: () => void;
  onReadinessChange: (ready: boolean) => void;
}) {
  const { api } = useSession();
  const { go } = useWorkspace();
  const query = useWorkspaceQuery<LocationAssetInventory>(
    `/api/v1/operational-tasks/${taskId}/location-asset-inventory`,
    { cache: queryPolicies.tasks, notifyError: false },
  );
  const data = query.data;
  const loadedItems = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
  const groups = useMemo(() => inventoryGroups(loadedItems), [loadedItems]);
  const incompletePayload = !!data && data.totalCount !== loadedItems.length;
  const roomCount = groups.filter((group) => group.title.startsWith('Phòng ')).length;
  const commonCount = groups.length - roomCount;
  const pendingOwnerRooms = Array.isArray(data?.pendingOwnerRooms) ? data.pendingOwnerRooms : [];
  const pendingOwnerCommonAssets = !!data?.pendingOwnerCommonAssets;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('all');
  // Render the first room immediately. Do not depend on nested horizontal
  // ScrollView measurement inside WorkspaceShell's vertical ScrollView.
  const visibleGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    return groups
      .map((group) => ({
        ...group,
        visibleItems: group.items.filter((item) => {
          const condition = item.condition ?? 'Unassessed';
          const pending =
            !item.checked ||
            ((condition === 'Missing' || condition === 'Damaged') && !item.incidentId) ||
            (condition === 'NotAccessible' && !item.note?.trim());
          const statusMatches =
            filter === 'all' || (filter === 'pending' ? pending : item.checked && !pending);
          const searchMatches =
            !term ||
            group.title.toLocaleLowerCase('vi').includes(term) ||
            item.name.toLocaleLowerCase('vi').includes(term);
          return statusMatches && searchMatches;
        }),
      }))
      .filter((group) => group.visibleItems.length > 0);
  }, [groups, filter, search]);
  const activeGroup =
    selectedGroup === ''
      ? null
      : (visibleGroups.find((group) => group.title === selectedGroup) ?? visibleGroups[0]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const reload = query.reload;
  useEffect(() => onReadinessChange(inventoryReady(data)), [data, onReadinessChange]);

  const save = useCallback(
    async (item: LocationAssetInventoryItem, checked: boolean, condition: string) => {
      if (!api || !data || data.status !== 'InProgress' || item.inherited || pending.current)
        return;
      pending.current = true;
      setBusy(true);
      setError('');
      const note = (notes[item.id] ?? item.note ?? '').trim();
      if (checked && condition === 'Unassessed') {
        setError('Chọn hiện trạng thực tế trước khi lưu kết quả kiểm tra.');
        pending.current = false;
        setBusy(false);
        return;
      }
      if (checked && ['Missing', 'Damaged', 'NotAccessible'].includes(condition) && !note) {
        setError(
          'Ghi chú hiện trạng là bắt buộc đối với tài sản thiếu, hỏng hoặc không thể kiểm tra.',
        );
        pending.current = false;
        setBusy(false);
        return;
      }
      try {
        const current = await locationAssetInventoryClient(api).get(taskId);
        if (current.version !== data.version)
          throw new Error('Kiểm kê đã thay đổi. Tải lại danh sách rồi xác nhận mục này.');
        await locationAssetInventoryClient(api).updateItem(
          taskId,
          item.id,
          {
            version: data.version,
            checked,
            condition: checked
              ? (condition as NonNullable<LocationAssetInventoryItem['condition']>)
              : 'Unassessed',
            note: note || null,
            incidentId: item.incidentId,
          },
          randomUUID(),
        );
        setNotes((previous) => {
          const next = { ...previous };
          delete next[item.id];
          return next;
        });
        setConditions((previous) => {
          const next = { ...previous };
          delete next[item.id];
          return next;
        });
        reload();
        onTaskRefresh();
        showSuccess('Đã lưu xác nhận kiểm kê.');
      } catch (failure) {
        setError(
          failure instanceof Error && failure.message.startsWith('Kiểm kê đã thay đổi')
            ? failure.message
            : errorMessage(failure),
        );
        reload();
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [api, data, notes, taskId, reload, onTaskRefresh],
  );

  return (
    <View style={[ui.card, styles.root]}>
      <Row spread>
        <Text variant="titleMedium" style={styles.title}>
          Danh sách kiểm kê từng phòng
        </Text>
        <Button compact icon="refresh" onPress={reload} disabled={busy || query.loading}>
          Tải lại
        </Button>
      </Row>
      {query.loading && <ActivityIndicator accessibilityLabel="Đang tải danh sách kiểm kê" />}
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
      {data && (
        <>
          {!!locationName && (
            <Text variant="bodyMedium" style={styles.title}>
              Cơ sở: {locationName}
            </Text>
          )}
          <Row spread>
            <Text style={styles.title} variant="labelLarge">
              Đã kiểm tra {data.checkedCount}/{data.totalCount} tài sản
            </Text>
            <Pill tone={inventoryReady(data) ? 'green' : 'blue'}>
              {data.status === 'Assigned'
                ? 'Chưa bắt đầu'
                : data.status === 'InProgress'
                  ? 'Đang kiểm kê'
                  : 'Đã gửi kiểm kê'}
            </Pill>
          </Row>
          {/* react-native-paper ProgressBar may size its web wrapper to the entire
              ScrollView content (observed >1500px), pushing room rows behind
              the following task sections. Use a fixed-height native View. */}
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={`Đã kiểm tra ${data.checkedCount}/${data.totalCount} tài sản`}
            accessibilityValue={{
              min: 0,
              max: Math.max(1, data.totalCount),
              now: data.checkedCount,
            }}
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(
                    100,
                    Math.max(0, data.totalCount ? (100 * data.checkedCount) / data.totalCount : 0),
                  )}%`,
                },
              ]}
            />
          </View>
          <View style={styles.tools}>
            <TextInput
              mode="outlined"
              dense
              value={search}
              onChangeText={setSearch}
              placeholder="Tìm phòng hoặc tài sản"
              accessibilityLabel="Tìm phòng hoặc tài sản"
              style={styles.search}
            />
            <View style={styles.filters}>
              {(
                [
                  ['all', 'Tất cả'],
                  ['pending', 'Cần xử lý'],
                  ['checked', 'Đã kiểm tra'],
                ] as const
              ).map(([value, label]) => (
                <TouchableRipple
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === value }}
                  onPress={() => {
                    setFilter(value);
                    setSelectedGroup(null);
                  }}
                  style={[styles.filter, filter === value && styles.filterSelected]}
                >
                  <Text
                    variant="labelMedium"
                    style={{ color: filter === value ? c.white : c.primary }}
                  >
                    {label}
                  </Text>
                </TouchableRipple>
              ))}
            </View>
          </View>
          {incompletePayload && (
            <View style={styles.notice}>
              <Text accessibilityRole="alert" variant="bodyMedium" style={ui.red}>
                Chưa tải đầy đủ checklist: nhận được {loadedItems.length}/{data.totalCount} mục tài
                sản. Vui lòng tải lại; nếu vẫn thiếu, báo Owner kiểm tra dữ liệu công việc.
              </Text>
              <Button compact icon="refresh" onPress={reload} disabled={busy || query.loading}>
                Tải lại checklist
              </Button>
            </View>
          )}
          {data.status === 'Assigned' && (
            <Text style={ui.muted}>Bắt đầu công việc ở trên để xác nhận từng tài sản.</Text>
          )}
          {data.totalCount === 0 && (
            <View style={styles.notice}>
              <Text accessibilityRole="alert" style={ui.red}>
                Chưa có tài sản đã được Owner kiểm kê và xác nhận tại cơ sở này. Yêu cầu Owner kiểm
                kê và xác nhận tài sản trước khi Staff kiểm tra, gửi kết quả và ký bàn giao.
              </Text>
            </View>
          )}
          {visibleGroups.map((group) => (
            <View key={group.title} style={styles.group}>
              <TouchableRipple
                accessibilityRole="button"
                accessibilityLabel={`Xem kiểm kê ${group.title}`}
                accessibilityState={{ expanded: activeGroup?.title === group.title }}
                onPress={() => {
                  setSelectedGroup(activeGroup?.title === group.title ? '' : group.title);
                  setExpandedId(null);
                }}
                style={styles.groupHeader}
              >
                <View style={styles.groupHeaderInner}>
                  <View style={ui.grow}>
                    <Text variant="titleSmall" style={styles.title}>
                      {group.title}
                    </Text>
                    <Text variant="labelSmall" style={ui.muted}>
                      {group.items.length} tài sản · Đã kiểm tra{' '}
                      {group.items.filter((item) => item.checked).length}/{group.items.length}
                    </Text>
                  </View>
                  <Text variant="labelSmall" style={styles.title}>
                    {activeGroup?.title === group.title ? 'Thu gọn' : 'Xem tài sản'}
                  </Text>
                </View>
              </TouchableRipple>
              {activeGroup?.title === group.title &&
                group.visibleItems.map((item) => {
                  const expanded = expandedId === item.id;
                  const dirtyNote = notes[item.id] ?? item.note ?? '';
                  const dirtyCondition = conditions[item.id] ?? item.condition ?? 'Unassessed';
                  const conditionChanged = dirtyCondition !== (item.condition ?? 'Unassessed');
                  const noteChanged = dirtyNote !== (item.note ?? '');
                  const needsNote = ['Missing', 'Damaged', 'NotAccessible'].includes(
                    dirtyCondition,
                  );
                  const label = conditionLabels[dirtyCondition] ?? 'Chưa ghi nhận hiện trạng';
                  return (
                    <View key={item.id} style={styles.item}>
                      <TouchableRipple
                        accessibilityRole="button"
                        accessibilityLabel={`Chi tiết kiểm kê: ${item.name}`}
                        onPress={() => setExpandedId(expanded ? null : item.id)}
                      >
                        <View style={styles.itemHeading}>
                          <View style={ui.grow}>
                            <Text variant="bodyMedium" style={styles.title}>
                              {item.name}
                            </Text>
                            <Text variant="bodySmall" style={ui.muted}>
                              Số lượng Owner đã xác nhận: {item.quantity}
                            </Text>
                          </View>
                          <Pill tone={item.checked ? 'green' : 'neutral'}>
                            {item.inherited
                              ? 'Kế thừa bàn giao Tenant'
                              : item.priorStaffTaskId && item.checked
                                ? 'Kế thừa Staff trước'
                                : item.checked
                                  ? 'Đã kiểm tra'
                                  : 'Chưa kiểm tra'}
                          </Pill>
                          {item.checked && dirtyCondition !== 'Unassessed' && (
                            <Pill tone={dirtyCondition === 'Intact' ? 'green' : 'amber'}>
                              {label}
                            </Pill>
                          )}
                        </View>
                      </TouchableRipple>
                      {expanded && (
                        <View style={styles.detail}>
                          {!!item.priorStaffTaskId && (
                            <Text style={ui.muted}>
                              Thông tin được tiếp nhận từ đợt kiểm kê của nhân viên trước. Lịch sử
                              gốc vẫn được lưu; bạn có thể đánh dấu cần kiểm tra lại nếu kết quả
                              thực tế thay đổi.
                            </Text>
                          )}
                          {item.inherited ? (
                            <Text style={ui.muted}>
                              Đã đối chiếu từ biên bản bàn giao Tenant còn hiệu lực. Mục này được tự
                              động xác nhận và giữ nguyên lịch sử.
                            </Text>
                          ) : (
                            <>
                              <ChoiceField
                                label="Hiện trạng thực tế"
                                value={dirtyCondition}
                                options={conditionOptions}
                                disabled={busy || data.status !== 'InProgress'}
                                onChange={(value) =>
                                  setConditions((previous) => ({ ...previous, [item.id]: value }))
                                }
                              />
                              <TextInput
                                mode="outlined"
                                label={
                                  needsNote ? 'Ghi chú hiện trạng *' : 'Ghi chú kiểm kê (tùy chọn)'
                                }
                                accessibilityLabel={`Ghi chú ${item.name}`}
                                multiline
                                maxLength={2000}
                                value={dirtyNote}
                                onChangeText={(value) =>
                                  setNotes((previous) => ({ ...previous, [item.id]: value }))
                                }
                                disabled={busy || data.status !== 'InProgress'}
                              />
                              {data.status === 'InProgress' && (
                                <Button
                                  mode="contained"
                                  disabled={
                                    busy ||
                                    (!item.checked && dirtyCondition === 'Unassessed') ||
                                    (needsNote && !dirtyNote.trim())
                                  }
                                  loading={busy}
                                  onPress={() =>
                                    void save(
                                      item,
                                      !item.checked || conditionChanged || noteChanged,
                                      !item.checked || conditionChanged || noteChanged
                                        ? dirtyCondition
                                        : 'Unassessed',
                                    )
                                  }
                                >
                                  {!item.checked
                                    ? 'Lưu kết quả kiểm tra'
                                    : conditionChanged || noteChanged
                                      ? 'Lưu cập nhật hiện trạng'
                                      : 'Đánh dấu cần kiểm tra lại'}
                                </Button>
                              )}
                              {item.checked &&
                                (dirtyCondition === 'Missing' || dirtyCondition === 'Damaged') &&
                                !item.incidentId && (
                                  <Text variant="bodySmall" style={styles.issueNotice}>
                                    Cần tạo báo cáo sự cố và liên kết với tài sản này trước khi gửi
                                    kết quả cho Owner.
                                  </Text>
                                )}
                            </>
                          )}
                          {item.note && <Text style={ui.muted}>Ghi nhận: {item.note}</Text>}
                          {item.incidentId ? (
                            <Button
                              onPress={() =>
                                go('incident-detail', { incidentId: item.incidentId! })
                              }
                            >
                              Xem sự cố đã liên kết
                            </Button>
                          ) : (
                            !item.inherited && (
                              <Button
                                mode="outlined"
                                icon="alert-circle-outline"
                                disabled={
                                  item.checked &&
                                  ['Missing', 'Damaged'].includes(item.condition ?? '') &&
                                  !item.note?.trim()
                                }
                                onPress={() =>
                                  go('report-incident', {
                                    inventoryTaskId: taskId,
                                    locationAssetInventoryItemId: item.id,
                                    locationId: data.locationId,
                                    ...(item.roomId ? { roomId: item.roomId } : {}),
                                    ...(item.commonArea ? { commonArea: item.commonArea } : {}),
                                    ...(item.assetId ? { assetId: item.assetId } : {}),
                                    description:
                                      `Kiểm kê cơ sở: ${group.title}, ${item.name}. ${dirtyNote || label}`.trim(),
                                  })
                                }
                              >
                                Báo cáo sự cố tài sản
                              </Button>
                            )
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
            </View>
          ))}
          {!visibleGroups.length && loadedItems.length > 0 && (
            <Text variant="bodySmall" style={ui.muted}>
              Không có tài sản phù hợp với bộ lọc. Hãy đổi bộ lọc hoặc từ khóa tìm kiếm.
            </Text>
          )}
          {!incompletePayload && loadedItems.length > 0 && (
            <Text variant="bodySmall" style={ui.muted}>
              {roomCount} phòng · {commonCount} khu vực chung · {loadedItems.length} mục tài sản
              Owner đã xác nhận
            </Text>
          )}
          {(pendingOwnerRooms.length > 0 || pendingOwnerCommonAssets) && (
            <View style={styles.notice}>
              <Text variant="labelLarge" style={styles.title}>
                Chờ Owner hoàn tất kiểm kê ban đầu
              </Text>
              <Text variant="bodySmall" style={ui.muted}>
                Các phòng hoặc tài sản chung bên dưới chưa được Owner xác nhận nên không được đưa
                vào checklist của Staff. Liên hệ Owner để kiểm kê và cập nhật lại công việc trước
                khi gửi kết quả.
              </Text>
              {pendingOwnerRooms.map((room, index) => (
                <Text key={`${room}:${index}`} variant="bodySmall" style={ui.muted}>
                  Phòng {room} · Chưa được Owner xác nhận
                </Text>
              ))}
              {pendingOwnerCommonAssets && (
                <Text variant="bodySmall" style={ui.muted}>
                  Tài sản khu vực chung · Chưa được Owner xác nhận
                </Text>
              )}
            </View>
          )}
          {loadedItems.length > 0 && (
            <Text variant="bodySmall" style={ui.muted}>
              Checklist chỉ gồm tài sản Owner đã xác nhận. Mục kế thừa biên bản Tenant chỉ tự đánh
              dấu kiểm tra, không tự thêm tài sản mới.
            </Text>
          )}
          {inventoryReady(data) && (
            <Text style={ui.green}>
              Đã ghi nhận đầy đủ hiện trạng. Bạn có thể gửi kết quả cho Owner đối soát và lập biên
              bản bàn giao.
            </Text>
          )}
          {loadedItems.some(
            (item) =>
              item.checked &&
              ['Missing', 'Damaged'].includes(item.condition ?? '') &&
              !item.incidentId,
          ) && (
            <View style={styles.notice}>
              <Text style={styles.issueNotice}>
                Còn tài sản thiếu/hư hỏng chưa có báo cáo sự cố liên kết. Hãy lọc “Cần xử lý” để
                hoàn tất các mục này.
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // This section lives inside the WorkspaceShell vertical ScrollView. Never
  // let the checklist's measured height collapse: otherwise its rows may paint
  // over the following handover / evidence / history cards on React Native Web.
  root: { width: '100%', flexShrink: 0, gap: 12, overflow: 'visible' },
  progressTrack: {
    width: '100%',
    height: 6,
    minHeight: 6,
    maxHeight: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: c.tint,
    flexShrink: 0,
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: c.blue },
  title: { color: c.primary },
  notice: { gap: 4, padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 8 },
  tools: { gap: 8 },
  search: { backgroundColor: c.white },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterSelected: { backgroundColor: c.primary, borderColor: c.primary },
  issueNotice: { color: c.red },
  group: { gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8 },
  groupHeader: { borderRadius: 6, backgroundColor: c.soft },
  groupHeaderInner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  item: { borderWidth: 1, borderColor: c.border, borderRadius: 8, overflow: 'hidden' },
  itemHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  detail: { gap: 10, padding: 12, backgroundColor: c.white },
});
