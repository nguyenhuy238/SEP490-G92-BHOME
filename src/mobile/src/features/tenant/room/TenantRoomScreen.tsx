import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import {
  displayContractDate,
  formatContractMoney,
  text,
} from '../../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Pill, ui } from '../../../components/WorkspaceKit';
import { ChoiceField } from '../../../components/WorkflowControls';
import { useWorkspaceHeaderRefresh } from '../../../components/WorkspaceHeaderContext';
import { useTenantTenancy } from './useTenantTenancy';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { colors as c } from '../../../theme/theme';

function Field({
  label,
  value,
  money = false,
  half = false,
}: {
  label: string;
  value: string;
  money?: boolean;
  half?: boolean;
}) {
  return (
    <View style={[styles.field, half && styles.half]}>
      <Text variant="labelSmall" style={ui.muted}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={money ? ui.money : styles.value}>
        {value}
      </Text>
    </View>
  );
}
function Feedback({
  loading,
  error,
  retry,
  label,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  label: string;
}) {
  if (loading)
    return (
      <View style={styles.feedback}>
        <ActivityIndicator size="small" />
        <Text style={ui.muted}>{label}</Text>
      </View>
    );
  if (!error) return null;
  return (
    <View style={styles.feedback}>
      <Text accessibilityRole="alert" style={[ui.grow, ui.red]}>
        {error}
      </Text>
      <Button compact onPress={retry}>
        Thử lại
      </Button>
    </View>
  );
}

