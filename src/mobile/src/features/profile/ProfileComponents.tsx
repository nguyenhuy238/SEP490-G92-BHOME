import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { colors, staffColors } from '../../theme/theme';
import { fontFaces } from '../../theme/typography';
import type { AccountProfile } from '../../services/accountProfile';

export const profileStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 16,
    borderWidth: 1,
    borderColor: '#EDF1F6',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: fontFaces.semibold, fontSize: 16, lineHeight: 24, color: colors.ink },
  label: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  value: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  divider: { height: 1, backgroundColor: '#EDF1F6' },
  field: { gap: 5 },
  setting: { paddingVertical: 14, paddingHorizontal: 16, minHeight: 56 },
  footer: {
    padding: 16,
    gap: 4,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  input: { backgroundColor: colors.white },
  error: { color: colors.red, fontSize: 13, lineHeight: 20 },
});
export function ProfileSkeleton() {
  return (
    <View accessibilityLabel="Đang tải hồ sơ" accessibilityRole="progressbar" style={{ gap: 16 }}>
      <View style={[profileStyles.card, profileStyles.row]}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.soft }} />
        <View style={[profileStyles.grow, { gap: 10 }]}>
          <View
            style={{ width: '75%', height: 18, borderRadius: 5, backgroundColor: colors.soft }}
          />
          <View
            style={{ width: '50%', height: 12, borderRadius: 5, backgroundColor: colors.soft }}
          />
        </View>
      </View>
      <View style={profileStyles.card}>
        {[0, 1, 2].map((n) => (
          <View key={n} style={{ gap: 8, paddingVertical: 8 }}>
            <View
              style={{ width: '30%', height: 12, borderRadius: 5, backgroundColor: colors.soft }}
            />
            <View
              style={{ width: '75%', height: 18, borderRadius: 5, backgroundColor: colors.soft }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
export function ProfileFailure({
  message,
  retry,
  busy = false,
}: {
  message: string;
  retry: () => void;
  busy?: boolean;
}) {
  return (
    <View style={profileStyles.card}>
      <Text accessibilityRole="alert" style={profileStyles.error}>
        {message}
      </Text>
      <Button compact mode="text" icon="refresh" disabled={busy} onPress={retry}>
        Thử lại
      </Button>
    </View>
  );
}
export function ProfileInfoCard({ profile, edit }: { profile: AccountProfile; edit: () => void }) {
  return (
    <View style={profileStyles.card}>
      <View style={profileStyles.row}>
        <Text style={[profileStyles.title, profileStyles.grow]}>Thông tin cá nhân</Text>
        <Button
          compact
          mode="text"
          icon="pencil-outline"
          textColor={staffColors.blue}
          onPress={edit}
        >
          Chỉnh sửa
        </Button>
      </View>
      {(
        [
          ['Họ và tên', profile.fullName],
          ['Số điện thoại', profile.phone],
          ['Email', profile.email],
        ] as const
      ).map(([label, value], index) => (
        <React.Fragment key={label}>
          {index > 0 && <View style={profileStyles.divider} />}
          <View style={profileStyles.field}>
            <Text style={profileStyles.label}>{label}</Text>
            <Text selectable style={profileStyles.value}>
              {value?.trim() || 'Chưa cập nhật'}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
export function ProfileSettingRow({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[profileStyles.row, profileStyles.setting]}>
        <Icon source={icon} size={21} color={staffColors.blue} />
        <Text style={[profileStyles.value, profileStyles.grow]}>{label}</Text>
        <Icon source="chevron-right" size={20} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}
