import { conciseMessage } from '../../lib/toast';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
  contractError,
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
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ContractEvidence } from './ContractEvidence';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { HoldingDepositAllocation } from './HoldingDepositAllocation';
import type { Readiness } from '../../../../../packages/client-core/src/contracts';

export function ContractWorkflowPanel({
  api,
  contract,
  role,
  section = 'all',
  showDeposits = true,
  readiness,
  onChanged,
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
  const [error, setError] = useFeedbackState(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID)),
    lock = useRef(false);
  const privileged = ['Owner', 'Tenant'].includes(role);
  const documents = section !== 'history';
  const history = section !== 'documents';
  const holding = useWorkspaceQuery<HoldingDepositStatus>(
    contract.kind === 'Holding' ? `/api/v1/contracts/${contract.id}/holding-deposit` : null,
  );
  const room = useWorkspaceQuery<{ status: number }>(
    contract.kind === 'Holding' && ['Owner', 'Staff'].includes(role)
      ? `/api/v1/rooms/${contract.roomId}`
      : null,
  );
  const versions = useWorkspaceQuery<Awaited<ReturnType<ContractClient['versions']>>>(
    history ? `/api/v1/contracts/${contract.id}/versions` : null,
  );
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [previews, deposits, audit] = await Promise.all([
          privileged && documents ? api.previews(contract.id, c.signal) : Promise.resolve([]),
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
  }, [api, contract, privileged, documents, history, showDeposits, revision, setError]);
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
      {contract.kind === 'Holding' && (
        <Box>
          <Heading title="Tình trạng cọc giữ chỗ" />
          <Text>Cọc yêu cầu: {formatContractMoney(contract.requiredDeposit)}</Text>
          {!contract.approvedAt && contract.status === 'Draft' && (
            <Text>Chờ Owner phê duyệt. Bản nháp chưa giữ phòng.</Text>
          )}
          {room.data && (
            <Text>
              Trạng thái phòng:{' '}
              {['Trống', 'Đang giữ chỗ', 'Đang thuê', 'Không sẵn sàng'][room.data.status] ??
                'Chưa xác định'}
            </Text>
          )}
          {!!room.error && <Text style={ui.red}>{conciseMessage(room.error)}</Text>}
          {!!holding.error && <Text style={ui.red}>{conciseMessage(holding.error)}</Text>}
          {holding.data?.disposition && (
            <>
              <Text>
                {holding.data.disposition.cause === 'TenantVoluntary'
                  ? 'Tenant tự nguyện hủy — cọc không hoàn'
                  : 'Owner không cung cấp được phòng — phải hoàn cọc'}
              </Text>
              <Text>
                Cọc không hoàn: {formatContractMoney(holding.data.disposition.forfeitedAmount)} ·
                Phải hoàn: {formatContractMoney(holding.data.disposition.refundRequired)}
              </Text>
              <Text>
                Đã hoàn: {formatContractMoney(holding.data.disposition.refunded)} · Đang giữ cho yêu
                cầu hoàn: {formatContractMoney(holding.data.disposition.reserved)}
              </Text>
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
              <HoldingDepositAllocation
                api={api}
                role={role}
                contract={contract}
                onChanged={() => {
                  holding.reload();
                  setRevision((value) => value + 1);
                  onChanged?.();
                }}
              />
            )}
          <Action secondary onPress={holding.reload}>
            Tải lại cọc giữ chỗ
          </Action>
        </Box>
      )}
      {history && (
        <Box>
          <Heading title="Các phiên bản hợp đồng" />
          {!!versions.error && <Text style={ui.red}>{conciseMessage(versions.error)}</Text>}
          {versions.data?.map((v) => (
            <Text key={v.id}>
              {text(v.kind)} · {text(v.status)} · {v.startDate} → {v.endDate}
              {v.monthlyRent !== null ? ' · ' + formatContractMoney(v.monthlyRent) : ''}
              {v.terms ? '\n' + v.terms : ''}
            </Text>
          ))}
          <Action secondary onPress={versions.reload}>
            Tải lại phiên bản
          </Action>
        </Box>
      )}
      {loading && <Text>Đang tải tài liệu và lịch sử…</Text>}
      {!!error && <Text style={ui.red}>{error}</Text>}
      {documents && privileged && (
        <Box>
          <Heading title="Bản hợp đồng PDF" detail="Nội dung hợp đồng đã lưu" />
          <Action disabled={busy} onPress={() => void preview()}>
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
              {f.developmentOnly && (
                <Text variant="bodySmall" style={ui.muted}>
                  Tài liệu Development · Chưa duyệt cho production
                </Text>
              )}
              <ContractEvidence api={api} contractId={contract.id} previewId={f.id} pdf />
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
          {data?.audit.map((a, i) => (
            <Text key={i}>
              {formatInstant(a.occurredAt)} ·{' '}
              {a.action === 'ContractOverviewFixtureCreated'
                ? 'Tạo dữ liệu minh họa để kiểm tra giao diện'
                : text(a.action)}
            </Text>
          ))}
          <Action secondary disabled={loading || busy} onPress={() => setRevision((v) => v + 1)}>
            Tải lại tài liệu và lịch sử
          </Action>
        </Box>
      )}
    </>
  );
}
