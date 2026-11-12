import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Icon,
  ProgressBar,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';
import { useSession } from '../lib/SessionProvider';
import { errorMessage } from '../lib/api';
import { conciseMessage, showError } from '../lib/toast';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { loadOwnerOverview, type OwnerOverview } from '../services/ownerOverview';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function LinkRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <View style={styles.link}>
        <View style={styles.linkIcon}>
          <Icon source={icon} size={21} color={s.blue} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.secondary} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        <Icon source="chevron-right" size={18} color={c.muted} />
      </View>
    </TouchableRipple>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.secondary}>{label}</Text>
    </View>
  );
}

function OverviewCard({ data }: { data: OwnerOverview }) {
  const occupancy = Math.min(1, Math.max(0, data.operationalOccupancyRate / 100));
  return (
    <View style={styles.surface}>
      <View style={styles.metrics}>
        <Metric label="Cơ sở" value={String(data.locations)} />
        <Metric label="Phòng" value={String(data.rooms)} />
        <Metric label="Phòng đang ở" value={String(data.occupiedRooms)} />
        <Metric label="Hợp đồng" value={String(data.contracts)} />
      </View>
      <View style={styles.divider} />
      <View style={styles.occupancyHeading}>
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>Tỷ lệ lấp đầy</Text>
          <Text style={styles.secondary}>{data.availableRooms} phòng đang trống</Text>
        </View>
        <Text style={styles.occupancyValue}>{data.operationalOccupancyRate.toFixed(1)}%</Text>
      </View>
      <ProgressBar progress={occupancy} color={s.blue} style={styles.progress} />
    </View>
  );
}

export function OwnerOverviewScreen() {
  const { api, session } = useSession();
  const { go } = useWorkspace();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    data: OwnerOverview | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: '', loading: true });

  useEffect(() => {
    if (!api || !session?.roles.includes('Owner')) return;
    const controller = new AbortController();
    void loadOwnerOverview(api, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: '', loading: false });
      },
      (error) => {
        if (!controller.signal.aborted) {
          const message = conciseMessage(errorMessage(error));
          setState({ data: null, error: message, loading: false });
          showError(message);
        }
      },
    );
    return () => controller.abort();
  }, [api, session, revision]);

  if (!api || !session?.roles.includes('Owner'))
    return <Text>Cần đăng nhập Owner để xem tổng quan.</Text>;
  const reload = () => {
    setState({ data: null, error: '', loading: true });
    setRevision((value) => value + 1);
  };

  return (
    <View style={styles.page}>
      <View style={styles.intro}>
        <View style={styles.grow}>
          <Text style={styles.title}>Tổng quan BHOME</Text>
          <Text style={styles.secondary}>Theo dõi cơ sở và xử lý công việc quan trọng</Text>
        </View>
        <TouchableRipple
          borderless
          style={styles.refresh}
          onPress={reload}
          disabled={state.loading}
          accessibilityRole="button"
          accessibilityLabel="Tải lại dữ liệu"
        >
          {state.loading ? (
            <ActivityIndicator size={20} accessibilityLabel="Đang tải tổng quan" />
          ) : (
            <Icon source="refresh" size={22} color={s.blue} />
          )}
        </TouchableRipple>
      </View>

      {!!state.error && (
        <View style={styles.errorBox}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {state.error}
          </Text>
          <Button compact onPress={reload}>
            Tải lại dữ liệu
          </Button>
        </View>
      )}
      {state.data && <OverviewCard data={state.data} />}

      <Section title="Cần xử lý">
        <View style={styles.surface}>
          <LinkRow
            icon="clipboard-check-outline"
            title="Phê duyệt"
            detail="Yêu cầu và quyết định đang chờ"
            onPress={() => go('approvals')}
          />
          <View style={styles.rowDivider} />
          <LinkRow
            icon="tune-variant"
            title="Vận hành"
            detail="Công việc, phòng và tình trạng cơ sở"
            onPress={() => go('operations')}
          />
          <View style={styles.rowDivider} />
          <LinkRow
            icon="tools"
            title="Sự cố và bảo trì"
            detail="Theo dõi sự cố, khẩn cấp và lệnh sửa chữa"
            onPress={() => go('owner-incidents')}
          />
        </View>
      </Section>

      <Section title="Quản lý">
        <View style={styles.surface}>
          <LinkRow
            icon="file-document-outline"
            title="Hợp đồng & Vòng đời"
            detail="Theo dõi ký, kích hoạt và trạng thái hợp đồng"
            onPress={() => go('signing')}
          />
          <View style={styles.rowDivider} />
          <LinkRow
            icon="chart-line"
            title="Tài chính"
            detail="Doanh thu, công nợ và chi phí"
            onPress={() => go('owner-finance')}
          />
          <View style={styles.rowDivider} />
          <LinkRow
            icon="bullhorn-outline"
            title="Thông báo đã gửi"
            detail="Xem lại thông tin đã gửi tới người dùng"
            onPress={() => go('owner-announcements')}
          />
        </View>
      </Section>

      <View style={styles.surface}>
        <LinkRow
          icon="account-cog-outline"
          title="Tài khoản & Đăng xuất"
          detail="Thông tin cá nhân, bảo mật và tùy chọn"
          onPress={() => go('profile')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', gap: 22 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 },
  title: { ...typography.screenTitle, color: '#173654' },
  secondary: { ...typography.secondary, color: c.muted, flexShrink: 1 },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  refresh: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: s.blueSoft,
  },
  surface: {
    backgroundColor: c.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  section: { gap: 12 },
  sectionTitle: { ...typography.sectionHeading, color: '#173654' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', padding: 8 },
  metric: { width: '50%', minHeight: 82, padding: 10, justifyContent: 'center', gap: 3 },
  metricValue: { ...typography.value, color: '#173654', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: c.border, marginHorizontal: 16 },
  occupancyHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  occupancyValue: { ...typography.value, color: s.blue, fontVariant: ['tabular-nums'] },
  progress: { height: 6, borderRadius: 3, margin: 16, marginTop: 12 },
  link: { minHeight: 70, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  linkIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: s.blueSoft,
  },
  rowTitle: { ...typography.link, color: '#173654' },
  rowDivider: { height: 1, backgroundColor: c.border, marginLeft: 64 },
  errorBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: c.redSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { ...typography.secondary, color: c.red, flex: 1 },
});
