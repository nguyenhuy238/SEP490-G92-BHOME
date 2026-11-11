import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, IconButton, Text, TouchableRipple, Checkbox } from 'react-native-paper';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { DebtInvoice, PaymentHistory } from '../../../../packages/client-core/src/payments';
import { paymentText } from '../../../../packages/client-core/src/payments';
import { signedVnd } from '../../../../packages/client-core/src/adjustments';
import {
  displayContractDate,
  formatContractMoney,
  businessToday,
} from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import {
  InvoiceDetailRow,
  InvoiceFeedback,
  InvoiceMoneyRow,
  InvoicePager,
  invoiceUi,
} from '../components/InvoiceDetailUi';
import { ChoiceField } from '../components/WorkflowControls';
import { TenantBillingTabs } from '../components/TenantBillingTabs';
import { TenantRefundPanel } from './TenantRefundPanel';
import { Pill } from '../components/WorkspaceKit';
import { colors } from '../theme/theme';
import { tenantPaymentLabel } from '../features/tenant/paymentPresentation';
import {
  ledgerPath,
  ledgerPeriod,
  loadLedgerPage,
  sortLedgerRows,
  verificationLabel,
  type LedgerFilters,
  type LedgerPage,
  type LedgerTab,
} from '../services/tenantPaymentHistory';

