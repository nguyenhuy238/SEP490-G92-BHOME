import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  Button,
  Chip,
  Icon,
  ProgressBar,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { colors as c } from '../theme/theme';

export const ui = StyleSheet.create({
  page: {
    padding: 20,
    gap: 16,
    paddingBottom: 28,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    backgroundColor: c.white,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#eef0f6',
  },
  soft: { backgroundColor: c.soft, borderRadius: 8, padding: 12, gap: 8 },
  muted: { color: c.muted },
  blue: { color: c.blue },
  green: { color: c.green },
  red: { color: c.red },
  grow: { flex: 1, minWidth: 0 },
  half: { flexGrow: 1, flexBasis: '45%', minWidth: 130 },
  money: { fontVariant: ['tabular-nums'], fontFamily: 'Inter-Bold' },
  line: { height: 1, backgroundColor: c.border },
  dark: { backgroundColor: c.navy, borderColor: c.navy },
  white: { color: c.white },
  input: { backgroundColor: c.white },
});
export function Box({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Surface elevation={0} style={[ui.card, style]}>
      {children}
    </Surface>
  );
}
export function Row({ children, spread = false }: { children: React.ReactNode; spread?: boolean }) {
  return <View style={spread ? ui.between : ui.row}>{children}</View>;
}
export function Pill({
  children,
  tone = 'blue',
}: {
  children: React.ReactNode;
  tone?: 'blue' | 'green' | 'red' | 'amber' | 'neutral';
}) {
  const pair = {
    blue: [c.tint, c.blue],
    green: [c.greenSoft, c.green],
    red: [c.redSoft, c.red],
    amber: [c.amberSoft, c.amber],
    neutral: [c.soft, c.muted],
  }[tone];
  return (
    <View
      style={{
        backgroundColor: pair[0],
        borderRadius: 5,
        paddingHorizontal: 7,
        paddingVertical: 4,
        alignSelf: 'flex-start',
        flexShrink: 1,
      }}
    >
      <Text variant="labelSmall" style={{ color: pair[1] }}>
        {children}
      </Text>
    </View>
  );
}
export function Heading({
  title,
  detail,
  action,
  onPress,
}: {
  title: string;
  detail?: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <Row spread>
      <View style={ui.grow}>
        <Text variant="titleLarge">{title}</Text>
        {detail && (
          <Text variant="labelSmall" style={ui.muted}>
            {detail}
          </Text>
        )}
      </View>
      {action && (
        <Button compact onPress={onPress} textColor={c.blue} labelStyle={{ fontSize: 11 }}>
          {action}
        </Button>
      )}
    </Row>
  );
}
export function Action({
  children,
  onPress,
  icon,
  secondary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  icon?: string;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      mode={secondary ? 'contained-tonal' : 'contained'}
      icon={icon}
      onPress={onPress}
      disabled={disabled}
      style={{ borderRadius: 8 }}
      contentStyle={{ minHeight: 44 }}
      labelStyle={{ fontSize: 12 }}
    >
      {children}
    </Button>
  );
}
export function Filters({
  options,
  selected,
  onChange,
}: {
  options: readonly string[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {options.map((label) => (
        <Chip
          key={label}
          selected={selected === label}
          showSelectedCheck={false}
          onPress={() => onChange(label)}
          style={{ backgroundColor: selected === label ? c.primary : c.white, borderRadius: 8 }}
          textStyle={{ color: selected === label ? c.white : c.muted, fontSize: 12 }}
        >
          {label}
        </Chip>
      ))}
    </ScrollView>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon,
  progress,
  danger,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
  progress?: number;
  danger?: boolean;
}) {
  return (
    <Box style={ui.half}>
      <Row spread>
        <Text variant="labelSmall" style={ui.muted}>
          {label}
        </Text>
        <Icon source={icon} size={18} color={danger ? c.red : c.blue} />
      </Row>
      <Text variant="headlineSmall" style={[ui.money, danger && ui.red]}>
        {value}
      </Text>
      {progress !== undefined && (
        <ProgressBar
          progress={progress}
          color={c.blue}
          style={{ height: 4, borderRadius: 3, backgroundColor: c.tint }}
        />
      )}
      <Text variant="labelSmall" style={danger ? ui.red : ui.muted}>
        {detail}
      </Text>
    </Box>
  );
}
export function QuickActions({
  items,
}: {
  items: { label: string; icon: string; onPress: () => void }[];
}) {
  return (
    <Row spread>
      {items.map((item) => (
        <TouchableRipple
          key={item.label}
          onPress={item.onPress}
          style={{ flex: 1, borderRadius: 8 }}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
            <View style={{ padding: 10, borderRadius: 12, backgroundColor: c.tint }}>
              <Icon source={item.icon} size={22} color={c.blue} />
            </View>
            <Text variant="labelSmall" style={{ textAlign: 'center' }}>
              {item.label}
            </Text>
          </View>
        </TouchableRipple>
      ))}
    </Row>
  );
}
export function InfoRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: string;
  title: string;
  detail?: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12 }}>
      <View style={{ backgroundColor: c.soft, padding: 9, borderRadius: 9 }}>
        <Icon source={icon} size={22} color={c.blue} />
      </View>
      <View style={ui.grow}>
        <Text variant="titleMedium">{title}</Text>
        {detail && (
          <Text variant="bodySmall" style={ui.muted}>
            {detail}
          </Text>
        )}
      </View>
      {onPress && <Icon source="chevron-right" size={20} color={c.muted} />}
    </View>
  );
  return onPress ? (
    <TouchableRipple onPress={onPress} accessibilityRole="button">
      {content}
    </TouchableRipple>
  ) : (
    content
  );
}
export function Photo({
  source,
  label,
  onPress,
}: {
  source: ImageSourcePropType;
  label: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={{ gap: 5 }}>
      <Image
        source={source}
        accessibilityLabel={label}
        style={{ height: 108, width: '100%', borderRadius: 8, backgroundColor: c.soft }}
        resizeMode="cover"
      />
      <Text variant="labelSmall" style={ui.muted}>
        {label}
      </Text>
    </View>
  );
  return (
    <View style={ui.half}>
      {onPress ? (
        <TouchableRipple onPress={onPress} accessibilityRole="button">
          {content}
        </TouchableRipple>
      ) : (
        content
      )}
    </View>
  );
}
