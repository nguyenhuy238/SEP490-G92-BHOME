import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Button, Icon, ProgressBar, Text } from 'react-native-paper';
import type { ConfirmedReading, MeterTask } from '../../../../packages/client-core/src/meter';
import { Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { meterRoundLabel } from '../features/workspace/roomMeterTasks';
import { colors as c } from '../theme/theme';

export function MeterRoomOverview({
  tasks,
  readings,
  loading,
  error,
  onSelect,
  onReload,
  onBack,
}: {
  tasks: MeterTask[];
  readings: Record<string, ConfirmedReading>;
  loading: boolean;
  error: string;
  onSelect: (id: string) => void;
  onReload: () => void;
  onBack: () => void;
}) {
  const first = tasks[0];
  const required = tasks.filter((task) => task.status !== 3);
  const count = required.filter((task) => task.status === 2 && !!readings[task.id]).length;
  return (
    <WorkspaceShell screen="meter-reading" onBack={onBack} contentRevision={loading ? 0 : 1}>
      <Heading title="Ghi chỉ số điện nước" />
      {loading ? (
        <ActivityIndicator accessibilityLabel="Đang tải đồng hồ của phòng" />
      ) : error ? (
        <Box>
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
          <Button onPress={onReload}>Thử tải lại đồng hồ</Button>
        </Box>
      ) : first ? (
        <>
          <View style={{ gap: 6 }}>
            <Heading title={`Phòng ${first.room}`} detail={first.location} />
            <Text style={ui.muted}>{meterRoundLabel(first)}</Text>
          </View>
          {!!required.length && (
            <View style={{ gap: 8 }}>
              <Row spread>
                <Text variant="labelLarge">
                  {count}/{required.length} đồng hồ đã ghi
                </Text>
                {count === required.length && <Pill tone="green">Phòng đã hoàn tất</Pill>}
              </Row>
              <ProgressBar
                progress={count / required.length}
                color={count === required.length ? c.green : c.blue}
                style={{ height: 4, borderRadius: 4 }}
              />
            </View>
          )}
          {[0, 1].map((utility) => {
            const meters = tasks.filter((task) => task.utilityType === utility);
            const title = utility === 0 ? 'Đồng hồ điện' : 'Đồng hồ nước';
            const unit = utility === 0 ? 'kWh' : 'm³';
            const icon = utility === 0 ? 'lightning-bolt-outline' : 'water-outline';
            return meters.length ? (
              meters.map((task) => {
                const saved = readings[task.id];
                const done = task.status === 2 && !!saved;
                const pending = task.status < 2 && !task.confirmedReadingId;
                const previous = saved?.previousValue ?? task.previousValue;
                return (
                  <Box key={task.id} style={{ padding: 16, gap: 14 }}>
                    <Row spread>
                      <Row>
                        <Icon source={icon} size={25} color={utility === 0 ? c.amber : c.blue} />
                        <Text variant="titleMedium">{title}</Text>
                      </Row>
                      <Pill tone={done ? 'green' : task.status === 3 ? 'neutral' : 'amber'}>
                        {done ? 'Đã ghi' : task.status === 3 ? 'Đã hủy' : 'Chưa ghi'}
                      </Pill>
                    </Row>
                    <Text variant="labelSmall" style={ui.muted}>
                      {task.meterCode}
                    </Text>
                    <Text style={ui.muted}>
                      Chỉ số trước: {previous === null ? 'Chưa có' : `${previous} ${unit}`}
                    </Text>
                    {done && (
                      <View style={{ gap: 4 }}>
                        <Text style={ui.muted}>Chỉ số đã ghi</Text>
                        <Text variant="titleLarge" style={ui.money}>
                          {saved.confirmedValue} {unit}
                        </Text>
                      </View>
                    )}
                    <Button
                      mode={done ? 'outlined' : 'contained'}
                      icon={done ? 'text-box-search-outline' : 'camera-outline'}
                      accessibilityLabel={`${done ? 'Xem chi tiết' : 'Chụp ảnh'} ${title.toLowerCase()}${meters.length > 1 ? ` ${task.meterCode}` : ''}`}
                      contentStyle={{ minHeight: 48 }}
                      disabled={!done && !pending}
                      onPress={() => onSelect(task.id)}
                    >
                      {done ? 'Xem chi tiết' : 'Chụp ảnh'}
                    </Button>
                  </Box>
                );
              })
            ) : (
              <Box key={utility} style={{ padding: 16, gap: 8 }}>
                <Row>
                  <Icon source={icon} size={25} color={c.muted} />
                  <Text variant="titleMedium">{title}</Text>
                </Row>
                <Text style={ui.muted}>Chưa có tác vụ ghi chỉ số.</Text>
              </Box>
            );
          })}
        </>
      ) : null}
    </WorkspaceShell>
  );
}
