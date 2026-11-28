import type { ReactNode } from 'react';
import { Dialog, DialogContent, IconButton, Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { X } from 'lucide-react';
import { operationalDetailPaper } from './operationalDetailLayout';

// Both work orders and reports use the same overlay as ordinary task details.
// The caller keeps the queue mounted and owns the URL/selection.
export function OperationalDetailDialog({
  title,
  recordKey,
  close,
  children,
}: {
  title: string;
  recordKey: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      aria-labelledby="operational-detail-title"
      onClose={(_, reason) => {
        if (reason === 'escapeKeyDown') close();
      }}
      slotProps={{
        paper: {
          sx: operationalDetailPaper,
        },
      }}
    >
      <Box component="span" id="operational-detail-title" sx={visuallyHidden}>
        {title}
      </Box>
      <IconButton
        aria-label="Đóng chi tiết"
        onClick={close}
        sx={{
          position: 'absolute',
          right: { xs: 8, md: 16 },
          top: 10,
          zIndex: 3,
          bgcolor: 'background.paper',
        }}
      >
        <X size={20} />
      </IconButton>
      <DialogContent
        key={recordKey}
        sx={{ px: { xs: 2, md: 3 }, pt: 1.5, pb: 2, minHeight: 0, overflowX: 'hidden' }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
