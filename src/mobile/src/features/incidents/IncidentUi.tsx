import React, { useEffect, useState } from 'react';
import { Image, Modal, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { incidentPhotoUri } from '../../components/IncidentEvidencePicker';
import { useSession } from '../../lib/SessionProvider';
import type { Incident } from '../../services/incidents';
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
  const { session } = useSession();
  if (session?.roles.includes('Owner')) return null;
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

export function IncidentPlace({ report }: { report: Incident }) {
  return (
    <Box>
      <Heading title="Vị trí và tài sản" />
      <IncidentInfo label="Cơ sở" value={report.locationName} />
      <IncidentInfo label="Phòng" value={report.roomNumber} />
      <IncidentInfo label="Khu vực chung" value={report.commonArea} />
      <IncidentInfo label="Tài sản" value={report.assetName} />
    </Box>
  );
}

export function EvidenceImage({
  incidentId,
  evidence,
}: {
  incidentId: string | null;
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
      .evidence(incidentId, evidence.id, controller.signal, evidence.workOrderId)
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
  }, [api, attempt, incidentId, evidence.id, evidence.workOrderId]);
  const uri = state?.api === api ? state.uri : '';
  return (
    <Box>
      <Text>
        {incidentText(evidence.kind)} · {evidence.contentType} ·{' '}
        {evidence.length.toLocaleString('vi-VN')} byte
      </Text>
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
  ExpectedOutcome: 'Kết quả yêu cầu',
  TargetCompletionAt: 'Hạn hoàn thành',
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
  Result: 'Kết quả',
  Note: 'Ghi chú',
  Status: 'Trạng thái',
  Version: 'Phiên bản',
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
export function IncidentTimeline({ items, owner }: { items: IncidentActivity[]; owner: boolean }) {
  return (
    <>
      {items.map((item) => (
        <Box key={item.id}>
          <Heading title={incidentText(item.action)} detail={incidentDate(item.occurredAt)} />
          {!!item.note && <Text>{item.note}</Text>}
          {owner &&
            eventFacts(item.dataJson).map((fact, i) => (
              <IncidentInfo key={i} label={fact.label} value={fact.value} />
            ))}
        </Box>
      ))}
    </>
  );
}
