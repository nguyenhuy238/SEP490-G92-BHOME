import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ClipboardList, KeyRound, Package, Plus, Wallet } from 'lucide-react';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
  type FinalInspection,
} from '../../../../../packages/client-core/src/contracts';
import { ConfirmActionButton } from '../../components/common/ConfirmActionButton';
import { MoneyField } from '../../components/common/MoneyField';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';

type ItemKind = 'Asset' | 'RoomCheck' | 'Access';
interface ProposalItem {
  kind: ItemKind;
  assetId?: string | null;
  roomCheckCode?: string | null;
  accessType?: string | null;
  amount: string;
  reason: string;
}
interface ProposalSource {
  kind: ItemKind;
  assetId?: string | null;
  roomCheckCode?: string | null;
  accessType?: string | null;
  label: string;
  baseline: string | null;
  observed: string | null;
  chargeable: boolean;
  evidenceIds: string[];
  baselineEvidenceIds?: string[];
}
interface FinancialProposal {
  id: string;
  sourceReference: string;
  items: ProposalItem[];
  totalCharges: string;
  existingOutstanding?: string;
  signedBalance: string;
  availableDeposit: string;
  verifiedDeposit: string;
  sentAt: string;
  note?: string | null;
  tenantFeedback?: { confirmed: boolean; reason: string; at?: string } | null;
}
interface ProposalPreview {
  contractId: string;
  baselineContractId?: string | null;
  reference: string;
  inspectionId: string;
  inspectionVersion: number;
  verifiedDeposit: string;
  availableDeposit: string;
  existingOutstanding?: string;
  items: ProposalSource[];
  latestProposal: FinancialProposal | null;
  status: 'None' | 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated';
}

/** Exact photo source rendered by /handovers?tab=handover; not a financial baseline. */
interface OpeningHandoverDraftPhotos {
  contractId: string;
  status: string;
  evidenceIds?: string[] | null;
  roomChecks?: { code: string; evidenceIds?: string[] | null }[] | null;
  assets?: { id: string; evidenceIds?: string[] | null }[] | null;
  keyEvidenceIds?: string[] | null;
}

const groupLabels: Record<ItemKind, string> = {
  RoomCheck: 'Hiện trạng phòng',
  Asset: 'Tài sản',
  Access: 'Chìa khóa',
};
const roomCheckLabels: Record<string, string> = {
  walls_ceiling_floor: 'Tường, trần và sàn',
  doors_windows_locks: 'Cửa, cửa sổ và khóa',
  electrical_lighting_outlets: 'Đèn, công tắc và ổ điện',
  water_plumbing_drainage: 'Cấp nước, vòi và thoát nước',
  bathroom_toilet: 'Nhà vệ sinh và thiết bị vệ sinh',
  cleanliness: 'Vệ sinh và hiện trạng phòng',
  safety_equipment: 'Thiết bị an toàn',
};
const statusLabels: Record<ProposalPreview['status'], string> = {
  None: 'Chưa gửi đề xuất',
  PendingTenant: 'Đang chờ Tenant duyệt',
  Accepted: 'Tenant đã đồng ý',
  Disputed: 'Tenant yêu cầu xem xét lại',
  Outdated: 'Dữ liệu đã thay đổi',
};
const groupIcons = { RoomCheck: ClipboardList, Asset: Package, Access: KeyRound };

function sourceKey(
  source: Pick<ProposalSource, 'kind' | 'assetId' | 'roomCheckCode' | 'accessType'>,
) {
  return [source.kind, source.assetId ?? source.roomCheckCode ?? source.accessType ?? ''].join(':');
}

function vndInteger(value: string | null | undefined): bigint | null {
  return typeof value === 'string' && /^(0|[1-9]\d*)(?:\.0+)?$/.test(value)
    ? BigInt(value.split('.')[0])
    : null;
}

function signedMoney(value: bigint | null) {
  if (value === null) return 'Chưa xác minh';
  if (value === 0n) return formatContractMoney('0');
  if (value < 0n) return '-' + formatContractMoney((-value).toString());
  return '+' + formatContractMoney(value.toString());
}

function statusVi(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return 'Chưa có dữ liệu';
  switch (text.toLowerCase()) {
    case 'passed':
    case 'good':
      return 'Tốt';
    case 'issue':
      return 'Có vấn đề';
    case 'notapplicable':
      return 'Không áp dụng';
    default:
      return text;
  }
}

