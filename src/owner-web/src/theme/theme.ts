import { createTheme } from '@mui/material/styles';
import { viVN } from '@mui/material/locale';

// Shared Owner Portal tokens from Stitch; Public Web remains independent.
export const theme = createTheme(
  {
    palette: {
      primary: { main: '#004ac6' },
      secondary: { main: '#505f76' },
      success: { main: '#006329' },
      error: { main: '#ba1a1a' },
      background: { default: '#faf8ff', paper: '#ffffff' },
      text: { primary: '#131b2e', secondary: '#505f76' },
      divider: '#eaedff',
    },
    typography: {
      fontFamily: 'Inter, Roboto, Arial, sans-serif',
      fontSize: 14,
      h1: { fontSize: '1.125rem', lineHeight: 1.5, fontWeight: 600, letterSpacing: '-0.01em' },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true, size: 'small' },
        styleOverrides: {
          root: {
            borderRadius: 4,
            '&.MuiButton-contained': {
              backgroundColor: '#283044',
              '&:hover': { backgroundColor: '#131b2e' },
            },
          },
        },
      },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: '#f2f3ff',
            borderRadius: 4,
            '&:hover': { backgroundColor: '#eaedff' },
            '&.Mui-focused': { backgroundColor: '#ffffff' },
          },
          notchedOutline: { borderColor: 'transparent' },
          input: { paddingTop: 12, paddingBottom: 12, fontSize: 14 },
        },
      },
    },
  },
  viVN,
);
