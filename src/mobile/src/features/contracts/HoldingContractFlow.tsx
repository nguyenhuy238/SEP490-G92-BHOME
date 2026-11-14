import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Text } from 'react-native-paper';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
  type Readiness,
  type PreviewDocument,
  type HoldingDepositStatus,
} from '../../../../../packages/client-core/src/contracts';
import {
  internalSigningClient,
  signingMessage,
  type InternalSigningStatus,
} from '../../../../../packages/client-core/src/internalSigning';
import { paymentClient } from '../../../../../packages/client-core/src/payments';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { mobileContractActions } from './contractSections';
import { ContractActionForm, SigningCertificates } from './ContractActionForm';
import { ContractEvidence } from './ContractEvidence';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import { HoldingProgress } from './HoldingProgress';
import { holdingStage, holdingStageLabel } from './holdingStage';
import { HoldingSandboxFlow, useHoldingSandbox } from './HoldingSandboxFlow';
import { HoldingSigningConfirmation } from './HoldingSigningConfirmation';

const signed = (c: ContractView) => ['PendingActivation', 'Active'].includes(c.status);
// Invitation creation has no backend idempotency key. Retain ambiguous attempts across
// navigation/refresh within this app session; only a confirmed active invitation clears it.
const pendingInvitations = new Set<string>();
export function invitationLabel(status: string) {
  return (
    (
      {
        OwnerApprovedLink: 'Đã tạo lời mời · Chưa xác nhận gửi email',
        InvitationAcceptedByProvider: 'Dịch vụ email đã tiếp nhận lời mời',
        InvitationPendingManualDelivery: 'Chưa gửi được email · Owner cần kiểm tra',
        OtpPendingDelivery: 'Đang gửi mã OTP',
        OtpAcceptedByProvider: 'Dịch vụ email đã tiếp nhận mã OTP',
        OtpVerified: 'Đã xác minh OTP',
        Accepted: 'Người giữ chỗ đã ký',
        Expired: 'Lời mời đã hết hạn',
        Revoked: 'Lời mời đã thu hồi',
      } as Record<string, string>
    )[status] ?? 'Chưa xác định trạng thái gửi lời mời'
  );
}
function liveInvitation(s: InternalSigningStatus) {
  return s.invitations.some((i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status));
}
function invitationExpiry(holdingExpiresAt?: string | null) {
  // Called only by the invitation event, matching Owner Web's one-hour window.
  return new Date(
    Math.min(Date.now() + 3600000, Date.parse(holdingExpiresAt ?? '') || Infinity),
  ).toISOString();
}

