import React, { useState } from 'react';
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
  const enabled = !preview && !!session && (role === 'Staff' || role === 'Tenant');
  const staff = useStaffIncidentScope(enabled && role === 'Staff');
  const [roomPage, setRoomPage] = useState(1),
    [assetPage, setAssetPage] = useState(1);
  const [tenantRoom, setTenantRoom] = useState(''),
    [assetId, setAssetId] = useState('');
  const [common, setCommon] = useState(false),
    [commonArea, setCommonArea] = useState('');
  const [severity, setSeverity] = useState('Normal'),
    [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);
  const mutation = useIncidentMutation();
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
  const assetOptions =
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
  const selectedAsset = assetOptions.some((item) => item.id === assetId) ? assetId : '';
  const valid =
    !!locationId &&
    (common ? commonName.length > 0 && commonName.length <= 200 : !!roomId) &&
    description.trim().length >= 10 &&
    description.trim().length <= 8000;
  async function submit() {
    if (!api || !enabled || !valid || mutation.busy) return;
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
      go('incident-detail', { incidentId: result.incidentId });
    }
  }
  return (
    <>
      <Heading title="Báo cáo sự cố" detail="Phòng, thiết bị hoặc khu vực chung" />
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
            <ChoiceField
              label="Cơ sở"
              value={staff.location}
              options={staff.locations.data ?? []}
              disabled={mutation.busy || !enabled}
              onChange={(id) => {
                staff.selectLocation(id);
                if (common) staff.selectArea('common');
                setAssetId('');
                setPhotos([]);
              }}
            />
            {staff.location && <QueryState {...staff.rooms} />}
            <ChoiceField
              label="Phòng"
              value={common ? '' : staff.area}
              options={staff.rooms.data ?? []}
              disabled={common || mutation.busy || !enabled}
              onChange={(id) => {
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
          disabled={mutation.busy}
          options={[
            { id: 'room', label: 'Trong phòng' },
            { id: 'common', label: 'Khu vực chung' },
          ]}
          onChange={(value) => {
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
            disabled={mutation.busy}
          />
        )}
        {!!locationId && (
          <>
            <QueryState {...(role === 'Staff' ? staff.assets : assets)} />
            <ChoiceField
              label="Tài sản liên quan (tùy chọn)"
              value={selectedAsset}
              disabled={mutation.busy}
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
      <Action disabled={!enabled || !valid || mutation.busy} onPress={() => void submit()}>
        Gửi báo cáo sự cố
      </Action>
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
