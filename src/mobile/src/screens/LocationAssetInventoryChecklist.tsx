import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { Pill, Row, ui } from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { errorMessage } from '../lib/api';
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
    { notifyError: false },
  );
  const data = query.data;
  const loadedItems = useMemo(() => Array.isArray(data?.items) ? data.items : [], [data]);
  const groups = useMemo(() => inventoryGroups(loadedItems), [loadedItems]);
  const incompletePayload = !!data && data.totalCount !== loadedItems.length;
  const roomCount = groups.filter((group) => group.title.startsWith('Phòng ')).length;
  const commonCount = groups.length - roomCount;
  const pendingOwnerRooms = Array.isArray(data?.pendingOwnerRooms) ? data.pendingOwnerRooms : [];
  const pendingOwnerCommonAssets = !!data?.pendingOwnerCommonAssets;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  // Render the first room immediately. Do not depend on nested horizontal
  // ScrollView measurement inside WorkspaceShell's vertical ScrollView.
  const activeGroup = selectedGroup === '' ? null :
    groups.find((group) => group.title === selectedGroup) ?? groups[0];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const reload = query.reload;
  useEffect(() => onReadinessChange(inventoryReady(data)), [data, onReadinessChange]);

  const save = useCallback(async (item: LocationAssetInventoryItem, checked: boolean) => {
    if (!api || !data || data.status !== 'InProgress' || item.inherited || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const note = (notes[item.id] ?? item.note ?? '').trim();
    try {
      const current = await locationAssetInventoryClient(api).get(taskId);
      if (current.version !== data.version)
        throw new Error('Kiểm kê đã thay đổi. Tải lại danh sách rồi xác nhận mục này.');
      await locationAssetInventoryClient(api).updateItem(taskId, item.id, {
        version: data.version,
        checked,
        note: note || null,
        incidentId: item.incidentId,
      }, randomUUID());
      setNotes((previous) => {
        const next = { ...previous };
        delete next[item.id];
        return next;
      });
      reload();
      onTaskRefresh();
      showSuccess('Đã lưu xác nhận kiểm kê.');
    } catch (failure) {
      setError(failure instanceof Error && failure.message.startsWith('Kiểm kê đã thay đổi')
        ? failure.message : errorMessage(failure));
      reload();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [api, data, notes, taskId, reload, onTaskRefresh]);

  return (
    <View style={[ui.card, styles.root]}>
      <Row spread>
        <Text variant="titleMedium" style={styles.title}>Danh sách kiểm kê từng phòng</Text>
        <Button compact icon="refresh" onPress={reload} disabled={busy || query.loading}>
          Tải lại
        </Button>
      </Row>
      {query.loading && <ActivityIndicator accessibilityLabel="Đang tải danh sách kiểm kê" />}
      {!!query.error && (
        <Text accessibilityRole="alert" style={ui.red}>{query.error}</Text>
      )}
      {!!error && <Text accessibilityRole="alert" style={ui.red}>{error}</Text>}
      {data && (
        <>
          {!!locationName && <Text variant="bodyMedium" style={styles.title}>Cơ sở: {locationName}</Text>}
          <Row spread>
            <Text style={styles.title} variant="labelLarge">
              Đã kiểm tra {data.checkedCount}/{data.totalCount} tài sản
            </Text>
            <Pill tone={inventoryReady(data) ? 'green' : 'blue'}>
              {data.status === 'Assigned' ? 'Chưa bắt đầu' :
                data.status === 'InProgress' ? 'Đang kiểm kê' : 'Đã gửi kiểm kê'}
            </Pill>
          </Row>
          {/* react-native-paper ProgressBar may size its web wrapper to the entire
              ScrollView content (observed >1500px), pushing room rows behind
              the following task sections. Use a fixed-height native View. */}
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={`Đã kiểm tra ${data.checkedCount}/${data.totalCount} tài sản`}
            accessibilityValue={{ min: 0, max: Math.max(1, data.totalCount), now: data.checkedCount }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, {
              width: `${Math.min(100, Math.max(0,
                data.totalCount ? 100 * data.checkedCount / data.totalCount : 0))}%`,
            }]} />
          </View>
          {incompletePayload && (
            <View style={styles.notice}>
              <Text accessibilityRole="alert" variant="bodyMedium" style={ui.red}>
                Chưa tải đầy đủ checklist: nhận được {loadedItems.length}/{data.totalCount} mục tài sản.
                Vui lòng tải lại; nếu vẫn thiếu, báo Owner kiểm tra dữ liệu công việc.
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
                Chưa có tài sản đã được Owner kiểm kê và xác nhận tại cơ sở này.
                Yêu cầu Owner kiểm kê và xác nhận tài sản trước khi Staff kiểm tra, gửi kết quả và ký bàn giao.
              </Text>
            </View>
          )}
          {groups.map((group) => (
            <View key={group.title} style={styles.group}>
              <TouchableRipple accessibilityRole="button"
                accessibilityLabel={`Xem kiểm kê ${group.title}`}
                accessibilityState={{ expanded: activeGroup?.title === group.title }}
                onPress={() => {
                  setSelectedGroup(activeGroup?.title === group.title ? '' : group.title);
                  setExpandedId(null);
                }}
                style={styles.groupHeader}>
                <View style={styles.groupHeaderInner}>
                  <View style={ui.grow}>
                    <Text variant="titleSmall" style={styles.title}>{group.title}</Text>
                    <Text variant="labelSmall" style={ui.muted}>
                      {group.items.length} tài sản · Đã kiểm tra {group.items.filter((item) => item.checked).length}/{group.items.length}
                    </Text>
                  </View>
                  <Text variant="labelSmall" style={styles.title}>
                    {activeGroup?.title === group.title ? 'Thu gọn' : 'Xem tài sản'}
                  </Text>
                </View>
              </TouchableRipple>
              {activeGroup?.title === group.title && group.items.map((item) => {
                const expanded = expandedId === item.id;
                const dirtyNote = notes[item.id] ?? item.note ?? '';
                return (
                  <View key={item.id} style={styles.item}>
                    <TouchableRipple
                      accessibilityRole="button"
                      accessibilityLabel={`Chi tiết kiểm kê: ${item.name}`}
                      onPress={() => setExpandedId(expanded ? null : item.id)}
                    >
                      <View style={styles.itemHeading}>
                        <View style={ui.grow}>
                          <Text variant="bodyMedium" style={styles.title}>{item.name}</Text>
                          <Text variant="bodySmall" style={ui.muted}>Số lượng Owner đã xác nhận: {item.quantity}</Text>
                        </View>
                        <Pill tone={item.checked ? 'green' : 'neutral'}>
                          {item.inherited ? 'Kế thừa bàn giao Tenant' : item.checked ? 'Đã kiểm tra' : 'Chưa kiểm tra'}
                        </Pill>
                      </View>
                    </TouchableRipple>
                    {expanded && (
                      <View style={styles.detail}>
                        {item.inherited ? (
                          <Text style={ui.muted}>
                            Đã đối chiếu từ biên bản bàn giao Tenant còn hiệu lực. Mục này được tự động xác nhận và giữ nguyên lịch sử.
                          </Text>
                        ) : (
                          <>
                            <TextInput
                              mode="outlined"
                              label="Ghi chú kiểm kê (tùy chọn)"
                              accessibilityLabel={`Ghi chú ${item.name}`}
                              multiline
                              maxLength={2000}
                              value={dirtyNote}
                              onChangeText={(value) => setNotes((previous) => ({ ...previous, [item.id]: value }))}
                              disabled={busy || data.status !== 'InProgress'}
                            />
                            {data.status === 'InProgress' && (
                              <Button
                                mode="contained"
                                disabled={busy}
                                loading={busy}
                                onPress={() => void save(item, !item.checked)}
                              >
                                {item.checked ? 'Đánh dấu cần kiểm tra lại' : 'Xác nhận đã kiểm tra'}
                              </Button>
                            )}
                          </>
                        )}
                        {item.note && <Text style={ui.muted}>Ghi nhận: {item.note}</Text>}
                        {item.incidentId ? (
                          <Button onPress={() => go('incident-detail', { incidentId: item.incidentId! })}>
                            Xem sự cố đã liên kết
                          </Button>
                        ) : !item.inherited && (
                          <Button
                            mode="outlined"
                            icon="alert-circle-outline"
                            onPress={() => go('report-incident', {
                              inventoryTaskId: taskId,
                              locationAssetInventoryItemId: item.id,
                              locationId: data.locationId,
                              ...(item.roomId ? { roomId: item.roomId } : {}),
                              ...(item.commonArea ? { commonArea: item.commonArea } : {}),
                              ...(item.assetId ? { assetId: item.assetId } : {}),
                              description: `Kiểm kê cơ sở: ${group.title}, ${item.name}. ${dirtyNote}`.trim(),
                            })}
                          >
                            Báo cáo sự cố tài sản
                          </Button>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
          {!incompletePayload && loadedItems.length > 0 && (
            <Text variant="bodySmall" style={ui.muted}>
              {roomCount} phòng · {commonCount} khu vực chung · {loadedItems.length} mục tài sản Owner đã xác nhận
            </Text>
          )}
          {(pendingOwnerRooms.length > 0 || pendingOwnerCommonAssets) && (
            <View style={styles.notice}>
              <Text variant="labelLarge" style={styles.title}>Chờ Owner hoàn tất kiểm kê ban đầu</Text>
              <Text variant="bodySmall" style={ui.muted}>
                Các phòng hoặc tài sản chung bên dưới chưa được Owner xác nhận nên không được đưa vào checklist của Staff.
                Liên hệ Owner để kiểm kê và cập nhật lại công việc trước khi gửi kết quả.
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
              Checklist chỉ gồm tài sản Owner đã xác nhận. Mục kế thừa biên bản Tenant chỉ tự đánh dấu kiểm tra,
              không tự thêm tài sản mới.
            </Text>
          )}
          {inventoryReady(data) && (
            <Text style={ui.green}>
              Đã kiểm tra đủ danh sách. Chọn Cập nhật công việc → Gửi kết quả để Owner duyệt và lập biên bản bàn giao.
            </Text>
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
  progressTrack: { width: '100%', height: 6, minHeight: 6, maxHeight: 6, borderRadius: 3,
    overflow: 'hidden', backgroundColor: c.tint, flexShrink: 0 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: c.blue },
  title: { color: c.primary },
  notice: { gap: 4, padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 8 },
  group: { gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 8 },
  groupHeader: { borderRadius: 6, backgroundColor: c.soft },
  groupHeaderInner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  item: { borderWidth: 1, borderColor: c.border, borderRadius: 8, overflow: 'hidden' },
  itemHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  detail: { gap: 10, padding: 12, backgroundColor: c.white },
});
