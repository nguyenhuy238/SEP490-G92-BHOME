import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { ChoiceField } from '../../components/WorkflowControls';
import { colors as c, staffColors as s } from '../../theme/theme';
import { identityStatusLabels, type HouseholdMode, type OnboardingPerson } from './onboarding';

interface Props {
  inline?: boolean;
  mode: HouseholdMode;
  people: readonly OnboardingPerson[];
  maxPeople: number;
  rosterLocked?: boolean;
  representative: string;
  editing: string;
  created: boolean;
  canContinue: boolean;
  backDisabled: boolean;
  onModeChange: (mode: HouseholdMode) => void;
  onAdd: () => void;
  onEdit: (key: string) => void;
  onRepresentative: (key: string) => void;
  onDelete: (key: string) => void;
  onLabelChange: (key: string, label: string) => void;
  onEmailChange: (key: string, email: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

// Presentation only: the parent retains the draft, validation and navigation rules.
export function OnboardingPeopleStep(props: Props) {
  return (
    <View style={styles.content}>
      <View style={styles.section}>
        <ChoiceField
          label="Hình thức thuê"
          value={props.mode}
          disabled={props.created}
          options={[
            { id: 'family', label: 'Hộ gia đình' },
            { id: 'individual', label: 'Cá nhân' },
          ]}
          onChange={(value) => props.onModeChange(value as HouseholdMode)}
        />
        <Text style={styles.description}>
          {props.mode === 'family'
            ? 'Một người đại diện và các thành viên cùng ở.'
            : 'Một người thuê trên một hợp đồng. Chọn Hộ gia đình để thêm thành viên cùng ở.'}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Danh sách người ở</Text>
          <Text style={styles.count}>
            {props.people.length}/{props.maxPeople} người
          </Text>
        </View>
        <View style={styles.list}>
          {props.people.map((item, index) => {
            const name = item.label || `Người ở ${index + 1}`;
            const representative = item.key === props.representative;
            const selected = item.key === props.editing;
            const canDelete =
              !props.rosterLocked &&
              props.people.length > 1 &&
              (!item.residentId || (props.mode === 'family' && !representative)) &&
              !(props.created && representative);
            return (
              <View key={item.key} style={[styles.person, selected && styles.selected]}>
                <View style={styles.personHeader}>
                  <View style={styles.identity}>
                    <Text style={styles.personName}>{name}</Text>
                    <Text style={styles.role}>
                      {representative
                        ? 'Đại diện phòng'
                        : props.mode === 'family'
                          ? 'Thành viên cùng ở'
                          : 'Người thuê'}
                    </Text>
                  </View>
                  <View style={styles.iconActions}>
                    <IconButton
                      icon="pencil-outline"
                      size={20}
                      style={styles.iconButton}
                      iconColor={s.navy}
                      disabled={props.rosterLocked || (!!item.residentId && representative)}
                      accessibilityLabel={`Chỉnh sửa ${name}`}
                      onPress={() => props.onEdit(item.key)}
                    />
                    <IconButton
                      icon="trash-can-outline"
                      size={20}
                      style={styles.iconButton}
                      iconColor={c.red}
                      containerColor={canDelete ? '#FFF1F2' : undefined}
                      disabled={!canDelete}
                      accessibilityLabel={`Xóa ${name}`}
                      onPress={() => props.onDelete(item.key)}
                    />
                  </View>
                </View>
                {item.residentId && (
                  <Text style={item.status === 'confirmed' ? styles.confirmed : styles.statusText}>
                    {props.mode === 'family' && !representative && item.member
                      ? 'Đã lưu thông tin'
                      : identityStatusLabels[item.status]}
                  </Text>
                )}
                {!props.created && !representative && (
                  <Button
                    compact
                    icon="account-star-outline"
                    textColor={s.blue}
                    contentStyle={styles.secondaryTouch}
                    style={styles.representativeAction}
                    onPress={() => props.onRepresentative(item.key)}
                    accessibilityLabel={`Chọn ${name} làm đại diện`}
                  >
                    Chọn làm đại diện
                  </Button>
                )}
              </View>
            );
          })}
        </View>
        <Button
          mode="outlined"
          icon="plus"
          textColor={s.blue}
          style={styles.addButton}
          contentStyle={styles.touch}
          onPress={props.onAdd}
          disabled={
            props.rosterLocked ||
            props.people.length >= props.maxPeople ||
            (props.mode === 'individual' && props.people.length >= 1)
          }
        >
          Thêm người ở
        </Button>
        <Text
          accessibilityRole={props.people.length > props.maxPeople ? 'alert' : undefined}
          style={styles.description}
        >
          {props.maxPeople <= 0
            ? 'Phòng không còn chỗ hoặc chưa tải được sức chứa. Vui lòng chọn lại phòng.'
            : props.people.length > props.maxPeople
              ? `Danh sách vượt giới hạn ${props.maxPeople} người. Hãy bớt người ở trước khi tiếp tục.`
              : `Tối đa ${props.maxPeople} người theo số chỗ còn lại của phòng.`}
        </Text>
      </View>

      {!props.inline && (
        <View style={styles.actions}>
          <Button
            mode="outlined"
            icon="arrow-left"
            textColor={s.navy}
            style={styles.backButton}
            contentStyle={styles.touch}
            disabled={props.backDisabled}
            onPress={props.onBack}
          >
            Quay lại
          </Button>
          <Button
            mode="contained"
            buttonColor={s.blue}
            style={styles.continueButton}
            contentStyle={styles.touch}
            disabled={!props.canContinue}
            accessibilityLabel="Tiếp tục đến CCCD"
            onPress={props.onContinue}
          >
            Tiếp tục
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24 },
  section: { gap: 10 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: { color: s.navy, fontSize: 17, lineHeight: 24, fontWeight: '700', flexShrink: 1 },
  description: { color: '#475569', fontSize: 14, lineHeight: 21 },
  count: { color: '#475569', fontSize: 13, lineHeight: 20 },
  list: { gap: 12 },
  person: {
    padding: 10,
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  selected: { backgroundColor: '#F8FAFC' },
  personHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  identity: { flex: 1, minWidth: 0, gap: 4, paddingTop: 2 },
  personName: { color: s.navy, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  role: { color: '#475569', fontSize: 12, lineHeight: 18 },
  iconActions: { flexDirection: 'row' },
  iconButton: { width: 44, height: 44, margin: 0, borderRadius: 12 },
  statusText: { color: '#475569', fontSize: 12, lineHeight: 18 },
  confirmed: { color: s.green },
  representativeAction: { alignSelf: 'flex-start', marginLeft: -8 },
  secondaryTouch: { minHeight: 44 },
  addButton: { borderRadius: 12, borderColor: '#CBD5E1', backgroundColor: c.white },
  touch: { minHeight: 48 },
  profileSection: {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
  },
  profileCaption: { color: '#475569', fontSize: 14, lineHeight: 20 },
  input: { minHeight: 52, backgroundColor: c.white },
  inputOutline: { borderRadius: 12 },
  helperRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  helper: { color: '#475569', fontSize: 12, lineHeight: 18, flex: 1 },
  counter: { color: '#475569', fontSize: 12, lineHeight: 18 },
  note: { color: '#475569', fontSize: 12, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  backButton: { flex: 1, borderRadius: 12, borderColor: '#CBD5E1' },
  continueButton: { flex: 1, borderRadius: 12 },
});