function meterInteger(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Chưa có chỉ số';
  const number = Number(value);
  // Display only. Do not round a confirmed meter value upward or alter the
  // underlying measurement; match the integer display on the Bàn giao tab.
  return Number.isFinite(number) && Number.isSafeInteger(Math.trunc(number))
    ? Math.trunc(number).toLocaleString('vi-VN')
    : String(value).split('.')[0];
}

type DetailLine = { label: string; value: string };
function contentLine(notes: string | null | undefined): DetailLine[] {
  return notes?.trim() ? [{ label: 'Nội dung', value: notes.trim() }] : [];
}
function numberLine(label: string, value: number | null | undefined): DetailLine {
  return { label, value: value == null ? 'Chưa có dữ liệu' : String(value) };
}

function fallbackDetails(raw: string | null): DetailLine[] {
  if (!raw) return [];
  const match = /^(Passed|Issue|NotApplicable)(?::\s*(.*))?$/i.exec(raw);
  if (match) {
    return [{ label: 'Tình trạng', value: statusVi(match[1]) }, ...contentLine(match[2])];
  }
  return raw
    .split(';')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const separator = piece.indexOf(':');
      if (separator < 0) return { label: 'Nội dung', value: piece };
      const label = piece.slice(0, separator).trim().toLowerCase();
      const value = piece.slice(separator + 1).trim();
      const labels: Record<string, string> = {
        'tình trạng': 'Tình trạng',
        'đã giao': 'Số lượng đã giao',
        'kiểm kê': 'Số lượng kiểm kê',
        'hư hỏng': 'Số lượng hư hỏng',
        thiếu: 'Số lượng thiếu',
        'nội dung': 'Nội dung',
      };
      return {
        label: labels[label] ?? 'Nội dung',
        value: label === 'tình trạng' ? statusVi(value) : value,
      };
    });
}

function comparisonDetails(
  source: ProposalSource,
  inspection: FinalInspection,
): { opening: DetailLine[]; returning: DetailLine[] } {
  if (source.kind === 'RoomCheck') {
    const opening = inspection.baseline?.roomChecks?.find(
      (item) => item.code === source.roomCheckCode,
    );
    const returning = inspection.observed.roomChecks?.find(
      (item) => item.code === source.roomCheckCode,
    );
    return {
      opening: opening
        ? [{ label: 'Tình trạng', value: statusVi(opening.status) }, ...contentLine(opening.notes)]
        : fallbackDetails(source.baseline),
      returning: returning
        ? [
            { label: 'Tình trạng', value: statusVi(returning.status) },
            ...contentLine(returning.notes),
          ]
        : fallbackDetails(source.observed),
    };
  }
  if (source.kind === 'Asset') {
    const opening = inspection.baseline?.assets.find((item) => item.id === source.assetId);
    const returning = inspection.observed.assets.find((item) => item.id === source.assetId);
    return {
      opening: opening
        ? [
            { label: 'Tình trạng', value: statusVi(opening.observedCondition) },
            numberLine('Số lượng lúc nhận', opening.handedOverQuantity ?? opening.observedQuantity),
            ...contentLine(opening.notes),
          ]
        : fallbackDetails(source.baseline),
      returning: returning
        ? [
            { label: 'Tình trạng', value: statusVi(returning.observedCondition) },
            numberLine('Số lượng lúc trả', returning.observedQuantity),
            ...(returning.missingQuantity && returning.missingQuantity > 0
              ? [numberLine('Số lượng thiếu', returning.missingQuantity)]
              : []),
            ...(returning.damagedQuantity && returning.damagedQuantity > 0
              ? [numberLine('Số lượng hư hỏng', returning.damagedQuantity)]
              : []),
            ...contentLine(returning.notes),
          ]
        : fallbackDetails(source.observed),
    };
  }
  const opening = inspection.baseline?.accessItems?.find((item) => item.type === source.accessType);
  const returning = inspection.observed.accessItems?.find(
    (item) => item.type === source.accessType,
  );
  return {
    opening: opening
      ? [numberLine('Số chìa khóa lúc nhận', opening.quantity), ...contentLine(opening.notes)]
      : fallbackDetails(source.baseline),
    returning: returning
      ? [numberLine('Số chìa khóa lúc trả', returning.quantity), ...contentLine(returning.notes)]
      : fallbackDetails(source.observed),
  };
}

