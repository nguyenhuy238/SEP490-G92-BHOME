import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type {
  ContractClient,
  ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { contractActions, mutationKeys } from '../../../../../packages/client-core/src/contracts';
import { OwnerSigningPanel } from './OwnerSigningPanel';
import { useSigningApi, useSigningMethods } from './useContractsApi';
import { SignaturePlacementPicker } from './SignaturePlacementPicker';
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
  const [link, setLink] = useState(''),
    [error, setError] = useState(''),
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
      setLink('');
    });
    return () => {
      active = false;
    };
  }, [contract.id, contract.snapshotHash]);
  const liveInvitation = status.data?.invitations.find(
    (i) => !['Accepted', 'Revoked', 'Expired'].includes(i.status),
  );
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
  if (contract.kind === 'Main' && status.data?.sandboxAvailable)
    return (
      <Stack spacing={2}>
        <Typography variant="h6">Xác nhận ký hợp đồng · Sandbox</Typography>
        <Alert severity="warning">
          Chỉ dùng cho kiểm thử: Owner xác nhận trên Web, Staff mô phỏng Tenant ký trên Mobile.
          Người thuê chưa ký OTP; thao tác này không phải chữ ký số hoặc bằng chứng ký thật của
          Tenant.
        </Alert>
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
          <Alert severity="warning">
            Chỉ dùng cho kiểm thử, không phải chữ ký số và không có giá trị pháp lý.
          </Alert>
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
                  !contract.approvedAt ||
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
          {!contract.approvedAt && (
            <Stack spacing={1}>
              <Typography>
                Hợp đồng chưa được phê duyệt. Phê duyệt trước, sau đó xác nhận chữ ký Owner.
              </Typography>
              <Button
                variant="outlined"
                disabled={busy || contract.status !== 'Draft'}
                onClick={() =>
                  void run(async () => {
                    await api.mutate(
                      contract.id,
                      'holding-approval',
                      { reason: 'Owner phê duyệt hợp đồng giữ chỗ trên Web' },
                      crypto.randomUUID(),
                    );
                  })
                }
              >
                Phê duyệt hợp đồng giữ chỗ
              </Button>
            </Stack>
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
      {['Draft', 'PendingSigning'].includes(contract.status) && !status.data?.tenantAcceptedAt && (
        <Button
          disabled={
            busy ||
            !reviewed ||
            !contract.snapshotHash ||
            !!liveInvitation ||
            (contract.kind === 'Holding' && !contract.approvedAt)
          }
          onClick={() =>
            void run(async () => {
              const issued = await service.invite(
                contract.id,
                contract.snapshotHash!,
                new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              );
              setLink(
                window.location.origin +
                  '/contract-signing#token=' +
                  encodeURIComponent(issued.token ?? ''),
              );
            })
          }
        >
          Duyệt và tạo lời mời ký
        </Button>
      )}
      {liveInvitation && (
        <Alert
          severity={liveInvitation.status === 'InvitationPendingManualDelivery' ? 'error' : 'info'}
        >
          {liveInvitation.status === 'InvitationAcceptedByProvider'
            ? 'Dịch vụ email đã tiếp nhận lời mời. Chờ người giữ chỗ mở email và ký.'
            : liveInvitation.status === 'OtpVerified'
              ? 'Đã xác minh OTP, người giữ chỗ chưa hoàn tất ký.'
              : liveInvitation.status === 'InvitationPendingManualDelivery'
                ? 'Gửi email thất bại. Kiểm tra cấu hình, thu hồi lời mời rồi gửi lại.'
                : 'Đã tạo lời mời. Chưa xác nhận gửi email hoặc đang chờ người giữ chỗ ký.'}
        </Alert>
      )}
      {link && (
        <TextField
          label="Liên kết gửi riêng cho người đại diện"
          value={link}
          slotProps={{ input: { readOnly: true } }}
          helperText="Chỉ hiển thị lần này. Liên kết mới sẽ thu hồi lời mời cũ chưa chấp thuận."
        />
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
                setLink('');
              })
            }
          >
            Thu hồi lời mời chưa ký
          </Button>
        ))}
      {status.data?.tenantSimulated && (
        <Alert severity="warning">
          Tenant đã xác nhận mô phỏng trên Sandbox. Owner xác nhận bằng tài khoản của mình; đây
          không phải chữ ký Tenant thật.
        </Alert>
      )}
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
  const signing = useSigningApi(api);
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
  const [uncertainInvitation, setUncertainInvitation] = useState(false);
  const [emails, setEmails] = useState<Record<string, string>>({});
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
    status?.tenantAcceptedAt && methods
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
        Người thuê xác minh OTP và ký qua lời mời trước. Owner ký tiếp trên PDF đó. OTP và dấu BHOME
        không phải chữ ký số cá nhân được CA chứng thực.
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
      {!status?.tenantAcceptedAt && (
        <>
          {!live && (c.occupants?.length ? c.occupants : [{ id: c.representativeResidentId, label: 'Người đại diện', representative: true }]).map((person) => (
            <TextField key={person.id} label={`Email nhận lời mời · ${person.label}`} type="email" value={emails[person.id] ?? ''}
              onChange={(e) => setEmails((before) => ({ ...before, [person.id]: e.target.value }))} disabled={busy} />
          ))}
          {!live && <Typography variant="body2">Email chỉ dùng cho phiên ký này; tài khoản Tenant được tạo sau khi kích hoạt hợp đồng chính thức.</Typography>}
          <SignaturePlacementPicker
            signing={signing}
            contractId={c.id}
            value={{ placement: null, usePicture: false }}
            onChange={() => {}}
            disabled
          />
          {live && (
            <Typography>
              Lời mời: {live.status} · {status?.maskedEmail}
            </Typography>
          )}
          {live &&
            ['OwnerApprovedLink', 'InvitationPendingManualDelivery'].includes(live.status) && (
              <Alert severity="warning">
                Chưa xác nhận gửi email thành công. Kiểm tra cấu hình và thu hồi lời mời trước khi
                gửi lại.
              </Alert>
            )}
          {uncertainInvitation && !live && (
            <Alert severity="warning">
              Chưa xác định kết quả gửi. Kiểm tra trạng thái lời mời trước khi thao tác lại.
            </Alert>
          )}
          <Button
            disabled={
              busy ||
              uncertainInvitation ||
              !status ||
              !!live ||
              !c.snapshotHash ||
              (c.kind === 'Holding' && !c.approvedAt)
            }
            onClick={() =>
              void run(async () => {
                const latest = await service.status(c.id);
                if (
                  latest.tenantAcceptedAt ||
                  latest.invitations.some(
                    (i) => !['Accepted', 'Revoked', 'Expired'].includes(i.status),
                  )
                )
                  return;
                setUncertainInvitation(true);
                await service.invite(
                  c.id,
                  c.snapshotHash!,
                  new Date(
                    Math.min(
                      Date.now() + 3600000,
                      Date.parse(c.holdingExpiresAt ?? '') || Infinity,
                    ),
                  ).toISOString(),
                  emails[c.representativeResidentId],
                  Object.entries(emails).filter(([, email]) => email.trim()).map(([residentId, email]) => ({ residentId, email })),
                );
                setUncertainInvitation(false);
              })
            }
          >
            Gửi lời mời ký qua email
          </Button>
          {live && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await service.revoke(c.id, live.id);
                  setUncertainInvitation(false);
                })
              }
            >
              Thu hồi lời mời chưa ký
            </Button>
          )}
        </>
      )}
      {!!status?.tenantAcceptedAt && (
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
