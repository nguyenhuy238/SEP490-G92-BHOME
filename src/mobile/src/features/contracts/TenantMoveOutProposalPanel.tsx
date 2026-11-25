import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Checkbox, Icon, Text, TextInput, TouchableRipple } from 'react-native-paper';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
  type MoveOutProposalCharge,
  type MoveOutProposalDisputedItem,
  type MoveOutProposalPreview,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Pill } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { roomHandoverChecks } from '../../services/moveInHandover';
import { colors } from '../../theme/theme';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { ContractEvidence } from './ContractEvidence';
import { TenantMoveOutExcessPayment } from './TenantMoveOutExcessPayment';

type ProposalItem = MoveOutProposalCharge;
type DisputedItem = MoveOutProposalDisputedItem;
type ProposalView = MoveOutProposalPreview;

type DisplayState = {
  api: ContractClient;
  contractId: string;
  revision: number;
  view: ProposalView | null;
  error: string;
};

type ReconcileState = {
  api: ContractClient;
  contractId: string;
  proposalId: string;
  status: 'running' | 'failed';
};

const styles = StyleSheet.create({
  root: { gap: 14, minWidth: 0 },
  statusCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  title: { color: colors.navy, fontSize: 17, fontWeight: '700', lineHeight: 24 },
  statusRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.navy },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  listRow: {
    minHeight: 64,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listText: { flex: 1, minWidth: 0, gap: 3 },
  itemTitle: { fontSize: 13, fontWeight: '600', color: colors.navy, lineHeight: 18 },
  itemReason: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  itemAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.navy,
    textAlign: 'right',
    maxWidth: '43%',
    flexShrink: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: 12,
  },
  summary: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  moneyLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  moneyLabel: { color: colors.muted, fontSize: 12, lineHeight: 19, flex: 1, minWidth: 0 },
  moneyValue: {
    color: colors.navy,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 0,
    lineHeight: 19,
  },
  balance: {
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 3,
  },
  balanceLabel: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  balanceValue: {
    color: colors.navy,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  balancePositive: { color: colors.green },
  balanceNegative: { color: colors.red },
  subtle: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.red, fontSize: 12, lineHeight: 18 },
  note: { color: colors.navy, fontSize: 13, lineHeight: 19 },
  actions: { gap: 8 },
  feedbackForm: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  checkbox: { paddingHorizontal: 0, paddingVertical: 0, minHeight: 48 },
  reasonInput: { backgroundColor: colors.white },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(14, 27, 47, 0.65)',
  },
  phoneOverlay: { paddingHorizontal: 0, paddingBottom: 0, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 520,
    maxHeight: '88%',
  },
  phoneSheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '92%' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalHeading: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: colors.navy },
  modalBody: { padding: 16, paddingBottom: 24, gap: 12 },
  modalAmount: { fontSize: 20, fontWeight: '700', color: colors.navy },
  detailBlock: { gap: 3 },
  detailLabel: { color: colors.muted, fontSize: 12 },
  detailText: { color: colors.navy, fontSize: 14, lineHeight: 20 },
});

function matchingInspectionItem(
  item: ProposalItem,
  view: ProposalView,
): ProposalView['items'][number] | undefined {
  return view.items.find(
    (entry) =>
      entry.kind === item.kind &&
      (entry.assetId ?? null) === (item.assetId ?? null) &&
      (entry.roomCheckCode ?? null) === (item.roomCheckCode ?? null) &&
      (entry.accessType ?? null) === (item.accessType ?? null),
  );
}

function proposalItemName(item: ProposalItem, view?: ProposalView): string {
  const eligible = view ? matchingInspectionItem(item, view) : undefined;
  return (
    eligible?.label ||
    item.label ||
    (item.kind === 'Asset'
      ? 'Tài sản trong phòng'
      : item.kind === 'RoomCheck'
        ? (roomHandoverChecks.find((check) => check.code === item.roomCheckCode)?.label ??
          'Tình trạng phòng')
        : 'Chìa khóa và quyền truy cập')
  );
}

