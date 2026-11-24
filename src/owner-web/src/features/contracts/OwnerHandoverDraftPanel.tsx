import { TextField } from '../../components/common/ValidatedForm';
import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
  type HandoverAsset,
  type HandoverReading,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { handoverAssetSummary } from '../../../../../packages/client-core/src/handoverForm';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { InlineHandoverEvidence } from './InlineHandoverEvidence';
import { DrawPad } from './OwnerSigningPanel';
import type { DrawnSignature } from '../../../../../packages/client-core/src/signing';

interface HandoverChangeRequest {
  id: string;
  version: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
  decisionReason?: string | null;
}

interface HandoverRoomCheck {
  code: string;
  status: 'Passed' | 'Issue' | 'NotApplicable';
  notes: string;
  evidenceIds: string[];
}

interface HandoverAccessItem {
  type: string;
  quantity: number;
  notes: string;
}

interface HandoverOutstandingIssue {
  code: string;
  description: string;
  responsibleParty: string;
  dueDate: string | null;
}

type ReinspectionKind = 'Room' | 'RoomCheck' | 'Asset' | 'Access' | 'Meter';
interface ReinspectionItem {
  kind: ReinspectionKind;
  code?: string;
  assetId?: string;
  rechecked?: boolean;
}

interface ReinspectionRecord {
  version: number;
  reason: string;
  ownerId: string;
  requestedAt: string;
  items: ReinspectionItem[];
}

interface ReinspectionOption {
  key: string;
  label: string;
  issue: boolean;
  item: ReinspectionItem;
}

const roomCheckLabels: Record<string, string> = {
  walls_ceiling_floor: 'Tường, trần, sàn',
  doors_windows_locks: 'Cửa, cửa sổ, khóa',
  electrical_lighting_outlets: 'Đèn, công tắc, ổ điện',
  water_plumbing_drainage: 'Cấp nước, vòi, thoát nước',
  bathroom_toilet: 'Nhà vệ sinh và thiết bị vệ sinh',
  cleanliness: 'Vệ sinh và hiện trạng phòng',
  safety_equipment: 'Thiết bị an toàn được trang bị',
};

/** GET /api/v1/contracts/{id}/handover/draft; kept local to Owner Web. */
interface OwnerHandoverDraft {
  version: number;
  /** Explicit server capability: older builds ignore `ink` in Owner Ready. */
  ownerInkSigningSupported?: boolean;
  status:
    | 'Draft'
    | 'PendingOwnerReview'
    | 'ReinspectionRequested'
    | 'Ready'
    | 'ChangesRequested'
    | 'Confirmed';
  contractId: string;
  roomNumber: string;
  locationName: string;
  locationAddress: string;
  startDate: string;
  endDate: string;
  monthlyRent: number | string;
  requiredDeposit: number | string;
  terms: string;
  electricity: HandoverReading | null;
  water: HandoverReading | null;
  assets: HandoverAsset[];
  /** Completed Staff inventory snapshot for Owner. IDs are authorized reinspection targets. */
  inspectedAssets?:
    | {
        id: string;
        name: string;
        expectedQuantity: number;
        actualQuantity: number;
        condition: string;
        notes?: string | null;
      }[]
    | null;
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  evidenceIds: string[];
  keyEvidenceIds?: string[];
  inventoryToken?: string | null;
  noAssetsConfirmed: boolean;
  inventoryHasIssues?: boolean;
  staffPreparedAt?: string | null;
  staffSubmittedAt?: string | null;
  staffSubmittedBy?: string | null;
  ownerSignedAt?: string | null;
  reinspectionItems?: ReinspectionItem[];
  reinspectionHistory?: ReinspectionRecord[];
  tenantSignedAt?: string | null;
  ownerReadyReason?: string | null;
  ownerHandlingPlan?: string | null;
  ownerDocumentId?: string | null;
  moveInTask?: {
    id: string;
    status: string;
    version?: number;
    canInspect?: boolean;
    inventoryTaskId: string | null;
    inventoryStatus: string | null;
  } | null;
  ownerReadyAt?: string | null;
  tenantConfirmedAt?: string | null;
  requests: HandoverChangeRequest[];
  missing: string[];
  roomChecks?: HandoverRoomCheck[];
  accessItems?: HandoverAccessItem[];
  outstandingIssues?: HandoverOutstandingIssue[];
}

const base = '/api/v1/contracts';
const ownerSessionSignature = {
  certificateId: '00000000-0000-0000-0000-000000000000',
  method: 'OWNER_SESSION',
  consent: true,
};

const statusLabel: Record<OwnerHandoverDraft['status'], string> = {
  Draft: 'Đang kiểm tra bàn giao',
  PendingOwnerReview: 'Chờ chủ trọ duyệt biên bản',
  ReinspectionRequested: 'Đang chờ nhân viên kiểm tra lại',
  Ready: 'Chờ khách thuê ký biên bản',
  ChangesRequested: 'Khách thuê yêu cầu chỉnh sửa',
  Confirmed: 'Đã xác nhận bàn giao',
};

function reinspectionOptions(draft: OwnerHandoverDraft): ReinspectionOption[] {
  const checks: ReinspectionOption[] = Object.entries(roomCheckLabels).map(([code, label]) => {
    const current = draft.roomChecks?.find((check) => check.code === code);
    return {
      key: `RoomCheck:${code}`,
      label: `${label} · ${current?.status === 'Issue' ? 'Có vấn đề' : current?.status === 'NotApplicable' ? 'Không áp dụng · Cần xác minh' : current ? 'Đạt' : 'Chưa kiểm tra'}`,
      issue: current?.status !== 'Passed',
      item: { kind: 'RoomCheck', code },
    };
  });
  const assets: ReinspectionOption[] = draft.inspectedAssets
    ? draft.inspectedAssets.map((asset) => ({
        key: `Asset:${asset.id}`,
        label: `Tài sản: ${asset.name}`,
        issue: asset.condition !== 'Good' || asset.actualQuantity !== asset.expectedQuantity,
        item: { kind: 'Asset' as const, assetId: asset.id },
      }))
    : (draft.noAssetsConfirmed ? [] : (draft.assets ?? [])).map((asset) => ({
        key: `Asset:${asset.id}`,
        label: `Tài sản: ${asset.name}`,
        issue:
          !asset.checked ||
          (asset.missingQuantity ?? 0) > 0 ||
          (asset.damagedQuantity ?? 0) > 0 ||
          (asset.wornQuantity ?? 0) > 0 ||
          (asset.configuredQuantity != null && asset.observedQuantity !== asset.configuredQuantity),
        item: { kind: 'Asset' as const, assetId: asset.id },
      }));
  return [
    {
      key: 'Room',
      label: 'Hiện trạng chung và ảnh phòng',
      issue: draft.missing.includes('room_summary_evidence'),
      item: { kind: 'Room' },
    },
    ...checks,
    ...assets,
    {
      key: 'Access:RoomKey',
      label: 'Chìa khóa và vật dụng ra vào',
      issue: !draft.accessItems?.some((item) => item.type === 'RoomKey' && item.quantity > 0),
      item: { kind: 'Access', code: 'RoomKey' },
    },
  ];
}

function reinspectionLabel(item: ReinspectionItem, draft: OwnerHandoverDraft): string {
  return (
    reinspectionOptions(draft).find(
      (option) =>
        option.item.kind === item.kind &&
        option.item.code === item.code &&
        option.item.assetId === item.assetId,
    )?.label ??
    item.code ??
    (item.kind === 'Asset' ? 'Tài sản' : item.kind)
  );
}

/** Whole-number meter display only; raw confirmed readings remain unchanged. */
function displayMeterInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'chưa có';
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isSafeInteger(Math.trunc(numeric))
    ? Math.trunc(numeric).toLocaleString('vi-VN')
    : String(value).split('.')[0];
}

