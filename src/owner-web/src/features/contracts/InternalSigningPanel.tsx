import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import type {
  ContractClient,
  ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { contractActions, mutationKeys } from '../../../../../packages/client-core/src/contracts';
import { OwnerSigningPanel } from './OwnerSigningPanel';
import { useSigningMethods } from './useContractsApi';
import { OwnerContractPreview } from './OwnerContractPreview';
import { ContractActionDialog } from './ContractActionDialog';
import {
  internalSigningClient,
  signingMessage,
} from '../../../../../packages/client-core/src/internalSigning';

export function InternalSigningPanel({
  api,
  contract,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  onChanged: () => void;
}) {
  const service = internalSigningClient(api.transport);
  const status = useQuery({
    queryKey: [
      'internal-signing',
      contract.id,
      contract.status,
      contract.snapshotHash,
      contract.approvedAt,
    ],
    queryFn: () => service.status(contract.id),
    refetchInterval: 5000,
  });
  const [error, setError] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [sandboxReviewed, setSandboxReviewed] = useState(false),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setError('');
      setReviewed(false);
      setSandboxReviewed(false);
    });
    return () => {
      active = false;
    };
  }, [contract.id, contract.snapshotHash]);
  const liveInvitation = status.data?.invitations.find(
    (i) => !['Accepted', 'Revoked', 'Expired'].includes(i.status),
  );
  const signerLabel = contract.kind === 'Holding' ? 'người giữ chỗ' : 'người đại diện thuê';
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      await status.refetch();
      onChanged();
    } catch (e) {
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!contract.isDevelopmentDemo)
    return <RealInternalSigning api={api} contract={contract} onChanged={onChanged} />;
  if (contract.kind === 'Main' && status.data?.sandboxAvailable && !liveInvitation)
    return (
      <Stack spacing={2}>
        <Typography variant="h6">Xác nhận ký hợp đồng · Sandbox</Typography>
        {(error || status.error) && (
          <Alert severity="error">{error || signingMessage(status.error)}</Alert>
        )}
        {status.data.ownerAcceptedAt ? (
          <Alert severity="success">
            Owner đã xác nhận test.{' '}
            {status.data.canContinue
              ? 'Có thể tiếp tục tạo QR trên Mobile.'
              : 'Chờ Staff bấm mô phỏng Tenant ký trên Mobile.'}
          </Alert>
        ) : (
          <>
            <FormControlLabel
              label="Tôi là Owner, đã xem nội dung và xác nhận ký test"
              control={
                <Checkbox
                  checked={sandboxReviewed}
                  disabled={busy}
                  onChange={(_, value) => setSandboxReviewed(value)}
                />
              }
            />
            <Button
              variant="contained"
              disabled={
                busy ||
                !sandboxReviewed ||
                !status.data.documentHash ||
                contract.status !== 'PendingSigning'
              }
              onClick={() =>
                void run(() => service.ownerConfirm(contract.id, status.data!.documentHash!))
              }
            >
              {busy ? 'Đang xác nhận…' : 'Owner xác nhận ký (Sandbox)'}
            </Button>
          </>
        )}
      </Stack>
    );
  return (
    <Stack spacing={2}>
      {contract.kind === 'Holding' && status.data?.sandboxAvailable && (
        <Stack spacing={1.5} sx={{ p: 2, bgcolor: '#F5F7FB', borderRadius: 2 }}>
          <Typography variant="h6">Giả lập chữ ký Owner · Sandbox</Typography>
          {status.data.ownerAcceptedAt ? (
            <Alert severity="success">
              Owner đã xác nhận: {new Date(status.data.ownerAcceptedAt).toLocaleString('vi-VN')}
            </Alert>
          ) : (
            <>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sandboxReviewed}
                    disabled={busy}
                    onChange={(_, value) => setSandboxReviewed(value)}
                  />
                }
                label="Tôi là Owner, đồng ý nội dung và xác nhận chữ ký giả lập cho hợp đồng này"
              />
              <Button
                variant="contained"
                disabled={
                  busy ||
                  !sandboxReviewed ||
                  !contract.snapshotHash ||
                  !['Draft', 'PendingSigning', 'PendingActivation'].includes(contract.status)
                }
                onClick={() =>
                  void run(() => service.ownerConfirm(contract.id, contract.snapshotHash!))
                }
              >
                {busy ? 'Đang xác nhận…' : 'Xác nhận chữ ký Owner (Sandbox)'}
              </Button>
            </>
          )}
          <Typography>
            {status.data.tenantAcceptedAt
              ? 'Tenant đã ký.'
              : status.data.tenantSimulated
                ? 'Staff đã xác nhận Tenant mô phỏng.'
                : 'Chờ Tenant ký hoặc Staff bấm mô phỏng Tenant trên Mobile.'}
          </Typography>
          <Typography>
            {status.data.canContinue
              ? 'Backend đã xác nhận đủ hai bên. Staff có thể tiếp tục tạo QR trên Mobile.'
              : 'Chỉ khi đủ xác nhận của Owner và Tenant, backend mới cho sang bước QR.'}
          </Typography>
        </Stack>
      )}
      <Typography variant="h6">Ký nội bộ qua OTP</Typography>
      <Alert severity="info">
        Người đại diện xác nhận đúng PDF, đồng ý và vẽ chữ ký trước khi có tài khoản. Owner xác nhận
        sau đó. Tài khoản chỉ được tạo sau khi Main Active.
      </Alert>
      <Alert severity="warning">
        Đây là chấp thuận điện tử nội bộ, không phải chữ ký số CA hoặc kết quả MySign.
      </Alert>
      {(error || status.error) && (
        <Alert severity="error">{error || signingMessage(status.error)}</Alert>
      )}
      <Typography>Trạng thái: {status.data?.state ?? 'Đang tải…'}</Typography>
      <FormControlLabel
        label="Tôi đã đọc đúng PDF và đồng ý nội dung hợp đồng"
        control={
          <Checkbox checked={reviewed} onChange={(_, v) => setReviewed(v)} disabled={busy} />
        }
      />
      {liveInvitation && (
        <Alert
          severity={liveInvitation.status === 'InvitationPendingManualDelivery' ? 'error' : 'info'}
        >
          {liveInvitation.status === 'InvitationAcceptedByProvider'
            ? `Dịch vụ email đã tiếp nhận lời mời. Chờ ${signerLabel} mở email và ký.`
            : liveInvitation.status === 'OtpVerified'
              ? `Đã xác minh OTP, ${signerLabel} chưa hoàn tất ký.`
              : liveInvitation.status === 'InvitationPendingManualDelivery'
                ? 'Gửi email thất bại. Kiểm tra cấu hình, thu hồi lời mời rồi gửi lại.'
                : `Đã tạo lời mời. Chưa xác nhận gửi email hoặc đang chờ ${signerLabel} ký.`}
        </Alert>
      )}
      {status.data?.invitations
        .filter((i) => !['Accepted', 'Revoked', 'Expired'].includes(i.status))
        .map((i) => (
          <Button
            key={i.id}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await service.revoke(contract.id, i.id);
              })
            }
          >
            Thu hồi lời mời chưa ký
          </Button>
        ))}
      {(status.data?.tenantAcceptedAt || status.data?.tenantSimulated) &&
        !(status.data.sandboxAvailable && !status.data.tenantAcceptedAt) &&
        !status.data.ownerAcceptedAt && (
          <Button
            disabled={busy || !reviewed}
            onClick={() =>
              void run(() => service.ownerConfirm(contract.id, status.data!.documentHash!))
            }
          >
            Xác nhận chấp thuận của Owner
          </Button>
        )}
      <Button disabled={busy} onClick={() => void status.refetch()}>
        Cập nhật trạng thái ký
      </Button>
    </Stack>
  );
}

