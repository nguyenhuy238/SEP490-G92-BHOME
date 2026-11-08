import { StyleSheet } from 'react-native';
import { colors, staffColors } from '../../theme/theme';
import { fontStyle, typography } from '../../theme/typography';
export const reportColors = {
  ...staffColors,
  navy: '#173654',
  border: colors.border,
  muted: colors.muted,
};
export const reportUi = StyleSheet.create({
  form: { gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grow: { flex: 1, minWidth: 0 },
  pageTitle: { ...fontStyle('bold', 22, 30), color: reportColors.navy },
  heading: { ...typography.sectionHeading, color: reportColors.navy },
  body: { ...typography.body, color: reportColors.navy },
  label: { ...fontStyle('medium', 13, 20), color: reportColors.navy },
  helper: { ...typography.secondary, color: reportColors.muted },
  error: { ...typography.secondary, color: colors.red },
  section: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  selector: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  selectContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    minHeight: 52,
  },
  option: {
    flex: 1,
    minWidth: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  optionBody: { padding: 12, minHeight: 48, gap: 6 },
  selected: { borderColor: reportColors.blue, backgroundColor: reportColors.blueSoft },
  urgent: { borderColor: reportColors.red, backgroundColor: reportColors.redSoft },
  input: { backgroundColor: colors.white, ...typography.body },
  dialog: { borderRadius: 16, maxHeight: '85%', backgroundColor: colors.white },
  modalRow: { paddingVertical: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  submit: { borderRadius: 12 },
});