export function HoldingContractFlow({
  api,
  contract: c,
  readiness,
  role,
  actorId,
  onChanged,
  onList,
}: {
  api: ContractClient;
  contract: ContractView;
  readiness: Readiness | null;
  role: string;
  actorId: string;
  onChanged: () => void;
  onList: () => void;
}) {
  // Reopening always resumes from persisted backend state, never by posting another draft.
  const step = holdingStage(c);
  const [operation, setOperation] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const actions = mobileContractActions(c, null, role, actorId);
  const action = actions.find((a) => a.operation === operation);
  const owner = role === 'Owner' && c.ownerSignerId === actorId;
  const internal = c.signingMode === 'INTERNAL_OTP_DRAWN';
  const representative = c.occupants?.find((r) => r.representative)?.label;
  const sandbox = useHoldingSandbox(api, c, role !== 'Owner');
  const operations =
    step === 5
      ? ['holding-approval']
      : step === 6 && !internal
        ? ['signing', 'signing/sync', 'signing/recover']
        : step >= 7 && signed(c)
          ? [
              'holding-activation',
              ...(c.approvedAt &&
              readiness &&
              !readiness.blockers.includes('verified_signature_evidence_required')
                ? ['deposit-verifications']
                : []),
            ]
          : [];
  if (sandbox.data)
    return (
      <HoldingSandboxFlow
        key={`${c.id}:${c.snapshotHash}`}
        api={api}
        contract={c}
        sandbox={sandbox}
        onChanged={onChanged}
        onList={onList}
      />
    );
  return (
    <>
      <Box>
        <Heading title={`Phòng ${c.roomNumber || '—'}`} detail={c.locationName} />
        <Text style={ui.blue}>{holdingStageLabel(c)}</Text>
        <ReadOnly label="Người giữ chỗ" value={representative} />
        <ReadOnly
          label="Thời gian"
          value={`${displayContractDate(c.startDate)} – ${displayContractDate(c.endDate)}`}
        />
        <ReadOnly label="Tiền giữ chỗ" value={formatContractMoney(c.requiredDeposit)} />
      </Box>
      <HoldingProgress current={step - 1} />
      {c.isDevelopmentDemo && (
        <Text style={ui.red}>Hợp đồng minh họa · Không dùng để ký hoặc thanh toán thực tế.</Text>
      )}
      {step === 5 && owner && <HoldingDraftDocument api={api} contract={c} role={role} />}
      {step === 5 && !owner && <Text style={ui.muted}>Đang chờ Owner phê duyệt hợp đồng.</Text>}
      {step === 6 && internal && role === 'Staff' && (
        <HoldingSigningConfirmation
          key={`${c.id}:${c.snapshotHash}`}
          api={api}
          contract={c}
          onChanged={onChanged}
          onContinue={onChanged}
        />
      )}
      {step === 6 && internal && owner && (
        <HoldingInternalSigning
          key={`${c.id}:${c.snapshotHash}`}
          api={api}
          contract={c}
          owner={owner}
          onChanged={onChanged}
        />
      )}
      {step === 6 && !internal && (
        <>
          <Box>
            <Text>Hợp đồng sử dụng phương thức ký số đã cấu hình.</Text>
          </Box>
          {owner && c.approvedAt && <SigningCertificates api={api} />}
          {owner && <ContractEvidence api={api} contractId={c.id} pdf />}
        </>
      )}
      {step >= 7 && signed(c) && (
        <HoldingPayment
          api={api}
          contract={c}
          role={role}
          owner={owner}
          readiness={readiness}
          onList={onList}
        />
      )}
      {actions
        .filter((a) => operations.includes(a.operation))
        .map((a) => (
          <Action
            key={a.operation}
            disabled={a.operation === 'holding-activation' && !readiness?.ready}
            onPress={() => setOperation(a.operation)}
          >
            {a.label}
          </Action>
        ))}
      {action && operations.includes(action.operation) && (
        <ContractActionForm
          key={action.operation}
          api={api}
          action={action}
          contract={c}
          keys={keys}
          evidenceIds={[]}
          onCancel={() => setOperation('')}
          onSuccess={() => {
            setOperation('');
            onChanged();
          }}
        />
      )}
    </>
  );
}

