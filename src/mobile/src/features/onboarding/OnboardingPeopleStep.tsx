import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { colors as c, staffColors as s } from '../../theme/theme';
import { identityStatusLabels, type HouseholdMode, type IdentitySide, type OnboardingPerson } from './onboarding';
import { IdentityPersonCard } from './IdentityPersonCard';

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
  completedCount: number;
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
  onScan: (person: OnboardingPerson, side?: IdentitySide) => void;
  onManual: (person: OnboardingPerson) => void;
  personLabel: (person: OnboardingPerson) => string;
  disabledFor: (person: OnboardingPerson) => boolean;
}

// Presentation only: the parent retains the draft, validation and navigation rules.
export function OnboardingPeopleStep(props: Props) {
  const individual = props.mode === 'individual';
  return (
    <View style={styles.content}>
      <View style={styles.section}>
        {!individual && (
          <>
            <Text style={styles.modeLabel}>Hình thức thuê</Text>
            <View style={styles.modeCards}>
              {([
                ['family', 'Hộ gia đình', 'account-group-outline'],
                ['individual', 'Cá nhân', 'account-outline'],
              ] as const).map(([value, label, icon]) => {
                const selected = props.mode === value;
                return (
                  <TouchableRipple
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: props.created }}
                    accessibilityLabel={label}
                    disabled={props.created}
                    onPress={() => props.onModeChange(value)}
                    style={[styles.modeCard, selected && styles.modeCardSelected]}
                  >
                    <View style={styles.modeCardContent}>
                      <Icon source={icon} size={22} color={selected ? s.blue : '#64748B'} />
                      <Text style={[styles.modeCardLabel, selected && styles.modeCardLabelSelected]}>
                        {label}
                      </Text>
                      {selected && <Icon source="check-circle" size={20} color={s.blue} />}
                    </View>
                  </TouchableRipple>
                );
              })}
            </View>
          </>
        )}
      </View>

      <View style={styles.section}>
        {!individual && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Danh sách người ở</Text>
            <Text style={styles.count}>{props.people.length}/{props.maxPeople} người</Text>
          </View>
        )}
        {!individual && (
          <Text style={styles.count}>Đã xác nhận {props.completedCount}/{props.people.length}</Text>
        )}

        <View style={styles.list}>
          {props.people.map((item, index) => {
            const representative = item.key === props.representative;
            const expanded = individual || item.key === props.editing;
            const fallbackName = `Người ở ${index + 1}`;
            const label = item.label.trim();
            const name =
              item.member?.fullName.trim() ||
              (/^Người ở \d+$/.test(label) ? fallbackName : label || fallbackName);
            const displayName = individual ? 'Người thuê' : name;
            const canDelete =
              !props.rosterLocked &&
              props.people.length > 1 &&
              (!item.residentId || (props.mode === 'family' && !representative)) &&
              !(props.created && representative);
            return (
              <View key={item.key} style={[styles.person, expanded && styles.personExpanded]}>
                <View style={styles.personHeader}>
                  <TouchableRipple
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${expanded ? 'Thu gọn' : 'Mở'} ${displayName}`}
                    disabled={individual}
                    onPress={() => props.onEdit(item.key)}
                    style={styles.personSummary}
                  >
                    <View style={styles.identity}>
                      <Text style={styles.personName} numberOfLines={1}>{displayName}</Text>
                      {!individual && (
                        <Text style={styles.role}>
                          {representative ? 'Người đại diện' : 'Thành viên cùng ở'}
                        </Text>
                      )}
                      <Text style={item.status === 'confirmed' ? styles.confirmed : styles.statusText}>
                        {item.status === 'confirmed' ? 'Đã xác minh CCCD' : identityStatusLabels[item.status]}
                      </Text>
                    </View>
                  </TouchableRipple>
                  {!individual && (
                    <View style={styles.iconActions}>
                      <IconButton
                        icon={expanded ? 'chevron-up' : 'pencil-outline'}
                        size={20}
                        style={styles.iconButton}
                        iconColor={s.navy}
                        accessibilityLabel={`${expanded ? 'Thu gọn' : 'Xác minh'} ${name}`}
                        onPress={() => props.onEdit(item.key)}
                      />
                      <IconButton
                        icon="trash-can-outline"
                        size={20}
                        style={styles.iconButton}
                        iconColor={canDelete ? c.red : '#94A3B8'}
                        containerColor={canDelete ? '#FFF1F2' : undefined}
                        disabled={!canDelete}
                        accessibilityLabel={`Xóa ${name}`}
                        onPress={() => props.onDelete(item.key)}
                      />
                    </View>
                  )}
                </View>
                {expanded && (
                  <View style={styles.expandedContent}>
                    <IdentityPersonCard
                      embedded
                      person={item}
                      label={props.personLabel(item)}
                      role={individual ? 'Người thuê' : representative ? 'Người đại diện' : 'Thành viên cùng ở'}
                      disabled={props.disabledFor(item)}
                      onScan={(side) => props.onScan(item, side)}
                      onManual={() => props.onManual(item)}
                    />
                    {!individual && !props.created && !representative && (
                      <Button
                        compact
                        icon="account-star-outline"
                        textColor={s.blue}
                        contentStyle={styles.secondaryTouch}
                        style={styles.representativeAction}
                        onPress={() => props.onRepresentative(item.key)}
                        accessibilityLabel={`Chọn ${name} làm người đại diện`}
                      >
                        Chọn làm đại diện
                      </Button>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {!individual && (
          <>
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
            {props.maxPeople <= 0 && (
              <Text style={styles.description}>
                Phòng không còn chỗ hoặc chưa tải được sức chứa. Vui lòng chọn lại phòng.
              </Text>
            )}
            {props.people.length > props.maxPeople && (
              <Text accessibilityRole="alert" style={styles.description}>
                Danh sách vượt giới hạn {props.maxPeople} người. Hãy bớt người ở trước khi tiếp tục.
              </Text>
            )}
          </>
        )}
      </View>

      {!props.inline && (
        <View style={styles.actions}>
          <Button mode="outlined" icon="arrow-left" textColor={s.navy} style={styles.actionButton}
            contentStyle={styles.touch} disabled={props.backDisabled} onPress={props.onBack}>
            Quay lại
          </Button>
          <Button mode="contained" buttonColor={s.blue} style={styles.actionButton}
            contentStyle={styles.touch} disabled={!props.canContinue} onPress={props.onContinue}>
            Tiếp tục
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  section: { gap: 10 },
  modeLabel: { color: s.navy, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  modeCards: { flexDirection: 'row', gap: 10 },
  modeCard: {
    flex: 1, minWidth: 0, minHeight: 58, borderRadius: 14, borderWidth: 1,
    borderColor: '#CBD5E1', backgroundColor: c.white, overflow: 'hidden',
  },
  modeCardSelected: { borderColor: s.blue, backgroundColor: s.blueSoft },
  modeCardContent: { minHeight: 56, paddingHorizontal: 10, gap: 8, flexDirection: 'row', alignItems: 'center' },
  modeCardLabel: { flex: 1, minWidth: 0, color: s.navy, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  modeCardLabelSelected: { color: s.blue },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: s.navy, fontSize: 17, lineHeight: 24, fontWeight: '700', flexShrink: 1 },
  description: { color: '#475569', fontSize: 13, lineHeight: 19 },
  count: { color: '#475569', fontSize: 13, lineHeight: 20 },
  list: { gap: 10 },
  person: { padding: 10, gap: 8, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.white },
  personExpanded: { borderColor: '#C9D9EC' },
  personHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  personSummary: { flex: 1, minWidth: 0, borderRadius: 10, overflow: 'hidden' },
  identity: { minWidth: 0, gap: 2, padding: 4 },
  personName: { color: s.navy, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  role: { color: '#475569', fontSize: 12, lineHeight: 17 },
  iconActions: { flexDirection: 'row' },
  iconButton: { width: 44, height: 44, margin: 0, borderRadius: 12 },
  statusText: { color: '#475569', fontSize: 12, lineHeight: 17 },
  confirmed: { color: s.green, fontSize: 12, lineHeight: 17 },
  expandedContent: { borderTopWidth: 1, borderTopColor: '#E8EDF4', paddingTop: 10, gap: 6 },
  representativeAction: { alignSelf: 'flex-start', marginLeft: -8 },
  secondaryTouch: { minHeight: 44 },
  addButton: { borderRadius: 12, borderColor: '#CBD5E1', backgroundColor: c.white },
  touch: { minHeight: 48 },
  actions: { flexDirection: 'row', gap: 12, paddingTop: 16, paddingBottom: 8, borderTopWidth: 1, borderTopColor: c.border },
  actionButton: { flex: 1, borderRadius: 12 },
});
