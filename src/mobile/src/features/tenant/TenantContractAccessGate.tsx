import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import type {
  ContractPage,
  ContractSummary,
  ContractView,
} from '../../../../../packages/client-core/src/contracts';
import {
  displayContractDate,
  formatContractMoney,
  text,
} from '../../../../../packages/client-core/src/contracts';
import { Page, styles } from '../../components/Controls';
import type { MobileApi } from '../../lib/api';
import { useSession } from '../../lib/SessionProvider';
import { colors } from '../../theme/theme';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { isActiveRoomRental } from './tenantContractEligibility';
import { TenantCurrentRentalContext } from './TenantCurrentRentalContext';

const accessPageSize = 100;

function validPage(value: ContractPage, expectedPage: number, pageSize: number) {
  return (
    !!value &&
    Array.isArray(value.items) &&
    value.page === expectedPage &&
    value.pageSize === pageSize &&
    Number.isSafeInteger(value.totalCount) &&
    value.totalCount >= 0 &&
    value.items.length <= pageSize &&
    value.items.every(
      (item) =>
        !!item &&
        typeof item.id === 'string' &&
        typeof item.roomId === 'string' &&
        typeof item.kind === 'string' &&
        typeof item.status === 'string',
    )
  );
}

/** Always inspect all Active pages: the first page might contain only Holding contracts. */
export async function findActiveRoomRental(
  api: MobileApi,
  signal: AbortSignal,
): Promise<ContractSummary | null> {
  for (let page = 1; ; page++) {
    const data = await api.request<ContractPage>(
      `/api/v1/contracts?page=${page}&pageSize=${accessPageSize}&status=Active`,
      { signal },
    );
    if (!validPage(data, page, accessPageSize) || (data.items.length === 0 && data.totalCount > 0))
      throw new Error('Không xác minh được danh sách hợp đồng.');
    const rental = data.items.find(isActiveRoomRental);
    if (rental) return rental;
    if (page * accessPageSize >= data.totalCount) return null;
  }
}

export async function hasActiveRoomRental(api: MobileApi, signal: AbortSignal): Promise<boolean> {
  return !!(await findActiveRoomRental(api, signal));
}

/** Renders before Expo Router: no tab, deep link, notification or previous screen mounts. */
export function TenantContractAccessGate({ children }: { children: React.ReactNode }) {
  const { role, preview } = useWorkspace();
  const { session } = useSession();
  return role === 'Tenant' && !preview && session ? (
    <TenantContractAccess key={session.userId}>{children}</TenantContractAccess>
  ) : (
    <>{children}</>
  );
}

type Access = 'checking' | 'active' | 'restricted' | 'error';

function TenantContractAccess({ children }: { children: React.ReactNode }) {
  const { api, logout } = useSession();
  const [access, setAccess] = useState<Access>('checking');
  const [rental, setRental] = useState<ContractSummary | null>(null);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(
    (preserveActiveScreen = false) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      // Periodic checks must not destroy an in-progress form every minute.
      // The very first check, manual retry and non-active states still fail closed.
      setAccess((current) => (preserveActiveScreen && current === 'active' ? current : 'checking'));
      if (!api) {
        setAccess('error');
        return;
      }
      void findActiveRoomRental(api, controller.signal).then(
        (found) => {
          if (!controller.signal.aborted) {
            setRental(found);
            setAccess(found ? 'active' : 'restricted');
          }
        },
        () => {
          if (!controller.signal.aborted) setAccess('error');
        },
      );
    },
    [api],
  );
  useEffect(() => {
    // The first check runs after effect setup; initial render is already fail closed.
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) refresh();
    });
    // Recheck on app resume and periodically while it stays open, including after move-out.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh(true);
    });
    const interval = setInterval(() => refresh(true), 60_000);
    return () => {
      mounted = false;
      pending.current?.abort();
      appState.remove();
      clearInterval(interval);
    };
  }, [refresh]);
  if (access === 'active' && rental)
    return (
      <TenantCurrentRentalContext.Provider value={rental}>
        {children}
      </TenantCurrentRentalContext.Provider>
    );
  return (
    <Page>
      {access === 'checking' ? (
        <View style={styles.row}>
          <ActivityIndicator accessibilityLabel="Đang kiểm tra hợp đồng thuê" />
          <Text>Đang kiểm tra phòng và hợp đồng của bạn…</Text>
        </View>
      ) : access === 'error' ? (
        <View style={styles.row}>
          <Text variant="titleLarge">Chưa kiểm tra được hợp đồng</Text>
          <Text accessibilityRole="alert">
            Không thể xác minh hợp đồng thuê hiện tại. Các chức năng tạm khóa để bảo vệ dữ liệu của
            bạn.
          </Text>
          <Button mode="contained" onPress={() => refresh()}>
            Thử lại
          </Button>
        </View>
      ) : (
        <NoCurrentRental onLogout={() => void logout().catch(() => {})} />
      )}
      {access !== 'restricted' && (
        <Button onPress={() => void logout().catch(() => {})}>Đăng xuất</Button>
      )}
    </Page>
  );
}

