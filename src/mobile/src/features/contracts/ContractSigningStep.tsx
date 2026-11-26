import { ContractNotice } from './ContractNotice';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Text } from 'react-native-paper';
import {
  contractActions,
  contractError,
  mutationKeys,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import {
  internalSigningClient,
  signingInvitationLabel,
  signingMessage,
  invitationPreDeliveryError,
  type InternalSigningStatus,
} from '../../../../../packages/client-core/src/internalSigning';
import { signingClient, signingMethodLabel } from '../../../../../packages/client-core/src/signing';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Row, ui } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { ContractSigningPanel } from './ContractSigningPanel';
import { ContractActionForm } from './ContractActionForm';
import { SignaturePlacementField } from './SigningSetup';
import { ContractEvidence } from './ContractEvidence';
import { ContractLoading } from './ContractLoading';
import { Input } from '../../components/WorkflowControls';
import { staffColors as s } from '../../theme/theme';

function signingComplete(c: ContractView, status: InternalSigningStatus | null) {
  if (!['PendingActivation', 'Active'].includes(c.status)) return false;
  return c.signingMode === 'INTERNAL_OTP_DRAWN'
    ? status?.canContinue === true && !status.tenantSimulated
    : [c.ownerSignerId, c.tenantUserId].every(
        (id) => !!id && c.signatures.some((s) => s.signerUserId === id && s.status === 'Signed'),
      );
}

