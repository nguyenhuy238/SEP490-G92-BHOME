import type { TextStyle } from 'react-native';

// Static TTF aliases loaded once in app/_layout.tsx on every platform.
export const fontFaces = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
} as const;
export function fontStyle(face: keyof typeof fontFaces, fontSize: number, lineHeight: number) {
  // The selected file supplies 400/500/600/700. Do not synthesize a second weight.
  return {
    fontFamily: fontFaces[face],
    fontWeight: 'normal' as const,
    fontSize,
    lineHeight,
    letterSpacing: 0,
  };
}
export const typography = {
  screenTitle: fontStyle('bold', 24, 32),
  sectionHeading: fontStyle('semibold', 16, 22),
  cardTitle: fontStyle('semibold', 14, 20),
  body: fontStyle('regular', 13, 20),
  secondary: fontStyle('regular', 12, 18),
  status: fontStyle('medium', 11, 16),
  label: fontStyle('medium', 12, 18),
  link: fontStyle('medium', 13, 20),
  value: { ...fontStyle('semibold', 24, 32), fontVariant: ['tabular-nums'] },
  metric: { ...fontStyle('bold', 24, 32), fontVariant: ['tabular-nums'] },
  money: { ...fontStyle('bold', 30, 40), fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;
