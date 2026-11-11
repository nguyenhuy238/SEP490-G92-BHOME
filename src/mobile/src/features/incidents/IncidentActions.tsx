import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { QueryState, Pagination } from '../../components/WorkspaceQueryState';
import { IncidentEvidencePicker } from '../../components/IncidentEvidencePicker';
import { useSession } from '../../lib/SessionProvider';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import { businessToday } from '../../../../../packages/client-core/src/contracts';
import { useIncidentMutation, useIncidentQuery } from './useIncidentData';
import {
  incidentClient,
  workActions,
  incidentRoot,
  type Incident,
  type WorkOrder,
  type IncidentPhoto,
  type EvidenceKind,
  type IncidentCommands,
  type WorkCommands,
  type EmergencyAction,
} from '../../services/incidents';

const names: Record<string, string> = {
  review: 'Phân loại sự cố',
  reject: 'Từ chối báo cáo',
  duplicate: 'Đánh dấu báo cáo trùng',
  cancel: 'Hủy',
  resolve: 'Đóng sự cố',
  'work-orders': 'Giao lệnh sửa chữa',
  'direct-completion': 'Xử lý trực tiếp và hoàn tất',
  acknowledge: 'Tiếp nhận khẩn cấp',
  'emergency-actions': 'Ghi hành động khẩn cấp',
  reassign: 'Đổi nhân viên',
  proposal: 'Gửi phương án sửa chữa',
  'plan-decision': 'Quyết định phương án',
  start: 'Bắt đầu sửa chữa',
  progress: 'Cập nhật tiến độ',
  blocker: 'Báo vướng mắc',
  submit: 'Gửi kết quả nghiệm thu',
  verify: 'Nghiệm thu hoàn thành',
  rework: 'Yêu cầu làm lại',
  'cost-decision': 'Quyết định chi phí khẩn cấp',
  'report-photo': 'Bổ sung ảnh báo cáo',
};
export function incidentActions(report: Incident, role: string): string[] {
  if (!['Submitted', 'InProgress'].includes(report.status)) return [];
  if (role === 'Owner')
    return [
      'review',
      ...(report.type && report.category ? ['work-orders', 'direct-completion'] : []),
      'resolve',
      'reject',
      'duplicate',
      'cancel',
      ...(report.severity === 'Emergency' ? ['emergency-actions'] : []),
    ];
  if (role === 'Staff')
    return report.severity === 'Emergency'
      ? [report.acknowledgedAt ? 'emergency-actions' : 'acknowledge']
      : [];
  return role === 'Tenant' && report.status === 'Submitted' && !report.type
    ? ['cancel', 'report-photo']
    : [];
}
function integer(value: string, label: string, required = true): number | null {
  if (!value.trim() && !required) return null;
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)))
    throw new Error(`${label} phải là số nguyên không âm trong giới hạn nhập liệu.`);
  return Number(value);
}
export function targetDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('Nhập hạn hoàn thành theo dd/MM/yyyy HH:mm.');
  const [, day, month, year, hour, minute] = match;
  const text = `${year}-${month}-${day}T${hour}:${minute}:00+07:00`;
  const parsed = new Date(text);
  if (
    +hour > 23 ||
    +minute > 59 ||
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    new Date(Date.UTC(+year, +month - 1, +day)).getUTCDate() !== +day ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.getTime() <= Date.now()
  )
    throw new Error('Hạn hoàn thành phải là ngày giờ hợp lệ trong tương lai.');
  return text;
}
interface Assignment {
  id: string;
  staffUserId: string;
  startDate: string;
  endDate: string;
}

