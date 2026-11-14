import { useState, useRef } from 'react';
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
    queryKey: ['internal-signing', contract.id, contract.status],
    queryFn: () => service.status(contract.id),
    refetchInterval: 5000,
  });
  const [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [sandboxReviewed, setSandboxReviewed] = useState(false),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
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
                  void run(() =>
                    service.ownerConfirm(
                      contract.id,
                      status.data!.documentHash ?? contract.snapshotHash!,
                    ),
                  )
                }
              >
                {busy ? 'Đang xác nhận…' : 'Xác nhận chữ ký Owner (Sandbox)'}
              </Button>
            </>
          )}
          {!contract.approvedAt && (
            <Typography>Phê duyệt hợp đồng trước khi xác nhận chữ ký.</Typography>
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
