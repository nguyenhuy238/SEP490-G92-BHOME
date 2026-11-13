import React, { useMemo, useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ContractDateField } from '../../components/ContractDateField';
import { Input } from '../../components/WorkflowControls';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { ownerQueuePolicy } from './ownerQueryPolicy';
import { useFeedbackState } from '../../lib/useFeedbackState';
import {
  dateOnly,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import {
  internalSigningClient,
  signingMessage,
  type InternalSigningStatus,
} from '../../../../../packages/client-core/src/internalSigning';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ContractEvidence } from '../contracts/ContractEvidence';
const ownerSigningPolicy = { ...ownerQueuePolicy, staleTime: 0 };

function invitationExpiry(date: string, time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error();
  const expiresAt = new Date(`${dateOnly(date)}T${time}:00+07:00`).toISOString();
  const now = Date.now();
  if (Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 24 * 60 * 60 * 1000)
    throw new Error();
  return expiresAt;
}

export const invitationLabel = (value: string) =>
  ({
    OwnerApprovedLink: 'Đã tạo · cần gửi riêng',
    InvitationAcceptedByProvider: 'Dịch vụ email đã tiếp nhận',
    InvitationPendingManualDelivery: 'Gửi email chưa thành công',
    OtpPendingDelivery: 'Đang chờ gửi mã xác nhận',
    OtpAcceptedByProvider: 'Dịch vụ email đã tiếp nhận mã',
    OtpVerified: 'Đã xác minh email',
    Accepted: 'Người đại diện đã chấp thuận',
    Revoked: 'Đã thu hồi',
    Expired: 'Đã hết hạn',
  })[value] ?? 'Cần kiểm tra trạng thái';

type OwnerSigningProps = {
  api: ContractClient;
  contract: ContractView;
  onChanged: () => void;
};

export function OwnerHoldingSigning(props: OwnerSigningProps) {
  const { session } = useSession();
  if (
    !session?.roles.includes('Owner') ||
    session.userId !== props.contract.ownerSignerId ||
    props.contract.signingMode !== 'INTERNAL_OTP_DRAWN'
  )
    return null;
  return <OwnerInternalSigning key={props.contract.id} {...props} />;
}

