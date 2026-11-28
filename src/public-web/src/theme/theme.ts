import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#455a64',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        a: { color: '#1565c0', textUnderlineOffset: '0.2em' },
        ':focus-visible': { outline: '3px solid #1565c0', outlineOffset: '3px' },
        '::selection': { backgroundColor: '#bbdefb', color: '#102a43' },
      },
    },
  },
});