// Both contract flows use persisted signing status to decide when payment can start.
export function ContractSigningStep({
  api,
  contract,
  actorId,
  role,
  onChanged,
  onContinue,
}: {
  api: ContractClient;
  contract: ContractView;
  actorId: string;
  role: string;
  onChanged: () => void;
  onContinue?: () => void;
}) {
  const internal = contract.signingMode === 'INTERNAL_OTP_DRAWN';
  const owner = role === 'Owner' && actorId === contract.ownerSignerId;
  const staffMain = role === 'Staff' && contract.kind === 'Main';
  const signer = owner || (role === 'Tenant' && actorId === contract.tenantUserId);
  const service = useMemo(() => internalSigningClient(api.transport), [api]);
  const signing = useMemo(() => signingClient(api.transport), [api]);
  const [data, setData] = useState<{
    contract: ContractView;
    status: InternalSigningStatus | null;
    methods: Awaited<ReturnType<typeof signing.methods>> | null;
  } | null>(null);
  const [error, setError] = useState('');
  const [invitationFailure, setInvitationFailure] = useState<{
    contractId: string;
    message: string;
  } | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sendingInvitation, setSendingInvitation] = useState(false);
  const [uncertainInvitation, setUncertainInvitation] = useState(false);
  const [operation, setOperation] = useState('');
  const [resendAfter, setResendAfter] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  const invitationRevision = useRef(0);
  useEffect(() => {
    if (resendAfter === null) return;
    const timer = setTimeout(() => setResendAfter(null), Math.max(0, resendAfter - Date.now()));
    return () => clearTimeout(timer);
  }, [resendAfter]);
  const c = data?.contract.id === contract.id ? data.contract : contract;
  const recipientEmail = emails[c.representativeResidentId]?.trim() ?? '';
  const recipientEmailError =
    recipientEmail &&
    (recipientEmail.length > 256 ||
      !/^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;.]+$/.test(recipientEmail))
      ? 'Nhập email hợp lệ, tối đa 256 ký tự.'
      : undefined;
  const status = data?.contract.id === contract.id ? data.status : null;
  const holdingEmail = status?.usesHoldingEmail ? (status.maskedEmail ?? undefined) : undefined;
  const displayedError =
    (!status?.tenantAcceptedAt && invitationFailure?.contractId === c.id
      ? invitationFailure.message
      : '') || error;
  const methods = data?.methods ?? null;
  useEffect(() => {
    let active = true,
      loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      const requestRevision = invitationRevision.current;
      try {
        const [latest, status, methods] = await Promise.all([
          api.get(contract.id),
          internal ? service.status(contract.id) : Promise.resolve(null),
          signer ? signing.methods() : Promise.resolve(null),
        ]);
        if (active && !lock.current && requestRevision === invitationRevision.current) {
          setData({ contract: latest, status, methods });
          setError('');
        }
      } catch (e) {
        if (active && !lock.current) setError(contractError(e));
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, contract.id, contract.snapshotHash, internal, service, signer, signing, revision]);
  const readyToSign =
    !internal || !!status?.tenantAcceptedAt || (['Holding', 'Main'].includes(c.kind) && owner);
  const complete = signingComplete(c, status);
  const bothSigned = internal
    ? !!status?.ownerAcceptedAt && !!status.tenantAcceptedAt && !status.tenantSimulated
    : [c.ownerSignerId, c.tenantUserId].every(
        (id) => !!id && c.signatures.some((signature) => signature.signerUserId === id && signature.status === 'Signed'),
      );
  const currentInvitation = status?.invitations.find(
    (i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status),
  );
  const signingSent =
    c.status === 'PendingActivation' ||
    !!currentInvitation ||
    !!status?.ownerAcceptedAt ||
    !!status?.tenantAcceptedAt ||
    c.signatures.length > 0;
  const representativeLabel = c.kind === 'Holding' ? 'Người giữ chỗ' : 'Người đại diện thuê';
  const nextSignerMessage = !data
    ? error
      ? 'Chưa tải được trạng thái ký. Bấm Làm mới trạng thái ký để thử lại.'
      : 'Đang tải trạng thái ký…'
    : complete
      ? 'Hai bên đã ký xong. Bạn có thể tiếp tục thanh toán.'
      : internal && !status?.tenantAcceptedAt
        ? currentInvitation
          ? `${representativeLabel} cần mở email, xác minh OTP và hoàn tất chữ ký. Trạng thái tự cập nhật khi ký xong.`
          : `Gửi lời mời qua email để ${representativeLabel.toLowerCase()} đọc và ký hợp đồng.`
        : internal && !status?.ownerAcceptedAt
          ? `${representativeLabel} đã ký. Owner mở hợp đồng trên web để ký tiếp.`
          : 'Mỗi bên mở hợp đồng trong tài khoản của mình để hoàn tất chữ ký còn thiếu.';
  const actions =
    readyToSign && methods
      ? contractActions(c, null, role, actorId, methods.methods).filter((a) =>
          a.operation.startsWith('signing'),
        )
      : [];
  const action = actions.find((a) => a.operation === operation);
  function changed() {
    setOperation('');
    setRevision((v) => v + 1);
    onChanged();
  }
  async function continueToPayment() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const [latest, latestStatus] = await Promise.all([
        api.get(c.id),
        internal ? service.status(c.id) : Promise.resolve(null),
      ]);
      setData({ contract: latest, status: latestStatus, methods });
      if (!signingComplete(latest, latestStatus))
        throw new Error('Chưa đủ chữ ký hợp lệ để tiếp tục thanh toán.');
      onChanged();
      onContinue?.();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function invite(resend = false) {
    if (lock.current || !c.snapshotHash || recipientEmailError) return;
    lock.current = true;
    setBusy(true);
    setSendingInvitation(true);
    setError('');
    setInvitationFailure(null);
    let dispatched = false;
    try {
      const latest = await service.status(c.id);
      const activeInvitation = latest.invitations.find(
        (i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status),
      );
      if (!latest.tenantAcceptedAt && (resend ? !!activeInvitation : !activeInvitation)) {
        setUncertainInvitation(true);
        dispatched = true;
        const result = await service.invite(
          c.id,
          c.snapshotHash,
          resend
            ? activeInvitation!.expiresAt
            : new Date(
                Math.min(Date.now() + 3600000, Date.parse(c.holdingExpiresAt ?? '') || Infinity),
              ).toISOString(),
          recipientEmail || undefined,
          resend
            ? undefined
            : Object.entries(emails)
                .filter(([, email]) => email.trim())
                .map(([residentId, email]) => ({ residentId, email })),
          resend,
        );
        // Reflect the confirmed response immediately; never retain or expose its token.
        invitationRevision.current++;
        setData({
          contract: c,
          methods,
          status: {
            ...latest,
            maskedEmail: recipientEmail
              ? recipientEmail.replace(/^([^@])[^@]*(@.*)$/, '$1***$2')
              : latest.maskedEmail,
            invitations: [
              { id: result.id, status: result.status, expiresAt: result.expiresAt },
              ...latest.invitations.filter(
                (i) => i.id !== result.id && (!resend || i.id !== activeInvitation?.id),
              ),
            ],
          },
        });
        setUncertainInvitation(false);
        if (c.kind === 'Holding')
          setEmails((before) => ({ ...before, [c.representativeResidentId]: '' }));
        setResendAfter(Date.now() + 60000);
      }
      changed();
    } catch (e) {
      const responseStatus = (e as { status?: number })?.status;
      const unknown =
        dispatched &&
        !invitationPreDeliveryError(e) &&
        (!responseStatus || responseStatus >= 500 || responseStatus === 408);
      setUncertainInvitation(unknown);
      if (!unknown) {
        setInvitationFailure({ contractId: c.id, message: signingMessage(e) });
        if (responseStatus === 429) setResendAfter(Date.now() + 60000);
      }
    } finally {
      lock.current = false;
      setBusy(false);
      setSendingInvitation(false);
    }
  }
  if (c.kind === 'Holding' && (!data || data.contract.id !== contract.id) && !error)
    return <ContractLoading compact label="Đang tải thông tin gửi ký…" />;
  return (
    <>
      <Box style={staffMain ? styles.staffSigning : undefined}>
        <Heading
          title={
            staffMain
              ? signingSent
                ? 'Trạng thái ký hợp đồng'
                : 'Gửi hợp đồng để ký'
              : c.kind === 'Holding'
                ? 'Ký hợp đồng'
                : 'Bước 5 · Ký hợp đồng'
          }
        />
        {c.kind !== 'Holding' && !staffMain && (
          <Text style={ui.muted}>
            Phòng {c.roomNumber} · {c.locationName} · Đại diện:{' '}
            {c.occupants?.find((p) => p.representative)?.label ?? 'Theo hồ sơ hợp đồng'}
          </Text>
        )}
        {c.kind !== 'Holding' && !staffMain && (
          <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#193653' }}>
            Tiến độ chữ ký
          </Text>
        )}
        {[
          { id: c.ownerSignerId, label: 'Chủ nhà', at: status?.ownerAcceptedAt },
          { id: c.tenantUserId, label: representativeLabel, at: status?.tenantAcceptedAt },
        ].map((p) => {
          const signature = c.signatures.find(
            (s) => s.signerUserId === p.id && s.status === 'Signed',
          );
          const at = signature?.signedAt ?? p.at;
          const isSigned = !!at || signature?.status === 'Signed';
          return (
            <React.Fragment key={p.label}>
              {staffMain ? (
                <Row spread>
                  <Icon
                    source={isSigned ? 'check-circle' : 'clock-outline'}
                    size={19}
                    color={isSigned ? s.green : s.orange}
                  />
                  <Text style={styles.staffSignerName}>{p.label}</Text>
                  <Text style={isSigned ? styles.staffSigned : styles.staffWaiting}>
                    {isSigned ? 'Đã ký' : 'Chờ ký'}
                  </Text>
                </Row>
              ) : (
                <>
                  <Text
                    style={{
                      fontSize: 13,
                      lineHeight: 20,
                      fontWeight: '600',
                      color: at ? '#16804A' : '#193653',
                    }}
                  >
                    {p.label}: {at ? 'Đã ký' : 'Chờ ký'}
                  </Text>
                  {!!at && c.kind !== 'Holding' && (
                    <Text style={{ fontSize: 12, lineHeight: 18, color: '#526581' }}>
                      {formatInstant(at)} ·{' '}
                      {signature?.method ? signingMethodLabel(signature.method) : 'OTP qua lời mời'}
                    </Text>
                  )}
                </>
              )}
            </React.Fragment>
          );
        })}
        {staffMain && bothSigned && (
          <Text style={styles.staffComplete}>Đã hoàn tất ký hợp đồng</Text>
        )}
        {c.kind !== 'Holding' && !staffMain && (
          <Text
            style={{
              backgroundColor: '#F2F6FB',
              padding: 12,
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 19,
              color: '#193653',
            }}
          >
            {complete ? 'Đã hoàn tất ký. ' : 'Thao tác tiếp theo: '}
            {nextSignerMessage}
          </Text>
        )}
        {c.kind !== 'Holding' && !staffMain && (
          <Text style={{ fontSize: 12, lineHeight: 18, color: '#526581' }}>
            OTP và chữ ký vẽ là chữ ký điện tử; dấu PDF BHOME không phải chứng thư số cá nhân của
            người ký.
          </Text>
        )}
        {internal && !status?.tenantAcceptedAt && (
          <>
            {currentInvitation && (
              <Text
                style={
                  currentInvitation.status === 'InvitationAcceptedByProvider' ? ui.green : ui.muted
                }
              >
                {staffMain && currentInvitation.status === 'InvitationAcceptedByProvider'
                  ? 'Máy chủ email đã tiếp nhận · Chờ ký'
                  : signingInvitationLabel(currentInvitation.status)}{' '}
                · {status?.maskedEmail}
              </Text>
            )}
            {currentInvitation &&
              ['OwnerApprovedLink', 'InvitationPendingManualDelivery'].includes(
                currentInvitation.status,
              ) && (
                <ContractNotice message="Email chưa được xác nhận gửi thành công. Kiểm tra cấu hình email hoặc thử gửi lại." />
              )}
            {uncertainInvitation && !busy && (
              <Text style={ui.muted}>
                Chưa xác định được kết quả gửi. Hãy làm mới trạng thái trước khi gửi lại.
              </Text>
            )}
            {staffMain && !!displayedError && <ContractNotice message={displayedError} />}
            {currentInvitation &&
              ['Owner', 'Staff'].includes(role) &&
              ['Holding', 'Main'].includes(c.kind) && (
                <>
                  <Input
                    label="Email nhận lời mời mới"
                    email
                    error={recipientEmailError}
                    value={emails[c.representativeResidentId] ?? ''}
                    onChange={(email) => {
                      setEmails((before) => ({ ...before, [c.representativeResidentId]: email }));
                      setInvitationFailure(null);
                    }}
                    disabled={busy}
                  />
                  <Text style={ui.muted}>
                    Để trống để gửi lại email hiện tại. Gửi lại sẽ cấp liên kết và mã OTP mới thay
                    cho email trước.
                  </Text>
                  <Text style={ui.muted}>
                    Email chỉ được lưu vào hồ sơ sau khi người nhận xác nhận OTP và ký thành công.
                  </Text>
                  <Action
                    loading={sendingInvitation}
                    disabled={
                      busy || uncertainInvitation || resendAfter !== null || !!recipientEmailError
                    }
                    onPress={() => void invite(true)}
                  >
                    {sendingInvitation
                      ? 'Đang gửi lại email…'
                      : resendAfter !== null
                        ? 'Gửi lại sau 1 phút'
                        : 'Gửi lại email'}
                  </Action>
                </>
              )}
            {['Owner', 'Staff'].includes(role) && !currentInvitation && (
              <>
                {(c.occupants?.some((person) => person.id === c.representativeResidentId)
                  ? c.occupants.filter((person) => person.id === c.representativeResidentId)
                  : [
                      {
                        id: c.representativeResidentId,
                        label: representativeLabel,
                        representative: true,
                      },
                    ]
                ).map((person) => (
                  <Input
                    key={person.id ?? 'representative'}
                    label={
                      c.kind === 'Holding' && (c.occupants?.length ?? 0) <= 1
                        ? 'Email người giữ chỗ'
                        : `Email nhận lời mời · ${person.label}`
                    }
                    placeholder={holdingEmail}
                    email
                    error={recipientEmailError}
                    value={emails[person.id] ?? ''}
                    onChange={(email) => {
                      setEmails((before) => ({ ...before, [person.id]: email }));
                      setInvitationFailure(null);
                    }}
                    disabled={busy}
                  />
                ))}
                {staffMain && (
                  <Text style={ui.muted}>
                    Người thuê nhận liên kết ký qua email. Chủ cơ sở nhận thông báo để mở hợp đồng
                    ký trên web hoặc mobile.
                  </Text>
                )}
                {c.kind === 'Main' &&
                  status?.maskedEmail &&
                  !emails[c.representativeResidentId]?.trim() && (
                    <Text style={ui.muted}>
                      {holdingEmail
                        ? `Sẽ dùng email từ hợp đồng giữ chỗ: ${holdingEmail}.`
                        : `Sẽ gửi đến email đã lưu: ${status.maskedEmail}.`}
                    </Text>
                  )}
                {c.kind !== 'Holding' && !staffMain && (
                  <Text style={ui.muted}>
                    Email dùng cho lời mời ký, không tự tạo tài khoản Tenant.
                  </Text>
                )}
                <Action
                  loading={sendingInvitation}
                  disabled={
                    busy ||
                    uncertainInvitation ||
                    !!recipientEmailError ||
                    !status ||
                    !!currentInvitation ||
                    (c.kind === 'Main' &&
                      !status.maskedEmail &&
                      !emails[c.representativeResidentId]?.trim())
                  }
                  onPress={() => void invite()}
                >
                  {sendingInvitation ? 'Đang gửi lời mời…' : 'Gửi lời mời ký qua email'}
                </Action>
              </>
            )}
            {owner && currentInvitation && (
              <Action
                secondary
                disabled={busy}
                onPress={() => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  void service
                    .revoke(c.id, currentInvitation.id)
                    .then(() => setUncertainInvitation(false))
                    .then(changed)
                    .catch((e) => setError(contractError(e)))
                    .finally(() => {
                      lock.current = false;
                      setBusy(false);
                    });
                }}
              >
                Thu hồi lời mời chưa ký
              </Action>
            )}
          </>
        )}
        {!!displayedError && (!staffMain || !internal || !!status?.tenantAcceptedAt) && (
          <ContractNotice message={displayedError} />
        )}
        {onContinue && ((c.kind !== 'Holding' && !staffMain) || bothSigned) && (
          <Action
            disabled={!complete || busy || !!displayedError}
            onPress={() => {
              void continueToPayment();
            }}
          >
            Tiếp tục thanh toán
          </Action>
        )}
        {!bothSigned && (
          <Action secondary disabled={busy} onPress={() => setRevision((v) => v + 1)}>
            Làm mới trạng thái ký
          </Action>
        )}
      </Box>
      {signer && !readyToSign && !complete && (
        <SignaturePlacementField
          signing={signing}
          contractId={c.id}
          value={{ placement: null, usePicture: false }}
          onChange={() => {}}
          disabled
        />
      )}
      {signer && readyToSign && (
        <ContractSigningPanel
          api={api}
          contract={c}
          actorId={actorId}
          methods={methods}
          onChanged={changed}
        />
      )}
      {actions.map((a) => (
        <Action key={a.operation} onPress={() => setOperation(a.operation)}>
          {a.label}
        </Action>
      ))}
      {action && (
        <ContractActionForm
          api={api}
          contract={c}
          action={action}
          keys={keys}
          onCancel={() => setOperation('')}
          onSuccess={changed}
        />
      )}
      {signer && (status?.tenantAcceptedAt || c.signatures.some((s) => s.status === 'Signed')) && (
        <ContractEvidence api={api} contractId={c.id} contractKind={c.kind} pdf />
      )}
    </>
  );
}

const styles = {
  staffSigning: { padding: 12, gap: 8 },
  staffSignerName: { flex: 1, color: s.navy, fontWeight: '600' as const, fontSize: 13 },
  staffSigned: { color: s.green, fontWeight: '600' as const, fontSize: 13 },
  staffWaiting: { color: s.orange, fontWeight: '600' as const, fontSize: 13 },
  staffComplete: { color: s.green, fontWeight: '600' as const, fontSize: 14 },
};
