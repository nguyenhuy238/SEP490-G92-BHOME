import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { DashboardCard, DashboardSection, DashboardSummary } from '../components/DashboardKit';
import {
  OwnerEmpty,
  OwnerFailure,
  OwnerLoading,
  OwnerRecordRow,
} from '../components/OwnerMobileKit';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { loadOwnerOverview } from '../services/ownerOverview';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { ownerQueuePolicy } from '../features/owner/ownerQueryPolicy';
import { useOwnerAttention } from '../features/owner/useOwnerAttention';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import type { MobileApi } from '../lib/api';
import type { DebtSummary } from '../../../../packages/client-core/src/payments';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import { colors, staffColors } from '../theme/theme';
import { typography } from '../theme/typography';
import { attentionTitle } from '../services/ownerAttention';
import { OwnerPlaceLabel } from '../features/owner/OwnerPlaceLabel';
import type { OperationalTask, TaskPage } from '../services/operationalTasks';
import { taskStatusLabels } from '../services/operationalTasks';

const loadOverview = (api: MobileApi, _path: string, signal: AbortSignal) =>
  loadOwnerOverview(api, signal);

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <DashboardCard style={styles.kpi}>
      <Text style={{ color: colors.muted }}>{label}</Text>
      <Text
        style={[
          typography.metric,
          { color: staffColors.navy },
          value.length > 9 && { fontSize: 18, lineHeight: 26 },
        ]}
      >
        {value.replace(/\u00a0/g, ' ')}
      </Text>
      <Text style={typography.secondary}>{detail}</Text>
    </DashboardCard>
  );
}

export function OwnerOverviewScreen() {
  const { api, session } = useSession();
  const { go } = useWorkspace();
  const owner = !!api && !!session?.roles.includes('Owner');
  const state = useWorkspaceQuery(owner ? '/owner-mobile/overview' : null, {
    cache: ownerQueuePolicy,
    load: loadOverview,
  });
  const debt = useWorkspaceQuery<DebtSummary>(owner ? '/api/v1/debts/summary' : null, {
    cache: ownerQueuePolicy,
  });
  const recent = useWorkspaceQuery<TaskPage<OperationalTask>>(
    owner ? '/api/v1/operational-tasks?page=1&pageSize=3' : null,
    { cache: ownerQueuePolicy },
  );
  const attention = useOwnerAttention();
  const { reload: reloadState } = state,
    { reload: reloadDebt } = debt,
    { reload: reloadAttention } = attention,
    { reload: reloadRecent } = recent;
  const refresh = useCallback(() => {
    reloadState();
    reloadDebt();
    reloadAttention();
    reloadRecent();
  }, [reloadState, reloadDebt, reloadAttention, reloadRecent]);
  useWorkspaceHeaderRefresh(
    refresh,
    state.fetching || debt.fetching || attention.fetching || recent.fetching,
    { title: 'Tổng quan' },
  );
  if (!owner) return <Text>Đăng nhập bằng tài khoản chủ cơ sở để xem tổng quan.</Text>;
  return (
    <>
      <DashboardSummary title="Tổng quan" detail="Nắm nhanh tình hình các cơ sở của bạn" />
      {state.loading && <OwnerLoading />}
      {(state.error || debt.error) && (
        <OwnerFailure retry={refresh} busy={state.fetching || debt.fetching} />
      )}
      <View style={styles.grid}>
        <Kpi
          label="Tổng số phòng"
          value={state.data ? String(state.data.rooms) : '—'}
          detail={state.data ? `${state.data.locations} cơ sở` : 'Chưa có dữ liệu'}
        />
        <Kpi
          label="Phòng đang ở"
          value={state.data ? String(state.data.occupiedRooms) : '—'}
          detail={
            state.data
              ? `Lấp đầy ${state.data.operationalOccupancyRate.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
              : 'Chưa có dữ liệu'
          }
        />
        <Kpi
          label="Còn phải thu"
          value={debt.data ? formatContractMoney(debt.data.outstandingAmount) : '—'}
          detail={
            debt.data ? `${debt.data.overdueInvoiceCount} hóa đơn quá hạn` : 'Chưa có dữ liệu'
          }
        />
        <Kpi
          label="Sự cố khẩn cấp"
          value={attention.emergencyCount === null ? '—' : String(attention.emergencyCount)}
          detail="Đang mở, cần theo dõi"
        />
      </View>
      <DashboardSection
        title="Cần xử lý"
        action="Xem tất cả"
        minActionHeight={48}
        onPress={() => go('approvals')}
      >
        <Text style={{ color: colors.muted }}>
          {attention.complete
            ? `${attention.totalKnown} mục cần theo dõi hoặc quyết định`
            : 'Đang tổng hợp các mục cần chú ý'}
        </Text>
        {attention.error && <OwnerFailure retry={reloadAttention} busy={attention.fetching} />}
        {attention.items.slice(0, 3).map(({ item, source }) => (
          <View key={`${source.path}:${item.id}`} style={{ gap: 6 }}>
            <OwnerRecordRow
              title={attentionTitle(item, source)}
              status={source.status}
              urgent={source.category === 'emergency'}
              action={source.action}
              onPress={() =>
                go(source.screen, {
                  [source.parameter]: item.id,
                  ...(source.screen === 'signing' ? { section: 'signing' } : {}),
                })
              }
            >
              <OwnerPlaceLabel item={item} />
            </OwnerRecordRow>
          </View>
        ))}
        {attention.loading && !attention.items.length && <OwnerLoading />}
        {attention.complete && attention.totalKnown === 0 && (
          <OwnerEmpty
            title="Bạn đã xem hết việc cần chú ý"
            detail="Các yêu cầu mới sẽ xuất hiện tại đây."
          />
        )}
      </DashboardSection>
      <DashboardSection
        title="Hoạt động vận hành"
        minActionHeight={48}
        action="Xem thêm"
        onPress={() => go('operations')}
      >
        {recent.loading && <OwnerLoading />}
        {!!recent.error && <OwnerFailure retry={reloadRecent} busy={recent.fetching} />}
        {recent.data?.items.map((task) => (
          <View key={task.id} style={{ gap: 6 }}>
            <OwnerRecordRow
              title={task.title}
              detail={task.result || task.requirements}
              status={taskStatusLabels[task.status] || 'Đang theo dõi'}
              urgent={task.isOverdue}
              onPress={() => go('task-detail', { taskId: task.id })}
            >
              <OwnerPlaceLabel item={task} />
            </OwnerRecordRow>
          </View>
        ))}
        {recent.data?.items.length === 0 && (
          <OwnerEmpty
            title="Chưa có hoạt động vận hành"
            detail="Công việc mới sẽ xuất hiện khi được giao trên Owner Web."
          />
        )}
      </DashboardSection>
    </>
  );
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpi: { flexBasis: '45%', flexGrow: 1, minWidth: 130, gap: 6, padding: 14 },
});
