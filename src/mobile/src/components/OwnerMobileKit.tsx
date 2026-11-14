import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';

export function OwnerScreenIntro({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.intro}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.secondary}>{detail}</Text>
    </View>
  );
}

export function OwnerSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {!!detail && <Text style={styles.secondary}>{detail}</Text>}
      </View>
      {children}
    </View>
  );
}

export function OwnerSurface({ children }: { children: React.ReactNode }) {
  return <View style={styles.surface}>{children}</View>;
}

export function OwnerDivider() {
  return <View style={styles.divider} />;
}

export function OwnerLinkRow({
  icon,
  title,
  detail,
  value,
  onPress,
}: {
  icon: string;
  title: string;
  detail?: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <View style={styles.link}>
        <View style={styles.icon}>
          <Icon source={icon} size={21} color={s.blue} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>{title}</Text>
          {!!detail && (
            <Text style={styles.secondary} numberOfLines={2}>
              {detail}
            </Text>
          )}
        </View>
        {!!value && <Text style={styles.value}>{value}</Text>}
        <Icon source="chevron-right" size={18} color={c.muted} />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 4, paddingHorizontal: 2 },
  title: { ...typography.screenTitle, color: '#173654' },
  secondary: { ...typography.secondary, color: c.muted, flexShrink: 1 },
  section: { gap: 12 },
  sectionHeading: { gap: 3 },
  sectionTitle: { ...typography.sectionHeading, color: '#173654' },
  surface: {
    backgroundColor: c.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: c.border, marginLeft: 64 },
  link: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: s.blueSoft,
  },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { ...typography.link, color: '#173654' },
  value: { ...typography.value, color: s.blue, fontVariant: ['tabular-nums'] },
});

export const ownerMobileStyles = styles;
