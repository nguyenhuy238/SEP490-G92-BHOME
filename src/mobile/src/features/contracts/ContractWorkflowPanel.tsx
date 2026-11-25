import { ContractNotice } from './ContractNotice';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
  type ContractAudit,
  type DepositVerification,
  type PreviewDocument,
  type HoldingDepositStatus,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { ContractEvidence } from './ContractEvidence';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import type { Readiness } from '../../../../../packages/client-core/src/contracts';

const historyMilestones: Readonly<Partial<Record<string, string>>> = {
  HoldingDraftCreated: 'Lập bản nháp giữ chỗ',
  MainDraftCreated: 'Lập bản nháp hợp đồng',
  ContractDraftCreated: 'Lập bản nháp hợp đồng',
  HoldingApproved: 'Duyệt giữ chỗ',
  HoldingSigningSubmitted: 'Gửi lời mời ký',
  MainSigningSubmitted: 'Gửi lời mời ký',
  ContractSigningRequested: 'Gửi yêu cầu ký',
  InternalTenantAcceptanceRecorded: 'Người thuê đã ký',
  InternalOwnerAcceptanceConfirmed: 'Chủ cơ sở đã ký',
  ContractSignatureVerified: 'Xác minh chữ ký',
  ContractDepositVerified: 'Xác minh tiền cọc',
  HoldingActivated: 'Kích hoạt giữ chỗ',
  'Automatic:HoldingActivated': 'Kích hoạt giữ chỗ',
  ContractActivated: 'Kích hoạt hợp đồng',
  'Automatic:ContractActivated': 'Kích hoạt hợp đồng',
  HoldingCancelled: 'Hủy giữ chỗ',
  HoldingExpired: 'Hết hạn giữ chỗ',
  ContractCancelled: 'Hủy hợp đồng',
  HoldingConversionPrepared: 'Chuẩn bị hợp đồng thuê',
  ContractRenewalPrepared: 'Lập bản gia hạn',
  ContractRenewalCancelled: 'Hủy bản gia hạn',
  ContractHandoverCompleted: 'Hoàn tất nhận phòng',
  ContractMoveOutRequested: 'Gửi yêu cầu trả phòng',
  ContractMoveOutApproved: 'Duyệt yêu cầu trả phòng',
  ContractInspectionScheduled: 'Đặt lịch kiểm tra trả phòng',
  ContractMoveOutInspected: 'Lưu biên bản trả phòng',
  ContractSettlementReviewed: 'Xem xét quyết toán',
  ContractTerminationCompleted: 'Hoàn tất trả phòng',
};

