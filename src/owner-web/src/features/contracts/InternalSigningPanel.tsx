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
  });
  const [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
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
                  encodeURIComponent(issued.token),
              );
            })
          }
        >
          Duyệt và tạo lời mời ký
        </Button>
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
      {status.data?.tenantAcceptedAt && !status.data.ownerAcceptedAt && (
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
