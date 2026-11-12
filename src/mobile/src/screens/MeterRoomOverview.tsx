import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Button, Icon, ProgressBar, Text } from 'react-native-paper';
import { formatMeterReading } from '../../../../packages/client-core/src/localization';
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
      <Heading title="Ghi chỉ số điện nước" detail="Quản lý ghi chỉ số theo phòng" />
      {loading ? (
        <ActivityIndicator accessibilityLabel="Đang tải đồng hồ của phòng" />
      ) : error ? (
        <Box style={{ padding: 14, gap: 10 }}>
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
          <Button onPress={onReload}>Thử tải lại đồng hồ</Button>
        </Box>
      ) : first ? (
        <>
          <Box style={{ padding: 14, gap: 8 }}>
            <Row spread>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Heading title={`Phòng ${first.room}`} detail={meterRoundLabel(first)} />
                <Text variant="labelMedium" style={{ color: c.primary }}>
                  Cơ sở: {first.location}
                </Text>
              </View>
              {!!required.length && count === required.length && (
                <Pill tone="green">Phòng đã hoàn tất</Pill>
              )}
            </Row>
            {!!required.length && (
              <View style={{ gap: 6, paddingTop: 2 }}>
                <Row spread>
                  <Text variant="labelLarge">
                    {count}/{required.length} đồng hồ đã ghi
                  </Text>
                </Row>
                <ProgressBar
                  progress={count / required.length}
                  color={count === required.length ? c.green : c.blue}
                  style={{ height: 4, borderRadius: 4 }}
                />
              </View>
            )}
          </Box>
          {!!required.length && count === required.length && (
            <Box style={{ padding: 14, gap: 6 }}>
              <Row spread>
                <Text variant="titleSmall" style={{ color: c.primary, fontWeight: '700' }}>
                  {first.purpose === 0 ? 'Đã lưu chỉ số ban đầu' : 'Đã lưu chỉ số định kỳ'}
                </Text>
                <Pill tone="blue">
                  {first.purpose === 0 ? 'Mốc khởi tạo' : 'Chờ tổng hợp hóa đơn'}
                </Pill>
              </Row>
              <Text variant="bodySmall" style={ui.muted}>
                {first.purpose === 0
                  ? 'Chỉ số điện và nước đã được lưu làm mốc chỉ số ban đầu của phòng. Hệ thống không tính tiêu thụ định kỳ hay phát sinh hóa đơn cho lần ghi ban đầu.'
                  : 'Chỉ số và mức tiêu thụ đã lưu vào hệ thống. Hóa đơn tạm tính và hóa đơn phát hành sẽ được tạo theo lịch chốt sổ của cơ sở.'}
              </Text>
            </Box>
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
                const isInitial = task.purpose === 0;
                return (
                  <Box key={task.id} style={{ padding: 14, gap: 10 }}>
                    <Row spread>
                      <Row>
                        <Icon source={icon} size={22} color={utility === 0 ? c.amber : c.blue} />
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
                      Chỉ số trước: {previous === null ? 'Chưa có' : formatMeterReading(previous, unit)}
                    </Text>
                    {isInitial && (
                      <Text variant="bodySmall" style={ui.muted}>
                        Mốc chỉ số ban đầu — không tính tiêu thụ kỳ
                      </Text>
                    )}
                    {done && (
                      <View style={{ gap: 2 }}>
                        <Text variant="bodySmall" style={ui.muted}>
                          Chỉ số đã ghi
                        </Text>
                        <Text variant="titleLarge" style={ui.money}>
                          {formatMeterReading(saved.confirmedValue, unit)}
                        </Text>
                        {!isInitial && saved.consumption !== null && (
                          <Text variant="bodySmall" style={ui.muted}>
                            Tiêu thụ kỳ này: {formatMeterReading(saved.consumption, unit)}
                          </Text>
                        )}
                      </View>
                    )}
                    <Button
                      mode={done ? 'outlined' : 'contained'}
                      icon={done ? 'text-box-search-outline' : 'camera-outline'}
                      accessibilityLabel={`${done ? 'Xem chi tiết' : 'Chụp ảnh'} ${title.toLowerCase()}${meters.length > 1 ? ` ${task.meterCode}` : ''}`}
                      contentStyle={{ minHeight: 44 }}
                      disabled={!done && !pending}
                      onPress={() => onSelect(task.id)}
                    >
                      {done ? 'Xem chi tiết' : 'Chụp ảnh'}
                    </Button>
                  </Box>
                );
              })
            ) : (
              <Box key={utility} style={{ padding: 14, gap: 6 }}>
                <Row>
                  <Icon source={icon} size={22} color={c.muted} />
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
