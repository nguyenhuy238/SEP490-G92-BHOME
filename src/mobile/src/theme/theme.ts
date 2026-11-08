import { configureFonts, MD3LightTheme } from 'react-native-paper';
import { fontFaces, fontStyle } from './typography';

// Values from the exported Stitch HTML. DESIGN.md contains a second palette;
// the rendered screens take precedence when those values differ.
export const colors = {
  navy: '#001637',
  primary: '#172b4d',
  blue: '#1052cf',
  background: '#f9f9ff',
  white: '#ffffff',
  soft: '#f1f3ff',
  tint: '#e8edff',
  border: '#e2e8f0',
  ink: '#111b2e',
  muted: '#64748b',
  green: '#168565',
  greenSoft: '#ebfbf5',
  red: '#ba1a1a',
  redSoft: '#ffdad6',
  amber: '#a86108',
  amberSoft: '#fff8e8',
};

// The existing Staff dashboard palette is the shared workspace design reference.
export const staffColors = {
  navy: '#193653',
  background: '#F5F7FB',
  accent: '#F59E0B',
  blue: '#2563EB',
  blueSoft: '#E8F0FE',
  purple: '#8054C7',
  purpleSoft: '#F1EBFA',
  green: '#16804A',
  greenSoft: '#E8F7EE',
  orange: '#CE7B16',
  orangeSoft: '#FFF3E3',
  red: '#D44747',
  redSoft: '#FDECEC',
};
export const theme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    secondary: colors.blue,
    primaryContainer: colors.tint,
    secondaryContainer: colors.tint,
    background: colors.background,
    surface: colors.white,
    surfaceVariant: colors.soft,
    onSurface: colors.ink,
    outline: colors.border,
    error: colors.red,
  },
  fonts: configureFonts({
    config: {
      ...configureFonts({
        config: { fontFamily: fontFaces.regular, fontWeight: 'normal', letterSpacing: 0 },
      }),
      headlineLarge: fontStyle('bold', 30, 38),
      headlineMedium: fontStyle('bold', 24, 32),
      headlineSmall: fontStyle('semibold', 20, 28),
      titleLarge: fontStyle('semibold', 17, 24),
      titleMedium: fontStyle('semibold', 14, 20),
      titleSmall: fontStyle('semibold', 12, 16),
      labelLarge: fontStyle('semibold', 14, 20),
      labelMedium: fontStyle('semibold', 12, 16),
      labelSmall: fontStyle('medium', 11, 14),
      bodyLarge: fontStyle('regular', 16, 24),
      bodyMedium: fontStyle('regular', 14, 20),
      bodySmall: fontStyle('regular', 13, 18),
    },
  }),
};
