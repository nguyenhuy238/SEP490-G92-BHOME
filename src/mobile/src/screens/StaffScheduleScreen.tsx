import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { Box, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import type { Named } from '../lib/api';
import { colors as c } from '../theme/theme';

// UC-09: read-only. The current API exposes assigned locations, but no shifts.
export function StaffScheduleScreen() {
  const { role, preview, go } = useWorkspace();
  const { session } = useSession();
  const allowed = role === 'Staff' && (preview || !!session?.roles.includes('Staff'));
  const enabled = allowed && !preview;
  const locations = useWorkspaceQuery<Named[]>(enabled ? '/api/v1/capture/locations' : null);
  const { reload } = locations;
  const [locationId, setLocationId] = useState('');
  useFocusEffect(
    useCallback(() => {
      if (enabled) reload();
    }, [enabled, reload]),
  );
  const items = enabled ? (locations.data ?? []) : [];
  const selected = items.some((item) => item.id === locationId) ? locationId : '';

  if (!allowed) return <Text>Bạn không có quyền xem lịch làm việc của Staff.</Text>;
  return (
    <>
      <View style={ui.between}>
        <View style={ui.grow}>
          <Text variant="titleLarge">Lịch làm việc</Text>
          <Text variant="bodySmall" style={ui.muted}>
            Theo dõi ca trực được phân công
          </Text>
        </View>
        {enabled && (
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại cơ sở được phân công"
            disabled={locations.loading}
            onPress={reload}
            style={styles.refresh}
          />
        )}
      </View>

      {enabled && locations.loading && (
        <Box style={styles.compact}>
          <View style={ui.row}>
            <ActivityIndicator size="small" accessibilityLabel="Đang tải cơ sở được phân công" />
            <Text variant="bodyMedium" style={ui.muted}>
              Đang tải cơ sở được phân công…
            </Text>
          </View>
        </Box>
      )}
      {enabled && !!locations.error && (
        <Box style={styles.compact}>
          <Text accessibilityRole="alert" variant="bodyMedium">
            Không thể tải cơ sở được phân công.
          </Text>
          <Text variant="bodySmall" style={ui.muted}>
            {locations.error}
          </Text>
          <Button
            compact
            icon="refresh"
            onPress={reload}
            style={styles.retry}
            contentStyle={styles.touch}
          >
            Thử lại
          </Button>
        </Box>
      )}
      {items.length === 1 && (
        <Box style={styles.compact}>
          <View style={ui.row}>
            <Icon source="map-marker-outline" size={22} color={c.navy} />
            <View style={ui.grow}>
              <Text variant="labelSmall" style={ui.muted}>
                Cơ sở được phân công
              </Text>
              <Text variant="titleSmall">{items[0].label}</Text>
            </View>
          </View>
        </Box>
      )}
      {items.length > 1 && (
        <Box style={styles.compact}>
          <ChoiceField
            label="Cơ sở được phân công"
            value={selected}
            options={[{ id: '', label: 'Tất cả cơ sở' }, ...items]}
            onChange={setLocationId}
          />
        </Box>
      )}

      <Box style={styles.empty}>
        <View style={styles.calendar}>
          <Icon source="calendar-blank-outline" size={32} color={c.navy} />
        </View>
        <Text variant="titleMedium" style={styles.center}>
          Chưa có dữ liệu lịch làm việc
        </Text>
        <Text variant="bodyMedium" style={[ui.muted, styles.center]}>
          Lịch ca trực hiện chưa có dữ liệu để hiển thị.
        </Text>
      </Box>

      <View style={styles.tasks}>
        <TouchableRipple
          accessibilityRole="button"
          accessibilityLabel="Mở công việc được giao"
          onPress={() => go('work-orders')}
          style={styles.taskButton}
        >
          <View style={styles.taskRow}>
            <Icon source="clipboard-text-outline" size={24} color={c.navy} />
            <View style={ui.grow}>
              <Text variant="titleSmall">Công việc được giao</Text>
              <Text variant="bodySmall" style={ui.muted}>
                Xem và xử lý nhiệm vụ được phân công
              </Text>
            </View>
            <Icon source="chevron-right" size={22} color={c.muted} />
          </View>
        </TouchableRipple>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  compact: { padding: 12, gap: 8 },
  refresh: { margin: 0 },
  retry: { alignSelf: 'flex-start' },
  touch: { minHeight: 44 },
  empty: { alignItems: 'center', paddingHorizontal: 18, paddingVertical: 24, gap: 10 },
  calendar: { backgroundColor: c.soft, borderRadius: 18, padding: 14, marginBottom: 2 },
  center: { textAlign: 'center' },
  tasks: {
    backgroundColor: c.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  taskButton: { borderRadius: 12 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 72 },
});
