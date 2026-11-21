import { useRef, useState } from 'react';
import { useObjectUrl } from './useObjectUrl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { signingError, type SigningClient } from '../../../../../packages/client-core/src/signing';

// "Ảnh chữ ký": the picture shown in the signer's signature box above "Ký bởi / Ngày ký". A transparent PNG
// (40–4000 px each side, at most 1 MB), or one generated from the signer's name.
export function SignatureImagePanel({ signing }: { signing: SigningClient }) {
  const queries = useQueryClient();
  const view = useQuery({
    staleTime: 0,
    queryKey: ['signature-image'],
    queryFn: ({ signal }) => signing.image(signal),
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const version = view.data?.present ? view.data.version : null;

  const url = useObjectUrl(
    'signature-image:' + (version ?? ''),
    version ? (signal) => signing.imageBlob(signal) : null,
  );

  async function run(work: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
      void queries.invalidateQueries({ queryKey: ['signature-image'] });
      void queries.invalidateQueries({ queryKey: ['signing-layout'] });
    }
  }

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Ảnh chữ ký của bạn</Typography>
      <Typography variant="body2" color="text.secondary">
        Ảnh hiện trong ô ký của bạn trên hợp đồng, phía trên dòng "Ký bởi / Ngày ký". Ảnh chỉ để
        hiển thị; giá trị pháp lý nằm ở chữ ký số MySign.
      </Typography>
      {view.isLoading && <LinearProgress aria-label="Đang tải ảnh chữ ký" />}
      {view.data && !view.data.present && <Alert severity="info">Bạn chưa có ảnh chữ ký.</Alert>}
      {view.data?.present && (
        <Box
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
            textAlign: 'center',
            backgroundImage:
              'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%)',
            backgroundSize: '16px 16px',
          }}
        >
          {url ? (
            <Box
              component="img"
              src={url}
              alt="Ảnh chữ ký hiện tại"
              sx={{ maxWidth: '100%', maxHeight: 120 }}
            />
          ) : (
            <LinearProgress />
          )}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {view.data.width} × {view.data.height} px
          </Typography>
        </Box>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          label="Họ tên để tạo ảnh"
          value={name}
          disabled={busy}
          slotProps={{ htmlInput: { maxLength: 60 } }}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          disabled={busy || name.trim().length < 2}
          onClick={() =>
            void run(() => signing.generateImage(name), 'Đã tạo ảnh chữ ký từ họ tên.')
          }
        >
          Tạo từ họ tên
        </Button>
        <Button disabled={busy} onClick={() => file.current?.click()}>
          Tải ảnh PNG lên
        </Button>
        {view.data?.present && (
          <Button
            color="error"
            disabled={busy}
            onClick={() => void run(() => signing.removeImage(), 'Đã xóa ảnh chữ ký.')}
          >
            Xóa ảnh
          </Button>
        )}
        <input
          ref={file}
          hidden
          type="file"
          accept="image/png"
          aria-label="Chọn ảnh chữ ký PNG"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (!chosen) return;
            if (chosen.type !== 'image/png') {
              setError('Ảnh phải là tệp PNG nền trong suốt.');
              return;
            }
            void run(
              async () => signing.uploadImage(await chosen.arrayBuffer()),
              'Đã lưu ảnh chữ ký.',
            );
          }}
        />
      </Stack>
      {busy && <LinearProgress />}
      {!!error && <Alert severity="error">{error}</Alert>}
      {!!notice && <Alert severity="success">{notice}</Alert>}
    </Stack>
  );
}