function NoCurrentRental({ onLogout }: { onLogout: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <View style={restrictedStyles.screen}>
      {showHistory ? (
        <View style={restrictedStyles.history}>
          <TenantContractHistory onExit={() => setShowHistory(false)} />
        </View>
      ) : (
        <View style={restrictedStyles.emptyState}>
          <View style={restrictedStyles.iconContainer}>
            <Icon source="home-outline" size={36} color={colors.primary} />
          </View>
          <Text variant="headlineSmall" style={restrictedStyles.title}>
            Bạn hiện không có phòng đang thuê
          </Text>
          <Text variant="bodyMedium" style={restrictedStyles.description}>
            Hiện chưa có hợp đồng thuê phòng đang hiệu lực. Bạn vẫn có thể xem lại lịch sử hợp đồng
            của mình.
          </Text>
          <Button
            mode="contained"
            icon="file-document-outline"
            style={restrictedStyles.primaryButton}
            contentStyle={restrictedStyles.primaryButtonContent}
            onPress={() => setShowHistory(true)}
          >
            Xem lịch sử hợp đồng
          </Button>
        </View>
      )}
      <View style={restrictedStyles.footer}>
        <Button mode="text" icon="logout" textColor={colors.muted} onPress={onLogout}>
          Đăng xuất
        </Button>
      </View>
    </View>
  );
}

const restrictedStyles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  emptyState: {
    flex: 1,
    minHeight: 400,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  iconContainer: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: colors.tint,
    marginBottom: 28,
  },
  title: {
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 330,
  },
  primaryButton: {
    alignSelf: 'stretch',
    marginTop: 32,
    borderRadius: 14,
  },
  primaryButtonContent: {
    minHeight: 52,
  },
  history: {
    flex: 1,
    gap: 16,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 8,
  },
});

