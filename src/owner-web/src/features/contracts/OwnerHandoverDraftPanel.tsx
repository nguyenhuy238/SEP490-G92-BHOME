import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
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
  status: 'Draft' | 'Ready' | 'ChangesRequested' | 'Confirmed';
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
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  evidenceIds: string[];
  keyEvidenceIds?: string[];
  inventoryToken?: string | null;
  noAssetsConfirmed: boolean;
  inventoryHasIssues?: boolean;
  moveInTask?: {
    id: string;
    status: string;
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

const statusLabel: Record<OwnerHandoverDraft['status'], string> = {
  Draft: 'Đang lập biên bản',
  Ready: 'Sẵn sàng cho Tenant xác nhận',
  ChangesRequested: 'Tenant yêu cầu chỉnh sửa',
  Confirmed: 'Đã xác nhận bàn giao',
};

const missingLabel: Record<string, string> = {
  contract_active: 'Hợp đồng chưa được kích hoạt',
  tenant_account: 'Chưa có tài khoản Tenant hợp lệ để xác nhận',
  electricity: 'Chưa có chỉ số điện ban đầu được xác nhận, kèm ảnh',
  water: 'Chưa có chỉ số nước ban đầu được xác nhận, kèm ảnh',
  meter_readings_same_day: 'Chỉ số điện và nước cần được ghi nhận cùng ngày',
  room_condition: 'Staff chưa ghi nhận hiện trạng phòng',
  keys_and_access: 'Chưa ghi nhận số lượng chìa khóa bàn giao',
  room_evidence: 'Chưa có ảnh chứng minh tình trạng phòng',
  room_checklist: 'Staff chưa hoàn tất 7 hạng mục kiểm tra hiện trạng phòng',
  room_issue_evidence: 'Hạng mục hiện trạng có vấn đề nhưng thiếu ảnh bằng chứng riêng',
  access_inventory: 'Chưa ghi nhận số lượng chìa khóa bàn giao',
  assets: 'Kiểm kê tài sản chưa hoàn tất',
  move_in_inventory: 'Staff chưa lưu/hoàn thành phiếu đối chiếu kiểm kê đầu vào',
  asset_quantities_or_evidence:
    'Số lượng, đối chiếu tài sản hoặc ảnh bằng chứng kiểm kê chưa hợp lệ; Staff cần kiểm tra và bổ sung',
  inventory_changed: 'Danh sách tài sản đã thay đổi, cần Staff kiểm kê lại',
  staff_inspection: 'Staff chưa hoàn tất các nội dung kiểm tra bàn giao',
  contract_changed: 'Dữ liệu hợp đồng đã thay đổi, cần cập nhật lại bản nháp',
};

// Match HandoverChecklist.RequiresOwner/Problem: an exceptional inventory
// requires an explicit Owner reason and handling plan before marking Ready.
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

/** Read the exact Staff inventory task, not the older handover-draft asset fields. */
function OwnerInventoryResults({
  api,
  taskId,
  polling,
}: {
  api: ContractClient;
  taskId: string;
  polling: boolean;
}) {
  const [response, setResponse] = useState<{
    api: ContractClient;
    taskId: string;
    data: ActualInventoryView | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    async function load() {
      if (checking) return;
      checking = true;
      try {
        const data = await api.transport<ActualInventoryView>(
          `/api/v1/operational-tasks/${encodeURIComponent(taskId)}/move-in-inventory`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setResponse({ api, taskId, data, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted)
          setResponse((previous) => ({
            api,
            taskId,
            data: previous?.api === api && previous.taskId === taskId ? previous.data : null,
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
  const current = response?.api === api && response.taskId === taskId ? response : null;
  if (!current) return <LinearProgress aria-label="Đang tải kiểm kê thực tế từ Staff" />;
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
          label={inventory.status === 'Completed' ? 'Staff đã hoàn tất' : 'Staff đang thực hiện'}
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
              {document.templateVersion != null ? ` · Phiên bản ${document.templateVersion}` : ''}
            </Typography>
            <PrivateEvidenceViewer
              label={
                index === 0 ? 'PDF bàn giao đã xác nhận' : `PDF bàn giao đã xác nhận ${index + 1}`
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
              : 'Bản nháp tự động cập nhật theo nhiệm vụ của Staff'}
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
            Điện: {draft.electricity?.value ?? 'Chờ Staff xác nhận'}
          </Typography>
          <Typography variant="body2">
            Nước: {draft.water?.value ?? 'Chờ Staff xác nhận'}
          </Typography>
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">IV. Kiểm kê tài sản</Typography>
          {draft.inventoryHasIssues && (
            <Alert severity="warning" variant="outlined">
              Staff ghi nhận tài sản thiếu hoặc hư hỏng trong phiếu kiểm kê. Owner cần đối chiếu ảnh
              và ghi chú trước khi quyết định lý do chấp thuận và phương án xử lý bàn giao.
            </Alert>
          )}
          {draft.status !== 'Confirmed' && draft.moveInTask?.inventoryTaskId ? (
            <OwnerInventoryResults api={api} taskId={draft.moveInTask.inventoryTaskId} polling />
          ) : draft.noAssetsConfirmed ? (
            <Typography variant="body2">Owner xác nhận phòng không có tài sản bàn giao.</Typography>
          ) : draft.assets?.length ? (
            draft.assets.map((asset) => (
              <Typography key={asset.id} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {handoverAssetSummary(asset)}
                {asset.checked ? '' : ' · Chờ kiểm kê'}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              Chờ Staff kiểm kê.
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
          <Typography variant="subtitle2">VII. Nội dung Owner cần xem xét</Typography>
          {draft.roomChecks?.some((check) => check.status === 'Issue') ? (
            <Typography variant="body2">
              Staff đã ghi nhận hiện trạng có vấn đề tại{' '}
              {draft.roomChecks.filter((check) => check.status === 'Issue').length} mục. Owner quyết
              định chấp thuận tình trạng thực tế hoặc phương án xử lý khi duyệt biên bản.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Không có vấn đề hiện trạng được Staff ghi nhận trong checklist.
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
              : 'Phần ký sẽ được bổ sung sau. Các thông tin đang chờ Staff được cập nhật từ máy chủ.'}
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
}: {
  api: ContractClient;
  id: string;
  contractStatus?: string;
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
  const [reviewed, setReviewed] = useState(false);
  const [readyReason, setReadyReason] = useState('');
  const [readyHandlingPlan, setReadyHandlingPlan] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [decisionRequest, setDecisionRequest] = useState('');
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const draftStatusRef = useRef<string | null>(null);

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
  const hasAssetException = !!draft && requiresOwnerException(draft);
  const exceptionDetailsComplete =
    !hasAssetException || (!!readyReason.trim() && !!readyHandlingPlan.trim());
  const canMarkReady =
    !!draft &&
    draft.status === 'Draft' &&
    !missing.length &&
    !pending.length &&
    !readyBlockedByContract;

  async function mutate(operation: string, body: unknown, key: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await api.mutate(id, operation, body, keys.get(key, body));
      keys.confirmed(key, body);
      setReviewed(false);
      setReadyReason('');
      setReadyHandlingPlan('');
      setDecisionRequest('');
      setReviewReason('');
      setNotice('Đã ghi nhận thao tác. Đang tải lại phiên bản bàn giao từ máy chủ.');
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(contractError(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        Biên bản bàn giao theo hợp đồng
      </Typography>
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
            <Chip size="small" label={`v${draft.version}`} variant="outlined" />
          </Stack>
          {draft.status === 'Confirmed' && (
            <ConfirmedHandoverDocuments key={`${id}-${revision}`} api={api} id={id} />
          )}
          <DraftDocument draft={draft} api={api} />
          {draft.status !== 'Confirmed' && (
            <PrivateEvidenceViewer
              label="PDF bản nháp bàn giao (chưa xác nhận)"
              filename="bien-ban-ban-giao-nhap.pdf"
              contentType="application/pdf"
              fetchBlob={(signal) =>
                api.transport<Blob>(
                  `${base}/${encodeURIComponent(id)}/handover/draft/pdf`,
                  { signal },
                  'blob',
                )
              }
              errorMessage={contractError}
            />
          )}
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
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Kiểm tra trước khi bàn giao
              </Typography>
              {missing.length ? (
                <Alert severity="warning">
                  Còn {missing.length} mục chưa đủ điều kiện theo máy chủ:
                  <Box component="ul" sx={{ my: 1, pl: 3 }}>
                    {missing.map((item, index) => (
                      <li key={`${index}-${item}`}>{missingLabel[item] ?? item}</li>
                    ))}
                  </Box>
                </Alert>
              ) : (
                <Alert severity="success">Máy chủ không báo thiếu mục kiểm tra nào.</Alert>
              )}
              {readyBlockedByContract && draft.status !== 'Confirmed' && (
                <Alert severity="info">
                  Hợp đồng cần Active trước khi Owner xác nhận sẵn sàng bàn giao.
                </Alert>
              )}
              {pending.length > 0 && (
                <Alert severity="warning">Đang có yêu cầu chỉnh sửa của Tenant cần xử lý.</Alert>
              )}
              {draft.status === 'Ready' && (
                <Alert severity="info">
                  Owner đã đánh dấu sẵn sàng. Đang chờ Tenant xác nhận biên bản.
                </Alert>
              )}
              {draft.status === 'Confirmed' && (
                <Alert severity="success">Biên bản đã hoàn tất và được lưu lại trên máy chủ.</Alert>
              )}
              {draft.ownerReadyAt && (
                <Typography variant="body2">
                  Owner đánh dấu sẵn sàng: {formatInstant(draft.ownerReadyAt)}
                </Typography>
              )}
              {draft.status === 'Draft' && (
                <>
                  {hasAssetException && (
                    <>
                      <Alert severity="warning">
                        Kiểm kê có tài sản chưa được Owner xác nhận, chênh lệch, thiếu, hỏng hoặc
                        hiện trạng phòng có vấn đề. Nhập lý do và phương án xử lý ngoại lệ trước khi
                        sẵn sàng bàn giao.
                      </Alert>
                      <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        required
                        label="Lý do chấp thuận ngoại lệ bàn giao"
                        value={readyReason}
                        disabled={busy}
                        slotProps={{ htmlInput: { maxLength: 2000 } }}
                        onChange={(event) => setReadyReason(event.target.value.slice(0, 2000))}
                      />
                      <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        required
                        label="Phương án xử lý ngoại lệ bàn giao"
                        value={readyHandlingPlan}
                        disabled={busy}
                        slotProps={{ htmlInput: { maxLength: 2000 } }}
                        onChange={(event) =>
                          setReadyHandlingPlan(event.target.value.slice(0, 2000))
                        }
                      />
                    </>
                  )}
                  <FormControlLabel
                    label="Tôi đã kiểm tra nội dung và xác nhận sẵn sàng bàn giao"
                    control={
                      <Checkbox
                        checked={reviewed}
                        onChange={(_, checked) => setReviewed(checked)}
                        disabled={busy || !canMarkReady}
                      />
                    }
                  />
                  <Button
                    variant="contained"
                    disabled={!reviewed || !canMarkReady || !exceptionDetailsComplete || busy}
                    onClick={() =>
                      void mutate(
                        'handover/draft/ready',
                        hasAssetException
                          ? {
                              version: draft.version,
                              reason: readyReason.trim(),
                              handlingPlan: readyHandlingPlan.trim(),
                            }
                          : { version: draft.version },
                        'handover-draft-ready',
                      )
                    }
                  >
                    Đánh dấu sẵn sàng bàn giao
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Yêu cầu chỉnh sửa của Tenant
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
                          ? 'Chờ Owner duyệt'
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
                      Phản hồi Owner: {request.decisionReason}
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
                          disabled={busy || decisionRequest !== request.id || !reviewReason.trim()}
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
                          disabled={busy || decisionRequest !== request.id || !reviewReason.trim()}
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
        </>
      )}
      <Button disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>
        {draft?.status === 'Confirmed' ? 'Tải lại biên bản' : 'Tải lại bản nháp'}
      </Button>
    </Stack>
  );
}
