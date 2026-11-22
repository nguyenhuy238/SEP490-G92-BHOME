import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput } from 'react-native-paper';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { ContractEvidence } from './ContractEvidence';

type ProposalItem = {
  kind: 'Asset' | 'RoomCheck' | 'Access';
  assetId?: string | null;
  roomCheckCode?: string | null;
  accessType?: string | null;
  label?: string | null;
  amount: string;
  reason: string;
};

type TenantProposal = {
  id: string;
  items: ProposalItem[];
  verifiedDeposit: string;
  availableDeposit: string;
  existingOutstanding: string;
  totalCharges: string;
  signedBalance: string;
  note: string | null;
  tenantFeedback?: { proposalId: string; confirmed: boolean; reason: string } | null;
};

type ProposalView = {
  contractId: string;
  reference: string;
  verifiedDeposit: string;
  availableDeposit: string;
  existingOutstanding: string;
  status: 'None' | 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated';
  latestProposal: TenantProposal | null;
  items: {
    kind: string;
    assetId?: string | null;
    roomCheckCode?: string | null;
    accessType?: string | null;
    label: string;
    baseline?: string | null;
    observed?: string | null;
    evidenceIds?: string[];
  }[];
};

type DisplayState = {
  api: ContractClient;
  contractId: string;
  revision: number;
  view: ProposalView | null;
  error: string;
};

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

function proposalItemName(item: ProposalItem, view: ProposalView): string {
  const eligible = matchingInspectionItem(item, view);
  return (
    eligible?.label ||
    (item.kind === 'Asset'
      ? 'Tài sản trong phòng'
      : item.kind === 'RoomCheck'
        ? 'Tình trạng phòng'
        : 'Chìa khóa và quyền truy cập')
  );
}

function signedMoney(amount: string): string {
  const matched = /^(-?)(\d+)(?:\.0+)?$/.exec(amount);
  if (!matched) return 'Chưa xác định';
  return `${matched[1] ? '−' : '+'}${formatContractMoney(matched[2])}`;
}

