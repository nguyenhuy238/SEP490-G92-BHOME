import React, { useEffect, useState } from 'react';
import { Image, Modal, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { incidentPhotoUri } from '../../components/IncidentEvidencePicker';
import { useSession } from '../../lib/SessionProvider';
import { useIncidentQuery } from './useIncidentData';
import {
  incidentRoot,
  type Incident,
  type IncidentPage,
  type ReportingRoom,
  type ReportingAsset,
} from '../../services/incidents';
import {
  incidentClient,
  incidentError,
  incidentText,
  type IncidentActivity,
  type IncidentEvidence,
} from '../../services/incidents';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';

export function IncidentInfo({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Text selectable>
      {label}: {String(value)}
    </Text>
  );
}
export function Details({
  title = 'Thông tin tham chiếu',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Button onPress={() => setOpen(!open)}>
        {open ? 'Ẩn ' : 'Xem '}
        {title.toLowerCase()}
      </Button>
      {open && children}
    </View>
  );
}
export function incidentDate(value: string | null) {
  return value ? formatInstant(value) : 'Chưa có thông tin';
}
export function incidentMoney(value: number | null) {
  if (value === null) return 'Chưa có thông tin';
  return Number.isSafeInteger(value)
    ? formatContractMoney(String(value))
    : 'Số tiền vượt giới hạn hiển thị chính xác; cần đối chiếu lại.';
}

// The incident DTO carries IDs, not display names. Resolve names only via authorized
// endpoints; historical Tenant reports remain readable even when lookups return no rows.
export function IncidentPlace({ report, role }: { report: Incident; role: string }) {
  const internal = role === 'Owner' || role === 'Staff';
  const location = useIncidentQuery<{ name: string }>(
    internal ? `/api/v1/locations/${report.locationId}` : null,
  );
  const room = useIncidentQuery<{ roomNumber: string }>(
    internal && report.roomId ? `/api/v1/rooms/${report.roomId}` : null,
  );
  const asset = useIncidentQuery<{ name: string; code: string | null }>(
    internal && report.assetId ? `/api/v1/assets/${report.assetId}` : null,
  );
  const tenantRooms = useIncidentQuery<IncidentPage<ReportingRoom>>(
    role === 'Tenant'
      ? `${incidentRoot}/reporting-rooms?locationId=${report.locationId}${report.roomId ? '&roomId=' + report.roomId : ''}&page=1&pageSize=1`
      : null,
  );
  const tenantAssets = useIncidentQuery<IncidentPage<ReportingAsset>>(
    role === 'Tenant' && report.assetId
      ? `${incidentRoot}/reporting-assets?locationId=${report.locationId}${report.roomId ? '&roomId=' + report.roomId : ''}&page=1&pageSize=100`
      : null,
  );
  const tenantRoom = tenantRooms.data?.items.find(
    (item) =>
      item.locationId === report.locationId && (!report.roomId || item.roomId === report.roomId),
  );
  const tenantAsset = tenantAssets.data?.items.find((item) => item.assetId === report.assetId);
  return (
    <Box>
      <Heading title="Vị trí và tài sản" />
      <IncidentInfo label="Cơ sở" value={location.data?.name ?? tenantRoom?.locationName} />
      <IncidentInfo
        label="Phòng"
        value={room.data?.roomNumber ?? (report.roomId ? tenantRoom?.roomNumber : null)}
      />
      <IncidentInfo label="Khu vực chung" value={report.commonArea} />
      <IncidentInfo label="Tài sản" value={asset.data?.name ?? tenantAsset?.name} />
      <IncidentInfo label="Mã thiết bị" value={asset.data?.code} />
      {!!(
        location.error ||
        room.error ||
        asset.error ||
        tenantRooms.error ||
        tenantAssets.error
      ) && (
        <Text style={ui.muted}>
          Chưa tải được một số tên hiển thị. Mã tham chiếu vẫn có trong chi tiết báo cáo.
        </Text>
      )}
      <Details>
        <IncidentInfo label="Mã cơ sở" value={report.locationId} />
        <IncidentInfo label="Mã phòng" value={report.roomId} />
        <IncidentInfo label="Mã tài sản" value={report.assetId} />
      </Details>
    </Box>
  );
}

export function EvidenceImage({
  incidentId,
  evidence,
}: {
  incidentId: string;
  evidence: IncidentEvidence;
}) {
  const { api } = useSession();
  const [state, setState] = useState<{ api: typeof api; uri: string } | null>(null);
  // attempt starts at 1 so the photo loads as soon as the detail opens (same as Owner web);
  // the button only retries.
  const [attempt, setAttempt] = useState(1),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!api || attempt === 0) return;
    const controller = new AbortController();
    void incidentClient(api)
      .evidence(incidentId, evidence.id, controller.signal)
      .then(
        (bytes) => {
          if (!controller.signal.aborted) {
            setState({ api, uri: incidentPhotoUri(bytes) });
            setLoading(false);
          }
        },
        (e) => {
          if (!controller.signal.aborted) {
            setError(incidentError(e));
            setLoading(false);
          }
        },
      );
    return () => controller.abort();
  }, [api, attempt, incidentId, evidence.id]);
  const uri = state?.api === api ? state.uri : '';
  return (
    <Box>
      <Text>
        {incidentText(evidence.kind)} · {evidence.contentType} ·{' '}
        {evidence.length.toLocaleString('vi-VN')} byte
      </Text>
      <Details>
        <IncidentInfo label="Mã ảnh" value={evidence.id} />
        <IncidentInfo label="Mã lệnh sửa chữa" value={evidence.workOrderId} />
        <IncidentInfo label="Mã hoạt động" value={evidence.activityId} />
      </Details>
      {uri && (
        <>
          <Image
            source={{ uri }}
            accessibilityLabel="Ảnh minh chứng đã tải từ máy chủ"
            style={{ width: '100%', height: 200 }}
            resizeMode="contain"
            onError={() => setError('Không hiển thị được ảnh. Hãy tải lại.')}
          />
          <Action secondary onPress={() => setOpen(true)}>
            Xem ảnh toàn màn hình
          </Action>
        </>
      )}
      <Button
        loading={loading}
        disabled={loading}
        onPress={() => {
          setLoading(true);
          setError('');
          setAttempt(attempt + 1);
        }}
      >
        {uri ? 'Tải lại ảnh' : 'Tải ảnh minh chứng'}
      </Button>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Modal visible={open && !!uri} onRequestClose={() => setOpen(false)} animationType="fade">
        <View style={{ flex: 1, padding: 24 }}>
          <Button onPress={() => setOpen(false)}>Đóng ảnh</Button>
          {!!uri && (
            <Image
              source={{ uri }}
              accessibilityLabel="Ảnh minh chứng toàn màn hình"
              style={{ flex: 1 }}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </Box>
  );
}

// Owner-only event snapshots: known fields are rendered as labeled facts, never raw JSON.
const eventFields: Record<string, string> = {
  Type: 'Loại sự cố',
  Category: 'Nhóm sự cố',
  Severity: 'Mức độ',
  AssignedStaffId: 'Nhân viên',
  Previous: 'Nhân viên trước',
  ExpectedOutcome: 'Kết quả yêu cầu',
  TargetCompletionAt: 'Hạn hoàn thành',
  AcknowledgedById: 'Người tiếp nhận',
  InspectionResult: 'Kết quả kiểm tra',
  Solution: 'Phương án',
  EstimatedMinutes: 'Thời gian dự kiến (phút)',
  EstimatedCost: 'Chi phí dự kiến',
  ProposalVersion: 'Phiên bản phương án',
  Approve: 'Phê duyệt',
  Vendor: 'Đơn vị sửa chữa',
  ActualCost: 'Chi phí thực tế',
  CostVarianceReason: 'Lý do chênh lệch',
  AssetStatus: 'Trạng thái tài sản',
  AssetCondition: 'Hiện trạng tài sản',
  RequestedCost: 'Chi phí đề nghị',
  EvidenceIds: 'Mã ảnh',
  DuplicateOfId: 'Báo cáo gốc',
  CauseActivityId: 'Hoạt động liên quan',
  EvidenceId: 'Mã ảnh',
  Result: 'Kết quả',
  Note: 'Ghi chú',
  Status: 'Trạng thái',
  Version: 'Phiên bản',
  Id: 'Mã tham chiếu',
};
export function eventFacts(value: string | null): { label: string; value: string }[] {
  if (!value) return [];
  try {
    const facts: { label: string; value: string }[] = [];
    const visit = (object: unknown, depth: number) => {
      if (!object || typeof object !== 'object' || depth > 2 || Array.isArray(object)) return;
      Object.entries(object).forEach(([key, entry]) => {
        if (key.toLowerCase() === 'input') {
          visit(entry, depth + 1);
          return;
        }
        const label = eventFields[key];
        if (!label || entry === null || entry === undefined) return;
        if (Array.isArray(entry))
          facts.push({ label, value: entry.filter((v) => typeof v === 'string').join(', ') });
        else if (typeof entry !== 'object')
          facts.push({
            label,
            value:
              typeof entry === 'boolean'
                ? entry
                  ? 'Có'
                  : 'Không'
                : ['EstimatedCost', 'ActualCost', 'RequestedCost'].includes(key) &&
                    typeof entry === 'number'
                  ? incidentMoney(entry)
                  : key === 'TargetCompletionAt' && typeof entry === 'string'
                    ? incidentDate(entry)
                    : key === 'AssetStatus' && typeof entry === 'number'
                      ? (['Hoạt động', 'Cần sửa', 'Đang sửa', 'Ngừng sử dụng'][entry] ??
                        String(entry))
                      : key === 'Severity' && typeof entry === 'number'
                        ? (['Thông thường', 'Khẩn cấp'][entry] ?? String(entry))
                        : key === 'Status' && typeof entry === 'number'
                          ? ([
                              'Đã phân công',
                              'Chờ duyệt phương án',
                              'Đang sửa',
                              'Chờ nghiệm thu',
                              'Đã nghiệm thu',
                              'Đã hủy',
                            ][entry] ?? String(entry))
                          : incidentText(String(entry)),
          });
      });
    };
    visit(JSON.parse(value), 0);
    return facts;
  } catch {
    return [];
  }
}
export function IncidentTimeline({
  items,
  owner,
  tenant,
}: {
  items: IncidentActivity[];
  owner: boolean;
  tenant: boolean;
}) {
  return (
    <>
      {items.map((item) => (
        <Box key={item.id}>
          <Heading title={incidentText(item.action)} detail={incidentDate(item.occurredAt)} />
          {!!item.note && <Text>{item.note}</Text>}
          <Details title="Tham chiếu hoạt động">
            <IncidentInfo label="Mã hoạt động" value={item.id} />
            {!tenant && (
              <>
                <IncidentInfo label="Người thực hiện" value={item.actorId} />
                <IncidentInfo label="Lệnh sửa chữa" value={item.workOrderId} />
              </>
            )}
          </Details>
          {owner && eventFacts(item.dataJson).length > 0 && (
            <Details title="Chi tiết quyết định">
              {eventFacts(item.dataJson).map((fact, i) => (
                <IncidentInfo key={i} label={fact.label} value={fact.value} />
              ))}
            </Details>
          )}
        </Box>
      ))}
    </>
  );
}
