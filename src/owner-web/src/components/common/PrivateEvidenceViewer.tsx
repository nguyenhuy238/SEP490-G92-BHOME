import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { requestDiagnostic } from '../../../../../packages/client-core/src/api';
import { Download } from 'lucide-react';

type PreviewType = 'image/png' | 'image/jpeg' | 'application/pdf';
type SafeFile = { blob: Blob; type: PreviewType | null };
type Preview = { url: string; type: PreviewType };

/**
 * Evidence GETs are not signing operations. Contract pages currently reuse
 * contractError, whose generic 503 fallback incorrectly mentions signing.
 * Keep the actual HTTP failure and safe request diagnostics, but do not imply
 * that an unavailable storage/backend dependency is a signing-provider error.
 */
function evidenceError(error: unknown, errorMessage?: (error: unknown) => string): string {
  const response = error as {
    status?: number;
    code?: string;
    problem?: { code?: string; correlationId?: string };
    requestPath?: string;
    correlationId?: string;
    method?: string;
  } | null;
  // ApiError carries the server trace inside problem, not on the error itself.
  // requestDiagnostic only includes UUID-shaped IDs, never arbitrary error details.
  const correlationId = response?.correlationId ?? response?.problem?.correlationId;
  const diagnostic = requestDiagnostic({
    status: response?.status,
    requestPath: response?.requestPath,
    method: response?.method,
    correlationId,
  });
  if ((response?.problem?.code ?? response?.code) === 'private_evidence_file_missing') {
    return (
      'Tệp bằng chứng đã được ghi nhận nhưng không còn trong kho lưu trữ. Cần khôi phục tệp gốc hoặc tải lại bằng chứng, không thể tải/xem từ metadata.' +
      diagnostic
    );
  }
  if (response?.status === 503) {
    return (
      'Máy chủ tạm thời chưa cung cấp được tệp bằng chứng. Dịch vụ lưu trữ hoặc thành phần liên quan có thể chưa sẵn sàng. Hãy thử lại sau hoặc báo quản trị viên kiểm tra hệ thống.' +
      diagnostic
    );
  }
  const message =
    errorMessage?.(error) ?? (error instanceof Error ? error.message : 'Không tải được chứng từ.');
  // Other statuses still use the caller's domain-specific mapping. Add only
  // the safe trace when it wasn't already rendered by that mapping.
  const trace = requestDiagnostic({ correlationId });
  return trace && !message.includes(trace) ? message + trace : message;
}

function readSignature(blob: Blob): Promise<Uint8Array> {
  const header = blob.slice(0, 16);
  if (typeof header.arrayBuffer === 'function') {
    return header.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  // jsdom and older browser Blob implementations expose FileReader but not
  // arrayBuffer(). Read only the header, never an entire private attachment.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Không đọc được chứng từ.'));
    reader.readAsArrayBuffer(header);
  });
}

export interface PrivateEvidenceViewerProps {
  /** A user-facing name, used in both accessible button labels and the dialog. */
  label: string;
  /** Display name only; it is never used as a URL or an untrusted extension. */
  filename: string;
  /** Fetch through the caller's authenticated, authorized API; never pass a public URL. */
  fetchBlob: (signal: AbortSignal) => Promise<Blob>;
  /** Optional server-side metadata. A conflicting MIME must never enable inline rendering. */
  contentType?: string;
  /** Optional trusted recorded byte count, when the API exposes it. */
  expectedSize?: number;
  errorMessage?: (error: unknown) => string;
  disabled?: boolean;
  /** Short action labels for the compact Owner handover PDF row only. */
  compactActions?: boolean;
}

