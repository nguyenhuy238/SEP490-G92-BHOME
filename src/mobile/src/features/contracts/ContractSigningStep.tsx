import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text } from 'react-native-paper';
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
  type InternalSigningStatus,
} from '../../../../../packages/client-core/src/internalSigning';
import { signingClient, signingMethodLabel } from '../../../../../packages/client-core/src/signing';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { randomUUID } from '../../lib/randomUUID';
import { ContractSigningPanel } from './ContractSigningPanel';
import { ContractActionForm, SigningCertificates } from './ContractActionForm';
import { SignaturePlacementField } from './SigningSetup';
import { ContractEvidence } from './ContractEvidence';
import { Input } from '../../components/WorkflowControls';

function signingComplete(c: ContractView, status: InternalSigningStatus | null) {
  if (!['PendingActivation', 'Active'].includes(c.status)) return false;
  return c.signingMode === 'INTERNAL_OTP_DRAWN'
    ? status?.canContinue === true && !status.tenantSimulated
    : [c.ownerSignerId, c.tenantUserId].every(
        (id) => !!id && c.signatures.some((s) => s.signerUserId === id && s.status === 'Signed'),
      );
}

// Shared Step 6. All completion decisions come from persisted backend state.
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
  const signer = owner || (role === 'Tenant' && actorId === contract.tenantUserId);
  const service = useMemo(() => internalSigningClient(api.transport), [api]);
  const signing = useMemo(() => signingClient(api.transport), [api]);
  const [data, setData] = useState<{
    contract: ContractView;
    status: InternalSigningStatus | null;
    methods: Awaited<ReturnType<typeof signing.methods>> | null;
  } | null>(null);
  const [error, setError] = useState('');
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uncertainInvitation, setUncertainInvitation] = useState(false);
  const [operation, setOperation] = useState('');
  const [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  const c = data?.contract.id === contract.id ? data.contract : contract;
  const status = data?.contract.id === contract.id ? data.status : null;
  const methods = data?.methods ?? null;
  useEffect(() => {
    let active = true,
      loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const [latest, status, methods] = await Promise.all([
          api.get(contract.id),
          internal ? service.status(contract.id) : Promise.resolve(null),
          signer ? signing.methods() : Promise.resolve(null),
        ]);
        if (active) {
          setData({ contract: latest, status, methods });
          setError('');
        }
      } catch (e) {
        if (active) setError(contractError(e));
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
  const readyToSign = !internal || !!status?.tenantAcceptedAt;
  const complete = signingComplete(c, status);
  const currentInvitation = status?.invitations.find(
    (i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status),
  );
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
  async function invite() {
    if (lock.current || !c.snapshotHash) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const latest = await service.status(c.id);
      if (
        !latest.tenantAcceptedAt &&
        !latest.invitations.some((i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status))
      ) {
        setUncertainInvitation(true);
        await service.invite(
          c.id,
          c.snapshotHash,
          new Date(
            Math.min(Date.now() + 3600000, Date.parse(c.holdingExpiresAt ?? '') || Infinity),
          ).toISOString(),
          emails[c.representativeResidentId],
          Object.entries(emails).filter(([, email]) => email.trim()).map(([residentId, email]) => ({ residentId, email })),
        );
        setUncertainInvitation(false);
      }
      changed();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Box>
        <Heading title="Bước 6 · Ký hợp đồng" />
        {c.kind !== 'Holding' && (
          <Text style={ui.muted}>
            Phòng {c.roomNumber} · {c.locationName} · Đại diện: {c.occupants?.find((p) => p.representative)?.label ?? 'Theo hồ sơ hợp đồng'}
          </Text>
        )}
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#193653' }}>
          Tiến độ chữ ký
        </Text>
        {[
          { id: c.ownerSignerId, label: 'Chủ nhà (Owner)', at: status?.ownerAcceptedAt },
          { id: c.tenantUserId, label: representativeLabel, at: status?.tenantAcceptedAt },
        ].map((p) => {
          const signature = c.signatures.find(
            (s) => s.signerUserId === p.id && s.status === 'Signed',
          );
          const at = signature?.signedAt ?? p.at;
          return (
            <React.Fragment key={p.label}>
              <Text style={{ fontSize: 13, lineHeight: 20, fontWeight: '600', color: at ? '#16804A' : '#193653' }}>
                {p.label}: {at ? 'Đã ký' : 'Chờ ký'}
              </Text>
              {!!at && (
                <Text style={{ fontSize: 12, lineHeight: 18, color: '#526581' }}>
                  {formatInstant(at)} · {signature?.method ? signingMethodLabel(signature.method) : 'OTP qua lời mời'}
                </Text>
              )}
            </React.Fragment>
          );
        })}
        <Text style={{ backgroundColor: '#F2F6FB', padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 19, color: '#193653' }}>
          {complete ? 'Đã hoàn tất ký. ' : 'Thao tác tiếp theo: '}{nextSignerMessage}
        </Text>
        <Text style={{ fontSize: 12, lineHeight: 18, color: '#526581' }}>
          OTP và chữ ký vẽ là chữ ký điện tử; dấu PDF BHOME không phải chứng thư số cá nhân của người ký.
        </Text>
        {internal && !status?.tenantAcceptedAt && (
          <>
            {currentInvitation && (
              <Text style={ui.muted}>
                {signingInvitationLabel(currentInvitation.status)} · {status?.maskedEmail}
              </Text>
            )}
            {currentInvitation &&
              ['OwnerApprovedLink', 'InvitationPendingManualDelivery'].includes(
                currentInvitation.status,
              ) && (
                <Text style={ui.red}>
                  Chưa xác nhận gửi email thành công. Owner kiểm tra cấu hình email và thu hồi lời
                  mời trước khi gửi lại.
                </Text>
              )}
            {uncertainInvitation && !currentInvitation && (
              <Text style={ui.red}>
                Chưa xác định kết quả gửi. Hãy kiểm tra trạng thái lời mời trên Owner Web trước khi
                gửi lại.
              </Text>
            )}
            {['Owner', 'Staff'].includes(role) && !currentInvitation && (
              <>
              {(c.occupants?.length ? c.occupants : [{ id: c.representativeResidentId, label: representativeLabel, representative: true }]).map((person) => (
                <Input key={person.id} label={`Email nhận lời mời · ${person.label}`} email value={emails[person.id] ?? ''}
                  onChange={(email) => setEmails((before) => ({ ...before, [person.id]: email }))} disabled={busy} />
              ))}
              <Text style={ui.muted}>Email dùng cho lời mời ký, không tự tạo tài khoản Tenant.</Text>
              <Action
                disabled={
                  busy ||
                  uncertainInvitation ||
                  !status ||
                  !!currentInvitation ||
                  (c.kind === 'Holding' && !c.approvedAt)
                }
                onPress={() => void invite()}
              >
                Gửi lời mời ký qua email
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
        {!!error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        <Action secondary onPress={() => setRevision((v) => v + 1)}>
          Làm mới trạng thái ký
        </Action>
        {onContinue && (
          <Action
            disabled={!complete || busy || !!error}
            onPress={() => {
              void continueToPayment();
            }}
          >
            Tiếp tục thanh toán
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
      {signer && methods?.methods.includes('VIETTEL_MYSIGN') && readyToSign && !complete && (
        <SigningCertificates api={api} />
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
          evidenceIds={[]}
          onCancel={() => setOperation('')}
          onSuccess={changed}
        />
      )}
      {signer && (status?.tenantAcceptedAt || c.signatures.some((s) => s.status === 'Signed')) && (
        <ContractEvidence api={api} contractId={c.id} pdf />
      )}
    </>
  );
}
