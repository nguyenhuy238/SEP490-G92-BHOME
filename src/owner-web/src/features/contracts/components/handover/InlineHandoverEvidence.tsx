import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { X } from 'lucide-react';

/** Read-only, authenticated image evidence. Never shows a download or exposes a storage URL. */
export function InlineHandoverEvidence({
  imageKey,
  label,
  fetchBlob,
}: {
  imageKey: string;
  label: string;
  fetchBlob: (signal: AbortSignal) => Promise<Blob>;
}) {
  const dialogTitle = useId();
  const latestFetch = useRef(fetchBlob);
  useEffect(() => {
    latestFetch.current = fetchBlob;
  }, [fetchBlob]);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let active = true;
    async function load() {
      try {
        const blob = await latestFetch.current(controller.signal);
        if (!(blob instanceof Blob) || !blob.size) throw new Error('Ảnh trống');
        const mime = blob.type.toLowerCase().split(';')[0]?.trim() ?? '';
        if (!['', 'application/octet-stream', 'image/png', 'image/jpeg'].includes(mime))
          throw new Error('Định dạng ảnh không hỗ trợ');
        const bytes = await new Promise<Uint8Array>((resolve, reject) => {
          const header = blob.slice(0, 8);
          if (typeof header.arrayBuffer === 'function') {
            void header.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
          } else {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.onerror = () => reject(new Error('Không đọc được ảnh'));
            reader.readAsArrayBuffer(header);
          }
        });
        const png = [137, 80, 78, 71, 13, 10, 26, 10].every((part, i) => bytes[i] === part);
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!png && !jpeg) throw new Error('Tệp không phải ảnh hợp lệ');
        const type = png ? 'image/png' : 'image/jpeg';
        if (mime.startsWith('image/') && mime !== type) throw new Error('Loại ảnh không khớp');
        if (!active || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([blob], { type }));
        setImage({ key: imageKey, url: objectUrl });
        setError(null);
      } catch {
        if (active && !controller.signal.aborted)
          setError({ key: imageKey, message: 'Không xem được ảnh riêng tư này.' });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageKey]);

  const url = image?.key === imageKey ? image.url : null;
  return (
    <>
      {url ? (
        <Box
          component="button"
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Xem lớn ${label}`}
          sx={{
            display: 'block',
            width: 104,
            height: 82,
            p: 0,
            cursor: 'zoom-in',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <Box
            component="img"
            src={url}
            alt={label}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Box>
      ) : error?.key === imageKey ? (
        <Alert severity="warning" sx={{ py: 0 }}>
          <Typography variant="caption">{error.message}</Typography>
        </Alert>
      ) : (
        <Skeleton aria-label={`Đang tải ${label}`} variant="rounded" width={104} height={82} />
      )}
      <Dialog
        open={expanded && !!url}
        onClose={() => setExpanded(false)}
        maxWidth="md"
        fullWidth
        aria-labelledby={dialogTitle}
      >
        <DialogTitle id={dialogTitle}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <Typography variant="subtitle1">{label}</Typography>
            <IconButton aria-label="Đóng ảnh" onClick={() => setExpanded(false)}>
              <X size={20} />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent
          dividers
          sx={{
            display: 'grid',
            placeItems: 'center',
            minHeight: 150,
            bgcolor: 'background.default',
          }}
        >
          {url && (
            <Box
              component="img"
              src={url}
              alt={label}
              sx={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