function signedMoney(amount: string): string {
  const matched = /^(-?)(\d+)(?:\.0+)?$/.exec(amount);
  if (!matched) return 'Chưa xác định';
  if (/^0+$/.test(matched[2])) return formatContractMoney('0');
  return `${matched[1] ? '−' : '+'}${formatContractMoney(matched[2])}`;
}

function localizedCondition(value: string): string {
  switch (value.trim().toLowerCase()) {
    case 'passed':
    case 'good':
      return 'Tốt';
    case 'issue':
    case 'damaged':
      return 'Có vấn đề';
    case 'notapplicable':
      return 'Không áp dụng';
    case 'chưa xác minh':
      return 'Chưa có dữ liệu';
    default:
      return value.trim();
  }
}

function comparisonLines(value: string): string[] {
  const fields = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const labels: Record<string, string> = {
    'tình trạng': 'Tình trạng',
    'kiểm kê': 'Số lượng hiện tại',
    'hư hỏng': 'Số lượng hư hỏng',
    'nội dung': 'Nội dung',
  };
  return fields.flatMap((field) => {
    const colon = field.indexOf(':');
    if (colon < 0) return [`Nội dung: ${localizedCondition(field)}`];
    const key = field.slice(0, colon).trim().toLowerCase();
    const text = field.slice(colon + 1).trim();
    // Tenant chỉ xem dữ liệu hiện tại, không đọc số lượng/chênh lệch đầu vào.
    if (key === 'đã giao' || key === 'thiếu') return [];
    if (['passed', 'issue', 'notapplicable'].includes(key)) {
      return [`Tình trạng: ${localizedCondition(key)}`, ...(text ? [`Nội dung: ${text}`] : [])];
    }
    return [`${labels[key] ?? 'Nội dung'}: ${localizedCondition(text)}`];
  });
}

function ProposalChargeRow({
  item,
  view,
  onPress,
}: {
  item: ProposalItem;
  view?: ProposalView;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      accessibilityRole="button"
      accessibilityLabel={`Xem chi tiết ${proposalItemName(item, view)}`}
      onPress={onPress}
    >
      <View style={styles.listRow}>
        <Icon
          source={
            item.kind === 'Asset'
              ? 'bed-outline'
              : item.kind === 'Access'
                ? 'key-outline'
                : 'home-outline'
          }
          color={colors.blue}
          size={20}
        />
        <View style={styles.listText}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {proposalItemName(item, view)}
          </Text>
          <Text style={styles.itemReason} numberOfLines={1}>
            {item.reason}
          </Text>
        </View>
        <Text
          style={styles.itemAmount}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {formatContractMoney(item.amount)}
        </Text>
        <Icon source="chevron-right" color={colors.muted} size={18} />
      </View>
    </TouchableRipple>
  );
}

function MoneyLine({ label, amount }: { label: string; amount: string }) {
  return (
    <View style={styles.moneyLine}>
      <Text style={styles.moneyLabel}>{label}</Text>
      <Text style={styles.moneyValue}>{formatContractMoney(amount)}</Text>
    </View>
  );
}