const historyStyles = StyleSheet.create({
  header: {
    gap: 10,
    paddingBottom: 8,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginLeft: -10,
  },
  heading: {
    color: colors.ink,
  },
  subtitle: {
    color: colors.muted,
    lineHeight: 20,
  },
  list: {
    gap: 12,
  },
  item: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  itemHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemHeadingText: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    color: colors.ink,
    flexShrink: 1,
  },
  itemMeta: {
    color: colors.muted,
    lineHeight: 19,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.soft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: colors.primary,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  dateText: {
    flex: 1,
    color: colors.muted,
    lineHeight: 20,
  },
  itemAction: {
    alignSelf: 'flex-start',
    marginLeft: -10,
  },
  detail: {
    gap: 24,
  },
  detailHero: {
    gap: 10,
    paddingTop: 4,
  },
  detailHeroTitle: {
    color: colors.ink,
  },
  detailSection: {
    gap: 15,
  },
  detailSectionTitle: {
    color: colors.ink,
  },
  infoSurface: {
    backgroundColor: colors.soft,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  infoField: {
    gap: 4,
  },
  fieldLabel: {
    color: colors.muted,
  },
  fieldValue: {
    color: colors.ink,
    lineHeight: 21,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  terms: {
    color: colors.ink,
    lineHeight: 23,
  },
  empty: {
    gap: 10,
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 12,
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 21,
  },
  error: {
    gap: 8,
    alignItems: 'flex-start',
  },
});

function TenantContractHistory({ onExit }: { onExit: () => void }) {
  const { api } = useSession();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<{
    key: string;
    items: ContractSummary[];
    totalCount: number;
    error: boolean;
  } | null>(null);
  const key = `${page}:${revision}`;
  const loading = listing?.key !== key;
  const error = !loading && !!listing?.error;
  const items = listing?.items ?? [];
  const totalCount = listing?.totalCount ?? 0;
  const [selected, setSelected] = useState<ContractSummary | null>(null);
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .request<ContractPage>(`/api/v1/contracts?page=${page}&pageSize=20`, {
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          if (!validPage(result, page, 20)) throw new Error('Invalid contract page');
          setListing((previous) => ({
            key,
            items: page === 1 ? result.items : [...(previous?.items ?? []), ...result.items],
            totalCount: result.totalCount,
            error: false,
          }));
        },
        () => {
          if (!controller.signal.aborted) {
            setListing((previous) => ({
              key,
              items: previous?.items ?? [],
              totalCount: previous?.totalCount ?? 0,
              error: true,
            }));
          }
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setListing((previous) => ({
            key,
            items: previous?.items ?? [],
            totalCount: previous?.totalCount ?? 0,
            error: true,
          }));
        }
      });
    return () => controller.abort();
  }, [api, page, revision, key]);
  const retry = () => setRevision((value) => value + 1);
  return (
    <View style={restrictedStyles.history}>
      <View style={historyStyles.header}>
        <Button
          icon="arrow-left"
          style={historyStyles.backButton}
          onPress={() => (selected ? setSelected(null) : onExit())}
        >
          Quay lại
        </Button>
        <Text variant="headlineSmall" style={historyStyles.heading}>
          {selected ? 'Chi tiết hợp đồng' : 'Lịch sử hợp đồng'}
        </Text>
        {!selected && (
          <Text variant="bodyMedium" style={historyStyles.subtitle}>
            Những hợp đồng đã được ghi nhận trong tài khoản của bạn.
          </Text>
        )}
      </View>
      {selected ? (
        <TenantHistoricalContractDetail contract={selected} />
      ) : (
        <View style={historyStyles.list}>
          {items.map((contract) => (
            <View key={contract.id} style={historyStyles.item}>
              <View style={historyStyles.itemHeading}>
                <Icon source="home-outline" color={colors.primary} size={22} />
                <View style={historyStyles.itemHeadingText}>
                  <Text variant="titleMedium" style={historyStyles.itemTitle}>
                    Phòng {contract.roomNumber}
                  </Text>
                  <Text variant="bodySmall" style={historyStyles.itemMeta}>
                    {contract.locationName}
                  </Text>
                </View>
              </View>
              <View style={historyStyles.badge}>
                <Text variant="labelSmall" style={historyStyles.badgeText}>
                  {text(contract.kind)} · {text(contract.status)}
                </Text>
              </View>
              <View style={historyStyles.dateRow}>
                <Icon source="calendar-month-outline" size={18} color={colors.muted} />
                <Text variant="bodySmall" style={historyStyles.dateText}>
                  {displayContractDate(contract.startDate)} –{' '}
                  {displayContractDate(contract.endDate)}
                </Text>
              </View>
              <View style={historyStyles.divider} />
              <Button
                icon="file-document-outline"
                style={historyStyles.itemAction}
                onPress={() => setSelected(contract)}
              >
                Xem chi tiết hợp đồng
              </Button>
            </View>
          ))}
          {!loading && !error && totalCount === 0 && (
            <View style={historyStyles.empty}>
              <Icon source="file-document-outline" color={colors.muted} size={30} />
              <Text style={historyStyles.emptyText}>
                Bạn chưa có lịch sử hợp đồng trong hệ thống.
              </Text>
            </View>
          )}
          {loading && <ActivityIndicator accessibilityLabel="Đang tải lịch sử hợp đồng" />}
          {error && (
            <View style={historyStyles.error}>
              <Text accessibilityRole="alert">Không tải được lịch sử hợp đồng.</Text>
              <Button onPress={retry}>Thử tải lại</Button>
            </View>
          )}
          {!loading && !error && items.length < totalCount && (
            <Button onPress={() => setPage((value) => value + 1)}>Xem thêm hợp đồng</Button>
          )}
        </View>
      )}
    </View>
  );
}

