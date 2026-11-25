import { ContractNotice } from './ContractNotice';
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Image, StyleSheet, View } from 'react-native';
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
import {
  paymentClient,
  type ContractDepositInstructions,
} from '../../../../../packages/client-core/src/payments';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Heading, ui } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { mobileContractActions } from './contractSections';
import { ContractActionForm, SigningCertificates } from './ContractActionForm';
import { ContractEvidence } from './ContractEvidence';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import { HoldingProgress } from './HoldingProgress';
import { holdingStage, holdingStageLabel } from './holdingStage';
import { HoldingSandboxFlow, useHoldingSandbox } from './HoldingSandboxFlow';
import { HoldingSigningConfirmation } from './HoldingSigningConfirmation';
import { ContractSigningStep } from './ContractSigningStep';
import {
  HoldingChecklistRow,
  HoldingInfoRow,
  HoldingSectionCard,
  HoldingStatusBadge,
} from './HoldingUi';
import { PaymentStatusCountdown, PAYMENT_STATUS_REFRESH_MS } from './PaymentStatusCountdown';

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
  onComplete,
}: {
  api: ContractClient;
  contract: ContractView;
  readiness: Readiness | null;
  role: string;
  actorId: string;
  onChanged: () => void;
  onList: () => void;
  onComplete?: () => void;
}) {
  // Reopening always resumes from persisted backend state, never by posting another draft.
  const [verifiedDepositContract, setVerifiedDepositContract] = useState<string | null>(null);
  const onDepositVerified = useCallback(
    (contractId: string) => setVerifiedDepositContract(contractId),
    [],
  );
  const depositVerified = verifiedDepositContract === c.id;
  const step = c.status === 'PendingActivation' && depositVerified ? 8 : holdingStage(c);
  const [operation, setOperation] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const actions = mobileContractActions(c, null, role, actorId);
  const action = actions.find((a) => a.operation === operation);
  const owner = role === 'Owner' && c.ownerSignerId === actorId;
  const internal = c.signingMode === 'INTERNAL_OTP_DRAWN';
  const sandbox = useHoldingSandbox(api, c, role !== 'Owner' && c.isDevelopmentDemo);
  const operations =
    step === 5
      ? []
      : step === 6 && !internal && c.isDevelopmentDemo
        ? ['signing', 'signing/sync', 'signing/recover']
        : step >= 7 && signed(c)
          ? [
              'holding-activation',
              ...(readiness && !readiness.blockers.includes('verified_signature_evidence_required')
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
        onList={onComplete ?? onList}
      />
    );
  return (
    <>
      <HoldingProgress current={step - 1} />
      <HoldingSectionCard title="Thông tin giữ chỗ">
        <Heading title={`Phòng ${c.roomNumber || '—'}`} detail={c.locationName} />
        <HoldingStatusBadge
          label={
            step === 5
              ? 'Bản nháp chờ gửi Owner ký'
              : c.status === 'PendingActivation' && depositVerified
                ? 'Đang hoàn tất giữ chỗ'
                : holdingStageLabel(c) || 'Đang xử lý hợp đồng'
          }
          tone={
            c.status === 'Active'
              ? 'success'
              : step === 5 || depositVerified
                ? 'warning'
                : 'neutral'
          }
        />
        <View style={holdingPaymentStyles.customer}>
          <Text style={holdingPaymentStyles.referenceLabel}>Người giữ chỗ</Text>
          <Text style={holdingPaymentStyles.customerName}>
            {c.holdingCustomer?.fullName || 'Chưa có thông tin khách hàng'}
          </Text>
          <ReadOnly label="Số CCCD" value={c.holdingCustomer?.maskedCitizenNumber} />
        </View>
        <ReadOnly
          label="Thời hạn giữ chỗ"
          value={`${displayContractDate(c.startDate)} – ${displayContractDate(c.endDate)}`}
        />
        {step < 7 && (
          <ReadOnly label="Tiền giữ chỗ" value={formatContractMoney(c.requiredDeposit)} />
        )}
      </HoldingSectionCard>
      {c.isDevelopmentDemo && (
        <Text style={ui.red}>Hợp đồng minh họa · Không dùng để ký hoặc thanh toán thực tế.</Text>
      )}
      {step === 5 && owner && <HoldingDraftDocument api={api} contract={c} role={role} />}
      {step === 5 && !owner && c.isDevelopmentDemo && (
        <HoldingSectionCard title="Yêu cầu ký của Owner">
          <HoldingStatusBadge label="Gửi Owner ký" tone="warning" />
          <Text style={ui.muted}>
            Nhập email người giữ chỗ để gửi lời mời ký. Owner và Tenant đều có thể ký trước; cần đủ
            chữ ký hai bên để tiếp tục thanh toán.
          </Text>
        </HoldingSectionCard>
      )}
      {(step === 5 || step === 6) && !c.isDevelopmentDemo && (
        <ContractSigningStep
          key={`${c.id}:${c.snapshotHash}`}
          api={api}
          contract={c}
          actorId={actorId}
          role={role}
          onChanged={onChanged}
          onContinue={onChanged}
        />
      )}
      {step === 6 && c.isDevelopmentDemo && internal && role === 'Staff' && (
        <HoldingSigningConfirmation
          key={`${c.id}:${c.snapshotHash}`}
          api={api}
          contract={c}
          onChanged={onChanged}
          onContinue={onChanged}
        />
      )}
      {step === 6 && c.isDevelopmentDemo && internal && owner && (
        <HoldingInternalSigning
          key={`${c.id}:${c.snapshotHash}`}
          api={api}
          contract={c}
          owner={owner}
          onChanged={onChanged}
        />
      )}
      {step === 6 && c.isDevelopmentDemo && !internal && (
        <>
          <HoldingSectionCard title="Ký hợp đồng">
            <HoldingStatusBadge label="Chờ ký số" tone="warning" />
            <Text style={ui.muted}>Hợp đồng sử dụng phương thức ký số đã cấu hình.</Text>
          </HoldingSectionCard>
          {owner && c.approvedAt && <SigningCertificates api={api} />}
          {owner && <ContractEvidence api={api} contractId={c.id} contractKind="Holding" pdf />}
        </>
      )}
      {step >= 7 && signed(c) && (
        <HoldingPayment
          onDepositVerified={onDepositVerified}
          key={c.id}
          api={api}
          contract={c}
          role={role}
          owner={owner}
          readiness={readiness}
          onList={onComplete ?? onList}
          onChanged={onChanged}
        />
      )}
      {actions.some((a) => operations.includes(a.operation)) && (
        <HoldingSectionCard title={step === 5 ? 'Phê duyệt hợp đồng' : 'Thao tác tiếp theo'}>
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
        </HoldingSectionCard>
      )}
      {action && operations.includes(action.operation) && (
        <ContractActionForm
          key={action.operation}
          api={api}
          action={action}
          contract={c}
          keys={keys}
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
  return <HoldingInfoRow label={label} value={value || 'Chưa có thông tin'} />;
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
    <HoldingSectionCard title="Bản nháp hợp đồng">
      <Text style={ui.muted}>Xem nội dung PDF trước khi ký và gửi lời mời ký.</Text>
      {role !== 'Owner' ? (
        <Text>Owner sẽ xem và ký bản hợp đồng.</Text>
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
              <ContractEvidence
                api={api}
                contractId={c.id}
                previewId={p.id}
                contractKind="Holding"
                pdf
                label="Xem hợp đồng"
              />
            </React.Fragment>
          ))}
        </>
      )}
      {!!error && <ContractNotice message={error} />}
    </HoldingSectionCard>
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
      <HoldingSectionCard title="Xác nhận ký hợp đồng">
        {owner && status && (
          <HoldingStatusBadge
            label={
              status.ownerAcceptedAt
                ? 'Đã hoàn tất xác nhận hợp đồng'
                : status.tenantAcceptedAt
                  ? 'Người giữ chỗ đã ký · Chờ Owner xác nhận'
                  : liveInvitation(status)
                    ? 'Đã tạo lời mời · Chờ người giữ chỗ ký'
                    : 'Chưa có lời mời ký còn hiệu lực'
            }
            tone={status.ownerAcceptedAt ? 'success' : 'warning'}
          />
        )}
        {!status && !error && <Text style={ui.muted}>Đang tải trạng thái ký…</Text>}
        {owner && (
          <>
            <HoldingInfoRow
              label="Người giữ chỗ"
              value={
                <HoldingStatusBadge
                  label={status?.tenantAcceptedAt ? 'Đã ký' : 'Chờ ký'}
                  tone={status?.tenantAcceptedAt ? 'success' : 'warning'}
                />
              }
            />
            {!!status?.tenantAcceptedAt && (
              <ReadOnly label="Thời gian ký" value={formatInstant(status.tenantAcceptedAt)} />
            )}
            <HoldingInfoRow
              label="Owner"
              value={
                <HoldingStatusBadge
                  label={status?.ownerAcceptedAt ? 'Đã xác nhận' : 'Chờ xác nhận'}
                  tone={status?.ownerAcceptedAt ? 'success' : 'warning'}
                />
              }
            />
            {!!status?.ownerAcceptedAt && (
              <ReadOnly label="Owner xác nhận" value={formatInstant(status.ownerAcceptedAt)} />
            )}
            <View style={{ borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 12, gap: 10 }}>
              <HoldingChecklistRow label="Owner phê duyệt bản nháp" complete={!!c.approvedAt} />
              <HoldingChecklistRow
                label="Đã tạo lời mời ký"
                complete={!!status?.invitations.length}
              />
              <HoldingChecklistRow
                label="Người giữ chỗ hoàn tất ký"
                complete={!!status?.tenantAcceptedAt}
              />
              <HoldingChecklistRow label="Owner xác nhận" complete={!!status?.ownerAcceptedAt} />
            </View>
          </>
        )}
        {!owner && (
          <Text>
            {c.status === 'PendingSigning'
              ? 'Đang chờ người giữ chỗ ký và Owner xác nhận.'
              : 'Owner đã phê duyệt. Đang chờ Owner gửi lời mời ký.'}
          </Text>
        )}
        {!!error && <ContractNotice message={error} />}
      </HoldingSectionCard>
      {owner && (
        <>
          <HoldingSectionCard title="Lời mời ký">
            <ReadOnly
              label="Người nhận"
              value={c.occupants?.find((r) => r.representative)?.label}
            />
            <Text style={ui.muted}>
              Gửi đến email đã xác minh. Người giữ chỗ xác minh OTP, đọc PDF và ký qua liên kết.
            </Text>
            {status?.invitations.map((i) => (
              <View
                key={i.id}
                style={{ gap: 6, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 10 }}
              >
                <HoldingStatusBadge
                  label={invitationLabel(i.status)}
                  tone={
                    i.status === 'InvitationPendingManualDelivery'
                      ? 'error'
                      : i.status === 'Accepted'
                        ? 'success'
                        : 'neutral'
                  }
                />
                <ReadOnly label="Hết hạn lời mời" value={formatInstant(i.expiresAt)} />
                {!['Expired', 'Revoked', 'Accepted'].includes(i.status) &&
                  !status.tenantAcceptedAt && (
                    <Button
                      mode="text"
                      compact
                      disabled={busy}
                      onPress={() => void run('refresh', i.id)}
                    >
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
          </HoldingSectionCard>
          {!!status?.tenantAcceptedAt && (
            <HoldingSectionCard title="Xác nhận của Owner">
              <HoldingStatusBadge label="Người giữ chỗ đã ký" tone="success" />
              <ReadOnly label="Thời điểm ký" value={formatInstant(status.tenantAcceptedAt)} />
              <ContractEvidence
                api={api}
                contractId={c.id}
                contractKind="Holding"
                pdf
                label="Xem hợp đồng đã ký"
              />
              {status.ownerAcceptedAt ? (
                <ReadOnly label="Owner đã xác nhận" value={formatInstant(status.ownerAcceptedAt)} />
              ) : (
                <Action
                  disabled={busy || !reviewed || !status.documentHash}
                  onPress={() => void run('confirm')}
                >
                  Xác nhận chấp thuận
                </Action>
              )}
            </HoldingSectionCard>
          )}
        </>
      )}
    </>
  );
}

function HoldingPayment({
  onDepositVerified,
  api,
  contract: c,
  role,
  owner,
  readiness,
  onList,
  onChanged,
}: {
  onDepositVerified: (contractId: string) => void;
  api: ContractClient;
  contract: ContractView;
  role: string;
  owner: boolean;
  readiness: Readiness | null;
  onList: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ deposit: HoldingDepositStatus; room: number } | null>(null);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const [reference, setReference] = useState<string | null>(null);
  const [qr, setQr] = useState<ContractDepositInstructions | null>(null);
  const [qrError, setQrError] = useState('');
  const [qrRevision, setQrRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (c.status !== 'Active')
      void paymentClient(api.transport)
        .depositInstructions(c.id, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setQr(result);
            setQrError('');
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            const problem = e as { status?: number; code?: string; problem?: { code?: string } };
            const code = problem.code ?? problem.problem?.code ?? '';
            setQrError(
              code === 'sepay_environment_mismatch'
                ? 'Cấu hình SePay hiện tại chưa hỗ trợ thanh toán cho hợp đồng này. Liên hệ chủ nhà để kiểm tra.'
                : problem.status === 404
                  ? 'QR chưa khả dụng cho cơ sở này. Owner kiểm tra cấu hình tài khoản nhận tiền.'
                  : contractError(e),
            );
          }
        });
    return () => controller.abort();
  }, [api, c.id, c.status, qrRevision]);
  const [error, setError] = useState('');
  const refreshedPayment = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      setCheckedAt(Date.now());
      void Promise.all([
        api.transport<HoldingDepositStatus>(`/api/v1/contracts/${c.id}/holding-deposit`, {
          signal: controller.signal,
        }),
        api.transport<{ status: number }>(`/api/v1/rooms/${c.roomId}`, {
          signal: controller.signal,
        }),
      ])
        .then(([deposit, room]) => {
          if (!controller.signal.aborted) {
            setData({ deposit, room: room.status });
            setError('');
            if (deposit.status === 'Verified') onDepositVerified(c.id);
            if (deposit.status === 'Verified' && refreshedPayment.current !== deposit.verified) {
              refreshedPayment.current = deposit.verified;
              onChanged();
            }
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(contractError(e));
          }
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    const timer = setInterval(load, PAYMENT_STATUS_REFRESH_MS);
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
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, c.id, c.roomId, c.status, owner, onChanged, onDepositVerified]);
  const success = c.status === 'Active' && data?.room === 1;
  const testPayment = (qr?.mode ?? c.paymentMode) === 'Test';
  return (
    <>
      <HoldingSectionCard title={success ? 'Giữ chỗ thành công' : 'Tiền giữ chỗ'}>
        <HoldingStatusBadge
          label={
            success
              ? 'Đã giữ phòng'
              : data?.deposit.status === 'Verified'
                ? 'Tiền cọc đã được xác minh'
                : 'Chờ xác minh tiền cọc'
          }
          tone={success || data?.deposit.status === 'Verified' ? 'success' : 'warning'}
        />
        {data &&
          !success &&
          data.deposit.status !== 'Verified' &&
          !data.deposit.requiresManualReview &&
          qr?.transferReference && <PaymentStatusCountdown checkedAt={checkedAt} />}
        {!data && !error && (
          <Text style={ui.muted}>Đang kiểm tra thanh toán và trạng thái phòng…</Text>
        )}
        {data && (
          <>
            <View style={holdingPaymentStyles.amountBlock}>
              <Text style={holdingPaymentStyles.referenceLabel}>Tổng tiền giữ chỗ</Text>
              <Text style={holdingPaymentStyles.amount}>
                {formatContractMoney(data.deposit.required)}
              </Text>
            </View>
            <ReadOnly label="Đã xác minh" value={formatContractMoney(data.deposit.verified)} />
            <ReadOnly label="Còn thiếu" value={formatContractMoney(data.deposit.remaining)} />
            {data.deposit.requiresManualReview && (
              <Text style={ui.red}>Cần Owner kiểm tra và đối chiếu giao dịch.</Text>
            )}
            {success && <Text style={ui.green}>Phòng đã được giữ chỗ cho khách hàng.</Text>}
            {success && reference && <ReadOnly label="Tham chiếu tiền cọc" value={reference} />}
          </>
        )}
        {!!error && <ContractNotice message={error} />}
      </HoldingSectionCard>
      {!success && data?.deposit.status !== 'Verified' && (
        <HoldingSectionCard title="Thông tin chuyển khoản">
          <HoldingStatusBadge
            label={testPayment ? 'SePay Test · QR sandbox' : 'Chuyển khoản ngân hàng'}
            tone="warning"
          />
          {!qr && !qrError && <Text style={ui.muted}>Đang tải mã QR chuyển khoản…</Text>}
          {qr && (
            <>
              {qr.qrImageDataUri && (
                <View style={holdingPaymentStyles.qrFrame}>
                  <Image
                    accessibilityLabel={testPayment ? 'QR chuyển khoản sandbox' : 'QR chuyển khoản'}
                    source={{ uri: qr.qrImageDataUri }}
                    style={holdingPaymentStyles.qrImage}
                    resizeMode="contain"
                  />
                </View>
              )}
              <ReadOnly label="Ngân hàng (BIN)" value={qr.bankIdentifier ?? ''} />
              <ReadOnly
                label={qr.mode === 'Test' ? 'Số tài khoản Test' : 'Số tài khoản'}
                value={qr.accountNumber ?? ''}
              />
              <ReadOnly label="Chủ tài khoản" value={qr.accountHolder ?? ''} />
              <ReadOnly
                label="Số tiền chuyển khoản"
                value={formatContractMoney(qr.outstandingAmount)}
              />
              <View style={holdingPaymentStyles.transferReference}>
                <Text style={holdingPaymentStyles.referenceLabel}>Nội dung chuyển khoản</Text>
                <Text selectable style={holdingPaymentStyles.referenceValue}>
                  {qr.transferReference}
                </Text>
              </View>
              <Text style={holdingPaymentStyles.paymentNote}>
                {qr.mode === 'Test'
                  ? 'SePay Sandbox · Giao dịch Test được đối soát qua cùng luồng thanh toán. Không chuyển tiền thật vào tài khoản Test.'
                  : 'Chuyển đúng số tiền và nội dung bên trên để hệ thống tự đối soát.'}
              </Text>
              {!qr.qrImageDataUri && (
                <Text style={ui.muted}>
                  Backend chưa trả ảnh QR. Dùng thông tin Test bên trên hoặc thử lại.
                </Text>
              )}
            </>
          )}
          {!!qrError && <ContractNotice message={qrError} />}
          <Button
            mode="outlined"
            contentStyle={{ minHeight: 44 }}
            onPress={() => {
              setQr(null);
              setQrError('');
              setQrRevision((value) => value + 1);
            }}
          >
            Tải lại QR chuyển khoản
          </Button>
        </HoldingSectionCard>
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
        <View style={holdingPaymentStyles.nextStep}>
          <Text style={holdingPaymentStyles.customerName}>Bước tiếp theo</Text>
          <Text style={ui.muted}>
            {data?.deposit.requiresManualReview
              ? 'Chủ nhà cần kiểm tra giao dịch trước khi hoàn tất giữ chỗ.'
              : data?.deposit.status === 'Verified'
                ? 'Tiền cọc đã được xác nhận. Chờ hệ thống xác nhận phòng đã được giữ chỗ. Nếu trạng thái không cập nhật, hãy liên hệ chủ nhà.'
                : 'Hướng dẫn khách chuyển khoản đúng thông tin bên trên và chờ hệ thống xác nhận.'}
          </Text>
        </View>
      )}
      {owner && readiness && !success && (
        <HoldingSectionCard title="Điều kiện kích hoạt">
          {readiness.ready ? (
            <HoldingStatusBadge label="Đủ điều kiện kích hoạt" tone="success" />
          ) : (
            readiness.blockers.map((blocker) => (
              <Text key={blocker} style={ui.red}>
                {text(blocker) === blocker
                  ? 'Cần Owner kiểm tra điều kiện hợp đồng trên hệ thống.'
                  : text(blocker)}
              </Text>
            ))
          )}
        </HoldingSectionCard>
      )}
      {success && (
        <HoldingSectionCard title="Hoàn tất giữ chỗ">
          <HoldingChecklistRow label="Hợp đồng có hiệu lực" complete={c.status === 'Active'} />
          <HoldingChecklistRow label="Phòng đã được giữ chỗ" complete={data?.room === 1} />
          <HoldingChecklistRow
            label="Tiền cọc được xác minh"
            complete={data?.deposit.status === 'Verified'}
          />
          <Button mode="contained" onPress={onList}>
            Hoàn tất
          </Button>
        </HoldingSectionCard>
      )}
    </>
  );
}

const holdingPaymentStyles = StyleSheet.create({
  customer: { backgroundColor: '#F2F6FB', borderRadius: 10, padding: 12, gap: 6 },
  customerName: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: '#193653' },
  amountBlock: { alignItems: 'center', paddingVertical: 12, gap: 4 },
  amount: { fontSize: 28, lineHeight: 36, fontWeight: '700', color: '#193653' },
  nextStep: { backgroundColor: '#EAF0F7', borderRadius: 12, padding: 14, gap: 6 },
  qrFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#F5F7FB',
    borderRadius: 12,
  },
  qrImage: { width: 240, height: 240, maxWidth: '100%' },
  transferReference: { backgroundColor: '#F2F6FB', borderRadius: 10, padding: 12, gap: 4 },
  referenceLabel: { fontSize: 12, lineHeight: 18, color: '#526581' },
  referenceValue: { fontSize: 14, lineHeight: 21, fontWeight: '700', color: '#193653' },
  paymentNote: { fontSize: 12, lineHeight: 18, color: '#526581' },
});
