// Shared dimensions for every operational detail overlay.
// The content owns its actual record title; the dialog retains an accessible name.
export const operationalDetailPaper = {
  width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' },
  maxWidth: 1280,
  maxHeight: '92dvh',
  m: { xs: 1, sm: 2 },
  borderRadius: { xs: 2, sm: 3 },
  overflow: 'hidden',
  '& .MuiButton-root': { borderRadius: '10px', minHeight: { xs: 44, sm: 36 }, fontSize: 14 },
} as const;

export const operationalFacts = {
  display: 'grid',
  gridTemplateColumns: {
    xs: 'repeat(2, minmax(0, 1fr))',
    md: 'repeat(3, minmax(0, 1fr))',
  },
  gap: 1.5,
  px: 1.5,
  py: 1,
  borderRadius: 1,
  bgcolor: 'action.hover',
} as const;

export const operationalTabs = {
  minHeight: 42,
  '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontWeight: 600 },
} as const;