export function TenantMoveOutProposalPanel({
  api,
  contractId,
  onChanged,
}: {
  api: ContractClient;
  contractId: string;
  onChanged: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<DisplayState | null>(null);
  const [selection, setSelection] = useState<{
    proposalId: string;
    reference: string;
    kind: 'accept' | 'dispute';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [disputedItems, setDisputedItems] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [detail, setDetail] = useState<{ proposalId: string; index: number } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reconcileState, setReconcileState] = useState<ReconcileState | null>(null);
  const [moveOutProgress, setMoveOutProgress] = useState<{
    api: ContractClient;
    contractId: string;
    status: string;
  } | null>(null);
  const lock = useRef(false);
  const keys = useRef(mutationKeys(randomUUID));
  const reconcileAttempts = useRef({ api, contractId, proposalIds: new Set<string>() });
  const isMounted = useRef(false);
  const onChangedRef = useRef(onChanged);
  const completedRef = useRef<string | null>(null);
  const { width } = useWindowDimensions();
  const phone = width < 540;
  const { go } = useWorkspace();
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api.moveOutProposal(contractId, controller.signal).then(
      (view) => {
        if (!controller.signal.aborted) setSnapshot({ api, contractId, revision, view, error: '' });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setSnapshot({ api, contractId, revision, view: null, error: contractError(cause) });
      },
    );
    return () => controller.abort();
  }, [api, contractId, revision]);

  const current =
    snapshot?.api === api && snapshot.contractId === contractId && snapshot.revision === revision
      ? snapshot
      : null;
  const proposal = current?.view?.latestProposal;
  const proposalId = proposal?.id;
  const viewStatus = current?.view?.status;
  const feedbackConfirmed = proposal?.tenantFeedback?.confirmed;
  const settlementStatus = proposal?.tenantFeedback?.settlement?.status;
  const completed =
    moveOutProgress?.api === api &&
    moveOutProgress.contractId === contractId &&
    moveOutProgress.status === 'Completed';
  useEffect(() => {
    if (!completed || completedRef.current === contractId) return;
    completedRef.current = contractId;
    onChangedRef.current();
  }, [completed, contractId]);
  // The original proposal is an immutable quote. After payment, read the
  // authoritative move-out status rather than continuing to display its
  // negative "expected balance" as though the Tenant still owes money.
  useEffect(() => {
    if (feedbackConfirmed !== true || settlementStatus !== 'Payable' || completed) return;
    const controller = new AbortController();
    const refresh = () => {
      void api.moveOut(contractId, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted)
            setMoveOutProgress({ api, contractId, status: result.status });
        },
        () => {
          /* The old quote remains read-only if status cannot be fetched. */
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, contractId, feedbackConfirmed, settlementStatus, completed]);
  const settlementReason = proposal?.tenantFeedback?.settlement?.reason;
  const legacyReconcileEligible =
    !!proposalId &&
    (viewStatus === 'Accepted' || viewStatus === 'Outdated') &&
    feedbackConfirmed === true &&
    settlementStatus === 'PendingOwnerReview' &&
    settlementReason === 'owner_confirmed_inspection_required';
  useEffect(() => {
    if (
      reconcileAttempts.current.api !== api ||
      reconcileAttempts.current.contractId !== contractId
    )
      reconcileAttempts.current = { api, contractId, proposalIds: new Set<string>() };
    if (!legacyReconcileEligible || !proposalId) return;
    const attempts = reconcileAttempts.current;
    // A legacy Owner-review gate can be recovered without asking the Tenant to
    // consent again. Other financial/evidence blockers stay under Owner review.
    if (attempts.proposalIds.has(proposalId)) return;
    attempts.proposalIds.add(proposalId);
    const body = { proposalId };
    setReconcileState({ api, contractId, proposalId, status: 'running' });
    // Do not cancel a financial POST on screen re-render/navigation. The server
    // handles repeat calls atomically by contract and the accepted proposal ID.
    void api.reconcileMoveOutProposal(contractId, body).then(
      () => {
        if (!isMounted.current || reconcileAttempts.current !== attempts) return;
        setReconcileState(null);
        setRevision((value) => value + 1);
        onChangedRef.current();
      },
      () => {
        if (!isMounted.current || reconcileAttempts.current !== attempts) return;
        setReconcileState({ api, contractId, proposalId, status: 'failed' });
      },
    );
  }, [api, contractId, legacyReconcileEligible, proposalId]);
  const activeReconcile =
    reconcileState?.api === api &&
    reconcileState.contractId === contractId &&
    reconcileState.proposalId === proposalId
      ? reconcileState
      : null;
  const canRespond = !!proposal && current?.view?.status === 'PendingTenant';
  const detailItem =
    detail && detail.proposalId === proposal?.id ? proposal?.items[detail.index] : null;
  // A superseded proposal must never borrow inspection details from the newer source.
  const detailInspection =
    detailItem && current?.view?.status !== 'Outdated' && current?.view
      ? matchingInspectionItem(detailItem, current.view)
      : null;
  const currentItemLabels =
    current?.view?.status !== 'Outdated' ? (current?.view ?? undefined) : undefined;
  const decision =
    selection &&
    selection.proposalId === proposal?.id &&
    selection.reference === current?.view?.reference
      ? selection.kind
      : null;

  function choose(kind: 'accept' | 'dispute') {
    if (!canRespond || !proposal || !current?.view) return;
    setSelection({ proposalId: proposal.id, reference: current.view.reference, kind });
    setConfirmed(false);
    setReason('');
    setDisputedItems({});
    setError('');
  }

  const disputedCharges: DisputedItem[] = Object.entries(disputedItems).flatMap(([index, note]) => {
    const item = proposal?.items[Number(index)];
    return item
      ? [
          {
            kind: item.kind,
            assetId: item.assetId ?? null,
            roomCheckCode: item.roomCheckCode ?? null,
            accessType: item.accessType ?? null,
            reason: note.trim(),
          },
        ]
      : [];
  });
  const disputeComplete =
    Object.values(disputedItems).every((note) => !!note.trim()) &&
    (disputedCharges.length > 0 || !!reason.trim()) &&
    reason.trim().length <= 2000;

  async function submit(accept: boolean) {
    if (
      lock.current ||
      !canRespond ||
      !current?.view ||
      decision !== (accept ? 'accept' : 'dispute')
    )
      return;
    if (accept && !confirmed) {
      setError('Hãy xác nhận bạn đã đọc toàn bộ đề xuất trước khi đồng ý.');
      return;
    }
    if (!accept && !disputeComplete) {
      setError('Chọn khoản chưa đồng ý và ghi rõ lý do, tối đa 2.000 ký tự cho toàn bộ phản hồi.');
      return;
    }
    const body = {
      proposalId: proposal.id,
      expectedReference: current.view.reference,
      confirmed: accept,
      reason: accept ? '' : reason.trim(),
      ...(accept ? {} : { disputedItems: disputedCharges }),
    };
    const scope = `${contractId}/move-out/proposal/tenant-feedback`;
    lock.current = true;
    setSubmitting(true);
    setError('');
    try {
      await api.respondMoveOutProposal(contractId, body, keys.current.get(scope, body));
      keys.current.confirmed(scope, body);
      setSelection(null);
      setReason('');
      setDisputedItems({});
      setConfirmed(false);
      setRevision((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(contractError(cause));
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  const positive = !!proposal && /^\+?[1-9]/.test(proposal.signedBalance);
  const negative = !!proposal && /^-[1-9]/.test(proposal.signedBalance);

  return (
    <View style={styles.root}>
      <View style={styles.statusCard}>
        <Text style={styles.title}>Đề xuất quyết toán</Text>
        <View style={styles.statusRow}>
          <Pill
            tone={
              completed || current?.view?.status === 'Accepted'
                ? 'green'
                : current?.view?.status === 'PendingTenant'
                  ? 'amber'
                  : 'neutral'
            }
          >
            {completed
              ? 'Trả phòng thành công'
              : !current
                ? 'Đang tải'
                : !proposal
                  ? 'Chưa có đề xuất'
                  : current.view?.status === 'PendingTenant'
                    ? 'Chờ bạn phản hồi'
                    : current.view?.status === 'Accepted'
                      ? 'Bạn đã đồng ý'
                      : current.view?.status === 'Disputed'
                        ? 'Đã yêu cầu xem lại'
                        : 'Cần cập nhật'}
          </Pill>
          {canRespond && <Text style={styles.subtle}>Xem từng khoản trước khi trả lời</Text>}
        </View>
        {!!current?.error && <Text style={styles.error}>{current.error}</Text>}
        {current?.view && !proposal && (
          <Text style={styles.subtle}>Owner chưa gửi đề xuất quyết toán.</Text>
        )}
        {!completed && current?.view?.status === 'Outdated' && !legacyReconcileEligible && (
          <Text style={styles.error}>Đề xuất cũ đã thay đổi. Vui lòng chờ Owner gửi bản mới.</Text>
        )}
      </View>

      {completed && (
        <View style={styles.statusCard}>
          <Text style={[styles.title, { color: colors.green }]}>Trả phòng thành công</Text>
          <Text style={styles.note}>
            Khoản phải thu đã được máy chủ xác minh thanh toán đủ. Hợp đồng đã kết thúc; phòng không
            có hợp đồng thuê khác được chuyển về trạng thái Trống.
          </Text>
        </View>
      )}

      {proposal && current?.view && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Các khoản thu ({proposal.items.length})</Text>
            <View style={styles.list}>
              {proposal.items.length ? (
                proposal.items.map((item, index) => (
                  <React.Fragment
                    key={`${item.kind}:${item.assetId ?? item.roomCheckCode ?? item.accessType ?? index}`}
                  >
                    {index > 0 && <View style={styles.separator} />}
                    <ProposalChargeRow
                      item={item}
                      view={currentItemLabels}
                      onPress={() => setDetail({ proposalId: proposal.id, index })}
                    />
                  </React.Fragment>
                ))
              ) : (
                <View style={styles.listRow}>
                  <Icon source="check-circle-outline" size={20} color={colors.green} />
                  <Text style={[styles.itemReason, { flex: 1 }]}>
                    Không có khoản thu bổ sung từ kiểm tra trả phòng.
                  </Text>
                </View>
              )}
            </View>
            {!!proposal.note && (
              <Text style={styles.subtle}>Ghi chú từ Owner: {proposal.note}</Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tiền cọc và chênh lệch</Text>
            <View style={styles.summary}>
              <MoneyLine label="Cọc còn khả dụng" amount={proposal.availableDeposit} />
              <MoneyLine
                label={completed ? 'Phí trả phòng đã chốt' : 'Khoản thu đề xuất'}
                amount={proposal.totalCharges}
              />
              <MoneyLine
                label={completed ? 'Khoản phải thu khác lúc đề xuất' : 'Khoản phải thu còn nợ'}
                amount={proposal.existingOutstanding}
              />
              {completed && (
                <MoneyLine
                  label="Khoản đã xác minh thanh toán"
                  amount={proposal.tenantFeedback?.settlement?.payableAmount ?? '0'}
                />
              )}
              <View style={styles.balance}>
                <Text style={styles.balanceLabel}>
                  {completed
                    ? 'Không còn phải thanh toán'
                    : negative
                      ? 'Dự kiến cần thanh toán thêm'
                      : positive
                        ? 'Dự kiến được hoàn'
                        : 'Chênh lệch dự kiến'}
                </Text>
                <Text
                  style={[
                    styles.balanceValue,
                    positive && styles.balancePositive,
                    negative && styles.balanceNegative,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {completed ? formatContractMoney('0') : signedMoney(proposal.signedBalance)}
                </Text>
                <Text style={styles.subtle}>
                  Cọc đã xác minh: {formatContractMoney(proposal.verifiedDeposit)}
                </Text>
              </View>
            </View>
            {!completed && (
              <Text style={styles.subtle}>
                Số tiền dự kiến; Owner sẽ đối chiếu thanh toán và hoàn cọc riêng.
              </Text>
            )}
          </View>

          {proposal.tenantFeedback && (
            <View style={styles.statusCard}>
              <Text style={styles.sectionTitle}>Phản hồi của bạn</Text>
              <Text style={styles.note}>
                {proposal.tenantFeedback.confirmed
                  ? 'Đã đồng ý với đề xuất'
                  : 'Đã yêu cầu Owner xem lại'}
              </Text>
              {!!proposal.tenantFeedback.reason && (
                <Text style={styles.subtle}>{proposal.tenantFeedback.reason}</Text>
              )}
              {proposal.tenantFeedback.disputedItems?.map((item, index) => (
                <Text
                  key={`${item.kind}:${item.assetId ?? item.roomCheckCode ?? item.accessType}:${index}`}
                  style={styles.subtle}
                >
                  {proposalItemName({ ...item, amount: '0' }, currentItemLabels)}: {item.reason}
                </Text>
              ))}
            </View>
          )}

          {current.view.status === 'Accepted' &&
            proposal.tenantFeedback?.settlement?.status === 'RefundEligible' &&
            /^[1-9]\d*(?:\.0+)?$/.test(proposal.tenantFeedback.settlement.refundAmount) && (
              <View style={styles.statusCard}>
                <Text style={styles.sectionTitle}>Đề nghị hoàn tiền cọc</Text>
                <Text style={styles.note}>
                  Bạn đã xác nhận đề xuất. Có thể gửi yêu cầu hoàn{' '}
                  {formatContractMoney(proposal.tenantFeedback.settlement.refundAmount)} cho Owner
                  xem xét.
                </Text>
                <Action
                  onPress={() =>
                    go('refund-requests', {
                      sourceContractId: contractId,
                      amount: proposal.tenantFeedback!.settlement!.refundAmount.replace(
                        /\.0+$/,
                        '',
                      ),
                      moveOutProposalId: proposal.id,
                      reason: 'Đề nghị hoàn cọc sau khi xác nhận quyết toán trả phòng.',
                    })
                  }
                >
                  Gửi đơn hoàn tiền
                </Action>
              </View>
            )}

          {!completed &&
            current.view.status === 'Accepted' &&
            proposal.tenantFeedback?.settlement?.status === 'Payable' &&
            proposal.tenantFeedback.settlement.payableReceivableId &&
            /^[1-9]\d*(?:\.0+)?$/.test(proposal.tenantFeedback.settlement.payableAmount) && (
              <TenantMoveOutExcessPayment
                contractId={contractId}
                chargeId={proposal.tenantFeedback.settlement.payableReceivableId}
                payableAmount={proposal.tenantFeedback.settlement.payableAmount}
              />
            )}
          {current.view.status === 'Accepted' &&
            proposal.tenantFeedback?.settlement?.status === 'Settled' && (
              <View style={styles.statusCard}>
                <Text style={styles.note}>
                  Đã đối chiếu xong phí trả phòng và tiền cọc. Không còn khoản cần thanh toán hoặc
                  hoàn thêm theo quyết toán này.
                </Text>
              </View>
            )}
          {(current.view.status === 'Accepted' || legacyReconcileEligible) &&
            (!proposal.tenantFeedback?.settlement ||
              proposal.tenantFeedback.settlement.status === 'PendingOwnerReview') && (
              <View style={styles.statusCard}>
                <Text style={styles.sectionTitle}>
                  {legacyReconcileEligible && activeReconcile?.status === 'running'
                    ? 'Đang tự động hoàn tất quyết toán'
                    : 'Đang chờ đối chiếu quyết toán'}
                </Text>
                {legacyReconcileEligible && activeReconcile?.status === 'running' ? (
                  <Text style={styles.subtle}>
                    Hệ thống đang kiểm tra lại phí và cấn trừ cọc đã được xác nhận để cấp mã thanh
                    toán chính xác.
                  </Text>
                ) : (
                  <Text style={styles.subtle}>
                    {legacyReconcileEligible && activeReconcile?.status === 'failed'
                      ? 'Chưa thể hoàn tất đối chiếu tự động. Đề xuất đã đồng ý vẫn được lưu; khoản thanh toán sẽ chỉ xuất hiện khi máy chủ xác minh xong.'
                      : 'Owner cần kiểm tra các khoản thu và cấn trừ cọc trước khi hệ thống có thể cấp mã thanh toán hoặc xác nhận số tiền hoàn.'}
                  </Text>
                )}
              </View>
            )}

          {canRespond && (
            <View style={styles.actions}>
              {!decision && (
                <>
                  <Action disabled={submitting} onPress={() => choose('accept')}>
                    Đồng ý với đề xuất
                  </Action>
                  <Action secondary disabled={submitting} onPress={() => choose('dispute')}>
                    Yêu cầu xem xét lại
                  </Action>
                </>
              )}
              {decision === 'accept' && (
                <View style={styles.feedbackForm}>
                  <Text style={styles.sectionTitle}>Xác nhận ý kiến</Text>
                  <Checkbox.Item
                    label="Tôi đã xem các khoản thu và đồng ý"
                    status={confirmed ? 'checked' : 'unchecked'}
                    onPress={() => setConfirmed((value) => !value)}
                    position="leading"
                    style={styles.checkbox}
                    labelStyle={styles.note}
                    disabled={submitting}
                  />
                  <Action disabled={submitting || !confirmed} onPress={() => void submit(true)}>
                    Gửi xác nhận đồng ý
                  </Action>
                  <Button
                    disabled={submitting}
                    onPress={() => {
                      setSelection(null);
                      setConfirmed(false);
                    }}
                  >
                    Quay lại
                  </Button>
                </View>
              )}
              {decision === 'dispute' && (
                <View style={styles.feedbackForm}>
                  <Text style={styles.sectionTitle}>Yêu cầu Owner xem lại</Text>
                  <Text style={styles.subtle}>
                    Chọn từng khoản chưa đồng ý và ghi lý do để Owner kiểm tra, điều chỉnh rồi gửi
                    lại.
                  </Text>
                  {proposal.items.map((item, index) => (
                    <View key={`${proposal.id}:dispute:${index}`} style={styles.section}>
                      <Checkbox.Item
                        label={`${proposalItemName(item, currentItemLabels)} · ${formatContractMoney(item.amount)}`}
                        status={Object.hasOwn(disputedItems, index) ? 'checked' : 'unchecked'}
                        onPress={() =>
                          setDisputedItems((currentItems) => {
                            const next = { ...currentItems };
                            if (Object.hasOwn(next, index)) delete next[index];
                            else next[index] = '';
                            return next;
                          })
                        }
                        position="leading"
                        style={styles.checkbox}
                        labelStyle={styles.note}
                        disabled={submitting}
                      />
                      {Object.hasOwn(disputedItems, index) && (
                        <TextInput
                          mode="outlined"
                          multiline
                          label={`Lý do chưa đồng ý ${proposalItemName(item, currentItemLabels)}`}
                          value={disputedItems[index]}
                          onChangeText={(value) =>
                            setDisputedItems((currentItems) => ({
                              ...currentItems,
                              [index]: value,
                            }))
                          }
                          maxLength={1000}
                          disabled={submitting}
                          style={styles.reasonInput}
                        />
                      )}
                    </View>
                  ))}
                  <TextInput
                    mode="outlined"
                    multiline
                    label="Lý do yêu cầu xem xét lại"
                    value={reason}
                    onChangeText={setReason}
                    maxLength={2000}
                    disabled={submitting}
                    style={styles.reasonInput}
                  />
                  <Action
                    disabled={submitting || !disputeComplete}
                    onPress={() => void submit(false)}
                  >
                    Gửi yêu cầu xem xét lại
                  </Action>
                  <Button
                    disabled={submitting}
                    onPress={() => {
                      setSelection(null);
                      setReason('');
                    }}
                  >
                    Quay lại
                  </Button>
                </View>
              )}
            </View>
          )}
        </>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
      <Modal
        visible={!!detailItem}
        transparent
        animationType="slide"
        onRequestClose={() => setDetail(null)}
      >
        <View style={[styles.modalOverlay, phone && styles.phoneOverlay]}>
          <View style={[styles.modalSheet, phone && styles.phoneSheet]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeading} numberOfLines={2}>
                {detailItem ? proposalItemName(detailItem, currentItemLabels) : ''}
              </Text>
              <Button compact onPress={() => setDetail(null)}>
                Đóng
              </Button>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalBody}
            >
              {detailItem && (
                <>
                  <Text style={styles.modalAmount}>{formatContractMoney(detailItem.amount)}</Text>
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>Lý do thu</Text>
                    <Text style={styles.detailText}>{detailItem.reason}</Text>
                  </View>
                  {typeof detailInspection?.observed === 'string' && (
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Hiện tại</Text>
                      {comparisonLines(detailInspection.observed).map((line, index) => (
                        <Text key={`observed-${index}`} style={styles.detailText}>
                          {line}
                        </Text>
                      ))}
                    </View>
                  )}
                  {!!detailInspection?.evidenceIds?.length && (
                    <View style={styles.detailBlock}>
                      <Text style={styles.sectionTitle}>Ảnh bằng chứng</Text>
                      {detailInspection.evidenceIds.map((evidenceId, index) => (
                        <ContractEvidence
                          key={evidenceId}
                          api={api}
                          contractId={contractId}
                          evidenceId={evidenceId}
                          thumbnail
                          thumbnailHeight={205}
                          label={`Ảnh bằng chứng ${index + 1}`}
                        />
                      ))}
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