function ComparisonColumn({
  title,
  lines,
  photos,
}: {
  title: string;
  lines: DetailLine[];
  photos?: ReactNode;
}) {
  return (
    <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1, gap: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
        {title}
      </Typography>
      {lines.length ? (
        lines.map((line, index) => (
          <Typography
            key={title + ':' + line.label + ':' + index}
            variant="body2"
            sx={{ overflowWrap: 'anywhere' }}
          >
            <Box component="span" sx={{ fontWeight: 600 }}>
              {line.label}:
            </Box>{' '}
            {line.value}
          </Typography>
        ))
      ) : (
        <Typography variant="body2" color="text.secondary">
          Chưa có dữ liệu
        </Typography>
      )}
      {photos}
    </Stack>
  );
}

function openingPhotoIds(source: ProposalSource, inspection: FinalInspection): string[] {
  if (source.baselineEvidenceIds?.length) return source.baselineEvidenceIds;
  if (source.kind === 'RoomCheck')
    return (
      inspection.baseline?.roomChecks?.find((item) => item.code === source.roomCheckCode)
        ?.evidenceIds ?? []
    );
  if (source.kind === 'Asset')
    return (
      inspection.baseline?.assets.find((item) => item.id === source.assetId)?.evidenceIds ?? []
    );
  return inspection.baseline?.keyEvidenceIds ?? [];
}

function openingPhotosFromDraft(
  source: ProposalSource,
  draft: OpeningHandoverDraftPhotos | undefined,
): string[] {
  if (!draft) return [];
  if (source.kind === 'RoomCheck')
    return draft.roomChecks?.find((item) => item.code === source.roomCheckCode)?.evidenceIds ?? [];
  if (source.kind === 'Asset')
    return draft.assets?.find((item) => item.id === source.assetId)?.evidenceIds ?? [];
  return draft.keyEvidenceIds ?? [];
}