function RealInternalSigning({
  api,
  contract,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  onChanged: () => void;
}) {
  const service = internalSigningClient(api.transport);
  const methods = useSigningMethods(api);
  const query = useQuery({
    queryKey: ['real-internal-signing', contract.id, contract.snapshotHash],
    queryFn: async () => ({
      contract: await api.get(contract.id),
      status: await service.status(contract.id),
    }),
    refetchInterval: 5000,
  });
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  const c = query.data?.contract ?? contract;
  const status = query.data?.status;
  const live = status?.invitations.find(
    (i) => !['Accepted', 'Revoked', 'Expired'].includes(i.status),
  );
  const actions =
    (status?.tenantAcceptedAt || ['Holding', 'Main'].includes(c.kind)) && methods
      ? contractActions(c, null, 'Owner', c.ownerSignerId, methods.methods).filter((a) =>
          a.operation.startsWith('signing'),
        )
      : [];
  const action = actions.find((a) => a.operation === operation);
  async function run(work: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      await query.refetch();
      onChanged();
    } catch (e) {
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Ký hợp đồng · Owner và đại diện người thuê</Typography>
      <Alert severity="info">
        {['Holding', 'Main'].includes(c.kind)
          ? 'Xem PDF và ký phần Chủ nhà. Staff gửi lời mời ký cho người thuê trên Mobile; hai bên có thể ký theo bất kỳ thứ tự nào.'
          : 'Người thuê xác minh OTP và ký qua lời mời trước. Owner ký tiếp trên PDF đó.'}{' '}
        OTP và dấu BHOME không phải chữ ký số cá nhân được CA chứng thực.
      </Alert>
      <Typography>
        Người thuê: {status?.tenantAcceptedAt ? `Đã ký · ${status.tenantAcceptedAt}` : 'Chờ ký'}
      </Typography>
      <Typography>
        Owner: {status?.ownerAcceptedAt ? `Đã ký · ${status.ownerAcceptedAt}` : 'Chờ ký'}
      </Typography>
      {(error || query.error) && (
        <Alert severity="error">{error || signingMessage(query.error)}</Alert>
      )}
      <OwnerContractPreview api={api} contract={c} accepted={!!status?.tenantAcceptedAt} />
      {live && <Typography>{status?.maskedEmail}</Typography>}
      {(!!status?.tenantAcceptedAt || ['Holding', 'Main'].includes(c.kind)) && (
        <OwnerSigningPanel
          api={api}
          contract={c}
          actorId={c.ownerSignerId}
          methods={methods}
          onChanged={() => void run(async () => {})}
        />
      )}
      {actions.map((a) => (
        <Button key={a.operation} disabled={busy} onClick={() => setOperation(a.operation)}>
          {a.label}
        </Button>
      ))}
      {action && (
        <ContractActionDialog
          api={api}
          contract={c}
          actorId={c.ownerSignerId}
          action={action}
          keys={keys}
          onClose={() => setOperation('')}
          onSuccess={() => {
            setOperation('');
            void run(async () => {});
          }}
        />
      )}
      <Button disabled={busy} onClick={() => void run(async () => {})}>
        Làm mới trạng thái ký
      </Button>
      {status?.canContinue && c.status === 'PendingActivation' && (
        <Alert severity="success">Đủ chữ ký. Có thể tiếp tục bước thanh toán hiện có.</Alert>
      )}
    </Stack>
  );
}