export function ContractWorkflowPanel({
  api,
  contract,
  role,
  section = 'all',
  showDeposits = true,
  readiness,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
  section?: 'all' | 'documents' | 'history';
  showDeposits?: boolean;
  readiness?: Readiness | null;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<{
    previews: PreviewDocument[];
    deposits: DepositVerification[];
    audit: ContractAudit[];
  } | null>(null);
  const [error, setError] = useFeedbackState('warning', false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID)),
    lock = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const privileged = ['Owner', 'Tenant'].includes(role);
  const canPreview =
    privileged ||
    (role === 'Staff' &&
      contract.kind === 'Main' &&
      ['Draft', 'PendingSigning'].includes(contract.status));
  const documents = section !== 'history';
  const history = section !== 'documents';
  const holding = useWorkspaceQuery<HoldingDepositStatus>(
    contract.kind === 'Holding' ? `/api/v1/contracts/${contract.id}/holding-deposit` : null,
  );
  const room = useWorkspaceQuery<{ status: number }>(
    documents && contract.kind === 'Holding' && ['Owner', 'Staff'].includes(role)
      ? `/api/v1/rooms/${contract.roomId}`
      : null,
  );
  const versions = useWorkspaceQuery<Awaited<ReturnType<ContractClient['versions']>>>(
    history ? `/api/v1/contracts/${contract.id}/versions` : null,
  );
  const milestones = (data?.audit ?? []).flatMap((event) => {
    const label = Object.hasOwn(historyMilestones, event.action) && historyMilestones[event.action];
    return label ? [{ label, at: event.occurredAt }] : [];
  });
  const versionRows = versions.data ?? [];
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [previews, deposits, audit] = await Promise.all([
          canPreview && documents ? api.previews(contract.id, c.signal) : Promise.resolve([]),
          privileged && documents && showDeposits
            ? api.deposits(contract.id, c.signal)
            : Promise.resolve([]),
          history ? api.audit(contract.id, c.signal) : Promise.resolve([]),
        ]);
        if (!c.signal.aborted) setData({ previews, deposits, audit });
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [api, contract, privileged, canPreview, documents, history, showDeposits, revision, setError]);
  async function preview() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.mutate(contract.id, 'previews', undefined, keys.get('preview', contract.id));
      keys.confirmed('preview', contract.id);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {contract.kind === 'Holding' && (documents || !!holding.data || !!holding.error) && (
        <Box>
          <Heading title="Tình trạng cọc giữ chỗ" />
          {documents && <Text>Cọc yêu cầu: {formatContractMoney(contract.requiredDeposit)}</Text>}
          {documents && !contract.approvedAt && contract.status === 'Draft' && (
            <Text>Chờ Owner phê duyệt. Bản nháp chưa giữ phòng.</Text>
          )}
          {room.data && (
            <Text>
              Trạng thái phòng:{' '}
              {['Trống', 'Đang giữ chỗ', 'Đang thuê', 'Không sẵn sàng'][room.data.status] ??
                'Chưa xác định'}
            </Text>
          )}
          {!!room.error && <ContractNotice message={room.error} />}
          {!!holding.error && <ContractNotice message={holding.error} />}
          {holding.data?.disposition && (
            <>
              {documents && (
                <>
                  <Text>
                    {holding.data.disposition.cause === 'TenantVoluntary'
                      ? 'Tenant tự nguyện hủy — cọc không hoàn'
                      : 'Owner không cung cấp được phòng — phải hoàn cọc'}
                  </Text>
                  <Text>
                    Cọc không hoàn: {formatContractMoney(holding.data.disposition.forfeitedAmount)}{' '}
                    · Phải hoàn: {formatContractMoney(holding.data.disposition.refundRequired)}
                  </Text>
                  <Text>
                    Đã hoàn: {formatContractMoney(holding.data.disposition.refunded)} · Đang giữ cho
                    yêu cầu hoàn: {formatContractMoney(holding.data.disposition.reserved)}
                  </Text>
                </>
              )}
              <Text>
                {(
                  {
                    Forfeited: 'Đã ghi nhận mất cọc',
                    RefundPending: 'Chờ Owner xử lý hoàn',
                    RefundReserved: 'Đang chờ thực chi',
                    RefundCompleted: 'Đã xác minh thực chi hoàn cọc',
                    NotRequired: 'Không có tiền cọc cần xử lý',
                    PendingManualReview: 'Cần Owner đối chiếu',
                  } as Record<string, string>
                )[holding.data.disposition.status] ?? 'Cần đối chiếu trạng thái'}
              </Text>
            </>
          )}
          {holding.data && !holding.data.disposition && (
            <Text>
              Đã xác minh: {formatContractMoney(holding.data.verified)} · Còn thiếu:{' '}
              {formatContractMoney(holding.data.remaining)}
            </Text>
          )}
          {role === 'Owner' &&
            documents &&
            contract.approvedAt &&
            readiness &&
            !readiness.blockers.includes('verified_signature_evidence_required') &&
            holding.data &&
            !/^0(?:\.0+)?$/.test(holding.data.remaining) &&
            ['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status) && (
              <OwnerWebNotice task="Phân bổ giao dịch và đối soát cọc giữ chỗ" />
            )}
          {documents && (
            <Action secondary onPress={holding.reload}>
              Tải lại cọc giữ chỗ
            </Action>
          )}
        </Box>
      )}
      {history && (versionRows.length > 1 || !!versions.error) && (
        <Box>
          <Heading title="Các phiên bản hợp đồng" />
          {!!versions.error && <ContractNotice message={versions.error} />}
          {(expanded ? versionRows : versionRows.slice(0, 3)).map((v) => (
            <Text key={v.id}>
              {text(v.status)}
              {v.id === contract.id ? ' (đang xem)' : ''} · {displayContractDate(v.startDate)} →{' '}
              {displayContractDate(v.endDate)}
            </Text>
          ))}
        </Box>
      )}
      {loading && <Text>{documents ? 'Đang tải tài liệu…' : 'Đang tải lịch sử…'}</Text>}
      {!!error && <ContractNotice message={error} />}
      {documents && canPreview && (
        <Box>
          <Heading title="Xem trước hợp đồng" detail="Bản PDF theo nội dung hợp đồng đã lưu" />
          <Action disabled={loading || busy} onPress={() => void preview()}>
            {busy
              ? 'Đang tạo…'
              : data?.previews.length
                ? 'Tạo lại bản xem trước'
                : 'Tạo bản xem trước'}
          </Action>
          {!loading && !data?.previews.length && <Text>Chưa có bản xem trước.</Text>}
          {data?.previews.map((f) => (
            <Box key={f.id}>
              <Text>Bản xem trước · {formatInstant(f.recordedAt)}</Text>
              <ContractEvidence
                api={api}
                contractId={contract.id}
                contractKind={contract.kind}
                previewId={f.id}
                pdf
              />
            </Box>
          ))}
        </Box>
      )}
      {documents && privileged && showDeposits && (
        <Box>
          <Heading title="Cọc đã xác minh" />
          {!data?.deposits.length && <Text>Chưa có khoản cọc được xác minh.</Text>}
          {data?.deposits.map((d) => (
            <Box key={d.id}>
              <Text>
                {formatContractMoney(d.amount)} · {d.bankTransactionReference}
              </Text>
              <Text>{d.verificationReason}</Text>
              <Text>{formatInstant(d.verifiedAt)}</Text>
            </Box>
          ))}
        </Box>
      )}
      {history && (
        <Box>
          <Heading title="Lịch sử hợp đồng" />
          {(expanded ? milestones : milestones.slice(0, 5)).map((event, i) => (
            <Text key={i}>
              {event.label} · {formatInstant(event.at)}
            </Text>
          ))}
          {!loading && !error && !milestones.length && <Text>Chưa có mốc lịch sử.</Text>}
          {(milestones.length > 5 || versionRows.length > 3) && (
            <Action secondary onPress={() => setExpanded((value) => !value)}>
              {expanded ? 'Thu gọn' : 'Xem thêm lịch sử'}
            </Action>
          )}
          <Action
            secondary
            disabled={loading || busy}
            onPress={() => {
              versions.reload();
              if (contract.kind === 'Holding') holding.reload();
              setRevision((v) => v + 1);
            }}
          >
            Tải lại lịch sử
          </Action>
        </Box>
      )}
    </>
  );
}
