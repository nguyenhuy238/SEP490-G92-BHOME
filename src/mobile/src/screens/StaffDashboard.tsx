import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, Portal, Text, TouchableRipple } from 'react-native-paper';
import { StaffFeatureCard } from '../components/StaffFeatureCard';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { type WorkspaceScreen } from '../features/workspace/navigation';
import { colors as c, staffColors as s } from '../theme/theme';

const groups = [
  {
    title: 'TIẾP NHẬN & HỢP ĐỒNG',
    items: [
      {
        title: 'Tiếp nhận người thuê',
        detail: 'Quét CCCD & lập hồ sơ',
        icon: 'account-plus-outline',
        color: s.blue,
        background: s.blueSoft,
        screen: 'onboarding',
      },
      {
        title: 'Hợp đồng',
        detail: 'Chuẩn bị & theo dõi ký',
        icon: 'file-document-edit-outline',
        color: s.purple,
        background: s.purpleSoft,
        screen: 'signing',
      },
    ],
  },
  {
    title: 'CÔNG VIỆC & LỊCH LÀM',
    items: [
      {
        title: 'Công việc của tôi',
        detail: 'Theo dõi & cập nhật tiến độ',
        icon: 'clipboard-check-outline',
        color: s.green,
        background: s.greenSoft,
        screen: 'work-orders',
      },
      {
        title: 'Lịch làm việc',
        detail: 'Xem ca được phân công',
        icon: 'calendar-month-outline',
        color: s.blue,
        background: s.blueSoft,
        screen: 'shifts',
      },
    ],
  },
  {
    title: 'ĐIỆN NƯỚC & BÀN GIAO',
    items: [
      {
        title: 'Ghi điện nước',
        detail: 'Chụp công tơ & OCR',
        icon: 'gauge',
        color: s.purple,
        background: s.purpleSoft,
        screen: 'meter-reading',
      },
      {
        title: 'Bàn giao / Trả phòng',
        detail: 'Kiểm tra & xác nhận',
        icon: 'key-outline',
        color: s.orange,
        background: s.orangeSoft,
        screen: 'move-in',
      },
    ],
  },
  {
    title: 'SỰ CỐ & BẢO TRÌ',
    items: [
      {
        title: 'Báo cáo sự cố',
        detail: 'Báo hỏng hóc, sự cố',
        icon: 'alert-outline',
        color: s.red,
        background: s.redSoft,
        screen: 'report-incident',
      },
      {
        title: 'Xử lý sự cố',
        detail: 'Kiểm tra & sửa chữa',
        icon: 'tools',
        color: s.orange,
        background: s.orangeSoft,
        screen: 'work-orders',
      },
    ],
  },
  {
    title: 'CÔNG NỢ & THÔNG BÁO',
    items: [
      {
        title: 'Theo dõi công nợ',
        detail: 'Kiểm tra & nhắc nợ',
        icon: 'wallet-outline',
        color: s.green,
        background: s.greenSoft,
        screen: 'debt-follow-up',
      },
      {
        title: 'Gửi thông báo',
        detail: 'Thông báo đến người thuê',
        icon: 'bullhorn-outline',
        color: s.purple,
        background: s.purpleSoft,
        screen: 'send-notification',
      },
    ],
  },
] satisfies {
  title: string;
  items: {
    title: string;
    detail: string;
    icon: string;
    color: string;
    background: string;
    screen: WorkspaceScreen;
  }[];
}[];

