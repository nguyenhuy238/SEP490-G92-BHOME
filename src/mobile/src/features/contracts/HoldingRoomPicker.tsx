import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import { colors } from '../../theme/theme';
import { RoomCapacityFilter } from './RoomCapacityFilter';

type RoomOption = {
  id: string;
  label: string;
  floor?: string | null;
  capacity?: number;
};

const fieldLabel = 'Phòng giữ chỗ *';
const floorOf = (room: RoomOption) => room.floor?.trim() || '';

export function HoldingRoomPicker({
  rooms,
  value,
  disabled,
  onChange,
}: {
  rooms: RoomOption[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [minimum, setMinimum] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const selected = rooms.find((room) => room.id === value);
  const floors = new Map<string, RoomOption[]>();
  if (open) {
    const term = search.trim().toLocaleLowerCase('vi');
    for (const room of rooms) {
      if (!room.label.toLocaleLowerCase('vi').includes(term)) continue;
      if (Number(minimum) > (room.capacity ?? 0)) continue;
      const floor = floorOf(room);
      const options = floors.get(floor) ?? [];
      options.push(room);
      floors.set(floor, options);
    }
  }
  const floorOptions = [...floors].sort(([a], [b]) =>
    a && b ? a.localeCompare(b, 'vi', { numeric: true }) : Number(!a) - Number(!b),
  );

  return (
    <View style={styles.field}>
      <Text variant="labelMedium">{fieldLabel}</Text>
      <Button
        mode="outlined"
        icon="door-open"
        accessibilityLabel={fieldLabel}
        accessibilityHint={selected?.label}
        disabled={disabled}
        contentStyle={styles.row}
        style={styles.trigger}
        onPress={() => {
          setSearch('');
          setExpanded(selected ? floorOf(selected) : null);
          setOpen(true);
        }}
      >
        {selected?.label ?? 'Chọn phòng còn trống'}
      </Button>
      <Portal>
        {open && (
          <Dialog visible onDismiss={() => setOpen(false)} style={styles.dialog}>
            <Dialog.Title>Phòng giữ chỗ</Dialog.Title>
            <View style={styles.filters}>
              <RoomCapacityFilter value={minimum} onChange={setMinimum} disabled={false} />
              <TextInput
                mode="outlined"
                label="Tìm theo mã phòng"
                accessibilityLabel="Tìm theo mã phòng"
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <Dialog.ScrollArea style={styles.scrollArea}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.floors}>
                {floorOptions.map(([floor, options]) => {
                  const isExpanded = floor === expanded;
                  const title = floor
                    ? /^tầng\b/i.test(floor)
                      ? floor
                      : `Tầng ${floor}`
                    : 'Chưa phân tầng';
                  return (
                    <View key={floor} style={styles.group}>
                      <Button
                        icon={isExpanded ? 'chevron-up' : 'chevron-down'}
                        mode="text"
                        contentStyle={styles.row}
                        accessibilityState={{ expanded: isExpanded }}
                        onPress={() => setExpanded(isExpanded ? null : floor)}
                      >
                        {`${title} · ${options.length} phòng`}
                      </Button>
                      {isExpanded && (
                        <View style={styles.rooms}>
                          {options.map((room) => (
                            <Button
                              key={room.id}
                              mode={room.id === value ? 'contained-tonal' : 'outlined'}
                              compact
                              contentStyle={styles.room}
                              accessibilityState={{ selected: room.id === value }}
                              onPress={() => {
                                onChange(room.id);
                                setOpen(false);
                              }}
                            >
                              {room.label}
                              {room.capacity ? ` · ${room.capacity} người` : ''}
                            </Button>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
                {!floorOptions.length && (
                  <Text accessibilityLiveRegion="polite" style={styles.empty}>
                    {rooms.length
                      ? 'Không có phòng phù hợp bộ lọc.'
                      : 'Cơ sở này chưa có phòng trống.'}
                  </Text>
                )}
              </ScrollView>
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button onPress={() => setOpen(false)}>Đóng</Button>
            </Dialog.Actions>
          </Dialog>
        )}
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  trigger: { borderColor: colors.border, borderRadius: 10 },
  row: { flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 48 },
  dialog: { height: '75%' },
  filters: { gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  scrollArea: { paddingHorizontal: 12, flex: 1, minHeight: 0 },
  floors: { gap: 4, paddingVertical: 6 },
  group: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rooms: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8 },
  room: { minHeight: 44 },
  empty: { padding: 12 },
});