function StaffReviewSummary({ draft }: { draft: OwnerHandoverDraft }) {
  const inspected = (draft.roomChecks ?? []).filter((item) => !!item.status).length;
  const flagged = (draft.roomChecks ?? []).filter((item) => item.status === 'Issue').length;
  const assetCount = draft.noAssetsConfirmed ? 0 : (draft.assets?.length ?? 0);
  const inventoryLabel = draft.noAssetsConfirmed
    ? 'Không có tài sản'
    : assetCount > 0
      ? `${assetCount} nhóm tài sản`
      : draft.moveInTask?.inventoryTaskId
        ? 'Có phiếu kiểm kê từ nhân viên'
        : 'Chờ kiểm kê tài sản';
  const taskStatus = draft.moveInTask?.status;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Kết quả nhân viên kiểm tra
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={`Hiện trạng phòng ${inspected}/7 mục`} />
          <Chip
            size="small"
            color={flagged ? 'warning' : 'default'}
            label={`${flagged} mục có vấn đề`}
          />
          <Chip size="small" variant="outlined" label={inventoryLabel} />
          <Chip
            size="small"
            variant="outlined"
            label={`Điện ${displayMeterInteger(draft.electricity?.value)} kWh · Nước ${displayMeterInteger(draft.water?.value)} m³`}
          />
        </Stack>
        {draft.staffPreparedAt && (
          <Typography variant="body2" color="text.secondary">
            Nhân viên lưu kiểm tra gần nhất: {formatInstant(draft.staffPreparedAt)}
          </Typography>
        )}
        {draft.staffSubmittedAt && (
          <Alert severity={draft.status === 'PendingOwnerReview' ? 'info' : 'success'}>
            Nhân viên đã gửi biên bản để chủ trọ duyệt lúc {formatInstant(draft.staffSubmittedAt)}.
            {draft.staffSubmittedBy && (
              <Typography
                component="span"
                variant="body2"
                sx={{ display: 'block', overflowWrap: 'anywhere' }}
              >
                Tài khoản nhân viên xác nhận: {draft.staffSubmittedBy}
              </Typography>
            )}
          </Alert>
        )}
        {taskStatus && (
          <Typography variant="body2" color="text.secondary">
            Nhiệm vụ bàn giao:{' '}
            {taskStatus === 'Completed'
              ? 'Đã hoàn thành'
              : taskStatus === 'InProgress'
                ? 'Đang thực hiện'
                : taskStatus === 'PendingVerification'
                  ? 'Chờ xác minh'
                  : taskStatus}
            {draft.moveInTask?.inventoryStatus
              ? ` · Kiểm kê: ${draft.moveInTask.inventoryStatus}`
              : ''}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function WorkSection({
  title,
  status,
  warning,
  children,
}: {
  title: string;
  status: string;
  warning?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
      <Stack spacing={1.25}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Chip
            size="small"
            color={warning ? 'warning' : 'success'}
            label={status}
            variant="outlined"
          />
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

function SelectReview({
  option,
  selected,
  onSelect,
  allowed,
}: {
  option: ReinspectionOption | undefined;
  selected: string[];
  onSelect: (key: string, checked: boolean) => void;
  allowed: boolean;
}) {
  if (!allowed || !option?.issue) return null;
  return (
    <Checkbox
      size="small"
      checked={selected.includes(option.key)}
      onChange={(_, checked) => onSelect(option.key, checked)}
      slotProps={{ input: { 'aria-label': `Chọn kiểm tra lại: ${option.label}` } }}
      sx={{ ml: 'auto', flexShrink: 0 }}
    />
  );
}

function DraftImages({
  api,
  contractId,
  ids,
  label,
}: {
  api: ContractClient;
  contractId: string;
  ids: string[] | undefined | null;
  label: string;
}) {
  if (!ids?.length) return null;
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', flexShrink: 0 }}>
      {ids.map((fileId, index) => (
        <InlineHandoverEvidence
          key={fileId}
          imageKey={`draft:${contractId}:${fileId}`}
          label={`${label} · Ảnh ${index + 1}`}
          fetchBlob={(signal) =>
            api.transport<Blob>(
              `${base}/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(fileId)}`,
              { signal },
              'blob',
            )
          }
        />
      ))}
    </Stack>
  );
}

/** Four Staff work modules are the only compact /handovers inspection interface. */
function StaffWorkModules({
  api,
  draft,
  inventory,
  selected,
  onSelect,
  allowReview,
  reinspectionAction,
}: {
  api: ContractClient;
  draft: OwnerHandoverDraft;
  inventory: InventoryResponse | null;
  selected: string[];
  onSelect: (key: string, checked: boolean) => void;
  allowReview: boolean;
  reinspectionAction?: React.ReactNode;
}) {
  const choices = reinspectionOptions(draft);
  const choice = (key: string) => choices.find((option) => option.key === key);
  const checks = Object.entries(roomCheckLabels)
    .map(([code, label]) => ({
      code,
      label,
      check: draft.roomChecks?.find((item) => item.code === code),
    }))
    .sort((a, b) => Number(b.check?.status !== 'Passed') - Number(a.check?.status !== 'Passed'));
  const problemChecks = checks.filter((item) => item.check?.status === 'Issue').length;
  const recordedChecks = checks.filter((item) => item.check).length;
  const roomKey = draft.accessItems?.find((item) => item.type === 'RoomKey');
  const keyOk = roomKey?.quantity != null && roomKey.quantity >= 0;
  const actual = inventory?.data ?? null;
  const inventoryProblems =
    actual?.items.filter(
      (item) => item.condition !== 'Good' || item.actualQuantity !== item.expectedQuantity,
    ) ?? [];
  const updatedAssetIds = new Set(
    (draft.reinspectionHistory ?? []).flatMap((record) =>
      record.items.filter((item) => item.kind === 'Asset').map((item) => item.assetId),
    ),
  );
  const draftAssetById = new Map((draft.assets ?? []).map((asset) => [asset.id, asset]));
  const inventoryComplete =
    actual?.status === 'Completed' && actual.items.every((item) => item.condition !== null);
  return (
    <Stack spacing={1.5}>
      <WorkSection
        title="Điện và nước ban đầu"
        status={draft.electricity && draft.water ? 'Đã xác nhận chỉ số' : 'Chờ xác nhận'}
        warning={!draft.electricity || !draft.water}
      >
        {(['electricity', 'water'] as const).map((kind) => {
          const reading = draft[kind];
          const label = kind === 'electricity' ? 'Điện' : 'Nước';
          return (
            <Stack
              key={kind}
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                py: 0.75,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ minWidth: 150, flex: '1 1 180px' }}>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>
                  {label}:{' '}
                  {reading
                    ? `${displayMeterInteger(reading.value)} ${kind === 'electricity' ? 'kWh' : 'm³'}`
                    : 'Chưa xác nhận'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {reading
                    ? `Đã xác nhận · ${reading.meterCode || 'Công tơ'}`
                    : 'Chưa có chỉ số được xác nhận'}
                </Typography>
              </Box>
              {reading?.id && (
                <InlineHandoverEvidence
                  imageKey={`meter:${reading.id}`}
                  label={`Ảnh công tơ ${label.toLowerCase()} ban đầu`}
                  fetchBlob={(signal) => api.readingEvidence(reading.id, signal)}
                />
              )}
            </Stack>
          );
        })}
      </WorkSection>

      <WorkSection
        title="Hiện trạng phòng và 7 hạng mục"
        status={
          recordedChecks < checks.length
            ? `${recordedChecks}/${checks.length} đã kiểm tra`
            : problemChecks
              ? `${problemChecks} mục có vấn đề`
              : `${recordedChecks}/${checks.length} đã kiểm tra`
        }
        warning={
          problemChecks > 0 ||
          recordedChecks < checks.length ||
          draft.missing.includes('room_summary_evidence')
        }
      >
        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
            py: 0.75,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              Ghi chú hiện trạng: {draft.roomCondition?.trim() || 'Không có ghi chú'}
            </Typography>
            {!!draft.notes?.trim() && (
              <Typography variant="body2" color="text.secondary">
                {draft.notes}
              </Typography>
            )}
          </Box>
          <DraftImages
            api={api}
            contractId={draft.contractId}
            ids={draft.evidenceIds}
            label="Hiện trạng phòng"
          />
          <SelectReview
            option={choice('Room')}
            selected={selected}
            onSelect={onSelect}
            allowed={allowReview}
          />
        </Stack>
        {checks.map(({ code, label, check }) => {
          const passed = check?.status === 'Passed';
          const status = passed
            ? 'Đạt'
            : check?.status === 'Issue'
              ? 'Có vấn đề'
              : check?.status === 'NotApplicable'
                ? 'Không áp dụng · Cần xác minh'
                : 'Chưa kiểm tra';
          return (
            <Stack
              key={code}
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{
                alignItems: 'center',
                flexWrap: 'wrap',
                py: 0.75,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: '1 1 230px', minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>
                  {label}
                </Typography>
                <Typography
                  variant="caption"
                  color={passed ? 'success.main' : 'warning.main'}
                  sx={{ fontWeight: 650 }}
                >
                  {status}
                </Typography>
                {!!check?.notes && (
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {check.notes}
                  </Typography>
                )}
              </Box>
              <DraftImages
                api={api}
                contractId={draft.contractId}
                ids={check?.evidenceIds}
                label={label}
              />
              <SelectReview
                option={choice(`RoomCheck:${code}`)}
                selected={selected}
                onSelect={onSelect}
                allowed={allowReview}
              />
            </Stack>
          );
        })}
      </WorkSection>

      <WorkSection
        title="Kiểm kê tài sản"
        status={
          actual
            ? `Nhân viên đã kiểm kê ${actual.items.filter((item) => item.condition !== null).length}/${actual.items.length}`
            : draft.moveInTask?.inventoryTaskId
              ? 'Đang tải kết quả nhân viên'
              : 'Kiểm kê theo biên bản'
        }
        warning={
          !!inventoryProblems.length || (!inventoryComplete && !!draft.moveInTask?.inventoryTaskId)
        }
      >
        {inventory?.error && (
          <Alert severity="warning">
            Không đồng bộ được phiếu kiểm kê nhân viên: {inventory.error}
          </Alert>
        )}
        {draft.moveInTask?.inventoryTaskId && !actual && !inventory?.error && (
          <LinearProgress aria-label="Đang tải kiểm kê tài sản từ nhân viên" />
        )}
        {actual?.items.map((item) => {
          const bad = item.condition !== 'Good' || item.actualQuantity !== item.expectedQuantity;
          const matchingDraft = draftAssetById.get(item.id);
          const updated = updatedAssetIds.has(item.id) ? matchingDraft : null;
          // The Backend accepts IDs from InspectedAssets when canonical
          // inventory exists; draft.assets can legitimately be stale/empty.
          const selectionAvailable = draft.inspectedAssets
            ? draft.inspectedAssets.some((asset) => asset.id === item.id)
            : !!matchingDraft;
          return (
            <Stack
              key={item.id}
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{
                py: 1,
                borderTop: '1px solid',
                borderColor: 'divider',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <Box sx={{ flex: '1 1 230px', minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>
                  {item.name}
                </Typography>
                <Typography
                  variant="caption"
                  color={bad ? 'warning.main' : 'success.main'}
                  sx={{ fontWeight: 650 }}
                >
                  {inventoryConditionLabels[item.condition ?? ''] ?? 'Chưa kiểm tra'} · Dự kiến{' '}
                  {item.expectedQuantity}, thực tế {item.actualQuantity ?? 'chưa ghi nhận'}
                </Typography>
                {!!item.notes?.trim() && <Typography variant="body2">{item.notes}</Typography>}
                {updated && (
                  <Box sx={{ mt: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 650 }}>
                      Nhân viên cập nhật biên bản sau kiểm tra lại
                    </Typography>
                    <Typography variant="body2">{handoverAssetSummary(updated)}</Typography>
                    {!!updated.notes && <Typography variant="body2">{updated.notes}</Typography>}
                    <DraftImages
                      api={api}
                      contractId={draft.contractId}
                      ids={updated.evidenceIds}
                      label={`${item.name} cập nhật`}
                    />
                  </Box>
                )}
                {bad && !selectionAvailable && allowReview && (
                  <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                    Chưa thể chọn kiểm tra lại: mã tài sản chưa được máy chủ xác nhận trong biên
                    bản.
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {(item.evidenceIds ?? []).map((fileId, index) => (
                  <InlineHandoverEvidence
                    key={fileId}
                    imageKey={`inventory:${actual.taskId}:${fileId}`}
                    label={`${item.name} · Ảnh kiểm kê ${index + 1}`}
                    fetchBlob={(signal) =>
                      api.transport<Blob>(
                        `/api/v1/operational-tasks/${encodeURIComponent(actual.taskId)}/evidence/${encodeURIComponent(fileId)}`,
                        { signal },
                        'blob',
                      )
                    }
                  />
                ))}
              </Stack>
              <SelectReview
                option={selectionAvailable ? choice(`Asset:${item.id}`) : undefined}
                selected={selected}
                onSelect={onSelect}
                allowed={allowReview}
              />
            </Stack>
          );
        })}
        {!draft.moveInTask?.inventoryTaskId &&
          (draft.noAssetsConfirmed ? (
            <Typography variant="body2">Phòng không có tài sản cần bàn giao.</Typography>
          ) : (
            (draft.assets ?? []).map((asset) => (
              <Stack
                key={asset.id}
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  py: 1,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Box sx={{ flex: '1 1 220px' }}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {handoverAssetSummary(asset)}
                  </Typography>
                  {!!asset.notes && <Typography variant="body2">{asset.notes}</Typography>}
                </Box>
                <DraftImages
                  api={api}
                  contractId={draft.contractId}
                  ids={asset.evidenceIds}
                  label={asset.name}
                />
                <SelectReview
                  option={choice(`Asset:${asset.id}`)}
                  selected={selected}
                  onSelect={onSelect}
                  allowed={allowReview}
                />
              </Stack>
            ))
          ))}
      </WorkSection>

      <WorkSection
        title="Chìa khóa và vật dụng ra vào"
        status={keyOk ? `Đã ghi nhận ${roomKey!.quantity} chìa khóa` : 'Chưa đủ thông tin'}
        warning={!keyOk}
      >
        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
            py: 0.75,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              Số lượng: {roomKey?.quantity ?? 'Chưa ghi nhận'}
            </Typography>
            {!!roomKey?.notes && <Typography variant="body2">{roomKey.notes}</Typography>}
          </Box>
          <DraftImages
            api={api}
            contractId={draft.contractId}
            ids={draft.keyEvidenceIds}
            label="Chìa khóa bàn giao"
          />
          <SelectReview
            option={choice('Access:RoomKey')}
            selected={selected}
            onSelect={onSelect}
            allowed={allowReview}
          />
        </Stack>
      </WorkSection>
      {reinspectionAction}
    </Stack>
  );
}

const missingLabel: Record<string, string> = {
  contract_active: 'Hợp đồng chưa được kích hoạt',
  tenant_account: 'Chưa có tài khoản khách thuê hợp lệ để xác nhận',
  electricity: 'Chưa có chỉ số điện ban đầu được xác nhận, kèm ảnh',
  water: 'Chưa có chỉ số nước ban đầu được xác nhận, kèm ảnh',
  meter_readings_same_day: 'Chỉ số điện và nước cần được ghi nhận cùng ngày',
  room_condition: 'Nhân viên chưa ghi nhận hiện trạng phòng',
  keys_and_access: 'Chưa ghi nhận số lượng chìa khóa bàn giao',
  room_evidence: 'Chưa có ảnh chứng minh tình trạng phòng',
  room_summary_evidence: 'Thiếu ảnh hiện trạng chung',
  room_check_evidence: 'Thiếu ảnh hạng mục hiện trạng',
  key_evidence: 'Thiếu ảnh chìa khóa',
  room_checklist: 'Nhân viên chưa hoàn tất 7 hạng mục kiểm tra hiện trạng phòng',
  room_issue_evidence: 'Hạng mục hiện trạng có vấn đề nhưng thiếu ảnh bằng chứng riêng',
  access_inventory: 'Chưa ghi nhận số lượng chìa khóa bàn giao',
  assets: 'Kiểm kê tài sản chưa hoàn tất',
  move_in_inventory: 'Nhân viên chưa lưu/hoàn thành phiếu đối chiếu kiểm kê đầu vào',
  asset_quantities_or_evidence:
    'Số lượng, đối chiếu tài sản hoặc ảnh bằng chứng kiểm kê chưa hợp lệ; nhân viên cần kiểm tra và bổ sung',
  inventory_changed: 'Danh sách tài sản đã thay đổi, cần nhân viên kiểm kê lại',
  inventory_issue: 'Phiếu kiểm kê nhân viên còn tài sản thiếu, hỏng hoặc số lượng không khớp',
  room_check_failed: 'Có hạng mục hiện trạng phòng chưa đạt, không áp dụng hoặc chưa được kiểm tra',
  access_not_ready: 'Chưa có số lượng chìa khóa hợp lệ để bàn giao',
  staff_inspection: 'Nhân viên chưa hoàn tất các nội dung kiểm tra bàn giao',
  contract_changed: 'Dữ liệu hợp đồng đã thay đổi, cần cập nhật lại bản nháp',
};

// Identify factual issues for reinspection guidance, never as an Owner override.
function requiresOwnerException(draft: OwnerHandoverDraft): boolean {
  if (draft.inventoryHasIssues) return true;
  if (draft.roomChecks?.some((check) => check.status === 'Issue')) return true;
  if (draft.noAssetsConfirmed) return false;
  if (!draft.assets?.length) return true;
  return draft.assets.some(
    (asset) =>
      !asset.ownerChecked ||
      (asset.missingQuantity ?? 0) > 0 ||
      (asset.damagedQuantity ?? 0) > 0 ||
      (asset.observedQuantity != null &&
        (asset.observedQuantity !==
          (asset.physicalAssets?.reduce((total, physical) => total + physical.quantity, 0) ?? 0) ||
          (asset.handedOverQuantity != null && asset.handedOverQuantity < asset.observedQuantity))),
  );
}

function maybe(value: string | null | undefined) {
  return value?.trim() || 'Chờ cập nhật';
}

function printedDate(value: string | null | undefined) {
  return value ? displayContractDate(value) : 'Chờ cập nhật';
}

interface ActualInventoryItem {
  id: string;
  name: string;
  expectedQuantity: number;
  actualQuantity: number | null;
  condition: 'Good' | 'Missing' | 'Damaged' | null;
  notes: string | null;
  evidenceIds: string[] | null;
}
interface ActualInventoryView {
  taskId: string;
  status: string;
  items: ActualInventoryItem[];
}
const inventoryConditionLabels: Record<string, string> = {
  Good: 'Đạt',
  Missing: 'Thiếu',
  Damaged: 'Hư hỏng',
};

interface InventoryResponse {
  api: ContractClient;
  taskId: string;
  data: ActualInventoryView | null;
  error: string;
}

/** Canonical Staff task is authoritative for initial inspection; the handover draft may lag. */
function useActualInventory(api: ContractClient, taskId: string | null, polling: boolean) {
  const [response, setResponse] = useState<InventoryResponse | null>(null);
  useEffect(() => {
    if (!taskId) return;
    const currentTaskId = taskId;
    const controller = new AbortController();
    let checking = false;
    async function load() {
      if (checking) return;
      checking = true;
      try {
        const data = await api.transport<ActualInventoryView>(
          `/api/v1/operational-tasks/${encodeURIComponent(currentTaskId)}/move-in-inventory`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setResponse({ api, taskId: currentTaskId, data, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted)
          setResponse((previous) => ({
            api,
            taskId: currentTaskId,
            data: previous?.api === api && previous.taskId === currentTaskId ? previous.data : null,
            error: contractError(failure),
          }));
      } finally {
        checking = false;
      }
    }
    void load();
    const timer = polling
      ? window.setInterval(() => {
          if (document.visibilityState !== 'hidden') void load();
        }, 10000)
      : null;
    return () => {
      controller.abort();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [api, taskId, polling]);
  return response?.api === api && response.taskId === taskId ? response : null;
}

/** Original Staff inventory task, retained as a separate historical comparison. */
function OwnerInventoryResults({
  api,
  taskId,
  polling,
  snapshot,
}: {
  api: ContractClient;
  taskId: string;
  polling: boolean;
  /** Reuse an existing canonical inventory fetch instead of starting a second request. */
  snapshot?: InventoryResponse | null;
}) {
  const fetched = useActualInventory(api, snapshot === undefined ? taskId : null, polling);
  const current = snapshot === undefined ? fetched : snapshot;
  if (!current) return <LinearProgress aria-label="Đang tải kiểm kê thực tế từ nhân viên" />;
  if (current.error && !current.data)
    return <Alert severity="warning">Chưa tải được kết quả kiểm kê thực tế: {current.error}</Alert>;
  const inventory = current.data;
  if (!inventory) return null;
  const checked = inventory.items.filter((item) => item.condition !== null).length;
  return (
    <Stack spacing={1}>
      {!!current.error && (
        <Alert severity="warning">Tạm thời chưa đồng bộ được kết quả mới: {current.error}</Alert>
      )}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip
          size="small"
          variant="outlined"
          label={`Đã kiểm kê ${checked}/${inventory.items.length}`}
        />
        <Chip
          size="small"
          color={inventory.status === 'Completed' ? 'success' : 'default'}
          label={
            inventory.status === 'Completed' ? 'Nhân viên đã hoàn tất' : 'Nhân viên đang thực hiện'
          }
        />
      </Stack>
      {inventory.items.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Phòng không có tài sản cần kiểm kê.
        </Typography>
      )}
      {inventory.items.map((item) => {
        const issue = item.condition === 'Missing' || item.condition === 'Damaged';
        return (
          <Box key={item.id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {item.name}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={issue ? 'warning' : item.condition === 'Good' ? 'success' : 'default'}
                label={inventoryConditionLabels[item.condition ?? ''] ?? 'Chưa kiểm tra'}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Dự kiến {item.expectedQuantity} · Thực tế {item.actualQuantity ?? 'Chưa ghi nhận'}
            </Typography>
            {!!item.notes?.trim() && (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {item.notes}
              </Typography>
            )}
            {!!item.evidenceIds?.length && (
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
                {item.evidenceIds.map((id, index) => (
                  <PrivateEvidenceViewer
                    key={id}
                    label={`${item.name} · Ảnh minh chứng ${index + 1}`}
                    filename={`kiem-ke-${index + 1}.jpg`}
                    fetchBlob={(signal) =>
                      api.transport<Blob>(
                        `/api/v1/operational-tasks/${encodeURIComponent(taskId)}/evidence/${encodeURIComponent(id)}`,
                        { signal },
                        'blob',
                      )
                    }
                    errorMessage={contractError}
                  />
                ))}
              </Stack>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

/** The current handover draft contains the latest Staff asset observations after reinspection. */
function UpdatedHandoverAssets({ draft, api }: { draft: OwnerHandoverDraft; api: ContractClient }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">Kết quả cập nhật biên bản</Typography>
      <Alert severity="info" variant="outlined">
        Đây là số lượng và tình trạng tài sản mới nhất nhân viên ghi nhận trong biên bản sau yêu cầu
        kiểm tra lại. Đối chiếu phần Kiểm kê gốc bên dưới để thấy các thay đổi trước khi ký.
      </Alert>
      {!draft.assets?.length && (
        <Alert severity="warning">Biên bản chưa có kết quả tài sản cập nhật để đối chiếu.</Alert>
      )}
      {(draft.assets ?? []).map((asset) => (
        <Box key={asset.id} sx={{ pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {asset.name}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              color={asset.checked ? 'success' : 'warning'}
              label={asset.checked ? 'Đã kiểm tra' : 'Chưa kiểm tra lại'}
            />
          </Stack>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {handoverAssetSummary(asset)}
          </Typography>
          {!!asset.notes?.trim() && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              Ghi chú cập nhật: {asset.notes}
            </Typography>
          )}
          {(asset.evidenceIds ?? []).length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Chưa có ảnh cập nhật ở mục này.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
              {(asset.evidenceIds ?? []).map((fileId, index) => (
                <PrivateEvidenceViewer
                  key={fileId}
                  label={`${asset.name} · Ảnh cập nhật ${index + 1}`}
                  filename={`kiem-tra-lai-${index + 1}.jpg`}
                  fetchBlob={(signal) =>
                    api.transport<Blob>(
                      `${base}/${encodeURIComponent(draft.contractId)}/handover/draft/evidence/${encodeURIComponent(fileId)}`,
                      { signal },
                      'blob',
                    )
                  }
                  errorMessage={contractError}
                />
              ))}
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  );
}

/** After confirmation, use the immutable server-stored MoveInReport, never the draft-watermarked PDF. */
function ConfirmedHandoverDocuments({ api, id }: { api: ContractClient; id: string }) {
  const [response, setResponse] = useState<{ documents: PreviewDocument[]; error: string } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    void api.handoverDocuments(id, controller.signal).then(
      (documents) => {
        if (!controller.signal.aborted) setResponse({ documents, error: '' });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResponse({ documents: [], error: contractError(error) });
      },
    );
    return () => controller.abort();
  }, [api, id]);

  const finalDocuments =
    response?.documents
      .filter(
        (document) =>
          document.kind === 'MoveInReport' &&
          document.contractId.toLowerCase() === id.toLowerCase(),
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)) ?? [];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          PDF biên bản bàn giao chính thức
        </Typography>
        {!response && <LinearProgress aria-label="Đang tải danh sách PDF bàn giao chính thức" />}
        {response?.error && (
          <Alert severity="error">
            Không tải được danh sách PDF bàn giao chính thức: {response.error}
          </Alert>
        )}
        {response && !response.error && finalDocuments.length === 0 && (
          <Alert severity="warning">
            Biên bản đã được xác nhận nhưng chưa tìm thấy PDF bàn giao chính thức đã lưu cho hợp
            đồng này. Vui lòng tải lại để kiểm tra; bản PDF nháp có watermark không thay thế cho bản
            chính thức.
          </Alert>
        )}
        {finalDocuments.map((document, index) => (
          <Stack spacing={0.5} key={document.id}>
            <Typography variant="body2" color="text.secondary">
              Lưu lúc {formatInstant(document.recordedAt)}
            </Typography>
            <PrivateEvidenceViewer
              label={
                index === 0 ? 'PDF bàn giao đã xác nhận' : `PDF bàn giao đã xác nhận ${index + 1}`
              }
              compactActions
              previewButtonLabel={
                index === 0
                  ? 'Xem biên bản bàn giao đã xác nhận'
                  : `Xem biên bản bàn giao đã xác nhận ${index + 1}`
              }
              filename="bien-ban-ban-giao-chinh-thuc.pdf"
              contentType="application/pdf"
              fetchBlob={(signal) => api.handoverDocument(id, document.id, signal)}
              errorMessage={contractError}
            />
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function DraftDocument({ draft, api }: { draft: OwnerHandoverDraft; api: ContractClient }) {
  const hasAssetReinspection =
    draft.reinspectionHistory?.some((entry) =>
      entry.items?.some((item) => item.kind === 'Asset'),
    ) ?? false;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 700, letterSpacing: '0.04em' }}>
            BIÊN BẢN BÀN GIAO PHÒNG
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {draft.status === 'Confirmed'
              ? 'Bản đã xác nhận'
              : draft.status === 'Ready'
                ? 'Bản tóm tắt sau khi chủ trọ ký'
                : 'Bản nháp tự động cập nhật theo nhiệm vụ của nhân viên'}
            {' · '}Phiên bản {draft.version}
          </Typography>
        </Box>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">I. Thông tin theo hợp đồng thuê</Typography>
          <Typography variant="body2">Cơ sở: {maybe(draft.locationName)}</Typography>
          <Typography variant="body2">Địa chỉ: {maybe(draft.locationAddress)}</Typography>
          <Typography variant="body2">Phòng: {maybe(draft.roomNumber)}</Typography>
          <Typography variant="body2">
            Thời hạn thuê: {printedDate(draft.startDate)} – {printedDate(draft.endDate)}
          </Typography>
          <Typography variant="body2">
            Tiền thuê: {formatContractMoney(String(draft.monthlyRent))} / tháng
          </Typography>
          <Typography variant="body2">
            Tiền cọc theo hợp đồng: {formatContractMoney(String(draft.requiredDeposit))}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">II. Hiện trạng phòng</Typography>
          <Typography variant="body2">Hiện trạng phòng: {maybe(draft.roomCondition)}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            Ghi chú: {draft.notes?.trim() || 'Chưa có ghi chú'}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">III. Chỉ số điện và nước ban đầu</Typography>
          <Typography variant="body2">
            Điện:{' '}
            {draft.electricity
              ? `${displayMeterInteger(draft.electricity.value)} kWh`
              : 'Chờ nhân viên xác nhận'}
          </Typography>
          <Typography variant="body2">
            Nước:{' '}
            {draft.water
              ? `${displayMeterInteger(draft.water.value)} m³`
              : 'Chờ nhân viên xác nhận'}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">IV. Kiểm kê tài sản</Typography>
          {draft.inventoryHasIssues && (
            <Alert severity="warning" variant="outlined">
              Nhân viên ghi nhận tài sản thiếu hoặc hư hỏng trong phiếu kiểm kê. chủ trọ cần đối
              chiếu ảnh và ghi chú trước khi quyết định lý do chấp thuận và phương án xử lý bàn
              giao.
            </Alert>
          )}
          {hasAssetReinspection && <UpdatedHandoverAssets draft={draft} api={api} />}
          {hasAssetReinspection &&
            draft.status !== 'Confirmed' &&
            draft.moveInTask?.inventoryTaskId && (
              <Typography variant="subtitle2" sx={{ mt: 1 }}>
                Kiểm kê gốc
              </Typography>
            )}
          {draft.status !== 'Confirmed' && draft.moveInTask?.inventoryTaskId ? (
            <OwnerInventoryResults api={api} taskId={draft.moveInTask.inventoryTaskId} polling />
          ) : hasAssetReinspection ? null : draft.noAssetsConfirmed ? (
            <Typography variant="body2">
              Chủ trọ xác nhận phòng không có tài sản bàn giao.
            </Typography>
          ) : draft.assets?.length ? (
            draft.assets.map((asset) => (
              <Typography key={asset.id} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {handoverAssetSummary(asset)}
                {asset.checked ? '' : ' · Chờ kiểm kê'}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              Chờ nhân viên kiểm kê.
            </Typography>
          )}
        </Stack>
        <Divider />
        <Stack spacing={1}>
          <Typography variant="subtitle2">V. Checklist hiện trạng phòng chi tiết</Typography>
          {Object.entries(roomCheckLabels).map(([code, label]) => {
            const check = draft.roomChecks?.find((item) => item.code === code);
            return (
              <Box key={code}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {label}:{' '}
                  {check
                    ? check.status === 'Passed'
                      ? 'Đạt'
                      : check.status === 'Issue'
                        ? 'Cần xử lý'
                        : 'Không áp dụng'
                    : 'Chưa kiểm tra'}
                </Typography>
                {!!check?.notes && <Typography variant="body2">{check.notes}</Typography>}
                {check?.status === 'Issue' && (
                  <Typography color="warning.main" variant="caption">
                    {check.evidenceIds?.length ?? 0} ảnh hạng mục
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">VI. Chìa khóa bàn giao</Typography>
          <Typography variant="body2">
            Số lượng thực giao:{' '}
            {draft.accessItems?.find((item) => item.type === 'RoomKey')?.quantity ??
              'Chưa kiểm đếm'}
          </Typography>
          {!!draft.accessItems?.find((item) => item.type === 'RoomKey')?.notes && (
            <Typography variant="body2">
              Ghi chú: {draft.accessItems.find((item) => item.type === 'RoomKey')!.notes}
            </Typography>
          )}
          <Typography variant="body2">
            Ảnh chìa khóa: {(draft.keyEvidenceIds ?? []).length}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">VII. Nội dung chủ trọ cần xem xét</Typography>
          {draft.roomChecks?.some((check) => check.status === 'Issue') ? (
            <Typography variant="body2">
              Nhân viên đã ghi nhận hiện trạng có vấn đề tại{' '}
              {draft.roomChecks.filter((check) => check.status === 'Issue').length} mục. Chủ trọ
              quyết định chấp thuận tình trạng thực tế hoặc phương án xử lý khi duyệt biên bản.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Không có vấn đề hiện trạng được nhân viên ghi nhận trong checklist.
            </Typography>
          )}
          {!!draft.outstandingIssues?.length && (
            <Typography variant="caption" color="text.secondary">
              Biên bản cũ có {draft.outstandingIssues.length} ghi chú phương án xử lý; vui lòng đối
              chiếu bản lưu trước đó.
            </Typography>
          )}
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">VIII. Điều khoản và xác nhận</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {maybe(draft.terms)}
          </Typography>
          <Typography variant="body2">
            Tenant:{' '}
            {draft.tenantConfirmedAt ? formatInstant(draft.tenantConfirmedAt) : 'Chưa xác nhận'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {draft.status === 'Confirmed'
              ? 'Đây là phần tóm tắt dữ liệu. Đối chiếu bản chính thức đã lưu để xem đầy đủ nội dung xác nhận.'
              : draft.ownerSignedAt
                ? 'Chủ trọ đã ký biên bản. khách thuê cần xem PDF có chữ ký chủ trọ và ký xác nhận.'
                : 'Biên bản đang chờ ký. Các thông tin kiểm tra được cập nhật từ máy chủ.'}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function OwnerHandoverDraftPanel({
  api,
  id,
  contractStatus,
  compact = false,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  contractStatus?: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [result, setResult] = useState<{
    api: ContractClient;
    id: string;
    revision: number;
    data: OwnerHandoverDraft | null;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<{
    api: ContractClient;
    id: string;
    revision: number;
    message: string;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const [ownerInk, setOwnerInk] = useState<{
    contractId: string;
    version: number;
    ink: DrawnSignature;
  } | null>(null);
  const [reinspectionReason, setReinspectionReason] = useState('');
  const [reinspectionSelection, setReinspectionSelection] = useState<string[]>([]);
  const [confirmReinspection, setConfirmReinspection] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [decisionRequest, setDecisionRequest] = useState('');
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const draftStatusRef = useRef<string | null>(null);
  // One authenticated canonical inventory request is shared by the four work
  // modules and the signing gate. Never infer completed status from draft.assets.
  const inventoryTaskId =
    compact && result?.api === api && result.id === id && result.revision === revision
      ? (result.data?.moveInTask?.inventoryTaskId ?? null)
      : null;
  const inventorySnapshot = useActualInventory(api, inventoryTaskId, compact);

  useEffect(() => {
    draftStatusRef.current =
      result?.api === api && result.id === id ? (result.data?.status ?? null) : null;
  }, [api, id, result]);

  useEffect(() => {
    if (typeof api.transport !== 'function') return;
    const controller = new AbortController();
    let checking = false;
    async function load() {
      if (checking) return;
      checking = true;
      try {
        const draft = await api.transport<OwnerHandoverDraft>(
          `${base}/${encodeURIComponent(id)}/handover/draft`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setResult({ api, id, revision, data: draft });
          setLoadError(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          setResult({ api, id, revision, data: null });
        } else {
          setLoadError({ api, id, revision, message: contractError(error) });
        }
      } finally {
        checking = false;
      }
    }
    void load();
    // Staff and Owner work in separate browser sessions. Refresh the server
    // draft without discarding Owner's unsaved decision fields or resetting
    // the visible document while polling.
    const timer = window.setInterval(() => {
      if (
        !lock.current &&
        draftStatusRef.current !== 'Confirmed' &&
        document.visibilityState !== 'hidden'
      )
        void load();
    }, 12000);
    const onFocus = () => {
      if (!lock.current && draftStatusRef.current !== 'Confirmed') void load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [api, id, revision]);

  if (typeof api.transport !== 'function') return null;
  const currentResult =
    result?.api === api && result.id === id && result.revision === revision ? result : null;
  const draft = currentResult?.data ?? null;
  const currentError =
    loadError?.api === api && loadError.id === id && loadError.revision === revision
      ? loadError.message
      : '';
  const loading = !currentResult && !currentError;
  const pending = draft?.requests?.filter((request) => request.status === 'Pending') ?? [];
  const missing = draft?.missing ?? [];
  const readyBlockedByContract = !!contractStatus && contractStatus !== 'Active';
  const hasAssetException =
    !!draft &&
    (draft.inspectedAssets
      ? draft.inspectedAssets.some(
          (asset) => asset.condition !== 'Good' || asset.actualQuantity !== asset.expectedQuantity,
        ) || draft.roomChecks?.some((check) => check.status !== 'Passed') === true
      : requiresOwnerException(draft));
  const reinspectionChoices = draft ? reinspectionOptions(draft) : [];
  const selectedReinspectionItems = reinspectionChoices
    .filter((option) => option.issue && reinspectionSelection.includes(option.key))
    .map((option) => option.item);
  const signedInk =
    ownerInk?.contractId === id && ownerInk.version === draft?.version ? ownerInk.ink : null;
  const inventoryData = inventorySnapshot?.data;
  const allPassed =
    !!draft &&
    (!draft.inventoryHasIssues ||
      draft.inspectedAssets?.every(
        (asset) => asset.condition === 'Good' && asset.actualQuantity === asset.expectedQuantity,
      ) === true) &&
    !draft.missing?.includes('room_summary_evidence') &&
    !!draft.electricity?.id &&
    !!draft.water?.id &&
    (draft.roomChecks ?? []).length === Object.keys(roomCheckLabels).length &&
    Object.keys(roomCheckLabels).every((code) =>
      draft.roomChecks?.some((check) => check.code === code && check.status === 'Passed'),
    ) &&
    (draft.accessItems?.some((access) => access.type === 'RoomKey' && access.quantity > 0) ??
      false) &&
    (draft.moveInTask?.inventoryTaskId
      ? compact
        ? inventoryData?.status === 'Completed' &&
          inventoryData.items.every(
            (item) => item.condition === 'Good' && item.actualQuantity === item.expectedQuantity,
          )
        : draft.moveInTask.inventoryStatus === 'Completed' &&
          !!draft.inspectedAssets &&
          draft.inspectedAssets.every(
            (asset) =>
              asset.condition === 'Good' && asset.actualQuantity === asset.expectedQuantity,
          )
      : draft.noAssetsConfirmed ||
        (!!draft.assets?.length &&
          draft.assets.every(
            (asset) =>
              asset.checked &&
              (asset.damagedQuantity ?? 0) === 0 &&
              (asset.missingQuantity ?? 0) === 0,
          )));
  const canMarkReady =
    !!draft &&
    draft.ownerInkSigningSupported === true &&
    draft.status === 'PendingOwnerReview' &&
    !missing.length &&
    !pending.length &&
    !readyBlockedByContract;
  const staleInventoryMissing =
    compact &&
    inventoryData?.status === 'Completed' &&
    missing.some((code) => ['assets', 'move_in_inventory', 'inventory_changed'].includes(code));
  const displayedMissing = staleInventoryMissing
    ? missing.filter((code) => !['assets', 'move_in_inventory', 'inventory_changed'].includes(code))
    : missing;

  async function mutate(operation: string, body: unknown, key: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await api.mutate(id, operation, body, keys.get(key, body));
      keys.confirmed(key, body);
      setReviewedVersion(null);
      setOwnerInk(null);
      setDecisionRequest('');
      setReviewReason('');
      setReinspectionSelection([]);
      setReinspectionReason('');
      setConfirmReinspection(false);
      setNotice('Đã ghi nhận thao tác. Đang tải lại phiên bản bàn giao từ máy chủ.');
      setRevision((value) => value + 1);
      onChanged?.();
    } catch (error) {
      setActionError(contractError(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2}>
      {!compact && (
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Biên bản bàn giao theo hợp đồng
        </Typography>
      )}
      {loading && <LinearProgress aria-label="Đang tải bản nháp bàn giao" />}
      {!!currentError && <Alert severity="error">{currentError}</Alert>}
      {!!actionError && <Alert severity="error">{actionError}</Alert>}
      {!!notice && <Alert severity="success">{notice}</Alert>}
      {!loading && !currentError && !draft && (
        <Alert severity="info">Máy chủ chưa có bản nháp bàn giao của hợp đồng này.</Alert>
      )}
      {draft && (
        <>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Chip
              label={statusLabel[draft.status] ?? draft.status}
              color={draft.status === 'Confirmed' ? 'success' : 'default'}
            />
          </Stack>
          {draft.status === 'Confirmed' && (
            <ConfirmedHandoverDocuments key={`${id}-${revision}`} api={api} id={id} />
          )}
          {!compact && <StaffReviewSummary draft={draft} />}
          {compact ? (
            <StaffWorkModules
              draft={draft}
              api={api}
              inventory={inventorySnapshot}
              selected={reinspectionSelection}
              onSelect={(key, checked) =>
                setReinspectionSelection((items) =>
                  checked ? [...items, key] : items.filter((item) => item !== key),
                )
              }
              allowReview={!busy && draft.status === 'PendingOwnerReview'}
              reinspectionAction={
                draft.status === 'PendingOwnerReview' &&
                reinspectionChoices.some((option) => option.issue) ? (
                  <Stack direction="row" sx={{ pt: 0.5, justifyContent: 'center' }}>
                    <Button
                      variant="contained"
                      disabled={busy || !selectedReinspectionItems.length}
                      onClick={() => setConfirmReinspection(true)}
                      sx={{ width: 'auto', minWidth: 220, maxWidth: '100%', px: 3 }}
                    >
                      Yêu cầu kiểm tra lại ({selectedReinspectionItems.length})
                    </Button>
                  </Stack>
                ) : undefined
              }
            />
          ) : (
            <DraftDocument draft={draft} api={api} />
          )}
          {draft.status !== 'Confirmed' && (
            <PrivateEvidenceViewer
              label={
                draft.ownerDocumentId && draft.ownerSignedAt
                  ? 'PDF bàn giao chủ trọ đã ký'
                  : 'PDF bản nháp bàn giao (chưa xác nhận)'
              }
              filename={
                draft.ownerDocumentId && draft.ownerSignedAt
                  ? 'bien-ban-ban-giao-owner-da-ky.pdf'
                  : 'bien-ban-ban-giao-nhap.pdf'
              }
              contentType="application/pdf"
              fetchBlob={(signal) =>
                api.transport<Blob>(
                  `${base}/${encodeURIComponent(id)}/handover/draft/pdf`,
                  { signal },
                  'blob',
                )
              }
              errorMessage={contractError}
              compactActions={compact}
            />
          )}
          {draft.status === 'Ready' && !draft.ownerDocumentId && (
            <Alert severity="warning">
              Máy chủ chưa trả về mã PDF chủ trọ đã ký. Vui lòng tải lại biên bản trước khi đối
              chiếu tài liệu ký.
            </Alert>
          )}
          {!compact && (
            <Accordion
              defaultExpanded={!compact}
              disableGutters
              elevation={0}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: '12px !important',
                overflow: 'hidden',
              }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Ảnh bằng chứng ·{' '}
                  {(draft.evidenceIds?.length ?? 0) +
                    (draft.keyEvidenceIds?.length ?? 0) +
                    (draft.roomChecks ?? []).reduce(
                      (count, check) => count + (check.evidenceIds?.length ?? 0),
                      0,
                    ) +
                    (draft.assets ?? []).reduce(
                      (count, asset) => count + (asset.evidenceIds?.length ?? 0),
                      0,
                    ) +
                    (draft.electricity?.id ? 1 : 0) +
                    (draft.water?.id ? 1 : 0)}{' '}
                  ảnh
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  {(draft.evidenceIds ?? []).map((fileId, index) => (
                    <PrivateEvidenceViewer
                      key={`room-${fileId}`}
                      label={`Ảnh hiện trạng phòng ${index + 1}`}
                      filename={`hien-trang-phong-${index + 1}.jpg`}
                      fetchBlob={(signal) =>
                        api.transport<Blob>(
                          `${base}/${encodeURIComponent(id)}/handover/draft/evidence/${encodeURIComponent(fileId)}`,
                          { signal },
                          'blob',
                        )
                      }
                      errorMessage={contractError}
                    />
                  ))}
                  {(draft.keyEvidenceIds ?? []).map((fileId, index) => (
                    <PrivateEvidenceViewer
                      key={`key-${fileId}`}
                      label={`Ảnh chìa khóa bàn giao ${index + 1}`}
                      filename={`chìa-khóa-bàn-giao-${index + 1}.jpg`}
                      fetchBlob={(signal) =>
                        api.transport<Blob>(
                          `${base}/${encodeURIComponent(id)}/handover/draft/evidence/${encodeURIComponent(fileId)}`,
                          { signal },
                          'blob',
                        )
                      }
                      errorMessage={contractError}
                    />
                  ))}
                  {(draft.roomChecks ?? []).flatMap((check) =>
                    (check.evidenceIds ?? []).map((fileId, index) => (
                      <PrivateEvidenceViewer
                        key={`roomcheck-${check.code}-${fileId}`}
                        label={`${roomCheckLabels[check.code] ?? check.code} · Ảnh kiểm tra ${index + 1}`}
                        filename={`hien-trang-${check.code}-${index + 1}.jpg`}
                        fetchBlob={(signal) =>
                          api.transport<Blob>(
                            `${base}/${encodeURIComponent(id)}/handover/draft/evidence/${encodeURIComponent(fileId)}`,
                            { signal },
                            'blob',
                          )
                        }
                        errorMessage={contractError}
                      />
                    )),
                  )}
                  {(draft.assets ?? []).flatMap((asset) =>
                    (asset.evidenceIds ?? []).map((fileId, index) => (
                      <PrivateEvidenceViewer
                        key={`${asset.id}-${fileId}`}
                        label={`${asset.name} · Ảnh kiểm kê ${index + 1}`}
                        filename={`kiem-ke-tai-san-${index + 1}.jpg`}
                        fetchBlob={(signal) =>
                          api.transport<Blob>(
                            `${base}/${encodeURIComponent(id)}/handover/draft/evidence/${encodeURIComponent(fileId)}`,
                            { signal },
                            'blob',
                          )
                        }
                        errorMessage={contractError}
                      />
                    )),
                  )}
                  {(['electricity', 'water'] as const).map((utility) => {
                    const reading = draft[utility];
                    return reading?.id ? (
                      <PrivateEvidenceViewer
                        key={reading.id}
                        label={`Ảnh công tơ ${utility === 'electricity' ? 'điện' : 'nước'} ban đầu`}
                        filename={`cong-to-${utility === 'electricity' ? 'dien' : 'nuoc'}.jpg`}
                        fetchBlob={(signal) => api.readingEvidence(reading.id, signal)}
                        errorMessage={contractError}
                      />
                    ) : null;
                  })}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
          {!compact && draft.status === 'PendingOwnerReview' && (
            <Accordion
              defaultExpanded={!compact}
              disableGutters
              elevation={0}
              sx={{ border: 1, borderColor: 'divider', borderRadius: '12px !important' }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Yêu cầu nhân viên kiểm tra lại (tùy chọn)
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 1.5, pb: 1.5 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Yêu cầu nhân viên kiểm tra lại từng hạng mục
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Chọn chính xác các mục thiếu, sai lệch hoặc hư hỏng cần nhân viên xác nhận
                      lại. Các mục còn lại vẫn giữ kết quả kiểm tra và bằng chứng đã lưu.
                    </Typography>
                    {hasAssetException && (
                      <Alert severity="info">
                        <Stack spacing={1}>
                          <Typography variant="body2">
                            Nếu hạng mục cần sửa chữa hoặc bổ sung vật dụng, chủ trọ có thể lập và
                            theo dõi công việc tại Quản lý bảo trì. Sau khi xử lý xong, chọn hạng
                            mục bên dưới để nhân viên kiểm tra lại và ghi nhận bằng chứng mới trước
                            khi chủ trọ ký.
                          </Typography>
                          <Button
                            component="a"
                            href="/maintenance"
                            target="_blank"
                            rel="noopener noreferrer"
                            size="small"
                            sx={{ alignSelf: 'flex-start' }}
                          >
                            Mở quản lý sửa chữa
                          </Button>
                        </Stack>
                      </Alert>
                    )}
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${reinspectionSelection.length} mục đã chọn`}
                      />
                      {draft.inventoryHasIssues && (
                        <Chip size="small" color="warning" label="Có kiểm kê tài sản bất thường" />
                      )}
                    </Stack>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                        gap: 1,
                      }}
                    >
                      {reinspectionChoices
                        .filter((option) => option.issue)
                        .map((option) => (
                          <Box
                            key={option.key}
                            sx={{
                              px: 1.5,
                              py: 0.5,
                              border: 1,
                              borderColor: option.issue ? 'warning.main' : 'divider',
                              borderRadius: 1.5,
                            }}
                          >
                            <FormControlLabel
                              label={option.label}
                              control={
                                <Checkbox
                                  checked={reinspectionSelection.includes(option.key)}
                                  disabled={busy}
                                  onChange={(_, checked) =>
                                    setReinspectionSelection((items) =>
                                      checked
                                        ? [...items, option.key]
                                        : items.filter((item) => item !== option.key),
                                    )
                                  }
                                />
                              }
                            />
                          </Box>
                        ))}
                    </Box>
                    <TextField
                      label="Nội dung nhân viên cần kiểm tra lại"
                      placeholder="Ví dụ: Kiểm tra lại khóa cửa và chụp đủ ảnh vị trí bị hỏng"
                      fullWidth
                      multiline
                      minRows={2}
                      required
                      disabled={busy}
                      value={reinspectionReason}
                      slotProps={{ htmlInput: { maxLength: 2000 } }}
                      onChange={(event) => setReinspectionReason(event.target.value.slice(0, 2000))}
                    />
                    <Button
                      variant="outlined"
                      disabled={
                        busy || !selectedReinspectionItems.length || !reinspectionReason.trim()
                      }
                      onClick={() =>
                        void mutate(
                          'handover/draft/reinspection',
                          {
                            version: draft.version,
                            reason: reinspectionReason.trim(),
                            items: selectedReinspectionItems,
                          },
                          'handover-draft-reinspection',
                        )
                      }
                    >
                      Gửi yêu cầu nhân viên kiểm tra lại ({selectedReinspectionItems.length})
                    </Button>
                  </Stack>
                </Paper>
              </AccordionDetails>
            </Accordion>
          )}
          {draft.status === 'ReinspectionRequested' && (
            <Alert severity="warning">
              <Typography sx={{ fontWeight: 700 }}>Đã yêu cầu nhân viên kiểm tra lại</Typography>
              {!!draft.reinspectionHistory?.length && (
                <Typography>
                  {draft.reinspectionHistory.at(-1)!.reason} · Gửi lúc{' '}
                  {formatInstant(draft.reinspectionHistory.at(-1)!.requestedAt)}
                </Typography>
              )}
              {!!draft.reinspectionItems?.length && (
                <Box component="ul" sx={{ pl: 3, mb: 0 }}>
                  {draft.reinspectionItems.map((item, index) => (
                    <li key={`${item.kind}-${item.code ?? item.assetId ?? index}`}>
                      {reinspectionLabel(item, draft)}{' '}
                      {item.rechecked ? '· Đã kiểm tra lại' : '· Chờ nhân viên'}
                    </li>
                  ))}
                </Box>
              )}
              Sau khi nhân viên hoàn tất và gửi lại, chủ trọ sẽ xem phiên bản mới trước khi ký.
            </Alert>
          )}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Kiểm tra trước khi bàn giao
              </Typography>
              {displayedMissing.length && draft.status !== 'Confirmed' ? (
                <Alert severity="warning">
                  Còn {displayedMissing.length} mục chưa đủ điều kiện theo máy chủ:
                  <Box component="ul" sx={{ my: 1, pl: 3 }}>
                    {displayedMissing.map((item, index) => (
                      <li key={`${index}-${item}`}>{missingLabel[item] ?? item}</li>
                    ))}
                  </Box>
                </Alert>
              ) : null}
              {staleInventoryMissing && (
                <Alert severity="warning">
                  Nhân viên đã hoàn tất phiếu kiểm kê nhưng máy chủ vẫn báo điều kiện kiểm kê trong
                  biên bản chưa hợp lệ. Chưa thể ký cho đến khi máy chủ đồng bộ và xác nhận đủ điều
                  kiện.
                </Alert>
              )}
              {draft.status === 'PendingOwnerReview' && draft.ownerInkSigningSupported !== true && (
                <Alert severity="warning">
                  Máy chủ đang sử dụng phiên bản chưa hỗ trợ ký tay trực tiếp trên biên bản. Cần cập
                  nhật Backend trước khi chủ trọ ký để chữ ký thực sự được đưa vào PDF.
                </Alert>
              )}
              {!allPassed && draft.status === 'PendingOwnerReview' && (
                <Alert severity="info">
                  Một số hạng mục có vấn đề. chủ trọ có thể ký sau khi kiểm tra và ghi nhận đúng
                  hiện trạng; khách thuê sẽ xem và quyết định chấp nhận khi ký.
                </Alert>
              )}
              {readyBlockedByContract && draft.status !== 'Confirmed' && (
                <Alert severity="info">
                  Hợp đồng cần Active trước khi chủ trọ xác nhận sẵn sàng bàn giao.
                </Alert>
              )}
              {pending.length > 0 && (
                <Alert severity="warning">
                  Đang có yêu cầu chỉnh sửa của khách thuê cần xử lý.
                </Alert>
              )}
              {draft.status === 'Ready' && (
                <Alert severity="info">
                  Chủ trọ đã ký và duyệt biên bản. Đang chờ khách thuê xem PDF và ký xác nhận.
                </Alert>
              )}
              {draft.ownerReadyAt && (
                <Typography variant="body2">
                  Chủ trọ duyệt sẵn sàng: {formatInstant(draft.ownerReadyAt)}
                </Typography>
              )}
              {draft.ownerSignedAt && (
                <Typography variant="body2">
                  Chủ trọ ký biên bản: {formatInstant(draft.ownerSignedAt)}
                </Typography>
              )}
              {draft.tenantSignedAt && (
                <Typography variant="body2">
                  Khách thuê ký biên bản: {formatInstant(draft.tenantSignedAt)}
                </Typography>
              )}
              {draft.status === 'Ready' && draft.ownerReadyReason && (
                <Alert severity="info">
                  Lý do chấp thuận hiện trạng: {draft.ownerReadyReason}
                  {draft.ownerHandlingPlan && ` · Phương án xử lý: ${draft.ownerHandlingPlan}`}
                </Alert>
              )}
              {draft.status === 'PendingOwnerReview' && (
                <>
                  {!compact && hasAssetException && (
                    <Alert severity="info">
                      Hạng mục có vấn đề sẽ được giữ nguyên trong biên bản cho khách thuê xem và xác
                      nhận.
                    </Alert>
                  )}
                  <Stack spacing={0.75}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Chữ ký tay của chủ trọ
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Vẽ chữ ký trong khung bên dưới bằng chuột hoặc cảm ứng. Chữ ký này sẽ được gắn
                      vào bản PDF do máy chủ ký xác thực sau khi kiểm tra đủ điều kiện.
                    </Typography>
                    <DrawPad
                      key={`${id}-${draft.version}`}
                      height={140}
                      disabled={busy || !canMarkReady}
                      onChange={(ink) =>
                        setOwnerInk(ink ? { contractId: id, version: draft.version, ink } : null)
                      }
                    />
                  </Stack>
                  <FormControlLabel
                    label="Tôi đã kiểm tra PDF và đồng ý ký với hiện trạng ghi nhận, kể cả các mục có vấn đề"
                    control={
                      <Checkbox
                        checked={reviewedVersion === draft.version}
                        onChange={(_, checked) =>
                          setReviewedVersion(checked ? draft.version : null)
                        }
                        disabled={busy || !canMarkReady}
                      />
                    }
                  />
                  <Typography variant="caption" color="text.secondary">
                    Chữ ký tay đi cùng xác thực phiên đăng nhập chủ trọ. Biên bản chỉ chuyển sang
                    chờ khách thuê ký sau khi máy chủ lưu thành công PDF đã ký.
                  </Typography>
                  <Button
                    variant="contained"
                    disabled={
                      reviewedVersion !== draft.version || !signedInk || !canMarkReady || busy
                    }
                    onClick={() =>
                      void mutate(
                        'handover/draft/ready',
                        {
                          version: draft.version,
                          signature: ownerSessionSignature,
                          ink: signedInk,
                        },
                        'handover-draft-ready',
                      )
                    }
                  >
                    Ký và duyệt biên bản bàn giao
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
          <Accordion
            defaultExpanded={!compact || pending.length > 0}
            disableGutters
            elevation={0}
            sx={{ border: 1, borderColor: 'divider', borderRadius: '12px !important' }}
          >
            <AccordionSummary expandIcon={<ChevronDown size={18} />}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Yêu cầu chỉnh sửa của khách thuê
                {pending.length ? ` · ${pending.length} đang chờ` : ''}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 1.5, pb: 1.5 }}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Yêu cầu chỉnh sửa của khách thuê
                  </Typography>
                  {!draft.requests?.length && (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có yêu cầu chỉnh sửa.
                    </Typography>
                  )}
                  {(draft.requests ?? []).map((request) => (
                    <Stack
                      spacing={1}
                      key={request.id}
                      sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
                    >
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={
                            request.status === 'Pending'
                              ? 'Chờ chủ trọ duyệt'
                              : request.status === 'Approved'
                                ? 'Đã chấp thuận'
                                : 'Đã từ chối'
                          }
                        />
                        <Typography variant="caption">
                          Phiên bản {request.version} · {formatInstant(request.createdAt)}
                        </Typography>
                      </Stack>
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                      >
                        {request.reason}
                      </Typography>
                      {request.decisionReason && (
                        <Typography variant="body2">
                          Phản hồi chủ trọ: {request.decisionReason}
                        </Typography>
                      )}
                      {request.status === 'Pending' && (
                        <>
                          <TextField
                            fullWidth
                            multiline
                            minRows={2}
                            slotProps={{ htmlInput: { maxLength: 2000 } }}
                            label="Lý do quyết định / hướng xử lý"
                            value={decisionRequest === request.id ? reviewReason : ''}
                            disabled={busy}
                            onChange={(event) => {
                              setDecisionRequest(request.id);
                              setReviewReason(event.target.value);
                            }}
                          />
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Button
                              disabled={
                                busy || decisionRequest !== request.id || !reviewReason.trim()
                              }
                              onClick={() =>
                                void mutate(
                                  `handover/draft/requests/${encodeURIComponent(request.id)}/decision`,
                                  {
                                    version: draft.version,
                                    accepted: true,
                                    reason: reviewReason.trim(),
                                  },
                                  `handover-change-${request.id}`,
                                )
                              }
                            >
                              Chấp thuận yêu cầu
                            </Button>
                            <Button
                              color="error"
                              disabled={
                                busy || decisionRequest !== request.id || !reviewReason.trim()
                              }
                              onClick={() =>
                                void mutate(
                                  `handover/draft/requests/${encodeURIComponent(request.id)}/decision`,
                                  {
                                    version: draft.version,
                                    accepted: false,
                                    reason: reviewReason.trim(),
                                  },
                                  `handover-change-${request.id}`,
                                )
                              }
                            >
                              Từ chối yêu cầu
                            </Button>
                          </Stack>
                        </>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            </AccordionDetails>
          </Accordion>
          {compact && draft.status === 'PendingOwnerReview' && (
            <Stack spacing={1}>
              <Dialog
                open={confirmReinspection}
                onClose={() => setConfirmReinspection(false)}
                maxWidth="sm"
                fullWidth
              >
                <DialogTitle>Xác nhận yêu cầu nhân viên kiểm tra lại</DialogTitle>
                <DialogContent dividers>
                  <Stack spacing={1.5}>
                    <Typography variant="body2">
                      {selectedReinspectionItems.length} mục được chọn. nhân viên chỉ kiểm tra và
                      cập nhật bằng chứng cho các mục này; hệ thống không tự giao công việc sửa
                      chữa.
                    </Typography>
                    <Box component="ul" sx={{ my: 0, pl: 3 }}>
                      {selectedReinspectionItems.map((item, index) => (
                        <li key={`${item.kind}-${item.code ?? item.assetId ?? index}`}>
                          {reinspectionLabel(item, draft)}
                        </li>
                      ))}
                    </Box>
                    <TextField
                      label="Nội dung nhân viên cần kiểm tra lại"
                      placeholder="Mô tả rõ vấn đề và bằng chứng cần chụp"
                      fullWidth
                      multiline
                      minRows={2}
                      required
                      value={reinspectionReason}
                      disabled={busy}
                      slotProps={{ htmlInput: { maxLength: 2000 } }}
                      onChange={(event) => setReinspectionReason(event.target.value.slice(0, 2000))}
                    />
                  </Stack>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setConfirmReinspection(false)} disabled={busy}>
                    Hủy
                  </Button>
                  <Button
                    variant="contained"
                    disabled={
                      busy || !selectedReinspectionItems.length || !reinspectionReason.trim()
                    }
                    onClick={() =>
                      void mutate(
                        'handover/draft/reinspection',
                        {
                          version: draft.version,
                          reason: reinspectionReason.trim(),
                          items: selectedReinspectionItems,
                        },
                        'handover-draft-reinspection',
                      )
                    }
                  >
                    Gửi yêu cầu kiểm tra lại
                  </Button>
                </DialogActions>
              </Dialog>
            </Stack>
          )}
        </>
      )}
      {!compact && (
        <Button disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>
          {draft?.status === 'Confirmed' ? 'Tải lại biên bản' : 'Tải lại bản nháp'}
        </Button>
      )}
    </Stack>
  );
}