function classify(blob: Blob, declaredType?: string): Promise<SafeFile> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('Chứng từ tải về rỗng hoặc không hợp lệ.');
  }
  const serverType = blob.type.toLowerCase().split(';')[0]?.trim() ?? '';
  const metadataType = declaredType?.toLowerCase().split(';')[0]?.trim() ?? '';
  // Many authorized binary endpoints return application/octet-stream. Only a
  // verified magic signature can promote that generic response to an inline MIME.
  const generic = !serverType || serverType === 'application/octet-stream';
  const type = metadataType || (generic ? '' : serverType);
  // A specific response MIME contradicting recorded metadata is never embedded.
  const matched = generic || !metadataType || serverType === metadataType;
  return readSignature(blob).then((signature) => {
    const png =
      signature.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((part, i) => signature[i] === part);
    const jpeg =
      signature.length >= 3 &&
      signature[0] === 0xff &&
      signature[1] === 0xd8 &&
      signature[2] === 0xff;
    const pdf =
      signature.length >= 5 && [37, 80, 68, 70, 45].every((part, i) => signature[i] === part);
    const safeType: PreviewType | null =
      matched && (!type || type === 'image/png') && png
        ? 'image/png'
        : matched && (!type || type === 'image/jpeg') && jpeg
          ? 'image/jpeg'
          : matched && (!type || type === 'application/pdf') && pdf
            ? 'application/pdf'
            : null;
    return { blob, type: safeType };
  });
}

function downloadName(name: string, type: PreviewType | null): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? '';
  const base =
    lastSegment
      .replace(/\.[^.]+$/, '')
      .replace(/[^\p{L}\p{N} _.-]/gu, '_')
      .replace(/^\.+/, '')
      .slice(0, 100)
      .trim() || 'chung-tu';
  const ext =
    type === 'image/png'
      ? 'png'
      : type === 'image/jpeg'
        ? 'jpg'
        : type === 'application/pdf'
          ? 'pdf'
          : 'bin';
  return `${base}.${ext}`;
}

/**
 * Private evidence is only fetched after the user explicitly chooses an action.
 * Never embeds server-provided HTML/SVG or uses unauthenticated attachment URLs.
 */