function OwnerInternalSigning({ api, contract, onChanged }: OwnerSigningProps) {
  const allowed = true;
  const service = useMemo(() => internalSigningClient(api.transport), [api]);
  const query = useWorkspaceQuery<InternalSigningStatus>(
    allowed ? `/api/v1/contracts/${contract.id}/internal-signing` : null,
    { cache: ownerSigningPolicy },
  );
  const recipient = useWorkspaceQuery<{
    id: string;
    roomId: string | null;
    residentType: string;
    tenantUserId: string | null;
    contactEmail: string | null;
    verificationStatus: string;
  }>(
    contract.representativeResidentId
      ? `/api/v1/residents/${contract.representativeResidentId}`
      : null,
    { cache: ownerSigningPolicy },
  );
  const [reviewed, setReviewed] = useState(false);
  const [date, setDate] = useState(''),
    [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const lock = useRef(false);
  const status = query.data;
  const recipientMatches =
    contract.kind !== 'Main' ||
    (recipient.data?.id === contract.representativeResidentId &&
      recipient.data.roomId === contract.roomId &&
      recipient.data.residentType === 'Representative' &&
      recipient.data.tenantUserId === contract.tenantUserId);
  const open =
    ['Draft', 'PendingSigning'].includes(contract.status) &&
    !contract.onboardingDraft &&
    (contract.kind !== 'Holding' || !!contract.approvedAt);
  const canInvite =
    allowed &&
    open &&
    !!contract.snapshotHash &&
    !!status &&
    !query.error &&
    !recipient.error &&
    recipientMatches &&
    recipient.data?.verificationStatus === 'Verified' &&
    !!recipient.data.contactEmail &&
    !status.tenantAcceptedAt;
  const canConfirm =
    allowed &&
    !!status?.tenantAcceptedAt &&
    !!status.documentHash &&
    !status.ownerAcceptedAt &&
    ['PendingSigning', 'PendingActivation'].includes(contract.status) &&
    !query.error;
  async function run(work: () => Promise<unknown>) {
    if (lock.current || !allowed) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      setReviewed(false);
      query.reload();
      onChanged();
    } catch (e) {
      setError(signingMessage(e));
      query.reload();
      setReviewed(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function invite() {
    if (!canInvite || !reviewed || busy) return;
    try {
      const expiresAt = invitationExpiry(date, time);
      // The backend sends email. Deliberately discard the one-time invitation token.
      void run(() => service.invite(contract.id, contract.snapshotHash!, expiresAt));
    } catch {
      setError('Nhập hạn lời mời trong 24 giờ tới (ngày và giờ Việt Nam).');
    }
  }
  if (!allowed) return null;
  return (
    <Box>
      <Heading title="Chấp thuận nội bộ qua email" />
      <Text style={ui.muted}>
        OTP và chữ ký vẽ là chấp thuận nội bộ, không phải chữ ký số CA hoặc MySign.
      </Text>
      <Text>
        Người nhận:{' '}
        {contract.occupants?.find((person) => person.representative)?.label ??
          'Người đại diện theo hồ sơ đã xác minh'}
      </Text>
      <Text>Email trong hồ sơ hiện tại: {recipient.data?.contactEmail ?? 'Chưa tải được'}</Text>
      <Text>
        Hồ sơ đại diện:{' '}
        {recipient.data?.verificationStatus === 'Verified'
          ? 'Đã xác minh'
          : 'Chưa xác nhận được trạng thái xác minh'}
      </Text>
      {!!recipient.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {recipient.error}
        </Text>
      )}
      {contract.kind === 'Main' && !!recipient.data && !recipientMatches && (
        <Text accessibilityRole="alert" style={ui.red}>
          Hồ sơ người nhận không khớp hợp đồng. Hãy tải lại hồ sơ bên thuê.
        </Text>
      )}
      {query.loading && <Text>Đang tải trạng thái ký…</Text>}
      {!!(error || query.error) && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error || query.error}
        </Text>
      )}
      {status && (
        <>
          {contract.kind === 'Main' &&
            status.invitations.some((invitation) =>
              ['OwnerApprovedLink', 'InvitationPendingManualDelivery'].includes(invitation.status),
            ) && (
              <Text accessibilityRole="alert" style={ui.red}>
                Email chưa được gửi thành công. Kiểm tra cấu hình hoặc dịch vụ email trước khi tạo
                lời mời mới.
              </Text>
            )}
          <Text>
            Người đại diện:{' '}
            {status.tenantAcceptedAt
              ? `Đã chấp thuận · ${formatInstant(status.tenantAcceptedAt)}`
              : 'Chưa chấp thuận'}
          </Text>
          <Text>
            Owner:{' '}
            {status.ownerAcceptedAt
              ? `Đã xác nhận · ${formatInstant(status.ownerAcceptedAt)}`
              : 'Chưa xác nhận'}
          </Text>
          {status.invitations.map((invitation) => (
            <React.Fragment key={invitation.id}>
              <Text>
                {invitationLabel(invitation.status)} · Hết hạn {formatInstant(invitation.expiresAt)}
              </Text>
              {canInvite && !['Accepted', 'Revoked', 'Expired'].includes(invitation.status) && (
                <Action
                  secondary
                  disabled={busy}
                  onPress={() => void run(() => service.revoke(contract.id, invitation.id))}
                >
                  Thu hồi lời mời chưa ký
                </Action>
              )}
            </React.Fragment>
          ))}
        </>
      )}
      {canInvite && (
        <>
          <ContractDateField
            label="Ngày hết hạn lời mời (dd/MM/yyyy)"
            value={date}
            onChange={setDate}
            disabled={busy}
          />
          <Input
            label="Giờ hết hạn (HH:mm, giờ Việt Nam)"
            value={time}
            onChange={setTime}
            disabled={busy}
          />
          {!!status?.invitations.length && (
            <Text>Lời mời mới thu hồi các lời mời cũ chưa được chấp thuận.</Text>
          )}
        </>
      )}
      {canConfirm && <ContractEvidence api={api} contractId={contract.id} pdf />}
      {(canInvite || canConfirm) && (
        <Checkbox.Item
          label="Tôi đã đọc đúng PDF và đồng ý nội dung hợp đồng"
          status={reviewed ? 'checked' : 'unchecked'}
          disabled={busy}
          onPress={() => setReviewed((value) => !value)}
        />
      )}
      {canInvite && (
        <Action disabled={busy || !reviewed || !date || !time} onPress={invite}>
          Gửi lời mời ký qua email
        </Action>
      )}
      {canConfirm && (
        <Action
          disabled={busy || !reviewed}
          onPress={() => {
            if (canConfirm && reviewed)
              void run(() => service.ownerConfirm(contract.id, status!.documentHash!));
          }}
        >
          Xác nhận chấp thuận của Owner
        </Action>
      )}
      <Action
        secondary
        disabled={busy || query.fetching}
        onPress={() => {
          setReviewed(false);
          query.reload();
          onChanged();
        }}
      >
        Cập nhật trạng thái ký
      </Action>
    </Box>
  );
}
