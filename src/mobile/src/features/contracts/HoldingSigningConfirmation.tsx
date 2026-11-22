import { ContractNotice } from './ContractNotice';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Text } from 'react-native-paper';
import type {
  ContractClient,
  ContractView,
} from '../../../../../packages/client-core/src/contracts';
import {
  internalSigningClient,
  signingMessage,
  type InternalSigningStatus,
} from '../../../../../packages/client-core/src/internalSigning';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { ui } from '../../components/WorkspaceKit';
import { HoldingInfoRow, HoldingSectionCard, HoldingStatusBadge } from './HoldingUi';

export function HoldingSigningConfirmation({
  api,
  contract: c,
  simulation,
  onContinue,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  simulation?: { tenantSimulated: boolean; canShowQr: boolean; simulate: () => Promise<void> };
  onContinue?: () => void;
  onChanged: () => void;
}) {
  const service = useMemo(() => internalSigningClient(api.transport), [api]);
  const [status, setStatus] = useState<InternalSigningStatus | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const result = await service.status(c.id);
        if (active) {
          setStatus(result);
          setError('');
        }
      } catch (e) {
        if (active) setError(signingMessage(e));
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
  }, [service, c.id, c.snapshotHash]);
  const invitation = status?.invitations.find(
    (i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status),
  );
  const tenantSimulated = !!status?.tenantSimulated || !!simulation?.tenantSimulated;
  const tenantSigned = !!status?.tenantAcceptedAt;
  const canInvite = !!status && !invitation && !tenantSigned && !tenantSimulated && !uncertain;
  const canContinue = !!status?.canContinue && (!simulation || simulation.canShowQr);
  async function run(kind: 'invite' | 'simulate') {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    setError('');
    setSuccess('');
    try {
      if (kind === 'invite') {
        // Recheck before mutation; active invitations are also deduplicated by the server.
        const latest = await service.status(c.id);
        if (
          latest.invitations.some((i) => !['Expired', 'Revoked', 'Accepted'].includes(i.status))
        ) {
          setStatus(latest);
          return;
        }
        setUncertain(true);
        const expiresAt = new Date(
          Math.min(Date.now() + 3600000, Date.parse(c.holdingExpiresAt ?? '') || Infinity),
        ).toISOString();
        const result = await service.invite(c.id, c.snapshotHash!, expiresAt);
        setUncertain(false);
        if (result.status === 'InvitationAcceptedByProvider')
          setSuccess('Dịch vụ email đã tiếp nhận lời mời ký.');
        else if (result.status === 'AwaitingOwnerSignature')
          setSuccess('Lời mời cũ đang chờ gửi. Nhờ Owner gửi lời mời qua email trên Web.');
        else setError('Chưa gửi được email. Nhờ Owner kiểm tra cấu hình và lời mời trên Web.');
      } else if (simulation) {
        await simulation.simulate();
        setSuccess('Đã lưu xác nhận Tenant mô phỏng. Vẫn cần Owner xác nhận trên Web.');
      }
      setStatus(await service.status(c.id));
      onChanged();
    } catch (e) {
      const failure = e as { status?: number; code?: string; problem?: { code?: string } };
      if (
        (failure.status && failure.status >= 400 && failure.status < 500) ||
        ['signing_otp_key_not_configured', 'signing_email_not_configured'].includes(
          failure.code ?? failure.problem?.code ?? '',
        )
      )
        setUncertain(false);
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  const tenantLabel = tenantSigned
    ? 'Đã ký'
    : tenantSimulated
      ? 'Đã xác nhận mô phỏng'
      : invitation?.status === 'AwaitingOwnerSignature'
        ? 'Lời mời cũ đang chờ gửi'
        : invitation?.status === 'InvitationAcceptedByProvider'
          ? 'Đã gửi email · Chờ ký'
          : invitation
            ? 'Chờ ký'
            : 'Chưa gửi lời mời';
  return (
    <HoldingSectionCard title="Xác nhận ký hợp đồng">
      {!status && !error && <Text style={ui.muted}>Đang tải trạng thái ký…</Text>}
      <HoldingInfoRow
        label="Chủ nhà (Owner)"
        value={
          <HoldingStatusBadge
            label={status?.ownerAcceptedAt ? 'Đã xác nhận' : 'Chờ xác nhận'}
            tone={status?.ownerAcceptedAt ? 'success' : 'warning'}
          />
        }
      />
      {!!status?.ownerAcceptedAt && (
        <HoldingInfoRow
          label="Thời gian Owner xác nhận"
          value={formatInstant(status.ownerAcceptedAt)}
        />
      )}
      {!status?.ownerAcceptedAt && (
        <Text style={ui.muted}>Owner xác nhận trên Owner Web. Staff không ký thay Owner.</Text>
      )}
      <HoldingInfoRow
        label="Người giữ chỗ"
        value={
          <HoldingStatusBadge
            label={tenantLabel}
            tone={tenantSigned ? 'success' : tenantSimulated ? 'neutral' : 'warning'}
          />
        }
      />
      {!!status?.maskedEmail && (
        <HoldingInfoRow label="Email nhận lời mời" value={status.maskedEmail} />
      )}
      {!!status?.tenantAcceptedAt && (
        <HoldingInfoRow label="Thời gian ký" value={formatInstant(status.tenantAcceptedAt)} />
      )}
      {invitation?.status === 'OtpVerified' && (
        <Text>Đã xác minh OTP. Người giữ chỗ cần đọc và ký hợp đồng để hoàn tất.</Text>
      )}
      {invitation?.status === 'InvitationPendingManualDelivery' && (
        <Text style={ui.red}>
          Gửi email thất bại. Owner cần kiểm tra và thu hồi lời mời trước khi gửi lại.
        </Text>
      )}
      {!status?.ownerAcceptedAt && (
        <Text>Owner hoặc Tenant đều có thể ký trước. Cần đủ chữ ký hai bên để tiếp tục.</Text>
      )}
      {uncertain && (
        <Text style={ui.red}>
          Chưa xác định kết quả gửi. Kiểm tra lời mời trên Owner Web trước khi gửi lại.
        </Text>
      )}
      {!tenantSigned && !tenantSimulated && (
        <Button
          icon="email-outline"
          mode={canInvite ? 'contained' : 'text'}
          contentStyle={{ minHeight: 44 }}
          loading={busy === 'invite'}
          disabled={!!busy || !canInvite || !c.snapshotHash}
          onPress={() => void run('invite')}
        >
          Gửi thông báo ký hợp đồng
        </Button>
      )}
      {simulation && !tenantSigned && (
        <>
          <HoldingStatusBadge label="Chỉ dùng kiểm thử Sandbox" tone="warning" />
          <Text style={ui.muted}>Mô phỏng chỉ để kiểm thử, không tạo chữ ký thật.</Text>
          <Button
            mode="outlined"
            contentStyle={{ minHeight: 44 }}
            loading={busy === 'simulate'}
            disabled={!!busy || !status || tenantSimulated}
            onPress={() => void run('simulate')}
          >
            {tenantSimulated ? '✓ Người giữ chỗ đã ký (mô phỏng)' : 'Mô phỏng người giữ chỗ đã ký'}
          </Button>
        </>
      )}
      {!canContinue && (
        <Text style={ui.muted}>
          Chỉ tiếp tục khi backend xác nhận cả Owner và người giữ chỗ đã hoàn tất.
        </Text>
      )}
      {onContinue && (
        <Button
          mode={canContinue ? 'contained' : 'text'}
          icon="arrow-right"
          contentStyle={{ minHeight: 44 }}
          disabled={!!busy || !canContinue}
          onPress={onContinue}
        >
          Tiếp tục: tạo QR
        </Button>
      )}
      {!!success && <Text style={ui.green}>{success}</Text>}
      {!!error && <ContractNotice message={error} />}
    </HoldingSectionCard>
  );
}
