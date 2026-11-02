import { useRef, useState } from 'react';
import { Alert, Button, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import {
  certificateStatus,
  contractError,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useSigningCertificates } from '../../../../../packages/client-core/src/useSigningCertificates';
import { formatInstant } from '../../../../../packages/client-core/src/localization';

export function SigningCertificates({ api }: { api: ContractClient }) {
  const [open, setOpen] = useState(false);
  const [subscriber, setSubscriber] = useState(''),
    [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  const directory = useSigningCertificates(api, open);
  async function run(work: () => Promise<unknown>, message: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setSubscriber('');
      setSerial('');
      setNotice(message);
      directory.reload();
    } catch (e) {
      setError(contractError(e));
      directory.reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1}>
      <Button
        disabled={busy}
        onClick={() => {
          setOpen((value) => !value);
          directory.reload();
        }}
      >
        {open ? 'Đóng quản lý chứng thư' : 'Khai báo chứng thư MySign của bạn'}
      </Button>
      {open && (
        <>
          <Typography variant="subtitle2">Chứng thư MySign của bạn</Typography>
          <Typography variant="body2">
            Khai báo chứng thư không đồng nghĩa đã ký hợp đồng. Xác nhận ký trên ứng dụng MySign khi
            có yêu cầu.
          </Typography>
          {directory.loading && <LinearProgress aria-label="Đang tải chứng thư" />}
          {!!directory.error && <Alert severity="error">{directory.error}</Alert>}
          {!directory.loading && !directory.error && !directory.certificates.length && (
            <Alert severity="info">Bạn chưa khai báo chứng thư MySign.</Alert>
          )}
          {directory.certificates.map((c) => (
            <Paper key={c.id} variant="outlined" sx={{ p: 1.5 }}>
              <Typography sx={{ overflowWrap: 'anywhere' }}>
                {c.provider} · {c.serialNumber}
              </Typography>
              <Typography variant="body2">
                Thuê bao: {c.providerUserIdHint} · {certificateStatus(c)}
              </Typography>
              <Typography variant="body2">Hết hạn: {formatInstant(c.validTo)}</Typography>
              <Button
                disabled={busy || directory.loading}
                onClick={() =>
                  void run(
                    () => api.lockCertificate(c.id, !c.locked),
                    c.locked
                      ? 'Đã mở khóa chứng thư. Máy chủ vẫn kiểm tra hiệu lực khi ký.'
                      : 'Đã khóa chứng thư cho các yêu cầu ký mới.',
                  )
                }
              >
                {c.locked ? 'Mở khóa chứng thư' : 'Khóa chứng thư'}
              </Button>
            </Paper>
          ))}
          <Button disabled={busy || directory.loading} onClick={directory.reload}>
            Tải lại chứng thư
          </Button>
          <TextField
            label="Mã thuê bao MySign của bạn"
            value={subscriber}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            onChange={(e) => setSubscriber(e.target.value)}
          />
          <TextField
            label="Số serial (tùy chọn)"
            value={serial}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 100 } }}
            onChange={(e) => setSerial(e.target.value)}
          />
          <Button
            disabled={busy || !subscriber.trim() || subscriber.length > 100 || serial.length > 100}
            onClick={() =>
              void run(
                () => api.declareCertificate(subscriber.trim(), serial.trim()),
                'Đã truy vấn và lưu chứng thư từ nhà cung cấp.',
              )
            }
          >
            {busy ? 'Đang xử lý…' : 'Tra cứu và lưu chứng thư'}
          </Button>
          {!!error && <Alert severity="error">{error}</Alert>}
          {!!notice && <Alert severity="success">{notice}</Alert>}
        </>
      )}
    </Stack>
  );
}
