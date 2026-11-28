import { StyleSheet } from 'react-native';
import { colors, staffColors } from './theme';
import { fontStyle } from './typography';

// Staff-only visual tokens. Shared Tenant and Owner styles remain unchanged.
export const staffLayout = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: 12,
  touch: 48,
  header: 56,
  pageWidth: 720,
} as const;

export const staffHomePalette = {
  background: '#EFF5FD',
  ink: '#102B49',
  muted: '#50647B',
  border: '#DCE6F2',
  iconSurface: '#E4EEFF',
} as const;

export const staffUi = StyleSheet.create({
  surface: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: staffLayout.radius,
  },
  section: { gap: staffLayout.space.sm },
  sectionTitle: { ...fontStyle('semibold', 16, 22), color: staffColors.navy },
  title: { ...fontStyle('semibold', 18, 24), color: staffColors.navy },
  body: { ...fontStyle('regular', 14, 20), color: colors.ink },
  secondary: { ...fontStyle('regular', 12, 18), color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: staffLayout.space.sm },
  action: { minHeight: staffLayout.touch, justifyContent: 'center' },
});