function ExpandableDetails({
  title,
  summary,
  expanded,
  onPress,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <TouchableRipple
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={summary}
        accessibilityState={{ expanded }}
        style={styles.sectionToggle}
      >
        <View style={styles.sectionToggleContent}>
          <View style={ui.grow}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {title}
            </Text>
            <Text variant="bodySmall" style={ui.muted}>
              {summary}
            </Text>
          </View>
          <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={c.muted} />
        </View>
      </TouchableRipple>
      {expanded && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

type TenantScope = ReturnType<typeof useTenantTenancy>;

// Remount on contract change so an expanded section from a different tenancy
// never stays open while the new contract's data is loading.
function RoomExtraDetails({
  contract,
  scope,
  openHandover,
}: {
  contract: NonNullable<TenantScope['detail']['data']>;
  scope: TenantScope;
  openHandover: () => void;
}) {
  const [occupantsOpen, setOccupantsOpen] = React.useState(false);
  const [handoverOpen, setHandoverOpen] = React.useState(false);
  const record = scope.handover.data;
  return (
    <Box style={styles.moreDetails}>
      <View style={styles.moreHeading}>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Thông tin thêm
        </Text>
        <Text variant="bodySmall" style={ui.muted}>
          Mở khi bạn muốn kiểm tra chi tiết
        </Text>
      </View>
      <ExpandableDetails
        title="Người ở trong hợp đồng"
        summary={
          contract.occupants?.length
            ? `${contract.occupants.length} người · Xem thông tin`
            : 'Xem thông tin người ở'
        }
        expanded={occupantsOpen}
        onPress={() => setOccupantsOpen((value) => !value)}
      >
        {contract.occupants?.length ? (
          contract.occupants.map((person) => (
            <View key={person.id} style={styles.person}>
              <View style={styles.avatar}>
                <Icon source="account-outline" size={20} color={c.primary} />
              </View>
              <View style={ui.grow}>
                <Text>{person.label}</Text>
                {person.representative && <Pill tone="neutral">Người đại diện</Pill>}
              </View>
            </View>
          ))
        ) : (
          <Text style={ui.muted}>Chưa có thông tin người ở trong hợp đồng này.</Text>
        )}
      </ExpandableDetails>
      <ExpandableDetails
        title="Thông tin bàn giao"
        summary={
          scope.handover.loading
            ? 'Đang tải biên bản…'
            : scope.handover.error
              ? 'Không tải được biên bản · Nhấn để thử lại'
              : record
                ? `Biên bản ${text(record.status)} · Xem hiện trạng và chứng từ`
                : 'Chưa có biên bản · Xem tình trạng bàn giao'
        }
        expanded={handoverOpen}
        onPress={() => setHandoverOpen((value) => !value)}
      >
        <Feedback {...scope.handover} retry={scope.handover.reload} label="Đang tải bàn giao…" />
        {!scope.handover.loading && !scope.handover.error && !record && (
          <>
            <Text>Chưa có biên bản bàn giao</Text>
            <Text style={ui.muted}>Biên bản sẽ hiển thị khi được tạo cho hợp đồng này.</Text>
          </>
        )}
        {record && (
          <>
            <View style={styles.roomHeading}>
              <Pill tone="neutral">{text(record.status)}</Pill>
              <Text style={ui.muted}>{displayContractDate(record.snapshot.date)}</Text>
            </View>
            <Field
              label="Tình trạng phòng"
              value={record.snapshot.roomCondition || 'Chưa ghi nhận'}
            />
            <Field
              label="Chìa khóa / ra vào"
              value={record.snapshot.keysAndAccess || 'Chưa ghi nhận'}
            />
            <View style={styles.grid}>
              <Field half label="Điện ban đầu" value={`${record.snapshot.electricity.value} kWh`} />
              <Field half label="Nước ban đầu" value={`${record.snapshot.water.value} m³`} />
            </View>
            <Field
              label="Bạn xác nhận lúc"
              value={
                record.tenantConfirmedAt ? formatInstant(record.tenantConfirmedAt) : 'Chưa xác nhận'
              }
            />
            <View style={ui.line} />
            <Text variant="labelMedium">Tài sản bàn giao · {record.snapshot.assets.length}</Text>
            {record.snapshot.assets.slice(0, 3).map((asset) => (
              <Text key={asset.id} numberOfLines={2}>
                {asset.name}: {asset.observedCondition}
              </Text>
            ))}
            {record.snapshot.assets.length > 3 && (
              <Text style={ui.muted}>
                Xem thêm {record.snapshot.assets.length - 3} tài sản trong biên bản.
              </Text>
            )}
            {!record.snapshot.assets.length && (
              <Text style={ui.muted}>Biên bản không có tài sản được ghi nhận.</Text>
            )}
            <Text variant="labelSmall" style={ui.muted}>
              Hiện trạng tại ngày bàn giao, không phải kiểm kê hiện tại.
            </Text>
            <Action secondary onPress={openHandover}>
              Xem biên bản bàn giao và bằng chứng
            </Action>
          </>
        )}
      </ExpandableDetails>
    </Box>
  );
}
export function TenantRoomScreen() {
  const scope = useTenantTenancy();
  const { go } = useWorkspace();
  const busy = scope.contracts.loading || scope.detail.loading || scope.handover.loading;
  useWorkspaceHeaderRefresh(scope.reload, busy);
  const contract = scope.detail.data;
  const multiplePages = (scope.contracts.data?.totalCount ?? 0) > 20;
  const openContract = (section: 'overview' | 'handover') => {
    if (contract)
      go(section === 'handover' ? 'checklist' : 'contract', { contractId: contract.id, section });
  };
  return (
    <>
      <View style={styles.header}>
        <View style={ui.grow}>
          <Heading title="Phòng của tôi" detail="Thông tin phòng thuê và hợp đồng hiện hành" />
        </View>
        <IconButton
          icon="refresh"
          accessibilityLabel="Tải lại phòng của tôi"
          disabled={busy}
          onPress={scope.reload}
        />
      </View>
      <Feedback {...scope.contracts} retry={scope.contracts.reload} label="Đang tải phòng thuê…" />
      {!scope.contracts.loading && !scope.contracts.error && !scope.items.length && (
        <Box style={styles.card}>
          <Text variant="titleMedium">Chưa có hợp đồng đang hiệu lực trên trang này.</Text>
          <Text style={ui.muted}>Phòng thuê sẽ hiển thị theo hợp đồng được cấp quyền.</Text>
          <Button compact onPress={() => go('contract')}>
            Xem hợp đồng của tôi
          </Button>
        </Box>
      )}
      {(scope.items.length > 1 ||
        ((multiplePages || scope.selectionUnavailable) && scope.items.length > 0)) && (
        <ChoiceField
          label="Chọn hợp đồng đang thuê"
          value={scope.current?.id ?? ''}
          onChange={scope.select}
          options={scope.items.map((item) => ({
            id: item.id,
            label: `Phòng ${item.roomNumber} · ${item.locationName} · ${displayContractDate(item.startDate)} – ${displayContractDate(item.endDate)} · ${text(item.kind)}`,
          }))}
        />
      )}
      {!scope.contracts.loading && (scope.items.length > 1 || multiplePages) && !scope.selected && (
        <Text style={ui.muted}>Chọn hợp đồng để xem phòng và thông tin bàn giao.</Text>
      )}
      {scope.selectionUnavailable && (
        <Text accessibilityRole="alert" style={ui.muted}>
          Hợp đồng đã chọn không còn trên trang này. Hãy chọn lại hợp đồng; phòng không được tự
          chuyển.
        </Text>
      )}
      {scope.current && (
        <>
          <Feedback
            {...scope.detail}
            retry={scope.detail.reload}
            label="Đang tải thông tin hợp đồng…"
          />
          {contract && (
            <>
              <Box style={styles.primaryCard}>
                <View style={styles.roomHeading}>
                  <View style={ui.grow}>
                    <Text variant="headlineMedium" style={styles.room}>
                      Phòng {contract.roomNumber}
                    </Text>
                    <Text style={ui.muted}>{contract.locationName}</Text>
                  </View>
                  <Pill tone={contract.status === 'Active' ? 'green' : 'neutral'}>
                    {text(contract.status)}
                  </Pill>
                </View>
                <Text variant="labelMedium" style={ui.muted}>
                  {text(contract.kind)}
                </Text>
                <View style={styles.rentBlock}>
                  <Text variant="labelMedium" style={ui.muted}>
                    Giá thuê / tháng
                  </Text>
                  <Text variant="headlineMedium" style={styles.rentValue}>
                    {formatContractMoney(contract.monthlyRent)}
                  </Text>
                </View>
                <View style={styles.grid}>
                  <Field
                    half
                    label="Ngày bắt đầu"
                    value={displayContractDate(contract.startDate)}
                  />
                  <Field half label="Ngày kết thúc" value={displayContractDate(contract.endDate)} />
                </View>
                <Field
                  label="Tiền cọc yêu cầu"
                  value={formatContractMoney(contract.requiredDeposit)}
                  money
                />
                <Action onPress={() => openContract('overview')} minHeight={48}>
                  Xem hợp đồng và quyền lợi
                </Action>
              </Box>
              <RoomExtraDetails
                key={contract.id}
                contract={contract}
                scope={scope}
                openHandover={() => openContract('handover')}
              />
            </>
          )}
        </>
      )}
      {scope.contracts.data && scope.contracts.data.totalCount > 20 && (
        <View style={styles.paging}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Trang hợp đồng trước"
            disabled={busy || scope.page <= 1}
            onPress={() => scope.setPage(scope.page - 1)}
          />
          <Text style={ui.muted}>
            Trang {scope.page} / {Math.ceil(scope.contracts.data.totalCount / 20)}
          </Text>
          <IconButton
            icon="chevron-right"
            accessibilityLabel="Trang hợp đồng sau"
            disabled={busy || scope.page * 20 >= scope.contracts.data.totalCount}
            onPress={() => scope.setPage(scope.page + 1)}
          />
        </View>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { gap: 12, padding: 16, borderColor: c.border },
  primaryCard: { gap: 14, padding: 16, borderColor: c.border },
  rentBlock: { gap: 4, paddingVertical: 4 },
  rentValue: { color: c.navy, fontVariant: ['tabular-nums'] },
  moreDetails: { gap: 0, padding: 0, borderColor: c.border, overflow: 'hidden' },
  moreHeading: { padding: 14, gap: 3 },
  sectionTitle: { color: c.navy },
  section: { borderTopWidth: 1, borderTopColor: c.border },
  sectionToggle: { minHeight: 62, justifyContent: 'center' },
  sectionToggleContent: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  sectionBody: { gap: 12, paddingHorizontal: 14, paddingBottom: 16 },
  roomHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  room: { color: c.navy, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { minWidth: 0, gap: 4 },
  half: { flexGrow: 1, flexBasis: '45%', minWidth: 100 },
  value: { color: c.ink, flexShrink: 1 },
  person: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedback: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  paging: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