function ProposalChargeRow({
  api,
  contractId,
  item,
  view,
}: {
  api: ContractClient;
  contractId: string;
  item: ProposalItem;
  view: ProposalView;
}) {
  const inspectionItem = matchingInspectionItem(item, view);
  return (
    <Box style={ui.soft}>
      <Text variant="titleSmall">{proposalItemName(item, view)}</Text>
      {typeof inspectionItem?.baseline === 'string' && (
        <Text>Lúc nhận phòng: {inspectionItem.baseline}</Text>
      )}
      {typeof inspectionItem?.observed === 'string' && (
        <Text>Khi trả phòng: {inspectionItem.observed}</Text>
      )}
      {(inspectionItem?.evidenceIds ?? []).map((evidenceId, index) => (
        <ContractEvidence
          key={evidenceId}
          api={api}
          contractId={contractId}
          evidenceId={evidenceId}
          label={`Ảnh đối chiếu · ${index + 1}`}
        />
      ))}
      <Text>Lý do thu: {item.reason}</Text>
      <Text style={ui.money}>Khoản thu đề xuất: {formatContractMoney(item.amount)}</Text>
    </Box>
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
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const keys = useRef(mutationKeys(randomUUID));
  const root = `/api/v1/contracts/${encodeURIComponent(contractId)}/move-out/receivables/proposal`;

  useEffect(() => {
    const controller = new AbortController();
    void api.transport<ProposalView>(root, { signal: controller.signal }).then(
      (view) => {
        if (!controller.signal.aborted)
          setSnapshot({ api, contractId, revision, view, error: '' });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setSnapshot({ api, contractId, revision, view: null, error: contractError(cause) });
      },
    );
    return () => controller.abort();
  }, [api, contractId, revision, root]);

  const current =
    snapshot?.api === api &&
    snapshot.contractId === contractId &&
    snapshot.revision === revision
      ? snapshot
      : null;
  const proposal = current?.view?.latestProposal;
  const canRespond = !!proposal && current?.view?.status === 'PendingTenant';
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
    setError('');
  }

  async function submit(accept: boolean) {
    if (lock.current || !canRespond || !current?.view || decision !== (accept ? 'accept' : 'dispute')) return;
    if (accept && !confirmed) {
      setError('Hãy xác nhận bạn đã đọc toàn bộ đề xuất trước khi đồng ý.');
      return;
    }
    if (!accept && (!reason.trim() || reason.trim().length > 2000)) {
      setError('Nhập lý do yêu cầu xem xét lại, tối đa 2.000 ký tự.');
      return;
    }
    const body = {
      proposalId: proposal.id,
      expectedReference: current.view.reference,
      confirmed: accept,
      reason: accept ? '' : reason.trim(),
    };
    const scope = `${contractId}/move-out/proposal/tenant-feedback`;
    lock.current = true;
    setSubmitting(true);
    setError('');
    try {
      await api.transport(`${root}/tenant-feedback`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keys.current.get(scope, body) },
        body: JSON.stringify(body),
      });
      keys.current.confirmed(scope, body);
      setSelection(null);
      setReason('');
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

  return (
    <Box>
      <Heading
        title="Đề xuất quyết toán trả phòng"
        detail="Owner gửi các khoản thu để bạn xem xét trước khi xử lý tiền cọc."
      />
      {!current && <Text>Đang tải đề xuất từ Owner…</Text>}
      {!!current?.error && <Text style={ui.red}>{current.error}</Text>}
      {current?.view && !proposal && (
        <Text style={ui.muted}>Owner chưa gửi đề xuất quyết toán cho hợp đồng này.</Text>
      )}
      {proposal && current?.view && (
        <>
          <Pill tone={canRespond ? 'amber' : current.view.status === 'Accepted' ? 'green' : 'neutral'}>
            {canRespond
              ? 'Chờ bạn phản hồi'
              : current.view.status === 'Accepted'
                ? 'Bạn đã đồng ý'
                : current.view.status === 'Disputed'
                  ? 'Đã yêu cầu xem xét lại'
                  : 'Đề xuất đã thay đổi, chờ Owner cập nhật'}
          </Pill>
          {current.view.status === 'Outdated' && (
            <Text style={ui.red}>
              Thông tin kiểm tra hoặc các khoản thu đã thay đổi. Các số tiền bên dưới thuộc đề xuất
              cũ. Chờ Owner gửi đề xuất mới.
            </Text>
          )}
          {proposal.items.map((item, index) => (
            <ProposalChargeRow
              key={`${item.kind}:${item.assetId ?? item.roomCheckCode ?? item.accessType ?? index}`}
              api={api}
              contractId={contractId}
              item={item}
              view={current.view!}
            />
          ))}
          {!proposal.items.length && <Text>Owner không đề xuất khoản thu bổ sung từ kiểm tra trả phòng.</Text>}
          {!!proposal.note && <Text>Ghi chú Owner: {proposal.note}</Text>}
          <Text>Cọc đã xác minh: {formatContractMoney(proposal.verifiedDeposit)}</Text>
          <Text>Cọc khả dụng để đối chiếu: {formatContractMoney(proposal.availableDeposit)}</Text>
          <Text>Tổng khoản thu đề xuất: {formatContractMoney(proposal.totalCharges)}</Text>
          <Text>
            Khoản phải thu hiện có còn nợ: {formatContractMoney(proposal.existingOutstanding)}
          </Text>
          <Text variant="titleMedium" style={ui.money}>
            Chênh lệch dự kiến (cọc khả dụng − khoản thu đề xuất − khoản còn nợ):{' '}
            {signedMoney(proposal.signedBalance)}
          </Text>
          {/^-[1-9]/.test(proposal.signedBalance) ? (
            <Text style={ui.red}>Số âm: dự kiến bạn cần thanh toán thêm phần chênh lệch.</Text>
          ) : /^\+?[1-9]/.test(proposal.signedBalance) ? (
            <Text style={ui.blue}>Số dương: dự kiến còn tiền cọc để Owner xử lý hoàn.</Text>
          ) : (
            <Text>Chưa có chênh lệch cần xử lý.</Text>
          )}
          <Text style={ui.muted}>
            Đây là đề xuất để xem xét. Việc cấn trừ, thanh toán hoặc hoàn tiền được đối chiếu và xác
            minh riêng trên máy chủ.
          </Text>
          {proposal.tenantFeedback && (
            <Text>
              Phản hồi gần nhất: {proposal.tenantFeedback.confirmed ? 'Đồng ý' : 'Yêu cầu xem xét lại'}
              {proposal.tenantFeedback.reason ? ` · ${proposal.tenantFeedback.reason}` : ''}
            </Text>
          )}
          {canRespond && !decision && (
            <>
              <Action disabled={submitting} onPress={() => choose('accept')}>
                Đồng ý với đề xuất
              </Action>
              <Action secondary disabled={submitting} onPress={() => choose('dispute')}>
                Yêu cầu xem xét lại
              </Action>
            </>
          )}
          {canRespond && decision === 'accept' && (
            <>
              <Text>Hãy kiểm tra từng khoản thu và số chênh lệch trước khi gửi ý kiến.</Text>
              <Action secondary onPress={() => setConfirmed((value) => !value)}>
                {confirmed ? '☑' : '☐'} Tôi đã xem và đồng ý với đề xuất này
              </Action>
              <Action disabled={submitting || !confirmed} onPress={() => void submit(true)}>
                Gửi xác nhận đồng ý
              </Action>
              <Action secondary disabled={submitting} onPress={() => { setSelection(null); setConfirmed(false); }}>
                Quay lại
              </Action>
            </>
          )}
          {canRespond && decision === 'dispute' && (
            <>
              <TextInput
                mode="outlined"
                multiline
                label="Lý do yêu cầu xem xét lại"
                value={reason}
                onChangeText={setReason}
                maxLength={2000}
                disabled={submitting}
              />
              <Action disabled={submitting || !reason.trim()} onPress={() => void submit(false)}>
                Gửi yêu cầu xem xét lại
              </Action>
              <Action secondary disabled={submitting} onPress={() => { setSelection(null); setReason(''); }}>
                Quay lại
              </Action>
            </>
          )}
        </>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action secondary disabled={submitting || !current} onPress={() => { setError(''); setRevision((value) => value + 1); }}>
        Tải lại đề xuất
      </Action>
    </Box>
  );
}
