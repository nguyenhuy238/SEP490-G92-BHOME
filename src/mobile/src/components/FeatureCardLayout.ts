import { StyleSheet } from 'react-native';

// Extracted unchanged from StaffFeatureCard; both roles share its geometry.
export const featureCardLayout = StyleSheet.create({
  surface: { flex: 1, borderRadius: 18, boxShadow: '0 3px 14px rgba(25, 52, 82, 0.05)' },
  ripple: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  content: { flexGrow: 1, padding: 12, alignItems: 'center', gap: 6 },
  compact: { padding: 12, gap: 4 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  compactIcon: { width: 36, height: 36, borderRadius: 12 },
});
