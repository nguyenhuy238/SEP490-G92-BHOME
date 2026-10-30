import { createTheme } from '@mui/material/styles';
import { viVN } from '@mui/material/locale';

// Shared Owner Portal tokens from Stitch; Public Web remains independent.
export const theme = createTheme(
  {
    palette: {
      primary: { main: '#255dde', dark: '#194cbb', light: '#ebf2ff' },
      secondary: { main: '#53657f' },
      success: { main: '#159a60' },
      warning: { main: '#cb8b16' },
      error: { main: '#db4d49' },
      background: { default: '#f6f8fc', paper: '#ffffff' },
      text: { primary: '#15243e', secondary: '#75839b' },
      divider: '#e6ebf2',
    },
    typography: {
      fontFamily: 'Inter, Roboto, Arial, sans-serif',
      fontSize: 14,
      h1: { fontSize: '1.65rem', lineHeight: 1.25, fontWeight: 800, letterSpacing: '-0.025em' },
      h2: { fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.01em' },
      button: { textTransform: 'none', fontWeight: 700 },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true, size: 'small' },
        styleOverrides: {
          root: {
            borderRadius: 10,
            minHeight: 38,
            '&.MuiButton-contained': {
              backgroundColor: '#255dde',
              '&:hover': { backgroundColor: '#194cbb' },
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          rounded: {
            borderRadius: 15,
            boxShadow: '0 8px 28px rgba(31,57,91,.035)',
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
          notchedOutline: { borderColor: '#e6ebf2' },
          input: { paddingTop: 12, paddingBottom: 12, fontSize: 14 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 48,
            paddingInline: 16,
            fontSize: 12,
            fontWeight: 750,
            color: '#718198',
          },
        },
      },
    },
  },
  viVN,
);
