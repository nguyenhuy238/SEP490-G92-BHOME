import React, { useEffect, useRef, useState } from 'react';
import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useStaffIncidentScope } from '../workspace/useStaffIncidentScope';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { QueryState, Pagination } from '../../components/WorkspaceQueryState';
import { IncidentEvidencePicker } from '../../components/IncidentEvidencePicker';
import {
  incidentClient,
  incidentText,
  incidentRoot,
  type IncidentPage,
  type ReportingRoom,
  type ReportingAsset,
  type IncidentPhoto,
} from '../../services/incidents';
import { useIncidentMutation, useIncidentQuery } from './useIncidentData';
import { TenantIncidentReportForm } from './TenantIncidentReportForm';
import { operationalTasks } from '../../services/operationalTasks';
import { moveInInventoryClient } from '../../services/moveInInventory';
import { locationAssetInventoryClient } from '../../services/locationAssetInventory';
import { randomUUID } from '../../lib/randomUUID';
import { errorMessage } from '../../lib/api';

const idPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function IncidentReportForm() {
  const { session } = useSession();
  const { role } = useWorkspace();
  return role === 'Tenant' ? (
    <TenantIncidentReportForm key={`${session?.userId}:${role}`} />
  ) : (
    <ReportForm key={`${session?.userId}:${role}`} />
  );
}
function ReportForm() {
  const { api, session } = useSession();
  const { role, preview, go } = useWorkspace();
  const params = useLocalSearchParams<{
    locationId?: string;
    roomId?: string;
    assetId?: string;
    description?: string;
    inventoryTaskId?: string;
    inventoryItemId?: string;
    locationAssetInventoryItemId?: string;
    inventoryEvidenceIds?: string;
    commonArea?: string;
  }>();
  const fromInventory =
    role === 'Staff' &&
    !!params.inventoryTaskId &&
    idPattern.test(params.inventoryTaskId) &&
    !!params.inventoryItemId &&
    idPattern.test(params.inventoryItemId);
  const fromLocationInventory =
    role === 'Staff' &&
    !!params.inventoryTaskId &&
    idPattern.test(params.inventoryTaskId) &&
    !!params.locationAssetInventoryItemId &&
    idPattern.test(params.locationAssetInventoryItemId) &&
    !!params.locationId &&
    idPattern.test(params.locationId);
  const fromAnyInventory = fromInventory || fromLocationInventory;
  const initialLocation =
    fromAnyInventory && params.locationId && idPattern.test(params.locationId)
      ? params.locationId
      : '';
  const initialRoom =
    fromAnyInventory && params.roomId && idPattern.test(params.roomId) ? params.roomId : '';
  const enabled = !preview && !!session && (role === 'Staff' || role === 'Tenant');
  const staff = useStaffIncidentScope(enabled && role === 'Staff', {
    locationId: initialLocation,
    roomId: initialRoom,
    commonArea: fromLocationInventory ? params.commonArea : undefined,
  });
  const [roomPage, setRoomPage] = useState(1),
    [assetPage, setAssetPage] = useState(1);
  const [tenantRoom, setTenantRoom] = useState(''),
    [assetId, setAssetId] = useState(
      fromAnyInventory && params.assetId && idPattern.test(params.assetId) ? params.assetId : '',
    );
  const [common, setCommon] = useState(fromLocationInventory && !!params.commonArea),
    [commonArea, setCommonArea] = useState(fromLocationInventory ? (params.commonArea ?? '') : '');
  const [severity, setSeverity] = useState('Normal'),
    [description, setDescription] = useState(
      fromAnyInventory ? (params.description ?? '').slice(0, 8000) : '',
    );
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);
  const [prefillMessage, setPrefillMessage] = useState(
    fromInventory && params.inventoryEvidenceIds ? 'Đang nạp ảnh từ mục kiểm kê…' : '',
  );
  const [pendingIncidentId, setPendingIncidentId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const changedScope = useRef(false);
  const mutation = useIncidentMutation();
  useEffect(() => {
    if (!api || !enabled || !fromInventory || !params.inventoryEvidenceIds) return;
    const ids = params.inventoryEvidenceIds
      .split(',')
      .filter((id) => idPattern.test(id))
      .slice(0, 5);
    if (!ids.length) return;
    const controller = new AbortController();
    void (async () => {
      const task = operationalTasks(api);
      const evidence = await task.evidence(params.inventoryTaskId!, controller.signal);
      const selected = evidence.filter(
        (entry) =>
          ids.includes(entry.id) &&
          (entry.contentType === 'image/png' || entry.contentType === 'image/jpeg'),
      );
      const loaded = await Promise.all(
        selected.map(async (entry) => ({
          id: randomUUID(),
          bytes: await task.imageBytes(params.inventoryTaskId!, entry.id, controller.signal),
          contentType: entry.contentType as 'image/png' | 'image/jpeg',
        })),
      );
      if (controller.signal.aborted || changedScope.current) return;
      setPhotos((before) => [...before, ...loaded].slice(0, 5));
      setPrefillMessage(
        loaded.length
          ? `Đã nạp ${loaded.length} ảnh từ kiểm kê.`
          : 'Ảnh kiểm kê chưa khả dụng; bạn có thể chọn ảnh khác.',
      );
    })().catch(() => {
      if (!controller.signal.aborted)
        setPrefillMessage('Không nạp được ảnh kiểm kê. Bạn vẫn có thể thêm ảnh thủ công.');
    });
    return () => controller.abort();
  }, [api, enabled, fromInventory, params.inventoryTaskId, params.inventoryEvidenceIds]);
  const rooms = useIncidentQuery<IncidentPage<ReportingRoom>>(
    enabled && role === 'Tenant'
      ? `${incidentRoot}/reporting-rooms?page=${roomPage}&pageSize=20`
      : null,
  );
  const selected = rooms.data?.items.find((room) => room.roomId === tenantRoom);
  const locationId = role === 'Staff' ? staff.location : selected?.locationId;
  const roomId = common ? null : role === 'Staff' ? staff.area : selected?.roomId;
  const assets = useIncidentQuery<IncidentPage<ReportingAsset>>(
    enabled && role === 'Tenant' && locationId
      ? `${incidentRoot}/reporting-assets?locationId=${locationId}${roomId ? '&roomId=' + roomId : ''}&page=${assetPage}&pageSize=20`
      : null,
  );
  const commonName = commonArea.trim();
  const visibleAssetOptions =
    role === 'Staff'
      ? staff.options
          .filter((item) => (common ? item.commonArea === commonName : item.roomId === roomId))
          .map((item) => ({ id: item.id, label: item.name }))
      : (assets.data?.items ?? [])
          .filter((item) =>
            common ? !item.roomId && item.commonArea === commonName : item.roomId === roomId,
          )
          .map((item) => ({
            id: item.assetId,
            label: `${item.name} · ${item.category} · ${incidentText(item.status)}`,
          }));
  // The assigned room may have more than 100 assets. The item's trusted
  // backend snapshot supplies the exact AssetId even if this page omits it.
  const initialAsset =
    fromAnyInventory &&
    params.assetId &&
    idPattern.test(params.assetId) &&
    locationId === initialLocation &&
    roomId === initialRoom &&
    (!common || (fromLocationInventory && commonName === params.commonArea))
      ? params.assetId
      : '';
  const assetOptions =
    initialAsset && !visibleAssetOptions.some((item) => item.id === initialAsset)
      ? [{ id: initialAsset, label: 'Tài sản đã ghi nhận trong kiểm kê' }, ...visibleAssetOptions]
      : visibleAssetOptions;
  const selectedAsset = assetOptions.some((item) => item.id === assetId) ? assetId : '';
  const valid =
    !!locationId &&
    (common ? commonName.length > 0 && commonName.length <= 200 : !!roomId) &&
    description.trim().length >= 10 &&
    description.trim().length <= 8000;
  async function linkInventoryIncident(incidentId: string) {
    if (!api || !fromAnyInventory || linking) return;
    setLinking(true);
    setLinkError('');
    try {
      if (fromLocationInventory) {
        const client = locationAssetInventoryClient(api);
        const view = await client.get(params.inventoryTaskId!);
        const item = view.items.find((entry) => entry.id === params.locationAssetInventoryItemId);
        if (
          !item ||
          view.locationId !== locationId ||
          item.roomId !== (roomId || null) ||
          item.commonArea !== (common ? commonName : null) ||
          item.assetId !== (selectedAsset || null)
        )
          throw new UserFeedbackError(
            'Phạm vi sự cố khác mục kiểm kê. Kiểm tra lại trước khi liên kết.',
          );
        if (item.inherited)
          throw new UserFeedbackError('Không thể sửa mục kiểm kê kế thừa Tenant.');
        if (item.incidentId && item.incidentId !== incidentId)
          throw new UserFeedbackError('Mục này đã liên kết với báo cáo sự cố khác.');
        if (!item.incidentId) {
          await client.updateItem(
            params.inventoryTaskId!,
            item.id,
            {
              version: view.version,
              checked: item.checked,
              note: (item.note?.trim() || description.trim()).slice(0, 2000),
              incidentId,
            },
            randomUUID(),
          );
        }
        go('task-detail', { taskId: params.inventoryTaskId! });
        return;
      }
      const client = moveInInventoryClient(api);
      const view = await client.get(params.inventoryTaskId!);
      const item = view.items.find((entry) => entry.id === params.inventoryItemId);
      if (
        !item ||
        view.locationId !== locationId ||
        view.roomId !== roomId ||
        (item.assetId && item.assetId !== selectedAsset)
      )
        throw new UserFeedbackError(
          'Phạm vi phòng hoặc tài sản đã thay đổi. Kiểm tra lại mục kiểm kê trước khi liên kết.',
        );
      if (!item.condition || item.condition === 'Good' || item.actualQuantity === null)
        throw new UserFeedbackError('Mục kiểm kê chưa lưu tình trạng thiếu hoặc hư hỏng.');
      if (item.incidentId && item.incidentId !== incidentId)
        throw new UserFeedbackError('Mục này đã được liên kết với báo cáo sự cố khác.');
      if (!item.incidentId) {
        await client.saveItem(
          params.inventoryTaskId!,
          item.id,
          {
            version: view.version,
            actualQuantity: item.actualQuantity,
            condition: item.condition,
            notes: item.notes ?? '',
            evidenceIds: item.evidenceIds ?? [],
            incidentId,
          },
          randomUUID(),
        );
      }
      go('move-in-inventory', { taskId: params.inventoryTaskId! });
    } catch (failure) {
      setLinkError(errorMessage(failure));
    } finally {
      setLinking(false);
    }
  }
  async function submit() {
    if (!api || !enabled || !valid || mutation.busy || linking || pendingIncidentId) return;
    const input = {
      locationId: locationId!,
      roomId: roomId || null,
      commonArea: common ? commonName : null,
      assetId: selectedAsset || null,
      severity: severity as 'Normal' | 'Emergency',
      description: description.trim(),
    };
    const result = await mutation.run(
      JSON.stringify([input, photos.map((p) => p.id)]),
      async (key, signal, progress) => {
        progress('Đang gửi báo cáo và ảnh minh chứng…');
        return incidentClient(api).submit(input, photos, key('submit'), signal);
      },
    );
    if (result) {
      setPhotos([]);
      if (fromAnyInventory) {
        setPendingIncidentId(result.incidentId);
        await linkInventoryIncident(result.incidentId);
      } else {
        go('incident-detail', { incidentId: result.incidentId });
      }
    }
  }
  return (
    <>
      <Heading title="Báo cáo sự cố" detail="Phòng, thiết bị hoặc khu vực chung" />
      {fromAnyInventory && (
        <Box>
          <Text>
            Thông tin cơ sở, phòng, tài sản và tình trạng đã lấy từ mục kiểm kê. Kiểm tra lại trước
            khi gửi báo cáo BF-07.
          </Text>
          {!!prefillMessage && <Text style={ui.muted}>{prefillMessage}</Text>}
        </Box>
      )}
      {!enabled && (
        <Box>
          <Text>
            Đăng nhập Staff hoặc Tenant để gửi báo cáo thật. Chế độ xem trước không gửi dữ liệu.
          </Text>
        </Box>
      )}
      <Box>
        {role === 'Staff' ? (
          <>
            <QueryState {...staff.locations} />
            <Text variant="labelMedium">
              Cơ sở đang làm việc:{' '}
              {staff.locations.data?.find((location) => location.id === staff.location)?.label ??
                'Chưa có cơ sở được phân công'}
            </Text>
            {staff.location && <QueryState {...staff.rooms} />}
            <ChoiceField
              label="Phòng"
              value={common ? '' : staff.area}
              options={staff.rooms.data ?? []}
              disabled={common || mutation.busy || !enabled || fromAnyInventory}
              onChange={(id) => {
                changedScope.current = true;
                staff.selectArea(id);
                setAssetId('');
                setPhotos([]);
              }}
            />
          </>
        ) : (
          <>
            <QueryState {...rooms} />
            <ChoiceField
              label="Phòng / cơ sở của bạn"
              value={tenantRoom}
              options={(rooms.data?.items ?? []).map((room) => ({
                id: room.roomId,
                label: `Phòng ${room.roomNumber} · ${room.locationName}`,
              }))}
              disabled={mutation.busy || !enabled}
              onChange={(id) => {
                setTenantRoom(id);
                setAssetId('');
                setAssetPage(1);
                setPhotos([]);
              }}
            />
            {rooms.data && (
              <Pagination
                page={roomPage}
                total={rooms.data.totalCount}
                loading={mutation.busy || rooms.loading}
                onChange={(page) => {
                  setRoomPage(page);
                  setTenantRoom('');
                  setAssetId('');
                }}
              />
            )}
          </>
        )}
        <ChoiceField
          label="Phạm vi sự cố"
          value={common ? 'common' : 'room'}
          disabled={mutation.busy || fromAnyInventory}
          options={[
            { id: 'room', label: 'Trong phòng' },
            { id: 'common', label: 'Khu vực chung' },
          ]}
          onChange={(value) => {
            changedScope.current = true;
            const next = value === 'common';
            setCommon(next);
            setAssetId('');
            if (role === 'Staff') staff.selectArea(next ? 'common' : '');
          }}
        />
        {common && (
          <Input
            label="Tên khu vực chung"
            value={commonArea}
            onChange={(value) => {
              setCommonArea(value);
              setAssetId('');
            }}
            disabled={mutation.busy || fromAnyInventory}
          />
        )}
        {!!locationId && (
          <>
            <QueryState {...(role === 'Staff' ? staff.assets : assets)} />
            <ChoiceField
              label="Tài sản liên quan (tùy chọn)"
              value={selectedAsset}
              disabled={mutation.busy || fromAnyInventory}
              options={[{ id: '', label: 'Không chọn tài sản' }, ...assetOptions]}
              onChange={setAssetId}
            />
            {role === 'Tenant' && assets.data && (
              <Pagination
                page={assetPage}
                total={assets.data.totalCount}
                loading={assets.loading || mutation.busy}
                onChange={(page) => {
                  setAssetPage(page);
                  setAssetId('');
                }}
              />
            )}
            {role === 'Staff' && staff.assets.data && (
              <Pagination
                page={staff.page}
                total={staff.assets.data.totalCount}
                pageSize={100}
                loading={staff.assets.loading || mutation.busy}
                onChange={(page) => {
                  staff.selectPage(page);
                  setAssetId('');
                }}
              />
            )}
          </>
        )}
      </Box>
      <Box>
        <ChoiceField
          label="Mức độ"
          value={severity}
          options={[
            { id: 'Normal', label: 'Thông thường' },
            { id: 'Emergency', label: 'Khẩn cấp' },
          ]}
          disabled={mutation.busy}
          onChange={setSeverity}
        />
        {severity === 'Emergency' && (
          <Text style={ui.red}>
            Ưu tiên đến nơi an toàn, liên hệ lực lượng khẩn cấp và chủ cơ sở nếu có nguy hiểm đến
            người.
          </Text>
        )}
        <Input
          label="Mô tả sự cố (10–8000 ký tự)"
          value={description}
          onChange={setDescription}
          multiline
          disabled={mutation.busy}
        />
        <Text style={ui.muted}>Loại và nhóm sự cố do Owner phân loại sau khi tiếp nhận.</Text>
        <IncidentEvidencePicker
          value={photos}
          onChange={setPhotos}
          disabled={mutation.busy || !enabled}
        />
      </Box>
      <Action
        disabled={!enabled || !valid || mutation.busy || linking || !!pendingIncidentId}
        onPress={() => void submit()}
      >
        Gửi báo cáo sự cố
      </Action>
      {!!pendingIncidentId && fromAnyInventory && (
        <Box>
          <Text style={ui.green}>Báo cáo sự cố đã được tạo. Mã: {pendingIncidentId}</Text>
          <Text style={ui.muted}>Cần liên kết báo cáo với mục kiểm kê để hoàn tất công việc.</Text>
          <Action disabled={linking} onPress={() => void linkInventoryIncident(pendingIncidentId)}>
            {linking ? 'Đang liên kết…' : 'Liên kết báo cáo với kiểm kê'}
          </Action>
          {!!linkError && (
            <Text accessibilityRole="alert" style={ui.red}>
              {linkError}
            </Text>
          )}
        </Box>
      )}
      {!!mutation.progress && <Text accessibilityRole="status">{mutation.progress}</Text>}
      {!!mutation.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {mutation.error}
        </Text>
      )}
      <Action
        secondary
        disabled={mutation.busy}
        onPress={() => go(role === 'Tenant' ? 'tenant-requests' : 'staff-maintenance')}
      >
        Xem báo cáo đã gửi
      </Action>
    </>
  );
}
