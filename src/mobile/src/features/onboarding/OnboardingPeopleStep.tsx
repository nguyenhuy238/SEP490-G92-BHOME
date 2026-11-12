import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, IconButton, Text, TextInput } from 'react-native-paper';
import { ChoiceField } from '../../components/WorkflowControls';
import { colors as c, staffColors as s } from '../../theme/theme';
import { identityStatusLabels, type HouseholdMode, type OnboardingPerson } from './onboarding';

interface Props {
  mode: HouseholdMode;
  people: readonly OnboardingPerson[];
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
  const person = props.people.find((item) => item.key === props.editing);
  return (
    <View style={styles.content}>
      <View style={styles.section}>
        <ChoiceField
          label="Hình thức thuê"
          value={props.mode}
          disabled={props.created}
          options={[
            { id: 'family', label: 'Hộ gia đình' },
            { id: 'individual', label: 'Cá nhân / Nhóm bạn' },
          ]}
          onChange={(value) => props.onModeChange(value as HouseholdMode)}
        />
        <Text style={styles.description}>
          {props.mode === 'family'
            ? 'Một người đại diện và các thành viên cùng ở.'
            : 'Mỗi người có hồ sơ riêng để chuẩn bị hợp đồng phù hợp.'}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Danh sách người ở</Text>
          <Text style={styles.count}>{props.people.length} người</Text>
        </View>
        <View style={styles.list}>
          {props.people.map((item, index) => {
            const name = item.label || `Người ở ${index + 1}`;
            const representative = item.key === props.representative;
            const selected = item.key === props.editing;
            const canDelete =
              !item.residentId && props.people.length > 1 && !(props.created && representative);
            return (
              <View key={item.key} style={[styles.person, selected && styles.selected]}>
                <View style={styles.personHeader}>
                  <View style={styles.avatar}>
                    <Icon source="account-outline" size={22} color={s.navy} />
                  </View>
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
                      disabled={!!item.residentId}
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
                <View style={styles.metadata}>
                  {representative && (
                    <View style={styles.representativeBadge}>
                      <Text style={styles.representativeText}>Người đại diện</Text>
                    </View>
                  )}
                  <View style={styles.status}>
                    <Icon
                      source={item.status === 'confirmed' ? 'check-circle-outline' : 'circle-small'}
                      size={16}
                      color={item.status === 'confirmed' ? s.green : c.muted}
                    />
                    <Text
                      style={[styles.statusText, item.status === 'confirmed' && styles.confirmed]}
                    >
                      {identityStatusLabels[item.status]}
                    </Text>
                  </View>
                </View>
                {selected && <Text style={styles.editing}>Đang chỉnh sửa hồ sơ bên dưới</Text>}
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
        >
          Thêm người ở
        </Button>
      </View>

      <View style={styles.profileSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Thông tin hồ sơ</Text>
          <Icon source="file-account-outline" size={22} color={s.navy} />
        </View>
        {person && (
          <>
            <Text style={styles.profileCaption}>
              {person.label || `Người ở ${props.people.indexOf(person) + 1}`}
            </Text>
            <TextInput
              mode="outlined"
              label="Tên gọi hồ sơ *"
              accessibilityLabel="Tên gọi hồ sơ"
              placeholder="Ví dụ: Người thuê 01"
              value={person.label}
              maxLength={150}
              disabled={!!person.residentId}
              style={styles.input}
              outlineColor={c.border}
              activeOutlineColor={s.blue}
              outlineStyle={styles.inputOutline}
              onChangeText={(label) => props.onLabelChange(person.key, label)}
            />
            <View style={styles.helperRow}>
              <Text style={styles.helper}>
                Tên gọi giúp phân biệt người ở. Không nhập số CCCD tại đây.
              </Text>
              <Text style={styles.counter}>{person.label.length}/150</Text>
            </View>
            <TextInput
              mode="outlined"
              label="Email người ở *"
              accessibilityLabel="Email người ở"
              value={person.email ?? ''}
              maxLength={256}
              keyboardType="email-address"
              autoCapitalize="none"
              disabled={!!person.residentId}
              style={styles.input}
              onChangeText={(email) => props.onEmailChange(person.key, email)}
            />
            <Text style={styles.helper}>
              Mỗi người ở cần email riêng. Tài khoản chỉ được cấp sau khi hợp đồng thuê được kích
              hoạt.
            </Text>
          </>
        )}
        <Text style={styles.note}>
          Hình thức thuê và người đại diện đang lưu tạm trong phiên tiếp nhận.
        </Text>
        {props.created && (
          <Text style={styles.note}>
            Hồ sơ đã tạo có thể được bổ sung thông tin ở bước CCCD; không xóa hồ sơ đó tại bước này.
          </Text>
        )}
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24 },
  section: { gap: 12 },
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
    padding: 12,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  selected: { backgroundColor: '#F8FAFC' },
  personHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#EEF2F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  identity: { flex: 1, minWidth: 0, gap: 4, paddingTop: 2 },
  personName: { color: s.navy, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  role: { color: '#475569', fontSize: 12, lineHeight: 18 },
  iconActions: { flexDirection: 'row' },
  iconButton: { width: 44, height: 44, margin: 0, borderRadius: 12 },
  metadata: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  representativeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: s.blueSoft,
  },
  representativeText: { color: '#1D4ED8', fontSize: 12, lineHeight: 18, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { color: '#475569', fontSize: 12, lineHeight: 18 },
  confirmed: { color: s.green },
  editing: { color: '#475569', fontSize: 12, lineHeight: 18 },
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
