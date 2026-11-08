import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Icon, IconButton, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { queryPolicies } from '../../lib/queryPolicies';
import {
  incidentRoot,
  incidentText,
  type IncidentPage,
  type IncidentSubmit,
  type ReportingRoom,
  type ReportingAsset,
} from '../../services/incidents';
import {
  incidentFormError,
  loadReportingRooms,
  loadReportingAssets,
  submitTenantIncident,
} from '../../services/tenantIncidentReport';
import { InvoiceFeedback } from '../../components/InvoiceDetailUi';
import {
  TenantIncidentPhotos,
  type TenantIncidentPhoto,
} from '../../components/TenantIncidentPhotos';
import { IncidentLookupDialog } from './IncidentLookupDialog';
import { useIncidentMutation } from './useIncidentData';
import { reportColors as c, reportUi as s } from './TenantIncidentStyle';

const roomPrefix = `${incidentRoot}/reporting-rooms?`;
export function TenantIncidentReportForm() {
  const { api, session } = useSession();
  const { role, preview, go, requestNavigation } = useWorkspace();
  const enabled = !preview && role === 'Tenant' && !!session?.roles.includes('Tenant');
  const rooms = useWorkspaceQuery<IncidentPage<ReportingRoom>>(
    enabled ? `${roomPrefix}page=1&pageSize=20` : null,
    { load: loadReportingRooms, cache: queryPolicies.rooms },
  );
  const [room, setRoom] = useState<ReportingRoom | null>(null),
    [roomOpen, setRoomOpen] = useState(false),
    [assetOpen, setAssetOpen] = useState(false);
  const [common, setCommon] = useState(false),
    [commonArea, setCommonArea] = useState(''),
    [asset, setAsset] = useState<ReportingAsset | null>(null);
  const [severity, setSeverity] = useState<IncidentSubmit['severity']>('Normal'),
    [description, setDescription] = useState(''),
    [descriptionTouched, setDescriptionTouched] = useState(false);
  const [photos, setPhotos] = useState<TenantIncidentPhoto[]>([]),
    [picking, setPicking] = useState(false);
  const mutation = useIncidentMutation({ successMessage: 'Đã gửi báo cáo sự cố thành công' });
  const candidateRoom =
    room ??
    (rooms.data?.totalCount === 1 && rooms.data.items.length === 1 ? rooms.data.items[0] : null);
  const selectionRemoved =
    !!room &&
    rooms.data?.totalCount === 1 &&
    rooms.data.items.length === 1 &&
    rooms.data.items[0].roomId !== room.roomId;
  const availableRoom =
    !enabled || (rooms.error && !rooms.data) || selectionRemoved
      ? null
      : rooms.data?.totalCount === 0
        ? null
        : candidateRoom;
  const commonName = commonArea.trim();
  const chosenAsset =
    asset &&
    asset.locationId === availableRoom?.locationId &&
    (common
      ? asset.roomId === null && asset.commonArea === commonName
      : asset.roomId === availableRoom?.roomId)
      ? asset
      : null;
  const input: IncidentSubmit = {
    locationId: availableRoom?.locationId ?? '',
    roomId: common ? null : (availableRoom?.roomId ?? null),
    commonArea: common ? commonName : null,
    assetId: chosenAsset?.assetId ?? null,
    severity,
    description: description.trim(),
  };
  const error =
    description.length > 8000
      ? 'Mô tả không được vượt quá 8.000 ký tự.'
      : incidentFormError(input, photos);
  const busy = mutation.busy || picking;
  const assetPrefix = `${incidentRoot}/reporting-assets?locationId=${encodeURIComponent(input.locationId)}${input.roomId ? '&roomId=' + encodeURIComponent(input.roomId) : ''}&`;
  // Once drafting starts, a background lookup must not silently move the report to another room.
  function freezeRoom() {
    if (!room && availableRoom) setRoom(availableRoom);
  }
  function changeRoom(next: ReportingRoom) {
    setRoom(next);
    setAsset(null);
    setRoomOpen(false);
  }
  function changeScope(next: boolean) {
    freezeRoom();
    setCommon(next);
    setCommonArea('');
    setAsset(null);
  }
  async function submit() {
    setDescriptionTouched(true);
    if (!api || !enabled || error || busy) return;
    const result = await mutation.run(
      JSON.stringify([
        input,
        photos.map((photo) => [photo.id, photo.contentType, photo.bytes.length]),
      ]),
      (key, signal, progress) => {
        progress('Đang gửi báo cáo và ảnh…');
        return submitTenantIncident(api, input, photos, key('submit'), signal);
      },
    );
    if (result) {
      setPhotos([]);
      setDescription('');
      setDescriptionTouched(false);
      setAsset(null);
      setCommon(false);
      setCommonArea('');
      setSeverity('Normal');
      go('incident-detail', { incidentId: result.incidentId });
    }
  }
  function back() {
    const leave = () => (router.canGoBack() ? router.back() : go('tenant-home'));
    if (requestNavigation) requestNavigation(leave);
    else leave();
  }
  return (
    <View style={s.form}>
      <View>
        <View style={s.header}>
          <IconButton
            icon="arrow-left"
            accessibilityLabel="Quay lại"
            disabled={busy}
            onPress={back}
          />
          <Text accessibilityRole="header" style={[s.pageTitle, s.grow]}>
            Báo cáo sự cố
          </Text>
          <Button compact icon="history" disabled={busy} onPress={() => go('tenant-requests')}>
            Đã gửi
          </Button>
        </View>
        <Text style={s.helper}>Báo vấn đề trong phòng hoặc khu vực chung</Text>
      </View>
      {!enabled && (
        <Text style={s.helper}>
          Đăng nhập tài khoản Tenant để gửi báo cáo. Chế độ xem trước không gửi dữ liệu.
        </Text>
      )}
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.heading}>
          1. Vị trí xảy ra sự cố
        </Text>
        <InvoiceFeedback {...rooms} />
        {enabled && rooms.data?.totalCount === 0 && (
          <Text style={s.helper}>
            Bạn chưa có phòng đủ điều kiện báo sự cố. Vui lòng liên hệ chủ cơ sở.
          </Text>
        )}
        <TouchableRipple
          style={s.selector}
          disabled={!enabled || busy || rooms.loading}
          accessibilityRole="button"
          accessibilityLabel="Chọn phòng"
          onPress={() => setRoomOpen(true)}
        >
          <View style={s.selectContent}>
            <Icon source="home-outline" color={c.blue} size={22} />
            <View style={s.grow}>
              <Text style={s.label}>
                {availableRoom ? `Phòng ${availableRoom.roomNumber}` : 'Chọn phòng'}
              </Text>
              <Text style={s.helper}>
                {availableRoom?.locationName ?? 'Chọn phòng để xác định cơ sở của bạn'}
              </Text>
            </View>
            <Icon source="chevron-down" color={c.muted} size={20} />
          </View>
        </TouchableRipple>
        <View style={s.row}>
          {([false, true] as const).map((value) => (
            <TouchableRipple
              key={String(value)}
              style={[s.option, common === value && s.selected]}
              disabled={busy || !enabled}
              accessibilityRole="radio"
              accessibilityState={{ checked: common === value }}
              onPress={() => changeScope(value)}
            >
              <View style={s.optionBody}>
                <Text style={s.label}>{value ? 'Khu vực chung' : 'Trong phòng'}</Text>
              </View>
            </TouchableRipple>
          ))}
        </View>
        {common && (
          <>
            <TextInput
              mode="outlined"
              label="Tên khu vực chung"
              value={commonArea}
              onChangeText={(value) => {
                setCommonArea(value);
                setAsset(null);
              }}
              disabled={busy || !enabled}
              style={s.input}
              outlineStyle={{ borderRadius: 12 }}
            />
            <Text style={commonName.length > 200 ? s.error : s.helper}>
              {commonName.length > 200
                ? 'Tên khu vực chung tối đa 200 ký tự.'
                : 'Ví dụ: Hành lang tầng 2. Báo cáo sẽ gửi theo cơ sở đã chọn.'}
            </Text>
          </>
        )}
        {availableRoom && (!common || (commonName.length > 0 && commonName.length <= 200)) && (
          <Button
            compact
            icon="package-variant-closed"
            mode="outlined"
            disabled={busy}
            style={{ borderRadius: 12 }}
            onPress={() => {
              freezeRoom();
              setAssetOpen(true);
            }}
          >
            {chosenAsset?.name ?? 'Tài sản liên quan (tùy chọn)'}
          </Button>
        )}
        {chosenAsset && (
          <Button compact disabled={busy} onPress={() => setAsset(null)}>
            Bỏ chọn tài sản
          </Button>
        )}
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.heading}>
          2. Mức độ sự cố
        </Text>
        <View style={s.row}>
          {(['Normal', 'Emergency'] as const).map((value) => (
            <TouchableRipple
              key={value}
              disabled={busy || !enabled}
              style={[
                s.option,
                severity === value && (value === 'Emergency' ? s.urgent : s.selected),
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: severity === value }}
              onPress={() => {
                freezeRoom();
                setSeverity(value);
              }}
            >
              <View style={s.optionBody}>
                <View style={[s.row, { flexWrap: 'nowrap', alignItems: 'flex-start' }]}>
                  <Icon
                    source={value === 'Normal' ? 'information-outline' : 'alert-outline'}
                    size={22}
                    color={value === 'Normal' ? c.blue : c.red}
                  />
                  <Text style={[s.label, s.grow]}>
                    {value === 'Normal' ? 'Thông thường' : 'Khẩn cấp'}
                  </Text>
                </View>
                <Text style={s.helper}>
                  {value === 'Normal'
                    ? 'Vấn đề không gây nguy hiểm tức thời'
                    : 'Nguy hiểm hoặc cần hỗ trợ ngay'}
                </Text>
              </View>
            </TouchableRipple>
          ))}
        </View>
        {severity === 'Emergency' && (
          <Text style={s.helper}>
            Nếu có nguy hiểm, hãy đến nơi an toàn và liên hệ chủ cơ sở hoặc lực lượng khẩn cấp. Gửi
            báo cáo không tự gọi dịch vụ khẩn cấp.
          </Text>
        )}
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.heading}>
          3. Mô tả sự cố
        </Text>
        <TextInput
          mode="outlined"
          label="Mô tả sự cố"
          placeholder="Ví dụ: Vòi nước trong phòng bị rò rỉ từ sáng nay..."
          multiline
          value={description}
          onChangeText={(value) => {
            freezeRoom();
            setDescription(value);
          }}
          onBlur={() => setDescriptionTouched(true)}
          disabled={busy || !enabled}
          error={
            descriptionTouched && (description.trim().length < 10 || description.length > 8000)
          }
          style={s.input}
          contentStyle={{ minHeight: 132, textAlignVertical: 'top' }}
          outlineStyle={{ borderRadius: 12 }}
        />
        <Text style={s.helper}>{description.length.toLocaleString('vi-VN')} / 8.000 ký tự</Text>
        {descriptionTouched && (description.trim().length < 10 || description.length > 8000) && (
          <Text accessibilityRole="alert" style={s.error}>
            Mô tả cần từ 10 đến 8.000 ký tự.
          </Text>
        )}
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.heading}>
          4. Hình ảnh hiện trường
        </Text>
        <TenantIncidentPhotos
          value={photos}
          onChange={(value) => {
            freezeRoom();
            setPhotos(value);
          }}
          onBusyChange={(value) => {
            if (value) freezeRoom();
            setPicking(value);
          }}
          disabled={mutation.busy || !enabled}
        />
      </View>
      <View style={{ gap: 8 }}>
        {!!error && <Text style={s.helper}>{error}</Text>}
        {!!mutation.error && (
          <Text accessibilityRole="alert" style={s.error}>
            {mutation.error}
            {'\n'}Nội dung và ảnh vẫn được giữ. Nếu chưa rõ kết quả, hãy thử lại báo cáo này thay vì
            tạo báo cáo khác.
          </Text>
        )}
        <Button
          mode="contained"
          buttonColor={c.blue}
          icon="send-outline"
          style={s.submit}
          contentStyle={{ minHeight: 50 }}
          loading={mutation.busy}
          disabled={!enabled || !!error || busy}
          onPress={() => void submit()}
        >
          {mutation.busy ? 'Đang gửi báo cáo...' : 'Gửi báo cáo'}
        </Button>
      </View>
      {roomOpen && (
        <IncidentLookupDialog
          title="Chọn phòng"
          prefix={roomPrefix}
          load={loadReportingRooms}
          identity={(row) => row.roomId}
          label={(row) => `Phòng ${row.roomNumber} · ${row.locationName}`}
          selected={(row) => row.roomId === availableRoom?.roomId}
          choose={changeRoom}
          close={() => setRoomOpen(false)}
        />
      )}
      {assetOpen && (
        <IncidentLookupDialog
          key={assetPrefix + commonName}
          title="Chọn tài sản liên quan"
          prefix={assetPrefix}
          load={loadReportingAssets}
          identity={(row) => row.assetId}
          label={(row) => `${row.name} · ${row.category} · ${incidentText(row.status)}`}
          matches={(row) =>
            common
              ? row.roomId === null && row.commonArea === commonName
              : row.roomId === input.roomId
          }
          selected={(row) => row.assetId === chosenAsset?.assetId}
          choose={(row) => {
            setAsset(row);
            setAssetOpen(false);
          }}
          close={() => setAssetOpen(false)}
        />
      )}
    </View>
  );
}
