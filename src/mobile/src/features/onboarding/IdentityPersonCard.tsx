import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { Pill } from '../../components/WorkspaceKit';
import { emptyCaptureProgress, type OnboardingPerson } from './onboarding';
import { staffColors as s } from '../../theme/theme';

export function IdentityPersonCard({
  person,
  label,
  role,
  disabled,
  onScan,
  onManual,
}: {
  person: OnboardingPerson;
  label: string;
  role: string;
  disabled: boolean;
  onScan: () => void;
  onManual: () => void;
}) {
  const progress = person.captureProgress ?? emptyCaptureProgress();
  const both = progress.front === 'recognized' && progress.back === 'recognized';
  const started = progress.front !== 'unscanned' || progress.back !== 'unscanned';
  const status = {
    unscanned: 'Chưa xác minh',
    recognizing: 'Đang quét',
    pending: 'Cần kiểm tra',
    confirmed: 'Đã xác minh',
  }[person.status];
  const action =
    person.status === 'confirmed'
      ? 'Xem thông tin'
      : both
        ? 'Kiểm tra thông tin'
        : started
          ? 'Tiếp tục quét'
          : person.status === 'pending'
            ? 'Kiểm tra thông tin'
            : 'Bắt đầu quét CCCD';
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Icon source="account-outline" size={24} color={s.navy} />
        </View>
        <View style={styles.identity}>
          <Text style={styles.name}>{label}</Text>
          <Text style={styles.role}>{role}</Text>
        </View>
      </View>
      <Pill
        tone={
          person.status === 'confirmed'
            ? 'green'
            : person.status === 'unscanned'
              ? 'neutral'
              : 'amber'
        }
      >
        {status}
      </Pill>
      {person.status !== 'confirmed' && (
        <View style={styles.progress}>
          {(['front', 'back'] as const).map((face) => (
            <View key={face} style={styles.face}>
              <Icon
                source={
                  progress[face] === 'recognized'
                    ? 'check-circle-outline'
                    : 'card-account-details-outline'
                }
                size={20}
                color={progress[face] === 'recognized' ? s.green : '#64748B'}
              />
              <Text style={styles.faceName}>Mặt {face === 'front' ? 'trước' : 'sau'}</Text>
              <Text style={styles.faceStatus}>
                {
                  { unscanned: 'Chưa quét', captured: 'Đã chụp', recognized: 'Đã nhận diện' }[
                    progress[face]
                  ]
                }
              </Text>
            </View>
          ))}
        </View>
      )}
      {person.status !== 'confirmed' && (
        <Button
          mode="outlined"
          textColor={s.blue}
          contentStyle={styles.touch}
          onPress={onScan}
          disabled={disabled}
        >
          {action}
        </Button>
      )}
      {person.status !== 'confirmed' && (
        <Button
          mode="text"
          icon="pencil-outline"
          contentStyle={styles.touch}
          onPress={onManual}
          disabled={disabled}
        >
          Nhập thủ công
        </Button>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: s.navy },
  role: { fontSize: 13, lineHeight: 18, color: '#475569' },
  progress: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  face: {
    flex: 1,
    minWidth: 110,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  faceName: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: s.navy },
  faceStatus: { fontSize: 12, lineHeight: 18, color: '#475569' },
  touch: { minHeight: 48 },
});