function EvidencePhotos({
  api,
  contractId,
  ids,
  label,
  opening,
  fromDraft = false,
}: {
  api: ContractClient;
  contractId: string;
  ids: string[];
  label: string;
  opening: boolean;
  fromDraft?: boolean;
}) {
  if (!ids.length) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {opening ? 'Ảnh bàn giao' : 'Ảnh trả phòng'}
      </Typography>
      <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap' }}>
        {ids.map((evidenceId, position) => (
          <PrivateEvidenceViewer
            key={evidenceId}
            label={`${opening ? 'Ảnh bàn giao' : 'Ảnh trả phòng'} · ${label} · ${position + 1}`}
            filename={`${opening ? 'ban-giao' : 'tra-phong'}-${position + 1}.jpg`}
            fetchBlob={(signal) =>
              opening
                ? fromDraft
                  ? api.transport<Blob>(
                      `/api/v1/contracts/${encodeURIComponent(contractId)}/handover/draft/evidence/${encodeURIComponent(evidenceId)}`,
                      { signal },
                      'blob',
                    )
                  : api.handoverEvidence(contractId, evidenceId, signal)
                : api.evidence(contractId, evidenceId, signal)
            }
            errorMessage={contractError}
            previewButtonLabel={ids.length === 1 ? 'Xem ảnh' : `Xem ảnh ${position + 1}`}
            showDownload={false}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function hasInspectionIssue(source: ProposalSource, inspection: FinalInspection): boolean {
  if (source.kind === 'RoomCheck')
    return (
      inspection.observed.roomChecks?.some(
        (item) => item.code === source.roomCheckCode && item.status === 'Issue',
      ) ?? false
    );
  if (source.kind === 'Asset') {
    const asset = inspection.observed.assets.find((item) => item.id === source.assetId);
    const previous = inspection.baseline?.assets.find((item) => item.id === source.assetId);
    return (
      !!asset &&
      (/có vấn đề|issue|damaged/i.test(asset.observedCondition ?? '') ||
        (previous?.handedOverQuantity != null &&
          asset.observedQuantity != null &&
          previous.handedOverQuantity !== asset.observedQuantity))
    );
  }
  const original = inspection.baseline?.accessItems?.find(
    (item) => item.type === source.accessType,
  )?.quantity;
  const returned = inspection.observed.accessItems?.find(
    (item) => item.type === source.accessType,
  )?.quantity;
  return original != null && returned != null && original !== returned;
}

function entryFor(source: ProposalSource, amount: string, reason: string): ProposalItem {
  return {
    kind: source.kind,
    ...(source.kind === 'Asset' ? { assetId: source.assetId } : {}),
    ...(source.kind === 'RoomCheck' ? { roomCheckCode: source.roomCheckCode } : {}),
    ...(source.kind === 'Access' ? { accessType: source.accessType } : {}),
    amount,
    reason: reason.trim(),
  };
}

function MeterResults({ api, inspection }: { api: ContractClient; inspection: FinalInspection }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={1}>
        <Typography sx={{ fontWeight: 700 }}>Điện và nước đã chốt</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {(['electricity', 'water'] as const).map((name) => {
            const reading = inspection.observed[name];
            const meterLabel = name === 'electricity' ? 'điện' : 'nước';
            const unit = name === 'electricity' ? 'kW' : 'm³';
            return (
              <Stack key={name} spacing={0.5} sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {name === 'electricity' ? 'Điện' : 'Nước'}
                </Typography>
                <Typography sx={{ fontWeight: 700 }}>
                  {meterInteger(reading?.value)}
                  {reading?.value != null ? ` ${unit}` : ''}
                </Typography>
                {!!reading?.id && (
                  <PrivateEvidenceViewer
                    label={`Ảnh chốt công tơ ${meterLabel}`}
                    filename={name === 'electricity' ? 'cong-to-dien.jpg' : 'cong-to-nuoc.jpg'}
                    fetchBlob={(signal) => api.readingEvidence(reading.id, signal)}
                    errorMessage={contractError}
                    previewButtonLabel="Xem ảnh"
                    showDownload={false}
                  />
                )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function OwnerMoveOutReviewPanel({
  api,
  id,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  onChanged: () => void;
}) {
  const moveOut = useQuery({
    queryKey: ['owner-move-out-review', id],
    queryFn: ({ signal }) => api.moveOut(id, signal),
  });
  const inspection = useQuery({
    queryKey: ['owner-move-out-inspections', id],
    queryFn: ({ signal }) => api.inspections(id, signal),
  });
  const latest = inspection.data?.[0];
  // Staff's final submitted inspection is the source for the fee proposal.
  // Owner review of the physical inspection is NOT a prerequisite.
  const inspectionReady =
    !!latest &&
    latest.ownerDecision !== 'Reinspection' &&
    ['Inspected', 'PendingSettlement', 'Settled', 'Completed'].includes(moveOut.data?.status ?? '');
  const canPriceInspection = inspectionReady && moveOut.data?.status === 'Inspected';
  const preview = useQuery({
    queryKey: ['owner-move-out-financial-proposal', id, latest?.id, latest?.version],
    enabled: inspectionReady,
    retry: false,
    queryFn: ({ signal }) =>
      api.transport<ProposalPreview>(
        '/api/v1/contracts/' + encodeURIComponent(id) + '/move-out/receivables/proposal',
        { signal },
      ),
  });
  const data = preview.data;
  // The adjacent Bàn giao tab is explicitly scoped to the selected contract.
  // Keep its draft-photo source on that same ID even if the verified comparison
  // baseline belongs to a prior contract in the room's chain.
  const handoverPhotoContractId = id;
  const snapshotPhotoContractId = data?.baselineContractId || latest?.baselineContractId || id;
  // Match the photo source used on the Bàn giao tab, which reads handover/draft.
  // The historical confirmed snapshot does not always contain these per-item IDs.
  const openingDraft = useQuery({
    queryKey: ['owner-move-out-opening-handover-photos', handoverPhotoContractId],
    enabled: inspectionReady && !!handoverPhotoContractId,
    retry: false,
    queryFn: ({ signal }) =>
      api.transport<OpeningHandoverDraftPhotos>(
        `/api/v1/contracts/${encodeURIComponent(handoverPhotoContractId)}/handover/draft`,
        { signal },
      ),
  });
  const openingDraftPhotoSource =
    openingDraft.data?.contractId === handoverPhotoContractId ? openingDraft.data : undefined;
  const [charges, setCharges] = useState<Record<string, { amount: string; reason: string }>>({});
  const initializedReference = useRef<string | null>(null);
  const [target, setTarget] = useState<ProposalSource | null>(null);
  const [amount, setAmount] = useState('');
  const [chargeReason, setChargeReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));

  useEffect(() => {
    if (!data || initializedReference.current === data.reference) return;
    initializedReference.current = data.reference;
    setCharges(
      Object.fromEntries(
        (data.latestProposal?.items ?? []).map((item) => [
          sourceKey(item),
          { amount: item.amount.split('.')[0], reason: item.reason },
        ]),
      ),
    );
    setNote(data.latestProposal?.note ?? '');
  }, [data]);

  const originalRoomKeys = latest?.baseline?.accessItems?.find(
    (item) => item.type === 'RoomKey',
  )?.quantity;
  const returnedRoomKeys = latest?.observed.accessItems?.find(
    (item) => item.type === 'RoomKey',
  )?.quantity;
  // The inspection itself remains readable before Owner review or when the
  // financial proposal endpoint is unavailable. Missing baselines are unknown,
  // never silently interpreted as zero.
  const inspectionSources: ProposalSource[] = latest
    ? [
        ...(latest.observed.roomChecks ?? []).map((check) => ({
          kind: 'RoomCheck' as const,
          roomCheckCode: check.code,
          label: roomCheckLabels[check.code] ?? check.code,
          baseline: null,
          observed:
            (check.status === 'Passed' ? 'Tốt' : 'Có vấn đề') +
            (check.notes ? ' · ' + check.notes : ''),
          chargeable: false,
          evidenceIds: check.evidenceIds ?? [],
        })),
        ...latest.observed.assets.map((asset) => {
          const old = latest.baseline?.assets?.find((item) => item.id === asset.id);
          return {
            kind: 'Asset' as const,
            assetId: asset.id,
            label: asset.name,
            baseline: old?.handedOverQuantity == null ? null : old.handedOverQuantity + ' chiếc',
            observed:
              (asset.observedQuantity ?? 'Chưa có số liệu') +
              ' chiếc · ' +
              (asset.observedCondition || 'Chưa rõ tình trạng') +
              (asset.notes ? ' · ' + asset.notes : ''),
            chargeable: false,
            evidenceIds: asset.evidenceIds ?? [],
          };
        }),
        ...(returnedRoomKeys === undefined
          ? []
          : [
              {
                kind: 'Access' as const,
                accessType: 'RoomKey',
                label: 'Chìa khóa phòng',
                baseline: originalRoomKeys === undefined ? null : originalRoomKeys + ' chìa khóa',
                observed: returnedRoomKeys + ' chìa khóa',
                chargeable: false,
                evidenceIds: latest.observed.keyEvidenceIds ?? [],
              },
            ]),
      ]
    : [];
  const groups = (['RoomCheck', 'Asset', 'Access'] as const).map((kind) => ({
    kind,
    items: (data?.items ?? inspectionSources).filter((item) => item.kind === kind),
  }));
  const entries = (data?.items ?? [])
    .filter((item) => {
      const draft = charges[sourceKey(item)];
      return (
        item.chargeable && draft && vndInteger(draft.amount) !== null && BigInt(draft.amount) > 0n
      );
    })
    .map((item) =>
      entryFor(item, charges[sourceKey(item)].amount, charges[sourceKey(item)].reason),
    );
  const amountTotal = entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
  const availableDeposit = vndInteger(data?.availableDeposit);
  const existingOutstanding = vndInteger(data?.existingOutstanding);
  const projectedBalance =
    availableDeposit === null || existingOutstanding === null
      ? null
      : availableDeposit - amountTotal - existingOutstanding;
  const locked = data?.status === 'PendingTenant' || data?.status === 'Accepted';
  const shownTotal = locked ? vndInteger(data?.latestProposal?.totalCharges) : amountTotal;
  const shownNet = locked
    ? (() => {
        const value = data?.latestProposal?.signedBalance;
        return value && /^-?\d+(?:\.0+)?$/.test(value) ? BigInt(value.split('.')[0]) : null;
      })()
    : projectedBalance;
  const hasUnpricedReason = entries.some((item) => !item.reason.trim());
  const canSend =
    !!data &&
    !!latest &&
    canPriceInspection &&
    !preview.isFetching &&
    !busy &&
    !locked &&
    availableDeposit !== null &&
    existingOutstanding !== null &&
    !hasUnpricedReason;

  async function refresh() {
    await Promise.all([moveOut.refetch(), inspection.refetch(), preview.refetch()]);
    onChanged();
  }

  async function send() {
    if (!canSend || !data || !latest || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const body = {
      expectedReference: data.reference,
      inspectionId: latest.id,
      inspectionVersion: latest.version,
      items: entries,
      note: note.trim() || null,
    };
    try {
      await api.mutate(
        id,
        'move-out/receivables/proposal',
        body,
        keys.get('financial-proposal', body),
      );
      keys.confirmed('financial-proposal', body);
      setNotice('Đã gửi đề xuất khoản thu cho Tenant xem và duyệt.');
      await refresh();
    } catch (cause) {
      setError(contractError(cause));
      if ((cause as { status?: number })?.status === 409) await refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function openCharge(source: ProposalSource) {
    if (!canPriceInspection || !source.chargeable || locked || busy) return;
    const existing = charges[sourceKey(source)];
    setTarget(source);
    setAmount(existing?.amount ?? '');
    setChargeReason(existing?.reason ?? '');
  }

  return (
    <Stack spacing={2}>
      {(moveOut.isPending || inspection.isPending) && (
        <Alert severity="info">Đang tải kết quả kiểm tra...</Alert>
      )}
      {(moveOut.error || inspection.error) && (
        <Alert severity="error" action={<Button onClick={() => void refresh()}>Thử lại</Button>}>
          Không tải được kết quả trả phòng: {contractError(moveOut.error ?? inspection.error)}
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {!latest && !inspection.isPending && !inspection.error && (
        <Alert severity="info">
          Staff chưa gửi kết quả kiểm kê. Yêu cầu trả phòng hiện tại:{' '}
          {moveOut.data?.status ?? 'Chưa rõ'}.
        </Alert>
      )}
      {latest && (
        <>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Chip size="small" label={'Kiểm kê lần ' + latest.version} />
            <Chip
              size="small"
              color={inspectionReady ? 'success' : 'warning'}
              label={inspectionReady ? 'Đã nhận kết quả Staff' : 'Staff đang kiểm tra'}
            />
          </Stack>
          <MeterResults api={api} inspection={latest} />
          {!!(
            openingDraftPhotoSource?.evidenceIds?.length || latest.baseline?.evidenceIds?.length
          ) &&
            !!handoverPhotoContractId && (
              <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 700 }}>Ảnh bàn giao chung</Typography>
                <EvidencePhotos
                  api={api}
                  contractId={
                    openingDraftPhotoSource?.evidenceIds?.length
                      ? handoverPhotoContractId
                      : snapshotPhotoContractId
                  }
                  ids={
                    openingDraftPhotoSource?.evidenceIds?.length
                      ? openingDraftPhotoSource.evidenceIds
                      : (latest.baseline?.evidenceIds ?? [])
                  }
                  label="Tổng quan phòng"
                  opening
                  fromDraft={!!openingDraftPhotoSource?.evidenceIds?.length}
                />
              </Paper>
            )}
          {!!latest && (
            <>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 750 }}>
                  Các hạng mục kiểm kê
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={
                    data?.status === 'PendingTenant'
                      ? 'info'
                      : data?.status === 'Accepted'
                        ? 'success'
                        : 'default'
                  }
                  label={
                    inspectionReady
                      ? data
                        ? statusLabels[data.status]
                        : 'Đang tải'
                      : 'Chờ Staff hoàn tất'
                  }
                />
              </Stack>
              {inspectionReady && preview.isPending && (
                <Alert severity="info">Đang tải dữ liệu đối chiếu khoản thu...</Alert>
              )}
              {inspectionReady && preview.error && (
                <Alert
                  severity="error"
                  action={<Button onClick={() => void preview.refetch()}>Thử lại</Button>}
                >
                  Chưa tải được số liệu định giá: {contractError(preview.error)}
                </Alert>
              )}
              {groups.map(({ kind, items }) => {
                const Icon = groupIcons[kind];
                return (
                  <Paper key={kind} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', px: 2, py: 1.5, bgcolor: 'action.hover' }}
                    >
                      <Icon size={18} />
                      <Typography sx={{ fontWeight: 700 }}>{groupLabels[kind]}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        ({items.length})
                      </Typography>
                    </Stack>
                    {items.length === 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                        Chưa có dữ liệu.
                      </Typography>
                    )}
                    {items.map((item, index) => {
                      const recordedIssue = hasInspectionIssue(item, latest);
                      const comparison = comparisonDetails(item, latest);
                      const draftPhotoIds = openingPhotosFromDraft(item, openingDraftPhotoSource);
                      const baselinePhotos = draftPhotoIds.length
                        ? draftPhotoIds
                        : openingPhotoIds(item, latest);
                      const baselineContractId = draftPhotoIds.length
                        ? handoverPhotoContractId
                        : snapshotPhotoContractId;
                      const stored = charges[sourceKey(item)];
                      const linked = locked
                        ? data?.latestProposal?.items.find(
                            (charge) => sourceKey(charge) === sourceKey(item),
                          )
                        : null;
                      const current = linked ?? stored;
                      const canEditFee =
                        canPriceInspection && !!data && item.chargeable && !locked && !busy;
                      return (
                        <Box
                          key={sourceKey(item)}
                          sx={{ px: 2, py: 1.5, borderTop: index ? 1 : 0, borderColor: 'divider' }}
                        >
                          <Stack
                            direction="row"
                            spacing={1.5}
                            sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                          >
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Stack
                                direction="row"
                                spacing={1}
                                useFlexGap
                                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                              >
                                <Typography sx={{ fontWeight: 650 }}>{item.label}</Typography>
                                {recordedIssue && (
                                  <Chip size="small" color="warning" label="Có vấn đề" />
                                )}
                              </Stack>
                              <Stack
                                direction={{ xs: 'column', md: 'row' }}
                                spacing={1.5}
                                sx={{ mt: 1 }}
                              >
                                <ComparisonColumn
                                  title="Lúc nhận"
                                  lines={comparison.opening}
                                  photos={
                                    baselineContractId && baselinePhotos.length > 0 ? (
                                      <EvidencePhotos
                                        api={api}
                                        contractId={baselineContractId}
                                        ids={baselinePhotos}
                                        label={item.label}
                                        opening
                                        fromDraft={draftPhotoIds.length > 0}
                                      />
                                    ) : undefined
                                  }
                                />
                                <ComparisonColumn
                                  title="Lúc trả"
                                  lines={comparison.returning}
                                  photos={
                                    item.evidenceIds?.length ? (
                                      <EvidencePhotos
                                        api={api}
                                        contractId={id}
                                        ids={item.evidenceIds}
                                        label={item.label}
                                        opening={false}
                                      />
                                    ) : undefined
                                  }
                                />
                              </Stack>
                            </Box>
                            <Stack spacing={1} sx={{ flexShrink: 0, alignItems: 'flex-end' }}>
                              {!locked && (
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<Plus size={15} />}
                                  disabled={!canEditFee}
                                  aria-label={`${current ? 'Sửa phí' : 'Nhập phí'} · ${item.label}`}
                                  onClick={() => openCharge(item)}
                                  sx={{ minHeight: 34, whiteSpace: 'nowrap' }}
                                >
                                  {current ? 'Sửa phí' : 'Nhập phí'}
                                </Button>
                              )}
                              {current && vndInteger(current.amount) !== null && (
                                <Stack
                                  spacing={0.25}
                                  sx={{ alignItems: 'flex-end', maxWidth: 220 }}
                                >
                                  <Typography color="warning.dark" sx={{ fontWeight: 750 }}>
                                    {formatContractMoney(current.amount)}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{ textAlign: 'right', overflowWrap: 'anywhere' }}
                                  >
                                    Nội dung: {current.reason}
                                  </Typography>
                                </Stack>
                              )}
                            </Stack>
                          </Stack>
                        </Box>
                      );
                    })}
                  </Paper>
                );
              })}
              {data && (
                <Paper variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Wallet size={18} />
                      <Typography sx={{ fontWeight: 750 }}>
                        Tổng kết tiền cọc và khoản thu
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Cọc hợp đồng đã xác minh</Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        {formatContractMoney(data.verifiedDeposit)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Cọc còn khả dụng</Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        {formatContractMoney(data.availableDeposit)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Các khoản phải thu dự kiến</Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        {shownTotal !== null
                          ? formatContractMoney(shownTotal.toString())
                          : 'Chưa xác minh'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">
                        Các khoản thu đã ghi nhận còn phải thanh toán
                      </Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        {existingOutstanding === null
                          ? 'Chưa xác minh'
                          : formatContractMoney(existingOutstanding.toString())}
                      </Typography>
                    </Stack>
                    <Divider />
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <Typography sx={{ fontWeight: 750 }}>Chênh lệch dự kiến</Typography>
                      <Typography
                        variant="h6"
                        color={shownNet !== null && shownNet < 0n ? 'error.main' : 'success.main'}
                        sx={{ fontWeight: 800 }}
                      >
                        {signedMoney(shownNet)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Dương: dự kiến còn tiền cọc hoàn lại. Âm: dự kiến Tenant cần trả thêm. Đã trừ
                      các khoản thu hiện có trong sổ; nợ hóa đơn khác được đối chiếu riêng. Chưa
                      phải giao dịch thanh toán hay quyết toán chính thức.
                    </Typography>
                    {data.latestProposal?.tenantFeedback && (
                      <Alert
                        severity={
                          data.latestProposal.tenantFeedback.confirmed ? 'success' : 'warning'
                        }
                      >
                        {data.latestProposal.tenantFeedback.confirmed
                          ? 'Tenant đã đồng ý đề xuất.'
                          : 'Tenant yêu cầu xem xét lại.'}
                        {data.latestProposal.tenantFeedback.reason
                          ? ' ' + data.latestProposal.tenantFeedback.reason
                          : ''}
                      </Alert>
                    )}
                    {data.status === 'Outdated' && (
                      <Alert severity="warning">
                        Dữ liệu tài chính hoặc kết quả kiểm tra đã thay đổi. Hãy tải lại và đối
                        chiếu trước khi gửi.
                      </Alert>
                    )}
                    {!locked && (
                      <>
                        <TextField
                          size="small"
                          label="Mô tả bổ sung (nếu có)"
                          placeholder="Thông tin chung muốn gửi thêm cho Tenant…"
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          multiline
                          minRows={2}
                          maxRows={5}
                          helperText="Mô tả chung kèm đề xuất, không thay thế lý do của từng khoản phí."
                          slotProps={{ htmlInput: { maxLength: 2000 } }}
                        />
                        <ConfirmActionButton
                          variant="contained"
                          title="Gửi đề xuất cho Tenant"
                          description="Tenant sẽ xem từng khoản thu và lý do, tiền cọc cùng chênh lệch có dấu để đồng ý hoặc yêu cầu xem xét lại. Hệ thống chưa tự thu tiền, trừ cọc hay hoàn tiền."
                          confirmationKey={
                            data.reference + ':' + JSON.stringify(entries) + ':' + note
                          }
                          disabled={!canSend}
                          onConfirm={send}
                        >
                          Gửi Tenant duyệt
                        </ConfirmActionButton>
                      </>
                    )}
                    {locked && !!data.latestProposal?.note && (
                      <Box>
                        <Typography variant="subtitle2">Mô tả đã gửi Tenant</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {data.latestProposal.note}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </Paper>
              )}
            </>
          )}
        </>
      )}
      <Dialog open={!!target} onClose={() => !busy && setTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Khoản thu · {target?.label}</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Stack spacing={2}>
            <MoneyField
              label="Số tiền cần thu (₫)"
              size="small"
              value={amount}
              onValueChange={setAmount}
            />
            <TextField
              autoFocus
              label="Lý do thu"
              size="small"
              multiline
              minRows={2}
              value={chargeReason}
              onChange={(event) => setChargeReason(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>Hủy</Button>
          {!!target && !!charges[sourceKey(target)] && (
            <Button
              color="inherit"
              onClick={() => {
                setCharges((before) => {
                  const next = { ...before };
                  delete next[sourceKey(target)];
                  return next;
                });
                setTarget(null);
              }}
            >
              Bỏ khoản thu
            </Button>
          )}
          <Button
            variant="contained"
            disabled={
              !target ||
              !/^(0|[1-9]\d{0,17})$/.test(amount) ||
              (amount !== '0' && !chargeReason.trim())
            }
            onClick={() => {
              if (!target) return;
              const key = sourceKey(target);
              setCharges((before) => {
                const next = { ...before };
                if (amount === '0') delete next[key];
                else next[key] = { amount, reason: chargeReason.trim() };
                return next;
              });
              setTarget(null);
            }}
          >
            Xong
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