export function TenantPaymentHistoryScreen() {
  const { session } = useSession();
  if (!session?.roles.includes('Tenant'))
    return <Text>Tài khoản không có quyền xem lịch sử thanh toán Tenant.</Text>;
  return <PaymentLedger key={session.userId} />;
}
const emptyFilters: LedgerFilters = { period: '', roomId: '', overdueOnly: false };
function PaymentLedger() {
  const { api } = useSession();
  const { go } = useWorkspace();
  const { historyTab } = useLocalSearchParams<{ historyTab?: string }>();
  const [tab, setTab] = useState<LedgerTab>(
    historyTab === 'outstanding' ? 'outstanding' : 'verified',
  );
  const [pages, setPages] = useState({ verified: 1, outstanding: 1 });
  const [filters, setFilters] = useState<LedgerFilters>(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState('server');
  const cache = useRef<{
    api: typeof api;
    pages: Map<string, LedgerPage>;
    rooms: Map<string, string>;
  }>({ api: null, pages: new Map(), rooms: new Map() });
  const [roomState, setRoomState] = useState<{ api: typeof api; rooms: Map<string, string> }>({
    api: null,
    rooms: new Map(),
  });
  const rooms = roomState.api === api ? roomState.rooms : new Map<string, string>();
  const loader = useCallback(
    async (client: NonNullable<typeof api>, path: string, signal: AbortSignal) => {
      if (cache.current.api !== client)
        cache.current = { api: client, pages: new Map(), rooms: new Map() };
      const current = cache.current;
      const saved = current.pages.get(path);
      if (saved) return saved;
      const result = await loadLedgerPage(client, path, signal);
      if (!signal.aborted && cache.current === current) {
        if (current.pages.size >= 20) current.pages.delete(current.pages.keys().next().value!);
        current.pages.set(path, result);
        for (const row of result.items)
          current.rooms.set(row.roomId, `${row.roomNumber} · ${row.locationName}`);
        setRoomState({ api: client, rooms: new Map(current.rooms) });
      }
      return result;
    },
    [],
  );
  const path = ledgerPath(tab, pages[tab], filters);
  const query = useWorkspaceQuery<LedgerPage>(path, { load: loader, notifyError: false });
  const reload = query.reload;
  const refresh = useCallback(() => {
    cache.current.pages.clear();
    reload();
  }, [reload]);
  const focused = useRef(false),
    previousApi = useRef(api);
  useFocusEffect(
    useCallback(() => {
      if (focused.current && previousApi.current === api) refresh();
      previousApi.current = api;
      focused.current = true;
    }, [api, refresh]),
  );
  const header = useWorkspaceHeaderRefresh(refresh, query.loading, {
    title: 'Hóa đơn & thanh toán',
  });
  function chooseTab(next: LedgerTab) {
    setTab(next);
    setSort('server');
    router.setParams({ historyTab: next });
  }
  function apply(next: LedgerFilters, nextSort: string) {
    if (JSON.stringify(next) !== JSON.stringify(filters)) setPages({ verified: 1, outstanding: 1 });
    setFilters(next);
    setSort(nextSort);
    setFilterOpen(false);
  }
  const filtered = !!(
    filters.period ||
    filters.roomId ||
    (tab === 'outstanding' && filters.overdueOnly)
  );
  const rows = sortLedgerRows(query.data?.items ?? [], sort);
  const openInvoice = (invoiceId: string) =>
    go('invoice', { invoiceId, returnTo: 'billing-history', historyTab: tab });
  return (
    <>
      {!header && (
        <View style={invoiceUi.row}>
          <Text style={invoiceUi.pageTitle}>Hóa đơn & thanh toán</Text>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại giao dịch"
            onPress={refresh}
            disabled={query.loading}
          />
        </View>
      )}
      <View style={invoiceUi.surface}>
        <TenantRefundPanel />
        <TenantBillingTabs
          active={tab}
          select={(next) => (next === 'invoices' ? go('invoice') : chooseTab(next))}
        />
        <View style={{ paddingVertical: 12, gap: 8 }}>
          <Text style={invoiceUi.secondary}>
            Các khoản thanh toán và số tiền còn lại của hóa đơn chung của phòng.
          </Text>
          <View style={invoiceUi.row}>
            <Button
              compact
              icon="filter-variant"
              style={invoiceUi.inlineAction}
              onPress={() => setFilterOpen(!filterOpen)}
              accessibilityState={{ expanded: filterOpen }}
            >
              Bộ lọc{filtered ? ' •' : ''}
            </Button>
            {query.data && (
              <Text style={invoiceUi.secondary}>
                {query.data.totalCount} {tab === 'verified' ? 'khoản ghi nhận' : 'hóa đơn'}
              </Text>
            )}
          </View>
          {filterOpen && (
            <LedgerFilterForm
              key={`${filters.period}:${filters.roomId}:${filters.overdueOnly}:${tab}`}
              filters={filters}
              tab={tab}
              rooms={rooms}
              sort={sort}
              apply={apply}
              clear={() => apply(emptyFilters, 'server')}
            />
          )}
          {filtered && (
            <Text style={invoiceUi.secondary}>
              {[
                filters.period && `Kỳ ${periodLabel(filters.period)}`,
                filters.roomId && (rooms.get(filters.roomId) ?? 'Phòng đã chọn'),
                tab === 'outstanding' && filters.overdueOnly && 'Chỉ quá hạn',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
          {sort !== 'server' && (
            <Text style={invoiceUi.secondary}>
              {sort === 'amount' ? 'Số tiền giảm dần' : 'Ngày trả mới trước'} · Chỉ trang đang xem
            </Text>
          )}
          <InvoiceFeedback {...query} reload={refresh} />
          {query.data && !rows.length && (
            <Text style={invoiceUi.secondary}>
              {filtered
                ? 'Không có kết quả phù hợp bộ lọc.'
                : tab === 'verified'
                  ? 'Chưa có thanh toán đã xác minh.'
                  : 'Không có hóa đơn còn nợ.'}
            </Text>
          )}
        </View>
        {rows.map((item) =>
          'amount' in item ? (
            <HistoryRow key={item.id} item={item} openInvoice={openInvoice} />
          ) : (
            <DebtRow key={item.invoiceId} item={item} openInvoice={openInvoice} />
          ),
        )}
        {query.data && (
          <View style={{ paddingBottom: query.data.totalCount > query.data.pageSize ? 12 : 0 }}>
            <InvoicePager
              page={query.data.page}
              total={query.data.totalCount}
              loading={query.loading}
              onChange={(page) => setPages((before) => ({ ...before, [tab]: page }))}
            />
          </View>
        )}
      </View>
    </>
  );
}
function LedgerFilterForm({
  filters,
  tab,
  rooms,
  sort,
  apply,
  clear,
}: {
  filters: LedgerFilters;
  tab: LedgerTab;
  rooms: Map<string, string>;
  sort: string;
  apply: (value: LedgerFilters, sort: string) => void;
  clear: () => void;
}) {
  const [month, setMonth] = useState(filters.period.slice(5, 7));
  const [year, setYear] = useState(
    filters.period ? Number(filters.period.slice(0, 4)) : Number(businessToday().slice(0, 4)),
  );
  const [draftSort, setDraftSort] = useState(sort);
  const [roomId, setRoom] = useState(filters.roomId);
  const [overdue, setOverdue] = useState(filters.overdueOnly);
  const [error, setError] = useState('');
  return (
    <View style={invoiceUi.detail}>
      <ChoiceField
        label="Tháng"
        value={month}
        options={[
          { id: '', label: 'Tất cả kỳ' },
          ...Array.from({ length: 12 }, (_, i) => ({
            id: String(i + 1).padStart(2, '0'),
            label: `Tháng ${i + 1}`,
          })),
        ]}
        onChange={setMonth}
      />
      {!!month && (
        <View style={invoiceUi.row}>
          <Text style={invoiceUi.title}>Năm {year}</Text>
          <View style={invoiceUi.row}>
            <IconButton
              icon="chevron-left"
              accessibilityLabel="Năm trước"
              disabled={year <= 1}
              onPress={() => setYear(year - 1)}
            />
            <IconButton
              icon="chevron-right"
              accessibilityLabel="Năm sau"
              disabled={year >= 9999}
              onPress={() => setYear(year + 1)}
            />
          </View>
        </View>
      )}
      <ChoiceField
        label="Phòng"
        value={roomId}
        options={[
          { id: '', label: 'Tất cả phòng' },
          ...Array.from(rooms, ([id, label]) => ({ id, label })),
        ]}
        onChange={setRoom}
      />
      <Text style={invoiceUi.secondary}>Chọn từ những phòng đã xuất hiện trong danh sách.</Text>
      {tab === 'outstanding' && (
        <Checkbox.Item
          label="Chỉ hóa đơn quá hạn"
          status={overdue ? 'checked' : 'unchecked'}
          onPress={() => setOverdue(!overdue)}
        />
      )}
      <ChoiceField
        label="Sắp xếp"
        value={draftSort}
        options={[
          { id: 'server', label: 'Mặc định' },
          { id: 'amount', label: 'Số tiền giảm dần (trang này)' },
          ...(tab === 'verified' ? [{ id: 'date', label: 'Ngày trả mới trước (trang này)' }] : []),
        ]}
        onChange={setDraftSort}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={invoiceUi.secondary}>
          {error}
        </Text>
      )}
      <View style={invoiceUi.row}>
        <Button
          compact
          onPress={() => {
            try {
              apply(
                {
                  period: ledgerPeriod(month ? `${month}/${String(year).padStart(4, '0')}` : ''),
                  roomId,
                  overdueOnly: overdue,
                },
                draftSort,
              );
            } catch {
              setError('Vui lòng chọn lại kỳ hóa đơn.');
            }
          }}
        >
          Áp dụng
        </Button>
        <Button compact onPress={clear}>
          Xóa bộ lọc
        </Button>
      </View>
    </View>
  );
}
const periodLabel = (value: string) => value.slice(0, 7).split('-').reverse().join('/');
function LedgerRowHeader({
  title,
  subtitle,
  amount,
  expanded,
  toggle,
  label,
  date,
  amountLabel,
}: {
  title: string;
  subtitle: string;
  amount: string;
  expanded: boolean;
  toggle: () => void;
  label: string;
  date?: string;
  amountLabel?: string;
}) {
  return (
    <TouchableRipple
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={toggle}
    >
      <View style={invoiceUi.charge}>
        <View style={invoiceUi.chargeText}>
          <Text style={invoiceUi.title}>{title}</Text>
          <Text style={invoiceUi.secondary}>{subtitle}</Text>
          {!!date && <Text style={invoiceUi.secondary}>{date}</Text>}
        </View>
        <View style={{ flexShrink: 1, alignItems: 'flex-end', gap: 2 }}>
          {!!amountLabel && <Text style={invoiceUi.secondary}>{amountLabel}</Text>}
          <Text style={invoiceUi.chargeAmount}>{amount}</Text>
        </View>
        <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}
function HistoryRow({
  item,
  openInvoice,
}: {
  item: PaymentHistory;
  openInvoice: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={invoiceUi.chargeBorder}>
      <LedgerRowHeader
        title={`Phòng ${item.roomNumber} · ${periodLabel(item.billingPeriod)}`}
        subtitle={`Người trả: ${item.paidBy}`}
        amount={formatContractMoney(item.amount)}
        amountLabel="Đã ghi nhận"
        date={formatInstant(item.paidAt)}
        expanded={expanded}
        toggle={() => setExpanded(!expanded)}
        label={`Khoản thanh toán phòng ${item.roomNumber}, ${expanded ? 'thu gọn' : 'xem chi tiết'}`}
      />
      {expanded && (
        <View style={{ gap: 8, paddingBottom: 12 }}>
          <Button
            compact
            mode="outlined"
            style={invoiceUi.inlineAction}
            onPress={() => openInvoice(item.invoiceId)}
          >
            Xem hóa đơn liên quan
          </Button>
          <InvoiceDetailRow label="Cơ sở" value={item.locationName} />
          <InvoiceDetailRow
            label="Nguồn xác minh"
            value={verificationLabel(item.verificationSource)}
          />
        </View>
      )}
    </View>
  );
}
function DebtRow({ item, openInvoice }: { item: DebtInvoice; openInvoice: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const status =
    item.paidAmount === null
      ? paymentText(item.paymentStatus)
      : tenantPaymentLabel({
          paymentStatus: item.paymentStatus,
          paidAmount: item.paidAmount,
          outstandingAmount: item.outstandingAmount,
        });
  return (
    <View style={invoiceUi.chargeBorder}>
      <LedgerRowHeader
        title={`Phòng ${item.roomNumber} · ${periodLabel(item.billingPeriod)}`}
        subtitle={`Hạn thanh toán: ${displayContractDate(item.dueDate)}`}
        amount={formatContractMoney(item.outstandingAmount)}
        expanded={expanded}
        toggle={() => setExpanded(!expanded)}
        label={`Công nợ phòng ${item.roomNumber}, ${expanded ? 'thu gọn' : 'xem chi tiết'}`}
      />
      <View style={[invoiceUi.row, { paddingBottom: 12 }]}>
        <Text style={invoiceUi.secondary}>Còn phải thanh toán</Text>
        <Pill
          tone={item.overdueDays > 0 ? 'red' : item.paymentStatus === 'Paid' ? 'green' : 'blue'}
        >
          {item.overdueDays > 0 ? `Quá hạn ${item.overdueDays} ngày` : status}
        </Pill>
      </View>
      {expanded && (
        <View style={{ gap: 8, paddingBottom: 12 }}>
          <Button
            compact
            mode="outlined"
            style={invoiceUi.inlineAction}
            onPress={() => openInvoice(item.invoiceId)}
          >
            Xem hóa đơn
          </Button>
          <InvoiceDetailRow label="Cơ sở" value={item.locationName} />
          <InvoiceDetailRow label="Trạng thái thanh toán" value={status} />
          <NullableMoney label="Số tiền phải thanh toán" value={item.payableAmount} />
          <NullableMoney label="Đã ghi nhận" value={item.paidAmount} />
          <InvoiceMoneyRow label="Còn phải trả" value={item.outstandingAmount} />
          <NullableMoney label="Tiền hóa đơn gốc" value={item.originalIssuedAmount} />
          {item.approvedAdjustmentTotal != null ? (
            <InvoiceDetailRow
              label="Điều chỉnh đã duyệt"
              value={signedVnd(item.approvedAdjustmentTotal)}
            />
          ) : (
            <InvoiceDetailRow label="Điều chỉnh đã duyệt" value="Chưa có dữ liệu" />
          )}
          <NullableMoney label="Tiền thừa cần xem xét" value={item.potentialExcessAmount} />
          {item.potentialExcessAmount != null && /[1-9]/.test(item.potentialExcessAmount) && (
            <Text style={invoiceUi.secondary}>Khoản thừa chưa phải tiền hoàn đã xác nhận.</Text>
          )}
          <InvoiceDetailRow label="Hạn thanh toán" value={displayContractDate(item.dueDate)} />
          <InvoiceDetailRow label="Số ngày quá hạn" value={String(item.overdueDays)} />
        </View>
      )}
    </View>
  );
}
function NullableMoney({ label, value }: { label: string; value?: string | null }) {
  return value == null ? (
    <InvoiceDetailRow label={label} value="Chưa có dữ liệu" />
  ) : (
    <InvoiceMoneyRow label={label} value={value} />
  );
}
