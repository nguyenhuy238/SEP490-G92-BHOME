import { useState } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';

// Keep the authenticated object URL owned by the caller. The browser PDF toolbar
// provides page navigation, zoom, fit and print without re-rendering signed bytes.
export function ContractDocumentViewer({
  url,
  title,
  filename = 'Hop-dong.pdf',
}: {
  url: string;
  title: string;
  filename?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const frame = (height: string) => (
    <Box
      component="iframe"
      title={title}
      src={url}
      sx={{ display: 'block', width: '100%', height, border: 0, bgcolor: 'background.paper' }}
    />
  );
  const actions = (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Button size="small" component="a" href={url} download={filename}>
        Tải PDF
      </Button>
      <Button size="small" component="a" href={url} target="_blank" rel="noopener noreferrer">
        Mở PDF để in
      </Button>
      <Button size="small" onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
      </Button>
    </Stack>
  );
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      {!expanded && (
        <>
          <Stack spacing={0.5} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2">{title}</Typography>
            {actions}
          </Stack>
          {frame('min(70vh, 760px)')}
        </>
      )}
      <Dialog fullScreen open={expanded} onClose={() => setExpanded(false)} aria-label={title}>
        <DialogTitle
          sx={{
            py: 1,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Typography component="span" variant="subtitle1">
            {title}
          </Typography>
          {actions}
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: 'hidden' }}>
          {expanded && frame('100%')}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