export function StaffDashboard() {
  const { go, preview } = useWorkspace();
  const [handover, setHandover] = useState(false);
  return (
    <>
      <View style={styles.summary}>
        <View style={styles.greetingRow}>
          <View style={styles.greeting}>
            <Text variant="headlineSmall" style={styles.title}>
              {preview ? 'Xin chào, Long!' : 'Xin chào bạn!'}
            </Text>
            <TouchableRipple
              onPress={() => go('shifts')}
              accessibilityRole="button"
              accessibilityLabel="Xem lịch ca"
            >
              <Text variant="bodySmall" style={styles.muted}>
                {preview ? 'Ca sáng (07:30 – 16:30)' : 'Xem lịch ca được phân công ›'}
              </Text>
            </TouchableRipple>
          </View>
          <Chip
            icon={preview ? 'circle-small' : 'clock-outline'}
            style={[styles.status, !preview && styles.statusPending]}
            textStyle={preview ? styles.statusText : styles.muted}
          >
            {preview ? 'Đang trực' : 'Chưa có dữ liệu ca'}
          </Chip>
        </View>
        <View style={styles.metrics}>
          {[
            { value: '4/6', label: 'Công việc hôm nay', screen: 'work-orders', danger: false },
            { value: '1', label: 'Sự cố cần xử lý', screen: 'work-orders', danger: true },
            { value: '2', label: 'Phòng sắp bàn giao', screen: 'move-in', danger: false },
          ].map((metric, index) => (
            <TouchableRipple
              key={metric.label}
              style={[styles.metric, index > 0 && styles.divider]}
              accessibilityRole="button"
              accessibilityLabel={metric.label}
              onPress={() => (metric.screen === 'move-in' ? setHandover(true) : go('work-orders'))}
            >
              <View style={styles.metricContent}>
                <Text
                  variant="headlineMedium"
                  style={[styles.title, metric.danger && preview && styles.danger]}
                >
                  {preview ? metric.value : '—'}
                </Text>
                <Text style={styles.metricLabel}>{metric.label}</Text>
              </View>
            </TouchableRipple>
          ))}
        </View>
        {!preview && (
          <Text variant="labelSmall" style={styles.muted}>
            Chưa có dữ liệu tổng quan từ hệ thống.
          </Text>
        )}
      </View>
      {groups.map((group) => (
        <View key={group.title} style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.accent} />
            <Text variant="titleMedium" style={styles.title}>
              {group.title}
            </Text>
          </View>
          <View style={styles.grid}>
            {group.items.map((item) => (
              <StaffFeatureCard
                key={item.title}
                title={item.title}
                description={item.detail}
                icon={item.icon}
                color={item.color}
                background={item.background}
                onPress={() => (item.screen === 'move-in' ? setHandover(true) : go(item.screen))}
              />
            ))}
          </View>
        </View>
      ))}
      <Portal>
        <Dialog visible={handover} onDismiss={() => setHandover(false)}>
          <Dialog.Title>Bàn giao / Trả phòng</Dialog.Title>
          <Dialog.Content>
            <Text>Chọn nghiệp vụ cần thực hiện.</Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            <Button
              onPress={() => {
                setHandover(false);
                go('move-in');
              }}
            >
              Bàn giao nhận phòng
            </Button>
            <Button
              onPress={() => {
                setHandover(false);
                go('move-out');
              }}
            >
              Kiểm tra trả phòng
            </Button>
            <Button onPress={() => setHandover(false)}>Đóng</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  summary: {
    backgroundColor: c.white,
    borderRadius: 22,
    padding: 16,
    gap: 16,
    boxShadow: '0 3px 14px rgba(25, 52, 82, 0.05)',
  },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  greeting: { flex: 1, minWidth: 165, gap: 4 },
  title: { color: s.navy },
  muted: { color: c.muted },
  status: {
    backgroundColor: s.greenSoft,
    borderRadius: 20,
  },
  statusText: { color: s.green },
  danger: { color: s.red },
  statusPending: { backgroundColor: c.soft },
  metrics: { flexDirection: 'row' },
  metric: { flex: 1 },
  metricContent: { alignItems: 'center', paddingHorizontal: 4, gap: 5 },
  metricLabel: { fontSize: 11, lineHeight: 16, textAlign: 'center', color: c.muted },
  divider: { borderLeftWidth: 1, borderLeftColor: c.border },
  section: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accent: { width: 4, height: 18, borderRadius: 2, backgroundColor: s.accent },
  grid: { flexDirection: 'row', gap: 12 },
  dialogActions: { flexDirection: 'column', alignItems: 'stretch' },
});