function ReadOnly({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[ui.muted, { flexShrink: 1 }]}>{label}</Text>
      <Text style={{ fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>
        {value || 'Chưa có thông tin'}
      </Text>
    </View>
  );
}

function HoldingDraftDocument({
  api,
  contract: c,
  role,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
}) {
  const [previews, setPreviews] = useState<PreviewDocument[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  useEffect(() => {
    if (role !== 'Owner') return;
    const controller = new AbortController();
    void api
      .previews(c.id, controller.signal)
      .then(setPreviews)
      .catch((e) => {
        if (!controller.signal.aborted) setError(contractError(e));
      });
    return () => controller.abort();
  }, [api, c.id, role]);
  async function generate() {
    if (lock.current || role !== 'Owner') return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      // Fetch first: a preview may already exist after a lost response or reopening.
      const current = await api.previews(c.id);
      if (!current.some((p) => p.snapshotHash === c.snapshotHash)) {
        await api.mutate(c.id, 'previews', undefined, keys.get('preview', c.id));
        keys.confirmed('preview', c.id);
      }
      setPreviews(await api.previews(c.id));
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const current = previews?.filter((p) => p.snapshotHash === c.snapshotHash);
  return (
    <Box>
      <Heading title="Xem bản nháp" detail="Hợp đồng giữ chỗ" />
      {role !== 'Owner' ? (
        <Text>Owner sẽ kiểm tra và phê duyệt bản hợp đồng.</Text>
      ) : (
        <>
          {!previews && !error && <Text>Đang tải tài liệu…</Text>}
          {!current?.length && (
            <Action disabled={busy} onPress={() => void generate()}>
              {busy ? 'Đang tải…' : 'Xem hợp đồng'}
            </Action>
          )}
          {current?.map((p) => (
            <React.Fragment key={p.id}>
              {p.developmentOnly && (
                <Text style={ui.muted}>Tài liệu Development · Chưa duyệt cho production</Text>
              )}
              <ContractEvidence
                api={api}
                contractId={c.id}
                previewId={p.id}
                pdf
                label="Xem hợp đồng"
              />
            </React.Fragment>
          ))}
        </>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
    </Box>
  );
}

function HoldingInternalSigning({
  api,
  contract: c,
  owner,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  owner: boolean;
  onChanged: () => void;
}) {
  const service = useMemo(() => internalSigningClient(api.transport), [api]);
  const [status, setStatus] = useState<InternalSigningStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const invitationScope = `${c.id}:${c.snapshotHash}`;
  const [uncertain, setUncertain] = useState(pendingInvitations.has(invitationScope));
  const lock = useRef(false);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    void service
      .status(c.id)
      .then((s) => {
        if (active) {
          setStatus(s);
          if (liveInvitation(s) || s.tenantAcceptedAt) {
            pendingInvitations.delete(invitationScope);
            setUncertain(false);
          }
        }
      })
      .catch((e) => {
        if (active) {
          setStatus(null);
          setError(signingMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [service, c.id, c.status, owner, invitationScope]);
  async function run(kind: 'invite' | 'confirm' | 'refresh', invitationId?: string) {
    if (lock.current || !owner) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const latest = await service.status(c.id);
      setStatus(latest);
      if (invitationId) await service.revoke(c.id, invitationId);
      else if (
        kind === 'invite' &&
        !uncertain &&
        !pendingInvitations.has(invitationScope) &&
        !liveInvitation(latest) &&
        !latest.tenantAcceptedAt &&
        c.approvedAt &&
        c.snapshotHash &&
        reviewed
      ) {
        const expiresAt = invitationExpiry(c.holdingExpiresAt);
        setUncertain(true);
        pendingInvitations.add(invitationScope);
        try {
          await service.invite(c.id, c.snapshotHash, expiresAt);
        } catch (e) {
          const failure = e as { status?: number; code?: string; problem?: { code?: string } };
          const code = failure.code ?? failure.problem?.code;
          // This rejection happens before creating an invitation. Network/unknown
          // failures remain ambiguous and must never cause an automatic resend.
          if (
            (failure.status && failure.status >= 400 && failure.status < 500) ||
            code === 'signing_otp_key_not_configured'
          ) {
            pendingInvitations.delete(invitationScope);
            setUncertain(false);
          }
          throw e;
        }
        // Discard the one-time token. Backend provides no displayable invitation URL.
        pendingInvitations.delete(invitationScope);
        setUncertain(false);
      } else if (
        kind === 'confirm' &&
        latest.tenantAcceptedAt &&
        !latest.ownerAcceptedAt &&
        latest.documentHash &&
        reviewed
      ) {
        await service.ownerConfirm(c.id, latest.documentHash);
      }
      const confirmed = await service.status(c.id);
      setStatus(confirmed);
      if (liveInvitation(confirmed) || confirmed.tenantAcceptedAt) {
        pendingInvitations.delete(invitationScope);
        setUncertain(false);
      }
      onChanged();
    } catch (e) {
      setStatus(null);
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const completed = [
    !!c.approvedAt,
    !!status?.invitations.length,
    !!status?.tenantAcceptedAt,
    !!status?.ownerAcceptedAt,
  ];
  const canInvite =
    !!status &&
    !liveInvitation(status) &&
    !status.tenantAcceptedAt &&
    !uncertain &&
    !!c.approvedAt &&
    !!c.snapshotHash &&
    ['Draft', 'PendingSigning'].includes(c.status);
  return (
    <>
      <Box>
        <Heading title="Tiến trình ký" />
        {owner && status && (
          <Text style={ui.blue}>
            {status.ownerAcceptedAt
              ? 'Đã hoàn tất xác nhận hợp đồng'
              : status.tenantAcceptedAt
                ? 'Người giữ chỗ đã ký · Chờ Owner xác nhận'
                : liveInvitation(status)
                  ? 'Đã tạo lời mời · Chờ người giữ chỗ ký'
                  : 'Chưa có lời mời ký còn hiệu lực'}
          </Text>
        )}
        {owner &&
          [
            'Owner phê duyệt',
            'Đã tạo lời mời ký',
            'Người giữ chỗ hoàn tất ký',
            'Owner xác nhận',
          ].map((label, i) => (
            <Text
              key={label}
              style={
                completed[i] ? ui.green : owner && status && completed[i - 1] ? ui.blue : ui.muted
              }
            >
              {completed[i] ? '✓ ' : '○ '}
              {label}
            </Text>
          ))}
        {!owner && (
          <Text>
            {c.status === 'PendingSigning'
              ? 'Đang chờ người giữ chỗ ký và Owner xác nhận.'
              : 'Owner đã phê duyệt. Đang chờ Owner gửi lời mời ký.'}
          </Text>
        )}
        {!!error && <Text style={ui.red}>{error}</Text>}
      </Box>
      {owner && (
        <>
          <Box>
            <Heading title="Lời mời ký" />
            <ReadOnly
              label="Người nhận"
              value={c.occupants?.find((r) => r.representative)?.label}
            />
            <Text>
              Lời mời dùng email đã xác minh trong hồ sơ. Người giữ chỗ mở liên kết nhận qua email
              để xác minh OTP, đọc PDF và vẽ chữ ký.
            </Text>
            {status?.invitations.map((i) => (
              <View key={i.id}>
                <Text style={i.status === 'InvitationPendingManualDelivery' ? ui.red : ui.muted}>
                  {invitationLabel(i.status)}
                </Text>
                <Text>Hết hạn: {formatInstant(i.expiresAt)}</Text>
                {!['Expired', 'Revoked', 'Accepted'].includes(i.status) &&
                  !status.tenantAcceptedAt && (
                    <Button disabled={busy} onPress={() => void run('refresh', i.id)}>
                      Thu hồi lời mời
                    </Button>
                  )}
              </View>
            ))}
            {uncertain && (
              <Text style={ui.red}>
                Chưa xác định kết quả tạo lời mời. Hãy làm mới và kiểm tra với Owner trước khi tạo
                lại; hệ thống không tự gửi lại.
              </Text>
            )}
            <HoldingDraftDocument api={api} contract={c} role="Owner" />
            <Checkbox.Item
              label="Tôi đã đọc đúng PDF và đồng ý nội dung hợp đồng"
              status={reviewed ? 'checked' : 'unchecked'}
              disabled={busy}
              onPress={() => setReviewed((v) => !v)}
            />
            {!status?.tenantAcceptedAt && (
              <Action disabled={busy || !reviewed || !canInvite} onPress={() => void run('invite')}>
                Tạo lời mời ký
              </Action>
            )}
          </Box>
          {!!status?.tenantAcceptedAt && (
            <Box>
              <Heading title="Xác nhận của Owner" />
              <Text>Người giữ chỗ đã ký: {formatInstant(status.tenantAcceptedAt)}</Text>
              <ContractEvidence api={api} contractId={c.id} pdf label="Xem hợp đồng đã ký" />
              {status.ownerAcceptedAt ? (
                <Text>Owner đã xác nhận: {formatInstant(status.ownerAcceptedAt)}</Text>
              ) : (
                <Action
                  disabled={busy || !reviewed || !status.documentHash}
                  onPress={() => void run('confirm')}
                >
                  Xác nhận chấp thuận
                </Action>
              )}
            </Box>
          )}
        </>
      )}
    </>
  );
}

function HoldingPayment({
  api,
  contract: c,
  role,
  owner,
  readiness,
  onList,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
  owner: boolean;
  readiness: Readiness | null;
  onList: () => void;
}) {
  const [data, setData] = useState<{ deposit: HoldingDepositStatus; room: number } | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.transport<HoldingDepositStatus>(`/api/v1/contracts/${c.id}/holding-deposit`, {
        signal: controller.signal,
      }),
      api.transport<{ status: number }>(`/api/v1/rooms/${c.roomId}`, { signal: controller.signal }),
    ])
      .then(([deposit, room]) => {
        if (!controller.signal.aborted) setData({ deposit, room: room.status });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(contractError(e));
        }
      });
    if (owner)
      void paymentClient(api.transport)
        .depositPosition(c.id, controller.signal)
        .then((p) => {
          if (!controller.signal.aborted) setReference(p.transferReference);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setReference(null);
            setError(contractError(e));
          }
        });
    return () => controller.abort();
  }, [api, c.id, c.roomId, c.status, readiness, owner]);
  const success = c.status === 'Active' && data?.room === 1;
  return (
    <>
      <Box>
        <Heading title={success ? 'Giữ chỗ thành công' : 'Theo dõi tiền cọc'} />
        {!data && !error && <Text>Đang kiểm tra thanh toán và phòng…</Text>}
        {data && (
          <>
            <ReadOnly label="Tiền cọc" value={formatContractMoney(data.deposit.required)} />
            <ReadOnly label="Đã xác minh" value={formatContractMoney(data.deposit.verified)} />
            <ReadOnly label="Còn thiếu" value={formatContractMoney(data.deposit.remaining)} />
            <Text>
              {data.deposit.status === 'Verified'
                ? 'Tiền cọc đã được xác minh'
                : 'Chờ đối chiếu tiền cọc'}
            </Text>
            {data.deposit.requiresManualReview && (
              <Text>Cần Owner kiểm tra và đối chiếu giao dịch.</Text>
            )}
            {success && (
              <Text style={ui.green}>Hợp đồng đã kích hoạt · Phòng đang giữ chỗ (OnHold).</Text>
            )}
            {success && reference && <ReadOnly label="Tham chiếu tiền cọc" value={reference} />}
          </>
        )}
        {!!error && <Text style={ui.red}>{error}</Text>}
      </Box>
      {!success && (
        <Box>
          <Heading title="Thông tin chuyển khoản" />
          {!!reference && <ReadOnly label="Nội dung chuyển khoản" value={reference} />}
          <Text>Liên hệ Owner để nhận thông tin chuyển khoản tiền giữ chỗ.</Text>
        </Box>
      )}
      {success && (
        <Button mode="contained" onPress={onList}>
          Hoàn tất
        </Button>
      )}
      {owner &&
        data &&
        !success &&
        readiness &&
        !readiness.blockers.includes('verified_signature_evidence_required') &&
        !/^0(?:\.0+)?$/.test(data.deposit.remaining) && (
          <OwnerWebNotice task="Đối chiếu và phân bổ tiền cọc giữ chỗ" />
        )}
      {!success && role === 'Staff' && (
        <Text>Owner sẽ đối chiếu tiền cọc và kích hoạt khi đủ điều kiện.</Text>
      )}
      {owner && readiness && !success && (
        <Box>
          <Heading title="Điều kiện kích hoạt" />
          {readiness.ready ? (
            <Text style={ui.green}>Đủ điều kiện để Owner kích hoạt</Text>
          ) : (
            readiness.blockers.map((blocker) => (
              <Text key={blocker} style={ui.red}>
                {text(blocker) === blocker
                  ? 'Cần Owner kiểm tra điều kiện hợp đồng trên hệ thống.'
                  : text(blocker)}
              </Text>
            ))
          )}
        </Box>
      )}
    </>
  );
}