export function IncidentActionPanel({
  report,
  work,
  role,
  emergencyActions = [],
}: {
  report: Incident;
  work?: WorkOrder;
  role: string;
  emergencyActions?: EmergencyAction[];
}) {
  const { api, session } = useSession();
  const allowed =
    role === 'Owner'
      ? []
      : work
        ? workActions(work, role, session?.userId ?? '')
        : incidentActions(report, role);
  const actions = [
    ...allowed,
    ...(!work &&
    role === 'Owner' &&
    ['Submitted', 'InProgress'].includes(report.status) &&
    emergencyActions.some((a) => a.requestedCost !== null && a.costApproved === null)
      ? ['cost-decision']
      : []),
  ];
  const [action, setAction] = useState(''),
    [values, setValues] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const mutation = useIncidentMutation();
  const [originalPage, setOriginalPage] = useState(1);
  // Snapshot a report version after this form's own uploads, then retain it on ambiguous retries.
  const versions = useRef(new Map<string, number>());
  const assignment = role === 'Owner' && ['work-orders', 'reassign'].includes(action);
  const assignments = useIncidentQuery<Assignment[]>(
    assignment ? `/api/v1/staff-location-assignments?locationId=${report.locationId}` : null,
  );
  const staff = useIncidentQuery<{ id: string; label: string }[]>(
    assignment ? '/api/v1/capture/staff' : null,
  );
  const today = businessToday();
  const staffChoices = (staff.data ?? []).filter((s) =>
    assignments.data?.some(
      (a) => a.staffUserId === s.id && a.startDate <= today && a.endDate >= today,
    ),
  );
  const set = (key: string, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setConfirmed(false);
  };
  const field = (key: string, label: string, numeric = false, multiline = false) => (
    <Input
      key={key}
      label={label}
      value={values[key] ?? ''}
      onChange={(value) => set(key, value)}
      numeric={numeric}
      multiline={multiline}
      disabled={mutation.busy}
    />
  );
  const needsPhotos = [
    'proposal',
    'progress',
    'blocker',
    'submit',
    'direct-completion',
    'emergency-actions',
    'report-photo',
  ].includes(action);
  const assetOutcome =
    !!report.assetId &&
    ['verify', 'direct-completion', ...(work ? ['cancel'] : [])].includes(action);
  async function execute() {
    if (!api || !action || !actions.includes(action) || !confirmed) return;
    const signature = JSON.stringify([
      report.id,
      work?.id,
      report.version,
      work?.version,
      action,
      values,
      photos.map((p) => p.id),
    ]);
    await mutation.run(signature, async (key, signal, progress) => {
      const client = incidentClient(api);
      const required = (name: string, label: string, max = 8000) => {
        const value = values[name]?.trim() ?? '';
        if (!value || value.length > max)
          throw new Error(`${label}: cần nhập nội dung, tối đa ${max} ký tự.`);
        return value;
      };
      const evidenceIds: string[] = [];
      const kind: EvidenceKind =
        action === 'proposal'
          ? 'Inspection'
          : action === 'direct-completion'
            ? 'Direct'
            : action === 'emergency-actions'
              ? 'EmergencyAction'
              : action === 'report-photo'
                ? 'Report'
                : 'Completion';
      // Validate all scalar inputs BEFORE any evidence upload.
      let input:
        | IncidentCommands[keyof IncidentCommands]
        | WorkCommands[keyof WorkCommands]
        | { version: number; approve: boolean; reason: string };
      const version = work?.version ?? report.version;
      const outcome = {
        assetCondition: assetOutcome
          ? required('assetCondition', 'Hiện trạng tài sản', 1000)
          : null,
        assetStatus: assetOutcome ? Number(required('assetStatus', 'Chọn trạng thái tài sản')) : 0,
      };
      switch (action) {
        case 'review':
          input = {
            version,
            type: required('type', 'Loại sự cố', 100),
            category: required('category', 'Nhóm sự cố', 100),
          };
          break;
        case 'work-orders':
          input = {
            version,
            staffId: required('staffId', 'Nhân viên'),
            expectedOutcome: required('expectedOutcome', 'Kết quả yêu cầu', 4000),
            targetCompletionAt: targetDate(required('target', 'Hạn hoàn thành')),
          };
          break;
        case 'reassign':
          input = {
            version,
            staffId: required('staffId', 'Nhân viên'),
            reason: required('reason', 'Lý do', 2000),
          };
          break;
        case 'proposal': {
          const minutes = integer(required('minutes', 'Thời gian dự kiến'), 'Thời gian dự kiến')!;
          if (minutes < 1 || minutes > 2147483647)
            throw new Error('Thời gian dự kiến phải từ 1 phút và trong giới hạn số nguyên.');
          input = {
            version,
            inspectionResult: required('inspection', 'Kết quả kiểm tra'),
            solution: required('solution', 'Phương án'),
            estimatedMinutes: minutes,
            estimatedCost: integer(values.cost ?? '', 'Chi phí dự kiến', false),
            evidenceIds,
          };
          break;
        }
        case 'plan-decision':
          required('approve', 'Chọn quyết định');
          input = {
            version,
            approve: values.approve === 'true',
            reason:
              values.approve === 'false'
                ? required('reason', 'Lý do', 2000)
                : values.reason?.trim() || null,
            vendor: values.vendor?.trim() || null,
          };
          break;
        case 'verify': {
          const actualCost = integer(required('cost', 'Chi phí thực tế'), 'Chi phí thực tế')!;
          input = {
            version,
            actualCost,
            result: required('result', 'Kết quả nghiệm thu'),
            costVarianceReason:
              work?.estimatedCost !== actualCost
                ? required('variance', 'Lý do chênh lệch chi phí', 2000)
                : values.variance?.trim() || null,
            ...outcome,
          };
          break;
        }
        case 'direct-completion':
          if (!photos.length) throw new Error('Cần ít nhất một ảnh kết quả.');
          input = {
            version,
            actualCost: integer(required('cost', 'Chi phí thực tế'), 'Chi phí thực tế')!,
            result: required('result', 'Kết quả xử lý'),
            evidenceIds,
            ...outcome,
          };
          break;
        case 'emergency-actions': {
          const cost = integer(values.cost ?? '', 'Chi phí đề nghị', false);
          if (cost !== null && cost > 0 && !photos.length)
            throw new Error('Chi phí khẩn cấp cần ảnh minh chứng.');
          input = {
            version,
            note: required('note', 'Hành động đã thực hiện'),
            evidenceIds,
            requestedCost: cost,
          };
          break;
        }
        case 'cost-decision':
          required('entryId', 'Khoản chi phí');
          required('approve', 'Chọn quyết định');
          input = {
            version,
            approve: values.approve === 'true',
            reason: required('reason', 'Lý do', 2000),
          };
          break;
        case 'start':
        case 'acknowledge':
          input = { version };
          break;
        case 'progress':
        case 'blocker':
        case 'submit':
        case 'rework':
          if (action === 'submit' && !photos.length)
            throw new Error('Cần ít nhất một ảnh kết quả cho lần gửi nghiệm thu này.');
          input = { version, note: required('note', 'Nội dung cập nhật'), evidenceIds };
          break;
        case 'report-photo':
          if (!photos.length) throw new Error('Chọn ảnh báo cáo.');
          input = { version };
          break;
        default:
          input = {
            version,
            reason: required('reason', 'Lý do', 2000),
            ...(action === 'duplicate'
              ? { duplicateOfId: required('duplicateOfId', 'Chọn báo cáo gốc') }
              : {}),
            ...(work && report.assetId ? outcome : {}),
          };
      }
      for (const [index, photo] of photos.entries()) {
        progress(`Đang tải ảnh ${index + 1}/${photos.length}…`);
        const result = await client.upload(
          report.id,
          work?.id ?? null,
          kind,
          photo,
          key(`upload:${report.id}:${work?.id ?? ''}:${kind}:${photo.id}`),
          signal,
        );
        if (!result.resourceId) throw new Error('Máy chủ chưa trả mã ảnh. Tải lại để kiểm tra.');
        evidenceIds.push(result.resourceId);
      }
      if (action === 'report-photo')
        return { incidentId: report.id, workOrderId: null, resourceId: evidenceIds[0] };
      if (!work && photos.length) {
        if (!versions.current.has(signature))
          versions.current.set(signature, (await client.get(report.id, signal)).version);
        input.version = versions.current.get(signature)!;
      }
      progress('Đang gửi thao tác…');
      if (action === 'cost-decision')
        return client.costDecision(
          report.id,
          values.entryId,
          input as { version: number; approve: boolean; reason: string },
          key('command'),
          signal,
        );
      if (work)
        return client.workCommand(
          work.id,
          action as keyof WorkCommands,
          input as WorkCommands[keyof WorkCommands],
          key('command'),
          signal,
        );
      return client.command(
        report.id,
        action as keyof IncidentCommands,
        input as IncidentCommands[keyof IncidentCommands],
        key('command'),
        signal,
      );
    });
  }
  const originals = useIncidentQuery<import('../../services/incidents').IncidentPage<Incident>>(
    action === 'duplicate'
      ? `${incidentRoot}?locationId=${report.locationId}${report.roomId ? '&roomId=' + report.roomId : ''}${report.assetId ? '&assetId=' + report.assetId : ''}&page=${originalPage}&pageSize=20`
      : null,
  );
  if (role === 'Owner')
    return (
      <OwnerWebNotice task="Phân loại, giao việc, duyệt phương án hoặc chi phí và nghiệm thu" />
    );
  if (!actions.length) return null;
  return (
    <Box>
      <Heading title="Thao tác theo quyền" />
      <ChoiceField
        label="Chọn thao tác"
        value={action}
        disabled={mutation.busy}
        options={actions.map((id) => ({ id, label: names[id] }))}
        onChange={(id) => {
          setAction(id);
          setOriginalPage(1);
          setValues({});
          setPhotos([]);
          setConfirmed(false);
        }}
      />
      {action === 'review' && (
        <>
          {field('type', 'Loại sự cố')}
          {field('category', 'Nhóm sự cố')}
        </>
      )}
      {assignment && (
        <>
          {(assignments.loading || staff.loading) && (
            <Text>Đang tải nhân viên được phân công…</Text>
          )}
          {(assignments.error || staff.error) && (
            <>
              <Text style={ui.red}>{assignments.error || staff.error}</Text>
              <Action
                secondary
                onPress={() => {
                  assignments.reload();
                  staff.reload();
                }}
              >
                Tải lại nhân viên
              </Action>
            </>
          )}
          <ChoiceField
            label="Nhân viên tại cơ sở"
            value={values.staffId ?? ''}
            disabled={mutation.busy}
            options={staffChoices.map((s) => ({ id: s.id, label: s.label }))}
            onChange={(id) => set('staffId', id)}
          />
        </>
      )}
      {action === 'work-orders' && (
        <>
          {field('expectedOutcome', 'Kết quả yêu cầu', false, true)}
          {field('target', 'Hạn hoàn thành (dd/MM/yyyy HH:mm)')}
        </>
      )}
      {[
        'reject',
        'duplicate',
        'cancel',
        'resolve',
        'reassign',
        'plan-decision',
        'cost-decision',
      ].includes(action) && field('reason', 'Lý do quyết định', false, true)}
      {action === 'duplicate' && (
        <>
          <Text style={ui.red}>{originals.error}</Text>
          <ChoiceField
            label="Báo cáo gốc cùng vị trí/tài sản"
            value={values.duplicateOfId ?? ''}
            disabled={mutation.busy}
            options={(originals.data?.items ?? [])
              .filter(
                (i) =>
                  i.id !== report.id &&
                  i.roomId === report.roomId &&
                  i.assetId === report.assetId &&
                  i.commonArea === report.commonArea &&
                  !['Duplicate', 'Rejected', 'Cancelled'].includes(i.status),
              )
              .map((i) => ({ id: i.id, label: i.code }))}
            onChange={(id) => set('duplicateOfId', id)}
          />
          <QueryState {...originals} />
          {originals.data && (
            <Pagination
              page={originalPage}
              total={originals.data.totalCount}
              loading={originals.loading || mutation.busy}
              onChange={(page) => {
                setOriginalPage(page);
                set('duplicateOfId', '');
              }}
            />
          )}
        </>
      )}
      {action === 'proposal' && (
        <>
          {field('inspection', 'Kết quả kiểm tra', false, true)}
          {field('solution', 'Phương án sửa chữa', false, true)}
          {field('minutes', 'Thời gian dự kiến (phút)', true)}
          {field('cost', 'Chi phí dự kiến (VND, tùy chọn)', true)}
        </>
      )}
      {['plan-decision', 'cost-decision'].includes(action) && (
        <ChoiceField
          label="Quyết định phê duyệt"
          value={values.approve ?? ''}
          disabled={mutation.busy}
          options={[
            { id: 'true', label: 'Phê duyệt' },
            { id: 'false', label: 'Từ chối' },
          ]}
          onChange={(value) => set('approve', value)}
        />
      )}
      {action === 'plan-decision' && field('vendor', 'Đơn vị sửa chữa (tùy chọn)')}
      {action === 'cost-decision' && (
        <ChoiceField
          label="Khoản chi phí chờ duyệt"
          value={values.entryId ?? ''}
          disabled={mutation.busy}
          options={emergencyActions
            .filter((e) => e.requestedCost !== null && e.costApproved === null)
            .map((e) => ({
              id: e.id,
              label: `${e.requestedCost?.toLocaleString('vi-VN')} đ · ${e.id}`,
            }))}
          onChange={(id) => set('entryId', id)}
        />
      )}
      {['progress', 'blocker', 'submit', 'rework', 'emergency-actions'].includes(action) &&
        field('note', 'Nội dung / kết quả thực hiện', false, true)}
      {['verify', 'direct-completion', 'emergency-actions'].includes(action) && (
        <>
          {field(
            'cost',
            action === 'emergency-actions'
              ? 'Chi phí đề nghị (VND, tùy chọn)'
              : 'Chi phí thực tế (VND, nhập 0 nếu không có)',
            true,
          )}
          {action !== 'emergency-actions' && field('result', 'Kết quả xác nhận', false, true)}
        </>
      )}
      {action === 'verify' && field('variance', 'Lý do chênh lệch chi phí (nếu có)', false, true)}
      {assetOutcome && (
        <>
          {field('assetCondition', 'Hiện trạng tài sản sau xử lý', false, true)}
          <ChoiceField
            label="Trạng thái tài sản sau xử lý"
            value={values.assetStatus ?? ''}
            disabled={mutation.busy}
            options={[
              { id: '0', label: 'Hoạt động' },
              { id: '1', label: 'Cần sửa' },
              { id: '3', label: 'Ngừng sử dụng' },
            ]}
            onChange={(v) => set('assetStatus', v)}
          />
        </>
      )}
      {needsPhotos && (
        <IncidentEvidencePicker
          value={photos}
          onChange={(next) => {
            setPhotos(next);
            setConfirmed(false);
          }}
          disabled={mutation.busy}
        />
      )}
      {!!action && (
        <>
          <Checkbox.Item
            label="Tôi đã kiểm tra thông tin và xác nhận gửi thao tác này"
            status={confirmed ? 'checked' : 'unchecked'}
            disabled={mutation.busy}
            onPress={() => setConfirmed(!confirmed)}
          />
          <Action disabled={!confirmed || mutation.busy} onPress={() => void execute()}>
            {mutation.busy ? 'Đang xử lý…' : names[action]}
          </Action>
        </>
      )}
      {!!mutation.progress && <Text accessibilityRole="status">{mutation.progress}</Text>}
      {!!mutation.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {mutation.error}
        </Text>
      )}
    </Box>
  );
}
