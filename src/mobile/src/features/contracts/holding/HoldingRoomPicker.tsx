import React, { useMemo, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Icon, IconButton, Searchbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, staffColors } from '../../../theme/theme';
import { RoomCapacityFilter } from '../main/RoomCapacityFilter';

type RoomOption = {
  id: string;
  label: string;
  floor?: string | null;
  capacity?: number;
};

const fieldLabel = 'Phòng giữ chỗ *';
const capacities = [0, 1, 2, 3, 4, 'custom'] as const;
const floorOf = (room: RoomOption) => room.floor?.trim() || '';
const surface = '#F8FAFC';
const selectedSurface = '#EFF6FF';

export function HoldingRoomPicker({
  rooms,
  value,
  disabled,
  loading = false,
  error = '',
  onRetry,
  onChange,
}: {
  rooms: RoomOption[];
  value: string;
  disabled: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [capacity, setCapacity] = useState<(typeof capacities)[number]>(0);
  const [customMinimum, setCustomMinimum] = useState('');
  const [draftId, setDraftId] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width >= 360 && fontScale <= 1.25;
  const [offset] = useState(() => new Animated.Value(0));
  const selected = rooms.find((room) => room.id === value);
  const draftRoom = rooms.find((room) => room.id === draftId);
  const term = search.trim().toLocaleLowerCase('vi');
  const minimum = capacity === 'custom' ? Number(customMinimum) : capacity;
  const floorOptions = useMemo(() => {
    const floors = new Map<string, RoomOption[]>();
    for (const room of rooms) {
      if (!room.label.toLocaleLowerCase('vi').includes(term) || minimum > (room.capacity ?? 0))
        continue;
      const floor = floorOf(room);
      const options = floors.get(floor) ?? [];
      options.push(room);
      floors.set(floor, options);
    }
    return [...floors].sort(([a], [b]) =>
      a && b ? a.localeCompare(b, 'vi', { numeric: true }) : Number(!a) - Number(!b),
    );
  }, [rooms, term, minimum]);
  const resultCount = floorOptions.reduce((count, [, options]) => count + options.length, 0);
  const filtered = !!term || capacity !== 0;
  const close = React.useCallback(() => {
    Keyboard.dismiss();
    setOpen(false);
  }, []);
  const drag = useMemo(() => {
    const restore = () =>
      Animated.spring(offset, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dx, dy }) => dy > 8 && dy > Math.abs(dx),
      onPanResponderMove: (_, { dy }) => offset.setValue(Math.max(0, dy)),
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 90 || (dy > 24 && vy > 0.8)) close();
        else restore();
      },
      onPanResponderTerminate: restore,
    });
  }, [close, offset]);
  const changeSearch = (next: string) => {
    if (next.trim() !== search.trim()) {
      const query = next.trim().toLocaleLowerCase('vi');
      setExpanded(
        query
          ? new Set(
              rooms
                .filter((room) => room.label.toLocaleLowerCase('vi').includes(query))
                .map(floorOf),
            )
          : new Set(draftRoom ? [floorOf(draftRoom)] : []),
      );
    }
    setSearch(next);
  };
  const reset = () => {
    changeSearch('');
    setCapacity(0);
    setCustomMinimum('');
  };
  const toggleFloor = (floor: string) => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((before) => {
      const next = new Set(before);
      if (next.has(floor)) next.delete(floor);
      else next.add(floor);
      return next;
    });
  };

  return (
    <View style={styles.field}>
      <Text variant="labelMedium">{fieldLabel}</Text>
      <Button
        mode="outlined"
        icon="door-open"
        accessibilityLabel={fieldLabel}
        accessibilityHint={selected?.label}
        disabled={disabled}
        contentStyle={styles.triggerContent}
        style={styles.trigger}
        onPress={() => {
          setSearch('');
          setDraftId(value);
          setExpanded(new Set(selected ? [floorOf(selected)] : []));
          offset.setValue(0);
          setOpen(true);
        }}
      >
        {selected?.label ?? 'Chọn phòng còn trống'}
      </Button>
      {open && (
        <Modal transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
          <KeyboardAvoidingView
            style={[styles.overlay, { paddingLeft: insets.left, paddingRight: insets.right }]}
            behavior={
              Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
            }
          >
            <Pressable
              accessible={false}
              importantForAccessibility="no"
              style={StyleSheet.absoluteFill}
              onPress={close}
            />
            <Animated.View
              accessibilityViewIsModal
              style={[
                styles.sheet,
                {
                  transform: [{ translateY: offset }],
                },
              ]}
            >
              <View {...drag.panHandlers} collapsable={false} style={styles.handleArea}>
                <View style={styles.handle} />
              </View>
              <View style={styles.header}>
                <View style={styles.heading}>
                  <Text accessibilityRole="header" style={styles.title}>
                    Chọn phòng giữ chỗ
                  </Text>
                  <Text style={styles.secondary}>Tìm kiếm và lựa chọn phòng phù hợp</Text>
                </View>
                <IconButton
                  icon="close"
                  size={22}
                  iconColor={colors.ink}
                  accessibilityLabel="Đóng"
                  onPress={close}
                  style={styles.close}
                />
              </View>
              <View style={styles.filters}>
                <Searchbar
                  accessibilityLabel="Tìm theo mã phòng"
                  clearAccessibilityLabel="Xóa tìm kiếm"
                  placeholder="Tìm theo mã phòng..."
                  value={search}
                  onChangeText={changeSearch}
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={styles.search}
                  inputStyle={styles.searchInput}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.chipScroll}
                  contentContainerStyle={styles.chips}
                >
                  {capacities.map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: capacity === option }}
                      onPress={() => setCapacity(option)}
                      style={({ pressed }) => [
                        styles.chip,
                        capacity === option && styles.chipSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[styles.chipText, capacity === option && styles.chipTextSelected]}
                      >
                        {option === 'custom'
                          ? 'Tùy chỉnh'
                          : option === 0
                            ? 'Tất cả'
                            : `${option}+ người`}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {capacity === 'custom' && (
                  <RoomCapacityFilter
                    value={customMinimum}
                    onChange={setCustomMinimum}
                    disabled={false}
                  />
                )}
                <View style={styles.resultRow}>
                  <Text accessibilityLiveRegion="polite" style={styles.secondary}>
                    {loading
                      ? 'Đang tải phòng…'
                      : error
                        ? 'Danh sách phòng'
                        : `${resultCount} phòng phù hợp`}
                  </Text>
                  {filtered && resultCount > 0 && (
                    <Button compact onPress={reset}>
                      Đặt lại bộ lọc
                    </Button>
                  )}
                </View>
              </View>
              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              >
                {loading ? (
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel="Đang tải phòng giữ chỗ"
                    style={styles.skeletonGroup}
                  >
                    {[1, 2, 3].map((row) => (
                      <View key={row} style={styles.skeletonRow}>
                        <View style={styles.skeletonText} />
                      </View>
                    ))}
                  </View>
                ) : error ? (
                  <View style={styles.empty}>
                    <Icon source="alert-circle-outline" size={28} color={colors.red} />
                    <Text accessibilityRole="alert" style={styles.emptyTitle}>
                      Không tải được danh sách phòng
                    </Text>
                    <Text style={styles.secondary}>{error}</Text>
                    {onRetry && <Button onPress={onRetry}>Thử lại</Button>}
                  </View>
                ) : !resultCount ? (
                  <View style={styles.empty}>
                    <Icon source="magnify" size={28} color={colors.muted} />
                    <Text style={styles.emptyTitle}>Không tìm thấy phòng phù hợp</Text>
                    <Button onPress={reset} disabled={!filtered}>
                      Đặt lại bộ lọc
                    </Button>
                  </View>
                ) : (
                  floorOptions.map(([floor, options]) => {
                    const isExpanded = expanded.has(floor);
                    const title = floor
                      ? /^tầng\b/i.test(floor)
                        ? floor
                        : `Tầng ${floor}`
                      : 'Chưa phân tầng';
                    return (
                      <View key={floor} style={styles.floor}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${title} · ${options.length} phòng`}
                          accessibilityState={{ expanded: isExpanded }}
                          onPress={() => toggleFloor(floor)}
                          style={({ pressed }) => [styles.floorHeader, pressed && styles.pressed]}
                        >
                          <Icon source="layers-outline" size={20} color={staffColors.navy} />
                          <Text style={styles.floorTitle}>{title}</Text>
                          <Text style={styles.floorCount}>{options.length} phòng</Text>
                          <Icon
                            source={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={20}
                            color={colors.muted}
                          />
                        </Pressable>
                        {isExpanded && (
                          <View style={styles.rooms}>
                            {options.map((room) => {
                              const picked = room.id === draftId;
                              return (
                                <Pressable
                                  key={room.id}
                                  accessibilityRole="button"
                                  accessibilityLabel={
                                    room.capacity
                                      ? `${room.label} · ${room.capacity} người`
                                      : room.label
                                  }
                                  accessibilityState={{ selected: picked, disabled }}
                                  disabled={disabled}
                                  onPress={() => setDraftId(room.id)}
                                  style={({ pressed }) => [
                                    styles.room,
                                    { width: twoColumns ? '48.5%' : '100%' },
                                    picked && styles.roomSelected,
                                    pressed && styles.pressed,
                                    disabled && styles.disabled,
                                  ]}
                                >
                                  <View style={styles.roomTitleRow}>
                                    <Icon source="door-open" size={18} color={staffColors.navy} />
                                    <Text style={styles.roomTitle}>{room.label}</Text>
                                    {picked && (
                                      <Icon
                                        source="check-circle"
                                        size={18}
                                        color={staffColors.blue}
                                      />
                                    )}
                                  </View>
                                  {!!room.capacity && (
                                    <View style={styles.roomCapacity}>
                                      <Icon
                                        source="account-outline"
                                        size={16}
                                        color={colors.muted}
                                      />
                                      <Text style={styles.secondary}>{room.capacity} người</Text>
                                    </View>
                                  )}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>
              <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={draftRoom ? styles.selection : styles.secondary}
                >
                  {draftRoom ? `Đã chọn: ${draftRoom.label}` : 'Chưa chọn phòng'}
                </Text>
                <Button
                  mode="contained"
                  buttonColor={staffColors.navy}
                  disabled={!draftRoom || loading || !!error || disabled}
                  style={styles.confirmButton}
                  contentStyle={styles.confirmContent}
                  onPress={() => {
                    if (!draftRoom || loading || error || disabled) return;
                    onChange(draftRoom.id);
                    close();
                  }}
                >
                  Xác nhận chọn phòng
                </Button>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  trigger: { borderColor: colors.border, borderRadius: 10 },
  triggerContent: { flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 48 },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '89%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  handleArea: { height: 24, justifyContent: 'center', alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: 4, backgroundColor: colors.border },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  heading: { flex: 1, gap: 4 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  secondary: { color: colors.muted, fontSize: 14 },
  close: { width: 44, height: 44, margin: 0, backgroundColor: surface },
  filters: { paddingHorizontal: 16, gap: 8 },
  search: {
    backgroundColor: surface,
    borderRadius: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { minHeight: 46, fontSize: 15 },
  chipScroll: { flexGrow: 0 },
  chips: { gap: 8, alignItems: 'center' },
  chip: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  chipSelected: { borderColor: staffColors.navy, backgroundColor: staffColors.navy },
  chipText: { color: colors.ink, fontWeight: '600' },
  chipTextSelected: { color: colors.white },
  resultRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  list: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  floor: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: surface,
  },
  floorHeader: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floorTitle: { flex: 1, color: colors.ink, fontWeight: '700' },
  floorCount: { color: staffColors.navy, fontSize: 13, fontWeight: '600' },
  rooms: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    padding: 8,
    paddingTop: 0,
  },
  room: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 8,
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.white,
  },
  roomSelected: { borderColor: staffColors.blue, backgroundColor: selectedSurface },
  roomTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roomTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' },
  roomCapacity: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  empty: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, gap: 8 },
  emptyTitle: { color: colors.ink, fontWeight: '600', textAlign: 'center' },
  skeletonGroup: { gap: 8 },
  skeletonRow: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: surface,
  },
  skeletonText: { width: '38%', height: 12, borderRadius: 4, backgroundColor: colors.border },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  selection: { color: staffColors.navy, fontSize: 14, fontWeight: '700' },
  confirmButton: { borderRadius: 12 },
  confirmContent: { minHeight: 48 },
});
