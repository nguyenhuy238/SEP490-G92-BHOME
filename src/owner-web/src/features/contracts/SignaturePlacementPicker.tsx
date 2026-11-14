import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useObjectUrl } from './useObjectUrl';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  boxHeight,
  clampPlacement,
  signingError,
  type SignaturePlacement,
  type SigningClient,
} from '../../../../../packages/client-core/src/signing';

export interface PlacementChoice {
  placement: SignaturePlacement | null;
  usePicture: boolean;
}

// The page of the contract the signer is about to sign, with their signature box on it: drag the box (or click the
// page) to move it, change its size, or pick another page. Starts in the signer's own box of the signature block.
export function SignaturePlacementPicker({
  signing,
  contractId,
  value,
  onChange,
  disabled,
  caption,
}: {
  signing: SigningClient;
  contractId: string;
  value: PlacementChoice;
  onChange: (value: PlacementChoice) => void;
  disabled?: boolean;
  /** The lines the server writes in the box; MySign wording by default. */
  caption?: string;
}) {
  const layout = useQuery({
    staleTime: 0,
    queryKey: ['signing-layout', contractId],
    queryFn: async ({ signal }) => {
      const data = await signing.layout(contractId, signal);
      if (!Array.isArray(data?.pages) || !data.pages.length || data.pageCount !== data.pages.length)
        throw new Error('Không đọc được các trang của hợp đồng.');
      return data;
    },
  });
  const picture = useQuery({
    staleTime: 0,
    queryKey: ['signature-image'],
    queryFn: ({ signal }) => signing.image(signal),
  });
  const pictureUrl = useObjectUrl(
    'signature-image:' + (picture.data?.version ?? ''),
    picture.data?.present ? (signal) => signing.imageBlob(signal) : null,
  );
  const pageNumber =
    value.placement?.page ?? layout.data?.suggested?.page ?? layout.data?.pageCount ?? 1;
  const pageUrl = useObjectUrl(
    `signing-page:${contractId}:${pageNumber}`,
    layout.data ? (signal) => signing.pageBlob(contractId, pageNumber, 900, signal) : null,
  );
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const pages = layout.data?.pages ?? [];
  const size = pages[pageNumber - 1] ?? { width: 595, height: 842 };
  const shownPicture = picture.data?.present ? picture.data : null;

  // First load: start from the suggested box (the signer's place in the signature block).
  useEffect(() => {
    if (!layout.data || value.placement) return;
    const start = layout.data.suggested ?? {
      page: layout.data.pageCount,
      x: 0.55,
      y: 0.7,
      width: 0.35,
    };
    onChange({
      placement: clampPlacement(start, layout.data.pages, shownPicture, value.usePicture),
      usePicture: value.usePicture && !!layout.data.hasPicture,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.data]);

  function set(next: Partial<SignaturePlacement>, usePicture = value.usePicture) {
    if (!value.placement) return;
    onChange({
      placement: clampPlacement({ ...value.placement, ...next }, pages, shownPicture, usePicture),
      usePicture,
    });
  }
  function point(e: ReactPointerEvent) {
    const rect = surface.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  if (layout.isLoading) return <LinearProgress aria-label="Đang tải trang ký" />;
  if (layout.error)
    return (
      <Alert severity="warning">
        {signingError(layout.error)} Nếu vẫn gửi, chữ ký đặt vào ô ký mặc định của bạn.
        <Button onClick={() => void layout.refetch()}>Tải lại</Button>
      </Alert>
    );
  if (!layout.data || !value.placement) return null;
  const p = value.placement;
  const height = boxHeight(p.width, size, shownPicture, value.usePicture);

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Vị trí chữ ký trên hợp đồng</Typography>
      <Typography variant="body2" color="text.secondary">
        Kéo ô màu xanh tới chỗ muốn ký (hoặc bấm vào trang). Mặc định là ô{' '}
        {layout.data.party === 'Owner' ? 'Bên A (Chủ nhà)' : 'Bên B (Người thuê)'} ở cuối hợp đồng.
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {layout.data.pageCount > 1 && (
          <TextField
            select
            size="small"
            label="Trang"
            value={p.page}
            disabled={disabled}
            onChange={(e) => set({ page: Number(e.target.value) })}
          >
            {Array.from({ length: layout.data.pageCount }, (_, i) => (
              <MenuItem key={i + 1} value={i + 1}>
                Trang {i + 1}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Box sx={{ minWidth: 180, flex: 1 }}>
          <Typography variant="caption">Cỡ ô chữ ký</Typography>
          <Slider
            size="small"
            min={0.15}
            max={0.6}
            step={0.01}
            value={p.width}
            disabled={disabled}
            aria-label="Cỡ ô chữ ký"
            onChange={(_, w) => set({ width: w as number })}
          />
        </Box>
        {layout.data.suggested && (
          <Button
            size="small"
            disabled={disabled}
            onClick={() =>
              onChange({
                placement: clampPlacement(
                  layout.data!.suggested!,
                  pages,
                  shownPicture,
                  value.usePicture,
                ),
                usePicture: value.usePicture,
              })
            }
          >
            Về ô ký mặc định
          </Button>
        )}
      </Stack>
      <FormControlLabel
        control={
          <Checkbox
            checked={value.usePicture && !!shownPicture}
            disabled={disabled || !shownPicture}
            onChange={(e) => set({}, e.target.checked)}
          />
        }
        label={
          shownPicture
            ? 'Hiển thị ảnh chữ ký của tôi trong ô ký'
            : 'Chưa có ảnh chữ ký: ô ký chỉ ghi "Ký bởi / Ngày ký" (thêm ảnh ở phần Ảnh chữ ký)'
        }
      />
      <Box
        ref={surface}
        role="application"
        aria-label={`Trang ${p.page} của hợp đồng`}
        onPointerDown={(e) => {
          if (disabled || e.target !== e.currentTarget) return;
          const at = point(e);
          set({ x: at.x - p.width / 2, y: at.y - height / 2 });
        }}
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 560,
          mx: 'auto',
          aspectRatio: `${size.width} / ${size.height}`,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'grey.100',
          backgroundImage: pageUrl ? `url(${pageUrl})` : undefined,
          backgroundSize: '100% 100%',
          userSelect: 'none',
          touchAction: 'none',
          cursor: disabled ? 'default' : 'crosshair',
        }}
      >
        {!pageUrl && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />}
        <Box
          aria-label="Ô chữ ký"
          onPointerDown={(e) => {
            if (disabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const at = point(e);
            drag.current = { dx: at.x - p.x, dy: at.y - p.y };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const at = point(e);
            set({ x: at.x - drag.current.dx, y: at.y - drag.current.dy });
          }}
          onPointerUp={() => (drag.current = null)}
          sx={{
            position: 'absolute',
            left: `${p.x * 100}%`,
            top: `${p.y * 100}%`,
            width: `${p.width * 100}%`,
            height: `${height * 100}%`,
            border: '2px solid',
            borderColor: 'primary.main',
            bgcolor: 'rgba(25,118,210,0.08)',
            cursor: disabled ? 'default' : 'move',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            p: '2px',
          }}
        >
          {value.usePicture && shownPicture && pictureUrl && (
            <Box
              component="img"
              src={pictureUrl}
              alt="Ảnh chữ ký"
              draggable={false}
              sx={{ width: '100%', pointerEvents: 'none' }}
            />
          )}
          <Typography
            component="span"
            sx={{
              color: 'error.main',
              fontSize: 'clamp(6px, 1.4vw, 11px)',
              lineHeight: 1.15,
              whiteSpace: 'pre-line',
            }}
          >
            {caption ?? (
              <>
                Ký bởi: {layout.data.signerName || 'tên trên chứng thư'}
                <br />
                Ngày ký: lúc xác nhận trên MySign
              </>
            )}
          </Typography>
        </Box>
      </Box>
    </Stack>
  );
}
