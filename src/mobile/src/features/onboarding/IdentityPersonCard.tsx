import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { Pill } from '../../components/WorkspaceKit';
import { emptyCaptureProgress, type IdentitySide, type OnboardingPerson } from './onboarding';
import { staffColors as s } from '../../theme/theme';

export function IdentityPersonCard({
  person,
  label,
  role,
  disabled,
  onScan,
  onManual,
  embedded = false,
}: {
  person: OnboardingPerson;
  label: string;
  role: string;
  disabled: boolean;
  onScan: (side?: IdentitySide) => void;
  onManual: () => void;
  embedded?: boolean;
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
    <View style={[styles.card, embedded && styles.embeddedCard]}>
      {!embedded && (
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Icon source="account-outline" size={24} color={s.navy} />
          </View>
          <View style={styles.identity}>
            <Text style={styles.name}>{label}</Text>
            <Text style={styles.role}>{role}</Text>
          </View>
        </View>
      )}
      {!embedded && <Pill
        tone={
          person.status === 'confirmed'
            ? 'green'
            : person.status === 'unscanned'
              ? 'neutral'
              : 'amber'
        }
      >
        {status}
      </Pill>}
      {!!person.verificationError && (
        <Text accessibilityRole="alert" style={{ color: s.red }}>
          {person.verificationError}
        </Text>
      )}
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
                  {
                    unscanned: 'Chưa quét',
                    captured: 'Đã chụp',
                    partial: 'Đọc được một phần',
                    recognized: 'Đã nhận diện',
                    failed: 'Chưa đọc được',
                  }[progress[face]]
                }
              </Text>
              <Button
                mode="outlined"
                compact
                accessibilityLabel={`${progress[face] === 'unscanned' ? 'Quét' : 'Quét lại'} mặt ${face === 'front' ? 'trước' : 'sau'}`}
                disabled={disabled}
                contentStyle={styles.faceTouch}
                onPress={() => onScan(face)}
              >
                {progress[face] === 'unscanned' ? 'Quét' : 'Quét lại'}
              </Button>
            </View>
          ))}
        </View>
      )}
      {person.status !== 'confirmed' && (
        <Button
          mode="outlined"
          textColor={s.blue}
          contentStyle={styles.touch}
          onPress={() => onScan()}
          disabled={disabled}
        >
          {action}
        </Button>
      )}
      <Button
        mode="text"
        icon={person.status === 'confirmed' ? 'file-document-edit-outline' : 'pencil-outline'}
        contentStyle={styles.touch}
        onPress={onManual}
        disabled={disabled}
      >
        {person.status === 'confirmed' ? 'Xem / sửa thông tin' : 'Nhập thủ công'}
      </Button>
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
  embeddedCard: { borderWidth: 0, padding: 0, gap: 10, backgroundColor: 'transparent' },
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
  progress: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8 },
  face: {
    flex: 1,
    minWidth: 0,
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  faceName: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: s.navy },
  faceStatus: { fontSize: 11, lineHeight: 16, color: '#475569' },
  touch: { minHeight: 48 },
  faceTouch: { minHeight: 40 },
});
