import type { ReactNode } from 'react';
import { Box } from '@mui/material';

export function StaffWorkspace({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        '& > .MuiStack-root': { gap: 3 },
        '& .MuiPaper-root': { borderRadius: 3, boxShadow: 'none', border: '1px solid #e3e9f2' },
        '& .MuiTableHead-root .MuiTableCell-root': {
          bgcolor: '#f5f8fc',
          color: '#52627a',
          fontWeight: 700,
          py: 1.75,
          whiteSpace: 'nowrap',
        },
        '& .MuiTableBody-root .MuiTableRow-root': { '&:hover': { bgcolor: '#f5f9ff' } },
        '& .MuiTableCell-root': { py: 2, borderColor: '#edf1f7' },
        '& .MuiButton-root': { borderRadius: 2, textTransform: 'none', fontWeight: 650 },
        '& .MuiTabs-root': { px: 1, minHeight: 58 },
        '& .MuiTab-root': { minHeight: 58, textTransform: 'none', fontWeight: 700 },
        '& .MuiAlert-root': { borderRadius: 2 },
      }}
    >
      {children}
    </Box>
  );
}