export function PrivateEvidenceViewer({
  label,
  filename,
  fetchBlob,
  contentType,
  expectedSize,
  errorMessage,
  disabled = false,
  compactActions = false,
}: PrivateEvidenceViewerProps) {
  const dialogTitleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<'preview' | 'download'>('preview');
  const busyRef = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const previewUrl = useRef<string | null>(null);
  const temporaryUrls = useRef(new Set<string>());
  const timeouts = useRef(new Set<number>());

  const revokePreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  };

  const revokeDownloads = () => {
    for (const timer of timeouts.current) window.clearTimeout(timer);
    timeouts.current.clear();
    for (const url of temporaryUrls.current) URL.revokeObjectURL(url);
    temporaryUrls.current.clear();
  };

  useEffect(() => {
    const pendingTimeouts = timeouts.current;
    const pendingTemporaryUrls = temporaryUrls.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
      busyRef.current = false;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
      for (const timer of pendingTimeouts) window.clearTimeout(timer);
      pendingTimeouts.clear();
      for (const url of pendingTemporaryUrls) URL.revokeObjectURL(url);
      pendingTemporaryUrls.clear();
    };
  }, []);

  const close = () => {
    requestId.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    busyRef.current = false;
    revokePreview();
    revokeDownloads();
    setOpen(false);
    setBusy(null);
    setUnsupported(false);
    setError('');
  };

  async function fetchFile(action: 'preview' | 'download') {
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    const id = ++requestId.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(action);
    setError('');
    if (action === 'preview') {
      setOpen(true);
      setUnsupported(false);
      revokePreview();
    }
    try {
      const blob = await fetchBlob(controller.signal);
      if (controller.signal.aborted || id !== requestId.current || !mounted.current) return;
      if (expectedSize !== undefined && blob.size !== expectedSize) {
        throw new Error('Kích thước chứng từ không khớp dữ liệu đã lưu.');
      }
      const file = await classify(blob, contentType);
      if (controller.signal.aborted || id !== requestId.current || !mounted.current) return;
      if (action === 'preview') {
        if (file.type) {
          // Give the browser a canonical MIME only after MIME AND magic-byte verification.
          const url = URL.createObjectURL(new Blob([file.blob], { type: file.type }));
          previewUrl.current = url;
          setPreview({ url, type: file.type });
        } else {
          setUnsupported(true);
        }
      } else {
        // Unsupported/ambiguous content is always forced to a passive binary download.
        const blobToSave = new Blob([file.blob], {
          type: file.type ?? 'application/octet-stream',
        });
        const url = URL.createObjectURL(blobToSave);
        temporaryUrls.current.add(url);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadName(filename, file.type);
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        try {
          anchor.click();
        } finally {
          anchor.remove();
          const timer = window.setTimeout(() => {
            URL.revokeObjectURL(url);
            temporaryUrls.current.delete(url);
            timeouts.current.delete(timer);
          }, 1000);
          timeouts.current.add(timer);
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && id === requestId.current && mounted.current) {
        setFailedAction(action);
        setError(evidenceError(cause, errorMessage));
      }
    } finally {
      if (id === requestId.current && mounted.current) {
        busyRef.current = false;
        activeRequest.current = null;
        setBusy(null);
      }
    }
  }

  return (
    <>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          size="small"
          type="button"
          variant="outlined"
          disabled={disabled || !!busy}
          onClick={() => void fetchFile('preview')}
        >
          {compactActions ? 'Xem PDF' : `Xem ${label}`}
        </Button>
        <Button
          size="small"
          type="button"
          startIcon={compactActions ? <Download size={16} aria-hidden="true" /> : undefined}
          disabled={disabled || !!busy}
          onClick={() => void fetchFile('download')}
        >
          {compactActions ? 'Tải xuống' : `Tải xuống ${label}`}
        </Button>
      </Stack>
      {error && !open && (
        <Alert
          severity="error"
          sx={{ mt: 1 }}
          action={<Button onClick={() => void fetchFile(failedAction)}>Thử lại</Button>}
        >
          {error}
        </Alert>
      )}
      <Dialog
        open={open}
        onClose={close}
        fullWidth
        maxWidth="lg"
        aria-labelledby={dialogTitleId}
        slotProps={{
          paper: { sx: { height: { xs: '100dvh', sm: 'min(85dvh, 900px)' }, m: { xs: 0, sm: 2 } } },
        }}
      >
        <DialogTitle id={dialogTitleId}>Xem {label}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {busy === 'preview' && (
            <Stack spacing={1} role="status">
              <LinearProgress />
              <Typography variant="body2">Đang tải chứng từ riêng tư…</Typography>
            </Stack>
          )}
          {error && (
            <Alert
              severity="error"
              action={
                <Button onClick={() => void fetchFile(failedAction)} disabled={!!busy}>
                  Thử lại
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          {unsupported && (
            <Alert severity="info">
              Tệp này không hỗ trợ xem trực tiếp. Hãy tải xuống để mở bằng ứng dụng phù hợp.
            </Alert>
          )}
          {preview?.type.startsWith('image/') && (
            <Box
              component="img"
              src={preview.url}
              alt={label}
              sx={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                mx: 'auto',
              }}
            />
          )}
          {preview?.type === 'application/pdf' && (
            <Box
              component="iframe"
              src={preview.url}
              title={`Nội dung PDF: ${label}`}
              // Chrome's built-in PDF viewer is a separate browser extension/
              // plugin. An empty iframe sandbox blocks that viewer entirely.
              // This path embeds only a signature-checked application/pdf Blob;
              // unsupported/HTML/SVG data never reaches the frame.
              referrerPolicy="no-referrer"
              sx={{ width: '100%', flex: 1, minHeight: 280, border: 0 }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ gap: 1, px: 2, py: 1.5 }}>
          {(unsupported || preview?.type === 'application/pdf') && (
            <Button disabled={!!busy || disabled} onClick={() => void fetchFile('download')}>
              {unsupported ? 'Tải xuống' : 'Tải PDF nếu không xem được'}
            </Button>
          )}
          <Button onClick={close}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
