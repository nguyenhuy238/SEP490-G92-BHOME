import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { Pill, Row, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useCachedWorkspaceQuery } from '../features/workspace/useCachedWorkspaceQuery';
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

const issueOptions = [
  { id: '', label: 'Chọn vấn đề phát hiện' },
  { id: 'Missing', label: 'Thiếu tài sản' },
  { id: 'Damaged', label: 'Tài sản hư hỏng' },
  { id: 'NotAccessible', label: 'Không thể tiếp cận để kiểm tra' },
];
const conditionLabels: Record<string, string> = {
  Unassessed: 'Chưa kiểm tra',
  Intact: 'Đủ và nguyên vẹn',
  Missing: 'Thiếu tài sản',
  Damaged: 'Tài sản hư hỏng',
  NotAccessible: 'Không thể kiểm tra',
};
type InventoryFilter = 'all' | 'pending' | 'checked';

export function LocationAssetInventoryChecklist({
  taskId,
  taskStatus,
  editable,
  onTaskRefresh,
}: {
  taskId: string;
  taskStatus: string;
  editable: boolean;
  onTaskRefresh: () => void;
}) {
  const { api } = useSession();
  const { go } = useWorkspace();
  const query = useCachedWorkspaceQuery<LocationAssetInventory>(
    `/api/v1/operational-tasks/${taskId}/location-asset-inventory`,
    queryPolicies.tasks,
  );
  const data = query.data;
  const loadedItems = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
  const groups = useMemo(() => inventoryGroups(loadedItems), [loadedItems]);
  const incompletePayload = !!data && data.totalCount !== loadedItems.length;
  const roomCount = groups.filter((group) => group.title.startsWith('Phòng ')).length;
  const commonCount = groups.length - roomCount;
  const pendingOwnerRooms = useMemo(
    () => (Array.isArray(data?.pendingOwnerRooms) ? data.pendingOwnerRooms : []),
    [data],
  );
  const pendingOwnerCommonAssets = !!data?.pendingOwnerCommonAssets;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [issueModes, setIssueModes] = useState<Record<string, boolean>>({});
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
  const setInventory = query.setData;
  const hasData = data !== undefined && data !== null;
  const dataStatus = data?.status;
  useEffect(() => {
    if (hasData && dataStatus !== taskStatus) reload();
  }, [hasData, dataStatus, reload, taskStatus]);

  const save = useCallback(
    async (item: LocationAssetInventoryItem, checked: boolean, condition: string) => {
      if (
        !api ||
        !editable ||
        !data ||
        data.status !== 'InProgress' ||
        item.inherited ||
        pending.current
      )
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
        // The versioned PUT is the authoritative stale-write guard on the server.
        // The returned snapshot includes the authoritative task status and version.
        const saved = await locationAssetInventoryClient(api).updateItem(
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
        setIssueModes((previous) => {
          const next = { ...previous };
          delete next[item.id];
          return next;
        });
        setInventory(saved);
        onTaskRefresh();
        showSuccess(
          saved.status === 'PendingVerification'
            ? 'Đã hoàn tất kiểm kê. Chờ Owner đối soát và lập biên bản.'
            : 'Đã lưu xác nhận kiểm kê.',
        );
      } catch (failure) {
        setError(
          failure instanceof Error && failure.message.startsWith('Kiểm kê đã thay đổi')
            ? failure.message
            : errorMessage(failure),
        );
        reload();
        onTaskRefresh();
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [api, data, editable, notes, taskId, reload, setInventory, onTaskRefresh],
  );

  const reportIssue = useCallback(
    (
      item: LocationAssetInventoryItem,
      groupTitle: string,
      condition: 'Missing' | 'Damaged',
      note: string,
    ) => {
      if (!editable || !data || data.status !== 'InProgress' || !note.trim()) return;
      setIssueModes((previous) => ({ ...previous, [item.id]: false }));
      go('report-incident', {
        inventoryTaskId: taskId,
        locationAssetInventoryItemId: item.id,
        locationId: data.locationId,
        inventoryCondition: condition,
        ...(item.roomId ? { roomId: item.roomId } : {}),
        ...(item.commonArea ? { commonArea: item.commonArea } : {}),
        ...(item.assetId ? { assetId: item.assetId } : {}),
        description: `Kiểm kê cơ sở: ${groupTitle}, ${item.name}. ${note.trim()}`.slice(0, 8000),
      });
    },
    [data, editable, go, taskId],
  );

  const inheritedCount = loadedItems.filter((item) => item.inherited).length;
  const directCount = loadedItems.length - inheritedCount;
  const statusLabel =
    data?.status === 'Assigned'
      ? 'Chưa bắt đầu'
      : data?.status === 'InProgress'
        ? 'Đang kiểm kê'
        : data?.status === 'Completed'
          ? 'Đã bàn giao'
          : data?.status === 'PendingVerification'
            ? 'Đã gửi kiểm kê'
            : 'Đã đóng';
  const unlinkedIssueCount = loadedItems.filter(
    (item) =>
      item.checked && ['Missing', 'Damaged'].includes(item.condition ?? '') && !item.incidentId,
  ).length;

  return (
    <View style={[ui.card, styles.root]}>
      <Row spread>
        <Text variant="titleMedium" style={styles.title}>
          Kiểm kê tài sản
        </Text>
        <Button
          compact
          icon="refresh"
          onPress={() => {
            reload();
            onTaskRefresh();
          }}
          disabled={busy || query.fetching}
        >
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
          <Row spread>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.title} variant="labelLarge">
                Đã kiểm tra {data.checkedCount}/{data.totalCount} mục tài sản
              </Text>
              <Text variant="bodySmall" style={ui.muted}>
                {directCount} Staff tự kiểm tra · {inheritedCount} kế thừa từ Tenant
              </Text>
            </View>
            <Pill
              tone={
                data.status === 'Completed' || data.status === 'PendingVerification'
                  ? 'green'
                  : 'blue'
              }
            >
              {statusLabel}
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
          {(pendingOwnerRooms.length > 0 || pendingOwnerCommonAssets) && (
            <View style={styles.notice}>
              <Text variant="labelLarge" style={styles.title}>
                Chờ Owner hoàn tất kiểm kê ban đầu
              </Text>
              <Text variant="bodySmall" style={ui.muted}>
                Owner vẫn còn tài sản chưa xác nhận trong các phạm vi này. Những mục đã xuất hiện
                trong checklist bên dưới là các mục đã được Owner xác nhận riêng lẻ, Staff có thể
                kiểm tra hoặc báo vấn đề. Chỉ được gửi nghiệm thu khi Owner hoàn tất toàn bộ phạm
                vi.
              </Text>
              {pendingOwnerRooms.map((room, index) => (
                <Text key={`${room}:${index}`} variant="bodySmall" style={ui.muted}>
                  Phòng {room} · Còn tài sản chờ Owner xác nhận
                </Text>
              ))}
              {pendingOwnerCommonAssets && (
                <Text variant="bodySmall" style={ui.muted}>
                  Tài sản khu vực chung · Còn tài sản chờ Owner xác nhận
                </Text>
              )}
            </View>
          )}
          {data.status === 'Assigned' && (
            <Text style={ui.muted}>
              Nhấn “Bắt đầu kiểm kê” để mở thao tác xác nhận từng tài sản.
            </Text>
          )}
          {data.totalCount === 0 && (
            <View style={styles.notice}>
              <Text accessibilityRole="alert" style={ui.red}>
                {pendingOwnerRooms.length || pendingOwnerCommonAssets
                  ? 'Owner chưa hoàn tất kiểm kê ban đầu. Bạn chưa thể tạo biên bản bàn giao.'
                  : 'Chưa có tài sản được Owner xác nhận để kiểm kê. Liên hệ Owner kiểm tra danh mục cơ sở.'}
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
                      {group.items.length} mục · Đã kiểm tra{' '}
                      {group.items.filter((item) => item.checked).length}/{group.items.length}
                      {group.items.some((item) => item.inherited)
                        ? ` · ${group.items.filter((item) => item.inherited).length} kế thừa Tenant`
                        : ''}
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
                  const dirtyCondition = conditions[item.id] ?? '';
                  const issueMode = !!issueModes[item.id];
                  const itemCondition = item.condition ?? 'Unassessed';
                  const itemEditable = editable && data.status === 'InProgress';
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
                              {item.quantity > 0
                                ? `Số lượng: ${item.quantity}`
                                : 'Owner đã xác nhận không có tài sản'}
                            </Text>
                          </View>
                          <Pill tone={item.checked ? 'green' : 'neutral'}>
                            {item.inherited
                              ? 'Kế thừa Tenant'
                              : item.priorStaffTaskId && item.checked
                                ? 'Giữ kết quả Staff trước'
                                : item.checked
                                  ? 'Đã kiểm tra'
                                  : 'Chưa kiểm tra'}
                          </Pill>
                          {item.checked && !item.inherited && itemCondition !== 'Unassessed' && (
                            <Pill tone={itemCondition === 'Intact' ? 'green' : 'amber'}>
                              {conditionLabels[itemCondition] ?? label}
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
                            <>
                              <Text style={ui.muted}>
                                Đã đối chiếu đúng tài sản trong biên bản bàn giao Tenant còn hiệu
                                lực. Mục này giữ nguyên thông tin và xác nhận gốc. Nếu phát hiện
                                thiếu hoặc hỏng, hãy tạo báo cáo sự cố riêng.
                              </Text>
                              {item.incidentId ? (
                                <Button
                                  compact
                                  onPress={() =>
                                    go('incident-detail', { incidentId: item.incidentId! })
                                  }
                                >
                                  Xem báo cáo sự cố đã liên kết
                                </Button>
                              ) : itemEditable ? (
                                <View style={styles.itemActions}>
                                  <Button
                                    mode="outlined"
                                    disabled={busy}
                                    onPress={() =>
                                      reportIssue(
                                        item,
                                        group.title,
                                        'Missing',
                                        'Phát hiện thiếu tài sản trong lần kiểm tra hiện tại.',
                                      )
                                    }
                                  >
                                    Báo thiếu
                                  </Button>
                                  <Button
                                    mode="outlined"
                                    disabled={busy}
                                    onPress={() =>
                                      reportIssue(
                                        item,
                                        group.title,
                                        'Damaged',
                                        'Phát hiện tài sản hư hỏng trong lần kiểm tra hiện tại.',
                                      )
                                    }
                                  >
                                    Báo hỏng
                                  </Button>
                                </View>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {item.note && !issueMode && (
                                <Text variant="bodySmall" style={ui.muted}>
                                  Ghi nhận: {item.note}
                                </Text>
                              )}
                              {item.incidentId && (
                                <Button
                                  compact
                                  onPress={() =>
                                    go('incident-detail', { incidentId: item.incidentId! })
                                  }
                                >
                                  Xem báo cáo sự cố đã liên kết
                                </Button>
                              )}
                              {itemEditable && !issueMode && (
                                <View style={styles.itemActions}>
                                  {!item.checked && (
                                    <Button
                                      mode="contained"
                                      disabled={busy}
                                      loading={busy}
                                      onPress={() => void save(item, true, 'Intact')}
                                    >
                                      Xác nhận đủ
                                    </Button>
                                  )}
                                  {!item.incidentId && (
                                    <Button
                                      mode="outlined"
                                      disabled={busy}
                                      onPress={() => {
                                        setIssueModes((previous) => ({
                                          ...previous,
                                          [item.id]: true,
                                        }));
                                        setConditions((previous) => ({
                                          ...previous,
                                          [item.id]: [
                                            'Missing',
                                            'Damaged',
                                            'NotAccessible',
                                          ].includes(itemCondition)
                                            ? itemCondition
                                            : '',
                                        }));
                                      }}
                                    >
                                      Báo vấn đề
                                    </Button>
                                  )}
                                  {item.checked &&
                                    (item.priorStaffTaskId ||
                                      itemCondition === 'NotAccessible') && (
                                      <Button
                                        compact
                                        disabled={busy}
                                        onPress={() => void save(item, false, 'Unassessed')}
                                      >
                                        Kiểm tra lại
                                      </Button>
                                    )}
                                </View>
                              )}
                              {issueMode && itemEditable && (
                                <>
                                  <ChoiceField
                                    label="Vấn đề phát hiện"
                                    value={dirtyCondition}
                                    options={issueOptions}
                                    disabled={busy}
                                    onChange={(value) =>
                                      setConditions((previous) => ({
                                        ...previous,
                                        [item.id]: value,
                                      }))
                                    }
                                  />
                                  <TextInput
                                    mode="outlined"
                                    label="Mô tả hiện trạng *"
                                    accessibilityLabel={`Mô tả hiện trạng ${item.name}`}
                                    multiline
                                    maxLength={2000}
                                    value={dirtyNote}
                                    onChangeText={(value) =>
                                      setNotes((previous) => ({ ...previous, [item.id]: value }))
                                    }
                                    disabled={busy}
                                  />
                                  <View style={styles.itemActions}>
                                    {dirtyCondition === 'Missing' ||
                                    dirtyCondition === 'Damaged' ? (
                                      <Button
                                        mode="contained"
                                        disabled={busy || !dirtyNote.trim()}
                                        onPress={() =>
                                          reportIssue(item, group.title, dirtyCondition, dirtyNote)
                                        }
                                      >
                                        Tạo báo cáo sự cố
                                      </Button>
                                    ) : dirtyCondition === 'NotAccessible' ? (
                                      <Button
                                        mode="contained"
                                        disabled={busy || !dirtyNote.trim()}
                                        loading={busy}
                                        onPress={() => void save(item, true, 'NotAccessible')}
                                      >
                                        Lưu vướng mắc
                                      </Button>
                                    ) : (
                                      <Text variant="bodySmall" style={ui.muted}>
                                        Chọn loại vấn đề để tiếp tục.
                                      </Text>
                                    )}
                                    <Button
                                      compact
                                      disabled={busy}
                                      onPress={() =>
                                        setIssueModes((previous) => ({
                                          ...previous,
                                          [item.id]: false,
                                        }))
                                      }
                                    >
                                      Hủy
                                    </Button>
                                  </View>
                                </>
                              )}
                              {item.checked &&
                                ['Missing', 'Damaged'].includes(itemCondition) &&
                                !item.incidentId &&
                                !issueMode && (
                                  <View style={styles.notice}>
                                    <Text variant="bodySmall" style={styles.issueNotice}>
                                      Cần có báo cáo sự cố liên kết trước khi hoàn tất kiểm kê.
                                    </Text>
                                    <Button
                                      mode="outlined"
                                      disabled={busy || !item.note?.trim()}
                                      onPress={() =>
                                        reportIssue(
                                          item,
                                          group.title,
                                          itemCondition as 'Missing' | 'Damaged',
                                          item.note ?? '',
                                        )
                                      }
                                    >
                                      Tạo báo cáo sự cố
                                    </Button>
                                  </View>
                                )}
                            </>
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
              {roomCount} phòng · {commonCount} khu vực chung · {loadedItems.length} nhóm tài sản
            </Text>
          )}
          {loadedItems.length > 0 && (
            <Text variant="bodySmall" style={ui.muted}>
              Chỉ kiểm tra tài sản Owner đã xác nhận. Mục khớp biên bản Tenant được tự xác nhận,
              không tạo tài sản mới.
            </Text>
          )}
          {data.status === 'InProgress' && inventoryReady(data) && (
            <Text style={ui.muted}>
              Đã kiểm tra đủ. Hệ thống đang tự động chuyển công việc sang chờ Owner kiểm tra.
            </Text>
          )}
          {data.status === 'PendingVerification' && (
            <Text style={ui.green}>
              Đã hoàn tất kiểm kê. Chờ Owner đối soát và lập biên bản bàn giao.
            </Text>
          )}
          {unlinkedIssueCount > 0 && (
            <View style={styles.notice}>
              <Text style={styles.issueNotice}>
                Còn {unlinkedIssueCount} mục thiếu/hư hỏng chưa có báo cáo sự cố liên kết.
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
  itemActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
});