function TenantHistoricalContractDetail({ contract }: { contract: ContractSummary }) {
  const { api } = useSession();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    detail: ContractView | null;
    error: boolean;
  } | null>(null);
  const detail = result?.revision === revision ? result.detail : null;
  const error = result?.revision === revision && result.error;
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .request<ContractView>(`/api/v1/contracts/${encodeURIComponent(contract.id)}`, {
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (!controller.signal.aborted) {
            if (result.id !== contract.id) setResult({ revision, detail: null, error: true });
            else setResult({ revision, detail: result, error: false });
          }
        },
        () => {
          if (!controller.signal.aborted) setResult({ revision, detail: null, error: true });
        },
      );
    return () => controller.abort();
  }, [api, contract.id, revision]);
  return (
    <View style={historyStyles.detail}>
      <View style={historyStyles.detailHero}>
        <Text variant="titleLarge" style={historyStyles.detailHeroTitle}>
          Phòng {contract.roomNumber}
        </Text>
        <Text variant="bodyMedium" style={historyStyles.subtitle}>
          {contract.locationName}
        </Text>
        <View style={historyStyles.badge}>
          <Text variant="labelSmall" style={historyStyles.badgeText}>
            {text(contract.status)}
          </Text>
        </View>
      </View>
      <View style={historyStyles.detailSection}>
        <Text variant="titleMedium" style={historyStyles.detailSectionTitle}>
          Thông tin hợp đồng
        </Text>
        <View style={historyStyles.infoSurface}>
          <View style={historyStyles.infoField}>
            <Text variant="labelMedium" style={historyStyles.fieldLabel}>
              Loại hợp đồng
            </Text>
            <Text variant="bodyMedium" style={historyStyles.fieldValue}>
              {text(contract.kind)}
            </Text>
          </View>
          <View style={historyStyles.divider} />
          <View style={historyStyles.infoField}>
            <Text variant="labelMedium" style={historyStyles.fieldLabel}>
              Thời hạn
            </Text>
            <Text variant="bodyMedium" style={historyStyles.fieldValue}>
              {displayContractDate(contract.startDate)} – {displayContractDate(contract.endDate)}
            </Text>
          </View>
          <View style={historyStyles.divider} />
          <View style={historyStyles.infoField}>
            <Text variant="labelMedium" style={historyStyles.fieldLabel}>
              Tiền thuê theo hợp đồng
            </Text>
            <Text variant="titleMedium" style={historyStyles.fieldValue}>
              {formatContractMoney(contract.monthlyRent)}
            </Text>
          </View>
        </View>
      </View>
      <View style={historyStyles.detailSection}>
        <Text variant="titleMedium" style={historyStyles.detailSectionTitle}>
          Điều khoản hợp đồng
        </Text>
        {detail && (
          <Text selectable variant="bodyMedium" style={historyStyles.terms}>
            {detail.terms || 'Không có thông tin.'}
          </Text>
        )}
        {!detail && !error && <ActivityIndicator accessibilityLabel="Đang tải chi tiết hợp đồng" />}
        {error && (
          <View style={historyStyles.error}>
            <Text accessibilityRole="alert">Không tải được chi tiết hợp đồng.</Text>
            <Button onPress={() => setRevision((value) => value + 1)}>Thử tải lại</Button>
          </View>
        )}
      </View>
    </View>
  );
}
