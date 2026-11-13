import { useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useMeterApi } from '../meters/useMeterApi';

// Evidence is served behind Owner auth, so a plain <img src> cannot load it.
// Fetch the bytes with the session and render them through an object URL.
export function IncidentEvidencePreview({ path, alt }: { path: string; alt: string }) {
  const { request } = useMeterApi();
  // State is tagged with the path it belongs to, so a path change shows the spinner
  // without resetting state inside the effect.
  const [loaded, setLoaded] = useState<{ path: string; url: string | null }>();
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    request<Blob>(path, { signal: controller.signal }, 'blob')
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ path, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ path, url: null });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, request]);
  const current = loaded?.path === path ? loaded : undefined;
  const url = current?.url;
  if (current && !url)
    return (
      <Typography variant="caption" color="error">
        Không tải được ảnh xem trước.
      </Typography>
    );
  if (!url) return <CircularProgress size={24} aria-label="Đang tải ảnh bằng chứng" />;
  return (
    <Box
      component="a"
      href={url}
      target="_blank"
      rel="noopener"
      sx={{ display: 'inline-block', lineHeight: 0 }}
    >
      <Box
        component="img"
        src={url}
        alt={alt}
        sx={{
          width: 160,
          height: 160,
          objectFit: 'cover',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      />
    </Box>
  );
}
