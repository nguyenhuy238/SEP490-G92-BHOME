import { createTheme } from '@mui/material/styles';
import { viVN } from '@mui/material/locale';

// Shared Owner Portal tokens from Stitch; Public Web remains independent.
export const theme = createTheme(
  {
    palette: {
      primary: { main: '#255dde', dark: '#194cbb', light: '#ebf2ff' },
      secondary: { main: '#53657f' },
      success: { main: '#18764a', dark: '#176b43' },
      warning: { main: '#a6650c', dark: '#925409' },
      error: { main: '#b93838', dark: '#9a2929' },
      background: { default: '#f6f8fc', paper: '#ffffff' },
      text: { primary: '#15243e', secondary: '#53657f' },
      divider: '#e6ebf2',
    },
    typography: {
      fontFamily: 'Inter, Roboto, Arial, sans-serif',
      fontSize: 14,
      h1: { fontSize: '1.5rem', lineHeight: 1.3, fontWeight: 750, letterSpacing: '-0.025em' },
      h2: { fontSize: '1.125rem', lineHeight: 1.4, fontWeight: 700, letterSpacing: '-0.01em' },
      h3: { fontSize: '1rem', lineHeight: 1.4, fontWeight: 700 },
      h4: { fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 700 },
      h5: { fontSize: '1.125rem', lineHeight: 1.4, fontWeight: 700 },
      h6: { fontSize: '1rem', lineHeight: 1.4, fontWeight: 700 },
      body1: { fontSize: '0.875rem', lineHeight: 1.55 },
      body2: { fontSize: '0.875rem', lineHeight: 1.55 },
      caption: { fontSize: '0.8125rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 650, fontSize: '0.875rem' },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true, size: 'small' },
        styleOverrides: {
          root: {
            borderRadius: 10,
            minHeight: 36,
            '&.Mui-focusVisible': { outline: '2px solid #255dde', outlineOffset: 2 },
            '@media (max-width:599px), (pointer:coarse)': { minHeight: 44 },
          },
          sizeSmall: { fontSize: 14 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          sizeMedium: {
            minWidth: 36,
            minHeight: 36,
            '@media (max-width:599px), (pointer:coarse)': { minWidth: 44, minHeight: 44 },
          },
          root: {
            '&.Mui-focusVisible': { outline: '2px solid #255dde', outlineOffset: 2 },
            '@media (max-width:599px), (pointer:coarse)': { minWidth: 44, minHeight: 44 },
          },
        },
      },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiTableCell: {
        styleOverrides: {
          root: { padding: '8px 12px', verticalAlign: 'middle', fontSize: 14, lineHeight: 1.5 },
          head: {
            backgroundColor: '#f6f8fc',
            color: '#53657f',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            '@media (max-width:599px)': {
              '&:not(.MuiDialog-paperFullScreen)': {
                margin: 12,
                width: 'calc(100% - 24px)',
                maxWidth: 'calc(100% - 24px)',
                maxHeight: 'calc(100% - 24px)',
              },
            },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontSize: 18, fontWeight: 700, padding: '16px', overflowWrap: 'anywhere' },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: { padding: '12px 16px', minWidth: 0, '&.MuiDialogContent-root': { paddingTop: 8 } },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: '12px 16px',
            gap: 8,
            flexWrap: 'wrap',
            '& > :not(style) ~ :not(style)': { marginLeft: 0 },
          },
        },
      },
      MuiTableContainer: { styleOverrides: { root: { maxWidth: '100%', overflowX: 'auto' } } },
      MuiTablePagination: {
        styleOverrides: {
          toolbar: { flexWrap: 'wrap', minHeight: 44, paddingLeft: 12, paddingRight: 8 },
          displayedRows: { fontVariantNumeric: 'tabular-nums' },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          rounded: {
            borderRadius: 12,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: '#ffffff',
            borderRadius: 10,
            '&:hover': { backgroundColor: '#ffffff' },
            '&.Mui-focused': { backgroundColor: '#ffffff' },
          },
          notchedOutline: { borderColor: '#8392a8' },
          input: {
            paddingTop: 8,
            paddingBottom: 8,
            fontSize: 14,
            '@media (max-width:599px), (pointer:coarse)': { paddingTop: 12, paddingBottom: 12 },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 42,
            paddingInline: 12,
            '@media (max-width:599px), (pointer:coarse)': { minHeight: 44 },
            fontSize: 14,
            fontWeight: 650,
            color: '#53657f',
            '&.Mui-focusVisible': { outline: '2px solid #255dde', outlineOffset: -2 },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 42, '@media (max-width:599px), (pointer:coarse)': { minHeight: 44 } },
        },
      },
    },
  },
  viVN,
);

// One semantic palette for charts, room cards and Location summaries.
// Soft surfaces are intentional: status remains legible without dominating the record.
export const roomStatusColors = {
  occupied: {
    fill: theme.palette.primary.main,
    foreground: theme.palette.primary.dark,
    surface: theme.palette.primary.light,
  },
  available: {
    fill: theme.palette.success.main,
    foreground: theme.palette.success.dark,
    surface: '#eaf7ef',
  },
  onHold: {
    fill: theme.palette.warning.main,
    foreground: theme.palette.warning.dark,
    surface: '#fff4df',
  },
  unavailable: {
    fill: '#64748b',
    foreground: theme.palette.text.secondary,
    surface: '#f0f2f5',
  },
} as const;
