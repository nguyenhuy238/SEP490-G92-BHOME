// Shared dialog layout for the real-API configuration workflows.
export const configurationDialogPaperSx = {
  '@media (max-width:599px)': {
    m: 0,
    width: '100%',
    maxWidth: '100%',
    height: '100%',
    maxHeight: '100%',
    borderRadius: 0,
  },
} as const;

export const configurationDialogContentSx = {
  px: { xs: 1.5, sm: 2 },
  py: 2,
  minWidth: 0,
  overflowWrap: 'anywhere',
} as const;

export const configurationFormGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
  gap: 1.5,
  alignItems: 'start',
} as const;

export function formatConfigurationDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
}

export function configurationStatusLabel(status: string) {
  return status === 'Draft'
    ? 'Bản nháp'
    : status === 'Published'
      ? 'Đã công bố'
      : status === 'Archived'
        ? 'Đã lưu trữ'
        : status;
}
