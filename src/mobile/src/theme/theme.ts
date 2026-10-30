import { configureFonts, MD3LightTheme } from 'react-native-paper';

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
      headlineLarge: { fontFamily: 'Inter-Bold', fontSize: 30, lineHeight: 38 },
      headlineMedium: { fontFamily: 'Inter-Bold', fontSize: 24, lineHeight: 32 },
      headlineSmall: { fontFamily: 'Inter-SemiBold', fontSize: 20, lineHeight: 28 },
      titleLarge: { fontFamily: 'Inter-SemiBold', fontSize: 17, lineHeight: 24 },
      titleMedium: { fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: 20 },
      titleSmall: { fontFamily: 'Inter-SemiBold', fontSize: 12, lineHeight: 16 },
      labelLarge: { fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: 20 },
      labelMedium: { fontFamily: 'Inter-SemiBold', fontSize: 12, lineHeight: 16 },
      labelSmall: { fontFamily: 'Inter-Medium', fontSize: 11, lineHeight: 14 },
      bodyLarge: { fontFamily: 'Inter-Regular', fontSize: 16, lineHeight: 24 },
      bodyMedium: { fontFamily: 'Inter-Regular', fontSize: 14, lineHeight: 20 },
      bodySmall: { fontFamily: 'Inter-Regular', fontSize: 13, lineHeight: 18 },
    },
  }),
};
